/**
 * FileWatcherReembedder - Auto re-embed source files when they change
 *
 * Watches project source files for modifications and automatically
 * re-embeds changed files in the memory backend. Uses content hashing
 * (SHA-256) to avoid redundant re-embeds.
 *
 * Designed to run inside the worker daemon as background task.
 *
 * @module @claude-flow/memory/file-watcher
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

// ===== Types =====

export interface FileWatcherConfig {
  /** Root directory to watch */
  rootDir: string;

  /** Glob-like patterns of directories/files to include (simple suffix match) */
  include?: string[];

  /** Directories to ignore */
  ignore?: string[];

  /** Debounce interval in ms (default: 1000) */
  debounceMs?: number;

  /** Namespace in memory backend for source embeddings */
  namespace?: string;

  /** Function to generate embedding and store it */
  onReembed: (filePath: string, content: string) => Promise<void>;
}

export interface FileWatcherStats {
  /** Number of files currently tracked */
  trackedFiles: number;

  /** Number of re-embeds performed */
  reembedCount: number;

  /** Number of re-embeds skipped (hash unchanged) */
  skippedCount: number;

  /** Last re-embed timestamp */
  lastReembedAt?: number;

  /** Whether watcher is running */
  running: boolean;
}

// ===== Constants =====

const DEFAULT_INCLUDE = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.md'];

const DEFAULT_IGNORE = [
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '__pycache__', '.cache', '.turbo', '.vercel', 'target',
];

// ===== Implementation =====

export class FileWatcherReembedder extends EventEmitter {
  private config: Required<Pick<FileWatcherConfig, 'rootDir' | 'debounceMs' | 'namespace'>> & FileWatcherConfig;
  private hashMap: Map<string, string> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private stats: FileWatcherStats = {
    trackedFiles: 0,
    reembedCount: 0,
    skippedCount: 0,
    running: false,
  };

  constructor(config: FileWatcherConfig) {
    super();
    this.config = {
      include: DEFAULT_INCLUDE,
      ignore: DEFAULT_IGNORE,
      debounceMs: 1000,
      namespace: 'source-embeddings',
      ...config,
    };
  }

  /**
   * Start watching for file changes
   */
  async start(): Promise<void> {
    if (this.stats.running) return;

    // Build initial hash map by scanning existing files
    await this.buildInitialHashMap();

    // Start recursive watcher
    try {
      this.watcher = fs.watch(this.config.rootDir, { recursive: true }, (eventType, filename) => {
        if (filename && eventType === 'change') {
          this.handleFileChange(filename);
        }
      });

      this.watcher.on('error', (err) => {
        this.emit('error', err);
      });

      this.stats.running = true;
      this.emit('started', { trackedFiles: this.stats.trackedFiles });
    } catch (err) {
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.stats.running = false;
    this.emit('stopped');
  }

  /**
   * Force re-scan and re-embed all changed files
   */
  async rescan(): Promise<number> {
    const files = await this.collectFiles(this.config.rootDir);
    let reembedded = 0;

    for (const filePath of files) {
      const changed = await this.checkAndReembed(filePath);
      if (changed) reembedded++;
    }

    return reembedded;
  }

  /**
   * Get current stats
   */
  getStats(): FileWatcherStats {
    return { ...this.stats };
  }

  // ===== Private methods =====

  private async buildInitialHashMap(): Promise<void> {
    const files = await this.collectFiles(this.config.rootDir);

    for (const filePath of files) {
      try {
        const content = await fsp.readFile(filePath, 'utf-8');
        const hash = this.contentHash(content);
        this.hashMap.set(filePath, hash);
      } catch {
        // File may have been deleted between scan and read
      }
    }

    this.stats.trackedFiles = this.hashMap.size;
  }

  private async collectFiles(dir: string): Promise<string[]> {
    const results: string[] = [];

    const walk = async (currentDir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!this.shouldIgnoreDir(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile() && this.shouldIncludeFile(entry.name)) {
          results.push(fullPath);
        }
      }
    };

    await walk(dir);
    return results;
  }

  private shouldIgnoreDir(name: string): boolean {
    return this.config.ignore!.includes(name);
  }

  private shouldIncludeFile(name: string): boolean {
    const ext = path.extname(name).toLowerCase();
    return this.config.include!.includes(ext);
  }

  private handleFileChange(relativePath: string): void {
    const fullPath = path.join(this.config.rootDir, relativePath);
    const fileName = path.basename(relativePath);

    // Quick filter
    if (!this.shouldIncludeFile(fileName)) return;

    // Check if path contains ignored directory
    const parts = relativePath.split(path.sep);
    if (parts.some(p => this.config.ignore!.includes(p))) return;

    // Debounce: wait for file to settle (editors do multiple writes)
    const existing = this.debounceTimers.get(fullPath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(fullPath, setTimeout(() => {
      this.debounceTimers.delete(fullPath);
      this.checkAndReembed(fullPath).catch(err => {
        this.emit('error', err);
      });
    }, this.config.debounceMs));
  }

  private async checkAndReembed(filePath: string): Promise<boolean> {
    let content: string;
    try {
      content = await fsp.readFile(filePath, 'utf-8');
    } catch {
      // File deleted — remove from hash map
      this.hashMap.delete(filePath);
      return false;
    }

    const newHash = this.contentHash(content);
    const oldHash = this.hashMap.get(filePath);

    if (oldHash === newHash) {
      this.stats.skippedCount++;
      return false;
    }

    // Hash changed — re-embed
    this.hashMap.set(filePath, newHash);
    this.stats.trackedFiles = this.hashMap.size;

    try {
      await this.config.onReembed(filePath, content);
      this.stats.reembedCount++;
      this.stats.lastReembedAt = Date.now();
      this.emit('reembedded', { filePath, hash: newHash });
      return true;
    } catch (err) {
      this.emit('reembed-error', { filePath, error: err });
      return false;
    }
  }

  private contentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}
