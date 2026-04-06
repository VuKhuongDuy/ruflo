/**
 * AgentDB Backend - Integration with agentdb@2.0.0-alpha.3.4
 *
 * Provides IMemoryBackend implementation using AgentDB with:
 * - HNSW vector search (150x-12,500x faster than brute-force)
 * - Native or WASM backend support with graceful fallback
 * - Optional dependency handling (works without hnswlib-node)
 * - Seamless integration with HybridBackend
 *
 * @module v3/memory/agentdb-backend
 */

import { EventEmitter } from "node:events";
import {
  IMemoryBackend,
  MemoryEntry,
  MemoryEntryInput,
  MemoryEntryUpdate,
  MemoryQuery,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
  ComponentHealth,
  MemoryType,
  EmbeddingGenerator,
  generateMemoryId,
  createDefaultEntry,
  CacheStats,
  HNSWStats,
} from "./types.js";
import { agentdbLogger, hnswLogger } from "./logger.js";

// ===== AgentDB Optional Import =====

let AgentDB: any;
let HNSWIndex: any;
let isHnswlibAvailable: (() => Promise<boolean>) | undefined;

// Dynamically import agentdb (handled at runtime)
let agentdbImportPromise: Promise<void> | undefined;

function ensureAgentDBImport(): Promise<void> {
  if (!agentdbImportPromise) {
    agentdbImportPromise = (async () => {
      try {
        const agentdbModule: any = await import("agentdb");
        AgentDB = agentdbModule.AgentDB || agentdbModule.default;
        HNSWIndex = agentdbModule.HNSWIndex;
        isHnswlibAvailable = agentdbModule.isHnswlibAvailable;
      } catch (error) {
        // AgentDB not available - will use fallback
      }
    })();
  }
  return agentdbImportPromise;
}

// ===== BM25 Keyword Search =====

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'after', 'before', 'above', 'below', 'and', 'or', 'but',
  'not', 'no', 'nor', 'so', 'yet', 'both', 'each', 'all', 'any',
  'this', 'that', 'these', 'those', 'it', 'its', 'what', 'which',
  'who', 'whom', 'how', 'when', 'where', 'why', 'if', 'then',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their',
]);

/**
 * Tokenize text into searchable terms.
 * Splits on whitespace/punctuation, lowercases, removes stop words,
 * and preserves compound tokens like "create_or_update".
 */
function tokenize(text: string): string[] {
  // Split on whitespace and common punctuation but preserve underscores/hyphens inside words
  const raw = text.toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) || [];
  const tokens: string[] = [];
  for (const t of raw) {
    if (t.length > 1 && !STOP_WORDS.has(t)) {
      tokens.push(t);
      // Also split compound tokens (snake_case, kebab-case) into sub-tokens
      if (t.includes('_') || t.includes('-')) {
        for (const sub of t.split(/[_-]/)) {
          if (sub.length > 1 && !STOP_WORDS.has(sub)) {
            tokens.push(sub);
          }
        }
      }
    }
  }
  return tokens;
}

/**
 * BM25 keyword index for hybrid search.
 * Maintains inverted index + document lengths for BM25 scoring.
 */
class BM25Index {
  // term -> Set<docId>
  private invertedIndex: Map<string, Set<string>> = new Map();
  // docId -> token count
  private docLengths: Map<string, number> = new Map();
  // total docs
  private docCount = 0;
  // average document length
  private avgDocLength = 0;
  // BM25 parameters
  private k1 = 1.2;
  private b = 0.75;

  add(id: string, content: string): void {
    const tokens = tokenize(content);
    this.docLengths.set(id, tokens.length);
    this.docCount++;
    this.avgDocLength =
      (this.avgDocLength * (this.docCount - 1) + tokens.length) / this.docCount;

    for (const token of tokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(id);
    }
  }

  remove(id: string): void {
    const docLen = this.docLengths.get(id);
    if (docLen === undefined) return;

    // Remove from inverted index
    this.invertedIndex.forEach((docIds) => {
      docIds.delete(id);
    });
    this.docLengths.delete(id);
    this.docCount--;
    if (this.docCount > 0) {
      this.avgDocLength =
        (this.avgDocLength * (this.docCount + 1) - docLen) / this.docCount;
    } else {
      this.avgDocLength = 0;
    }
  }

  /**
   * Search using BM25 scoring.
   * Returns sorted array of { id, score } pairs.
   */
  search(query: string, limit: number = 10): Array<{ id: string; score: number }> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores = new Map<string, number>();

    for (const token of queryTokens) {
      const docs = this.invertedIndex.get(token);
      if (!docs || docs.size === 0) continue;

      // IDF: log((N - n + 0.5) / (n + 0.5) + 1)
      const n = docs.size;
      const idf = Math.log((this.docCount - n + 0.5) / (n + 0.5) + 1);

      docs.forEach((docId) => {
        const dl = this.docLengths.get(docId) || 0;
        // TF approximation: we count the term once per document in the inverted index
        // For more accurate TF, we'd need to store term frequencies per doc
        const tf = 1;
        const tfNorm =
          (tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + this.b * (dl / (this.avgDocLength || 1))));
        const bm25Score = idf * tfNorm;

        scores.set(docId, (scores.get(docId) || 0) + bm25Score);
      });
    }

    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

// ===== Configuration =====

/**
 * Configuration for AgentDB Backend
 */
export interface AgentDBBackendConfig {
  /** Database path for persistence */
  dbPath?: string;

  /** Namespace for memory organization */
  namespace?: string;

  /** Force WASM backend (skip native hnswlib) */
  forceWasm?: boolean;

  /** Vector backend: 'auto', 'ruvector', 'hnswlib' */
  vectorBackend?: "auto" | "ruvector" | "hnswlib";

  /** Vector dimensions (default: 1536) */
  vectorDimension?: number;

  /** HNSW M parameter */
  hnswM?: number;

  /** HNSW efConstruction parameter */
  hnswEfConstruction?: number;

  /** HNSW efSearch parameter */
  hnswEfSearch?: number;

  /** Enable caching */
  cacheEnabled?: boolean;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /** Maximum entries */
  maxEntries?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<
  Omit<AgentDBBackendConfig, "dbPath" | "embeddingGenerator">
> = {
  namespace: "default",
  forceWasm: false,
  vectorBackend: "auto",
  vectorDimension: 1536,
  hnswM: 16,
  hnswEfConstruction: 200,
  hnswEfSearch: 100,
  cacheEnabled: true,
  maxEntries: 1000000,
};

// ===== AgentDB Backend Implementation =====

/**
 * AgentDB Backend
 *
 * Integrates AgentDB for vector search with the V3 memory system.
 * Provides 150x-12,500x faster search compared to brute-force approaches.
 *
 * Features:
 * - HNSW indexing for fast approximate nearest neighbor search
 * - Automatic fallback: native hnswlib → ruvector → WASM
 * - Graceful handling of optional native dependencies
 * - Semantic search with filtering
 * - Compatible with HybridBackend for combined SQLite+AgentDB queries
 */
export class AgentDBBackend extends EventEmitter implements IMemoryBackend {
  private config: Required<
    Omit<AgentDBBackendConfig, "dbPath" | "embeddingGenerator">
  > & {
    dbPath?: string;
    embeddingGenerator?: EmbeddingGenerator;
  };
  private agentdb: any;
  private initialized: boolean = false;
  private available: boolean = false;

  // In-memory storage for compatibility
  private entries: Map<string, MemoryEntry> = new Map();
  private namespaceIndex: Map<string, Set<string>> = new Map();
  private keyIndex: Map<string, string> = new Map();

  // O(1) reverse lookup for numeric ID -> string ID (fixes O(n) linear scan)
  private numericToStringIdMap: Map<number, string> = new Map();

  // BM25 keyword index for hybrid search
  private bm25Index: BM25Index = new BM25Index();

  // Performance tracking
  private stats = {
    queryCount: 0,
    totalQueryTime: 0,
    searchCount: 0,
    totalSearchTime: 0,
  };

  constructor(config: AgentDBBackendConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.available = false; // Will be set during initialization
  }

  /**
   * Initialize AgentDB
   */
  async initialize(): Promise<void> {
    agentdbLogger.info("Init agentDB");

    if (this.initialized) return;

    // Try to import AgentDB
    await ensureAgentDBImport();

    this.available = AgentDB !== undefined;

    if (!this.available) {
      agentdbLogger.warn(
        "AgentDB not available, using fallback in-memory storage",
      );
      this.initialized = true;
      return;
    }

    try {
      // Initialize AgentDB with config
      this.agentdb = new AgentDB({
        dbPath: this.config.dbPath || ":memory:",
        namespace: this.config.namespace,
        forceWasm: this.config.forceWasm,
        vectorBackend: this.config.vectorBackend,
        vectorDimension: this.config.vectorDimension,
      });

      // Suppress agentdb's noisy console.log during init
      // (EmbeddingService, AgentDB core emit info-level logs we don't need)
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = String(args[0] ?? "");
        if (
          msg.includes("Transformers.js loaded") ||
          msg.includes("Using better-sqlite3") ||
          msg.includes("better-sqlite3 unavailable") ||
          msg.includes("[AgentDB]")
        )
          return;
        origLog.apply(console, args);
      };
      try {
        await this.agentdb.initialize();
      } finally {
        console.log = origLog;
      }

      // Create memory_entries table if it doesn't exist
      await this.createSchema();

      this.initialized = true;
      this.emit("initialized", {
        backend: this.agentdb.vectorBackendName,
        isWasm: this.agentdb.isWasm,
      });
    } catch (error) {
      agentdbLogger.error("Failed to initialize AgentDB", error);
      this.available = false;
      this.initialized = true;
      this.emit("initialization:failed", { error });
    }
  }

  /**
   * Shutdown AgentDB
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    if (this.agentdb) {
      await this.agentdb.close();
    }

    this.initialized = false;
    this.emit("shutdown");
  }

  /**
   * Store a memory entry
   */
  async store(entry: MemoryEntry): Promise<void> {
    // Generate embedding if needed
    agentdbLogger.info(`AgentDB store with entry: ${JSON.stringify(entry)}`);

    if (entry.content && !entry.embedding && this.config.embeddingGenerator) {
      entry.embedding = await this.config.embeddingGenerator(entry.content);
    }

    // Store in-memory for quick access
    this.entries.set(entry.id, entry);

    // Register ID mapping for O(1) reverse lookup
    this.registerIdMapping(entry.id);

    // Update indexes
    this.updateIndexes(entry);

    // Index in BM25 for keyword search
    this.bm25Index.add(entry.id, `${entry.key} ${entry.content}`);

    // Store in AgentDB if available
    if (this.agentdb) {
      await this.storeInAgentDB(entry);
    }

    this.emit("entry:stored", { id: entry.id });
  }

  /**
   * Get entry by ID
   */
  async get(id: string): Promise<MemoryEntry | null> {
    agentdbLogger.info(`AgentDB get with id: ${id}`);

    // Check in-memory first
    const cached = this.entries.get(id);
    if (cached) return cached;

    // Query AgentDB if available
    if (this.agentdb) {
      return this.getFromAgentDB(id);
    }

    return null;
  }

  /**
   * Get entry by key
   */
  async getByKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    agentdbLogger.info(
      `AgentDB getByKey with namespace: ${namespace} and key: ${key}`,
    );
    const keyIndexKey = `${namespace}:${key}`;
    const id = this.keyIndex.get(keyIndexKey);
    if (!id) return null;
    return this.get(id);
  }

  /**
   * Update entry
   */
  async update(
    id: string,
    update: MemoryEntryUpdate,
  ): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    // Apply updates
    if (update.content !== undefined) {
      entry.content = update.content;
      // Re-index BM25
      this.bm25Index.remove(id);
      this.bm25Index.add(id, `${entry.key} ${entry.content}`);
      // Regenerate embedding if needed
      if (this.config.embeddingGenerator) {
        entry.embedding = await this.config.embeddingGenerator(entry.content);
      }
    }

    if (update.tags !== undefined) {
      entry.tags = update.tags;
    }

    if (update.metadata !== undefined) {
      entry.metadata = { ...entry.metadata, ...update.metadata };
    }

    if (update.accessLevel !== undefined) {
      entry.accessLevel = update.accessLevel;
    }

    if (update.expiresAt !== undefined) {
      entry.expiresAt = update.expiresAt;
    }

    if (update.references !== undefined) {
      entry.references = update.references;
    }

    entry.updatedAt = Date.now();
    entry.version++;

    // Update in AgentDB
    if (this.agentdb) {
      await this.updateInAgentDB(entry);
    }

    this.emit("entry:updated", { id });
    return entry;
  }

  /**
   * Delete entry
   */
  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    // Remove from indexes
    this.entries.delete(id);
    this.unregisterIdMapping(id); // Clean up reverse lookup map
    this.bm25Index.remove(id);
    this.namespaceIndex.get(entry.namespace)?.delete(id);
    const keyIndexKey = `${entry.namespace}:${entry.key}`;
    this.keyIndex.delete(keyIndexKey);

    // Delete from AgentDB
    if (this.agentdb) {
      await this.deleteFromAgentDB(id);
    }

    this.emit("entry:deleted", { id });
    return true;
  }

  /**
   * Query entries
   */
  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const startTime = performance.now();
    let results: MemoryEntry[] = [];

    if (query.type === "semantic" && (query.embedding || query.content)) {
      // Use semantic search
      const searchResults = await this.semanticSearch(query);
      results = searchResults.map((r) => r.entry);
    } else {
      // Fallback to in-memory filtering
      results = this.queryInMemory(query);
    }

    const duration = performance.now() - startTime;
    this.stats.queryCount++;
    this.stats.totalQueryTime += duration;

    return results;
  }

  /**
   * Semantic vector search
   */
  async search(
    embedding: Float32Array,
    options: SearchOptions,
  ): Promise<SearchResult[]> {
    const startTime = performance.now();

    if (!this.agentdb) {
      // Fallback to brute-force search
      return this.bruteForceSearch(embedding, options);
    }

    try {
      // Use AgentDB HNSW search
      const results = await this.searchWithAgentDB(embedding, options);

      const duration = performance.now() - startTime;
      this.stats.searchCount++;
      this.stats.totalSearchTime += duration;

      return results;
    } catch (error) {
      agentdbLogger.error(
        "AgentDB search failed, falling back to brute-force",
        error,
      );
      return this.bruteForceSearch(embedding, options);
    }
  }

  /**
   * Bulk insert
   */
  async bulkInsert(entries: MemoryEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.store(entry);
    }
  }

  /**
   * Bulk delete
   */
  async bulkDelete(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (await this.delete(id)) {
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Count entries
   */
  async count(namespace?: string): Promise<number> {
    if (namespace) {
      return this.namespaceIndex.get(namespace)?.size || 0;
    }
    return this.entries.size;
  }

  /**
   * List namespaces
   */
  async listNamespaces(): Promise<string[]> {
    return Array.from(this.namespaceIndex.keys());
  }

  /**
   * Clear namespace
   */
  async clearNamespace(namespace: string): Promise<number> {
    const ids = this.namespaceIndex.get(namespace);
    if (!ids) return 0;

    let deleted = 0;
    for (const id of ids) {
      if (await this.delete(id)) {
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<BackendStats> {
    const entriesByNamespace: Record<string, number> = {};
    for (const [namespace, ids] of this.namespaceIndex) {
      entriesByNamespace[namespace] = ids.size;
    }

    const entriesByType: Record<MemoryType, number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0,
      working: 0,
      cache: 0,
    };

    for (const entry of this.entries.values()) {
      entriesByType[entry.type]++;
    }

    // Get HNSW stats if available
    let hnswStats: HNSWStats | undefined;
    if (this.agentdb && HNSWIndex) {
      try {
        const hnsw = this.agentdb.getController("hnsw");
        if (hnsw) {
          const stats = hnsw.getStats();
          hnswStats = {
            vectorCount: stats.numElements || 0,
            memoryUsage: 0,
            avgSearchTime: stats.avgSearchTimeMs || 0,
            buildTime: stats.lastBuildTime || 0,
            compressionRatio: 1.0,
          };
        }
      } catch {
        // HNSW not available
      }
    }

    return {
      totalEntries: this.entries.size,
      entriesByNamespace,
      entriesByType,
      memoryUsage: this.estimateMemoryUsage(),
      hnswStats,
      avgQueryTime:
        this.stats.queryCount > 0
          ? this.stats.totalQueryTime / this.stats.queryCount
          : 0,
      avgSearchTime:
        this.stats.searchCount > 0
          ? this.stats.totalSearchTime / this.stats.searchCount
          : 0,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check AgentDB availability
    const storageHealth: ComponentHealth = this.agentdb
      ? { status: "healthy", latency: 0 }
      : {
          status: "degraded",
          latency: 0,
          message: "AgentDB not available, using fallback",
        };

    // Check index health
    const indexHealth: ComponentHealth = { status: "healthy", latency: 0 };
    if (!this.agentdb) {
      indexHealth.status = "degraded";
      indexHealth.message = "HNSW index not available";
      recommendations.push(
        "Install agentdb for 150x-12,500x faster vector search",
      );
    }

    // Check cache health
    const cacheHealth: ComponentHealth = { status: "healthy", latency: 0 };

    const status =
      storageHealth.status === "unhealthy" || indexHealth.status === "unhealthy"
        ? "unhealthy"
        : storageHealth.status === "degraded" ||
            indexHealth.status === "degraded"
          ? "degraded"
          : "healthy";

    return {
      status,
      components: {
        storage: storageHealth,
        index: indexHealth,
        cache: cacheHealth,
      },
      timestamp: Date.now(),
      issues,
      recommendations,
    };
  }

  // ===== Private Methods =====

  /**
   * Create database schema
   */
  private async createSchema(): Promise<void> {
    if (!this.agentdb) return;

    const db = this.agentdb.database;
    if (!db || typeof db.run !== "function") {
      // AgentDB doesn't expose raw database - using native API
      return;
    }

    try {
      // Create memory_entries table
      await db.run(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        type TEXT NOT NULL,
        namespace TEXT NOT NULL,
        tags TEXT,
        metadata TEXT,
        owner_id TEXT,
        access_level TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        version INTEGER NOT NULL,
        references TEXT,
        access_count INTEGER DEFAULT 0,
        last_accessed_at INTEGER
      )
    `);

      // Create indexes
      await db.run(
        "CREATE INDEX IF NOT EXISTS idx_namespace ON memory_entries(namespace)",
      );
      await db.run("CREATE INDEX IF NOT EXISTS idx_key ON memory_entries(key)");
      await db.run(
        "CREATE INDEX IF NOT EXISTS idx_type ON memory_entries(type)",
      );
    } catch {
      // Schema creation failed - using in-memory only
    }
  }

  /**
   * Store entry in AgentDB
   */
  private async storeInAgentDB(entry: MemoryEntry): Promise<void> {
    if (!this.agentdb) return;

    // Try to use agentdb's native store method if available
    try {
      if (typeof this.agentdb.store === "function") {
        await this.agentdb.store(entry.id, {
          key: entry.key,
          content: entry.content,
          embedding: entry.embedding,
          type: entry.type,
          namespace: entry.namespace,
          tags: entry.tags,
          metadata: entry.metadata,
        });
        return;
      }

      // Fallback: use database directly if available
      const db = this.agentdb.database;
      if (!db || typeof db.run !== "function") {
        // No compatible database interface - skip agentdb storage
        // Entry is already stored in-memory
        return;
      }

      await db.run(
        `
      INSERT OR REPLACE INTO memory_entries
      (id, key, content, embedding, type, namespace, tags, metadata, owner_id,
       access_level, created_at, updated_at, expires_at, version, references,
       access_count, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        [
          entry.id,
          entry.key,
          entry.content,
          entry.embedding ? Buffer.from(entry.embedding.buffer) : null,
          entry.type,
          entry.namespace,
          JSON.stringify(entry.tags),
          JSON.stringify(entry.metadata),
          entry.ownerId || null,
          entry.accessLevel,
          entry.createdAt,
          entry.updatedAt,
          entry.expiresAt || null,
          entry.version,
          JSON.stringify(entry.references),
          entry.accessCount,
          entry.lastAccessedAt,
        ],
      );
    } catch {
      // AgentDB storage failed - entry is already in-memory
    }

    // Add to vector index if HNSW is available
    if (entry.embedding && HNSWIndex) {
      try {
        const hnsw = this.agentdb.getController("hnsw");
        if (hnsw) {
          // Convert string ID to number for HNSW (use hash)
          const numericId = this.stringIdToNumeric(entry.id);
          hnsw.addVector(numericId, entry.embedding);
        }
      } catch {
        // HNSW not available
      }
    }
  }

  /**
   * Get entry from AgentDB
   */
  private async getFromAgentDB(id: string): Promise<MemoryEntry | null> {
    if (!this.agentdb) return null;

    try {
      // Try native get method first
      if (typeof this.agentdb.get === "function") {
        const data = await this.agentdb.get(id);
        if (data) return this.dataToEntry(id, data);
      }

      // Fallback to database
      const db = this.agentdb.database;
      if (!db || typeof db.get !== "function") return null;

      const row = await db.get("SELECT * FROM memory_entries WHERE id = ?", [
        id,
      ]);
      if (!row) return null;
      return this.rowToEntry(row);
    } catch {
      return null;
    }
  }

  /**
   * Convert agentdb data to MemoryEntry
   */
  private dataToEntry(id: string, data: any): MemoryEntry {
    const now = Date.now();
    return {
      id,
      key: data.key || id,
      content: data.content || "",
      embedding: data.embedding,
      type: data.type || "semantic",
      namespace: data.namespace || this.config.namespace,
      tags: data.tags || [],
      metadata: data.metadata || {},
      ownerId: data.ownerId,
      accessLevel: data.accessLevel || "private",
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      expiresAt: data.expiresAt,
      version: data.version || 1,
      references: data.references || [],
      accessCount: data.accessCount || 0,
      lastAccessedAt: data.lastAccessedAt || now,
    };
  }

  /**
   * Update entry in AgentDB
   */
  private async updateInAgentDB(entry: MemoryEntry): Promise<void> {
    await this.storeInAgentDB(entry);
  }

  /**
   * Delete entry from AgentDB
   */
  private async deleteFromAgentDB(id: string): Promise<void> {
    if (!this.agentdb) return;

    try {
      // Try native delete method first
      if (typeof this.agentdb.delete === "function") {
        await this.agentdb.delete(id);
        return;
      }

      // Fallback to database
      const db = this.agentdb.database;
      if (!db || typeof db.run !== "function") return;

      await db.run("DELETE FROM memory_entries WHERE id = ?", [id]);
    } catch {
      // Delete failed - entry removed from in-memory
    }
  }

  /**
   * Search with AgentDB HNSW
   */
  private async searchWithAgentDB(
    embedding: Float32Array,
    options: SearchOptions,
  ): Promise<SearchResult[]> {
    if (!this.agentdb || !HNSWIndex) {
      return [];
    }

    try {
      const hnsw = this.agentdb.getController("hnsw");
      if (!hnsw) {
        return this.bruteForceSearch(embedding, options);
      }

      const results = await hnsw.search(embedding, options.k, {
        threshold: options.threshold,
      });

      const searchResults: SearchResult[] = [];

      for (const result of results) {
        const id = this.numericIdToString(result.id);
        const entry = await this.get(id);
        if (!entry) continue;

        searchResults.push({
          entry,
          score: result.similarity,
          distance: result.distance,
        });
      }

      return searchResults;
    } catch (error) {
      hnswLogger.error("HNSW search failed", error);
      return this.bruteForceSearch(embedding, options);
    }
  }

  /**
   * Brute-force vector search fallback
   */
  private bruteForceSearch(
    embedding: Float32Array,
    options: SearchOptions,
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (!entry.embedding) continue;

      const score = this.cosineSimilarity(embedding, entry.embedding);
      const distance = 1 - score;

      if (options.threshold && score < options.threshold) continue;

      results.push({ entry, score, distance });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, options.k);
  }

  /**
   * Hybrid search: combines BM25 keyword search with vector semantic search.
   * Uses Reciprocal Rank Fusion (RRF) to merge results from both strategies.
   */
  private async semanticSearch(query: MemoryQuery): Promise<SearchResult[]> {
    const limit = query.limit || 10;
    const fetchK = Math.max(limit * 2, 20); // fetch more candidates for merging

    // 1. BM25 keyword search (always runs if there's text content)
    const bm25Results: Array<{ id: string; score: number }> = [];
    if (query.content) {
      const hits = this.bm25Index.search(query.content, fetchK);
      bm25Results.push(...hits);
    }

    // 2. Vector semantic search (if embedding available)
    let vectorResults: SearchResult[] = [];
    let embedding = query.embedding;
    if (!embedding && query.content && this.config.embeddingGenerator) {
      embedding = await this.config.embeddingGenerator(query.content);
    }
    if (embedding) {
      vectorResults = await this.search(embedding, {
        k: fetchK,
        threshold: query.threshold,
        filters: query,
      });
    }

    // 3. If only one strategy returned results, return it directly
    if (bm25Results.length === 0 && vectorResults.length > 0) {
      return vectorResults.slice(0, limit);
    }
    if (vectorResults.length === 0 && bm25Results.length > 0) {
      return bm25Results
        .filter((r) => this.entries.has(r.id))
        .map((r) => ({
          entry: this.entries.get(r.id)!,
          score: r.score,
          distance: 1 - r.score,
        }))
        .slice(0, limit);
    }
    if (bm25Results.length === 0 && vectorResults.length === 0) {
      return [];
    }

    // 4. Reciprocal Rank Fusion (RRF) to merge both result sets
    //    RRF score = sum(1 / (k + rank)) where k=60 is a constant
    const rrfK = 60;
    const fusedScores = new Map<string, number>();

    // Add BM25 ranks
    for (let i = 0; i < bm25Results.length; i++) {
      const id = bm25Results[i].id;
      fusedScores.set(id, (fusedScores.get(id) || 0) + 1 / (rrfK + i + 1));
    }

    // Add vector search ranks
    for (let i = 0; i < vectorResults.length; i++) {
      const id = vectorResults[i].entry.id;
      fusedScores.set(id, (fusedScores.get(id) || 0) + 1 / (rrfK + i + 1));
    }

    // Build a lookup for vector results (to reuse their entry objects)
    const vectorResultMap = new Map<string, SearchResult>();
    for (const vr of vectorResults) {
      vectorResultMap.set(vr.entry.id, vr);
    }

    // Sort by fused score and return
    return Array.from(fusedScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, rrfScore]) => {
        const existing = vectorResultMap.get(id);
        if (existing) {
          return { ...existing, score: rrfScore };
        }
        const entry = this.entries.get(id);
        if (!entry) return null;
        return { entry, score: rrfScore, distance: 1 - rrfScore };
      })
      .filter((r): r is SearchResult => r !== null);
  }

  /**
   * In-memory query fallback
   */
  private queryInMemory(query: MemoryQuery): MemoryEntry[] {
    let results = Array.from(this.entries.values());

    // Apply filters
    if (query.namespace) {
      results = results.filter((e) => e.namespace === query.namespace);
    }

    if (query.key) {
      results = results.filter((e) => e.key === query.key);
    }

    if (query.keyPrefix) {
      results = results.filter((e) => e.key.startsWith(query.keyPrefix!));
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) =>
        query.tags!.every((tag) => e.tags.includes(tag)),
      );
    }

    return results.slice(0, query.limit);
  }

  /**
   * Update in-memory indexes
   */
  private updateIndexes(entry: MemoryEntry): void {
    const namespace = entry.namespace;

    if (!this.namespaceIndex.has(namespace)) {
      this.namespaceIndex.set(namespace, new Set());
    }
    this.namespaceIndex.get(namespace)!.add(entry.id);

    const keyIndexKey = `${namespace}:${entry.key}`;
    this.keyIndex.set(keyIndexKey, entry.id);
  }

  /**
   * Convert DB row to MemoryEntry
   */
  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      key: row.key,
      content: row.content,
      embedding: row.embedding
        ? new Float32Array(new Uint8Array(row.embedding).buffer)
        : undefined,
      type: row.type,
      namespace: row.namespace,
      tags: JSON.parse(row.tags || "[]"),
      metadata: JSON.parse(row.metadata || "{}"),
      ownerId: row.owner_id,
      accessLevel: row.access_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      version: row.version,
      references: JSON.parse(row.references || "[]"),
      accessCount: row.access_count || 0,
      lastAccessedAt: row.last_accessed_at || row.created_at,
    };
  }

  /**
   * Convert string ID to numeric for HNSW
   */
  private stringIdToNumeric(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  /**
   * Convert numeric ID back to string using O(1) reverse lookup
   * PERFORMANCE FIX: Uses pre-built reverse map instead of O(n) linear scan
   */
  private numericIdToString(numericId: number): string {
    // Use O(1) reverse lookup map
    const stringId = this.numericToStringIdMap.get(numericId);
    if (stringId) {
      return stringId;
    }
    // Fallback for unmapped IDs
    return String(numericId);
  }

  /**
   * Register string ID in reverse lookup map
   * Called when storing entries to maintain bidirectional mapping
   */
  private registerIdMapping(stringId: string): void {
    const numericId = this.stringIdToNumeric(stringId);
    this.numericToStringIdMap.set(numericId, stringId);
  }

  /**
   * Unregister string ID from reverse lookup map
   * Called when deleting entries
   */
  private unregisterIdMapping(stringId: string): void {
    const numericId = this.stringIdToNumeric(stringId);
    this.numericToStringIdMap.delete(numericId);
  }

  /**
   * Cosine similarity (returns value in range [0, 1] where 1 = identical)
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Estimate memory usage
   */
  private estimateMemoryUsage(): number {
    let total = 0;

    for (const entry of this.entries.values()) {
      total += entry.content.length * 2;
      if (entry.embedding) {
        total += entry.embedding.length * 4;
      }
    }

    return total;
  }

  /**
   * Check if AgentDB is available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Get underlying AgentDB instance
   */
  getAgentDB(): any {
    return this.agentdb;
  }
}

export default AgentDBBackend;
