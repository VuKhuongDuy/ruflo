# 4. Memory — Lưu Trữ & Tìm Kiếm Ngữ Nghĩa

> Memory cho phép agent nhớ kiến thức từ các phiên làm việc trước, tìm kiếm bằng ngữ nghĩa (semantic) và từ khóa (BM25), với 3 search engines: HNSW, BM25, DiskANN.

---

## Mô Tả

Thay vì chỉ biết những gì trong conversation hiện tại, agent có thể **nhớ** kiến thức xuyên suốt các session:

```
Session 1: Agent học "OAuth pattern X là tốt nhất"
                ↓ lưu vào Memory với embedding
Session 5: Agent hỏi "authentication patterns?"
                ↓ tìm kiếm semantic trong Memory
           → Tìm ra "OAuth pattern X" từ session 1!
```

Memory được xây dựng trên **AgentDB** (SQLite-based) với 3 search engines chạy song song.

## Giải Thích Chi Tiết

### Kiến Trúc Phân Lớp

```
┌─────────────────────────────────────────────────────────────┐
│                  UnifiedMemoryService                        │
│              (API cấp cao cho agent)                         │
├─────────────────────────────────────────────────────────────┤
│   AgentDBAdapter  │  Memory Bridge (ADR-076)  │ File Watcher │
│   (IMemoryBackend)│  (Claude ↔ AgentDB sync)  │ (auto-index) │
├───────────────────┼───────────────┬─────────────────────────┤
│   HNSW Index      │  BM25 Engine  │  DiskANN (ADR-077)      │
│   (semantic)      │  (keyword)    │  (disk-based ANN)       │
│                   │               │                          │
│   Hybrid Fusion: α·HNSW + (1-α)·BM25                       │
├────────────────────┬────────────────────────────────────────┤
│                    │        CacheManager                     │
│                    │    (LRU + TTL, 10k entries)             │
├────────────────────┴────────────────────────────────────────┤
│                      AgentDB                                 │
│               (event-driven storage)                         │
├─────────────────────────────────────────────────────────────┤
│    SQLite (native)  │  sql.js (WASM)  │  RVF (binary)       │
│    Production       │  Cross-platform │  Lightweight        │
└─────────────────────────────────────────────────────────────┘
```

### MemoryEntry — Cấu Trúc Dữ Liệu

```typescript
interface MemoryEntry {
  id: string;                    // UUID duy nhất
  key: string;                   // "auth:oauth-pattern"
  content: string;               // Nội dung thực sự
  embedding?: Float32Array;      // Vector 384 chiều
  type: MemoryType;              // episodic|semantic|procedural|working|cache
  namespace: string;             // "auth", "performance", "security"...
  tags: string[];                // ["oauth", "critical", "security"]
  accessLevel: AccessLevel;      // private|team|swarm|public|system
  version: number;               // Optimistic locking
  references: string[];          // Links đến entries khác
  accessCount: number;           // Số lần truy cập
}
```

### 5 Loại Memory

| Loại | Mô tả | Ví dụ |
|------|-------|-------|
| **episodic** (sự kiện) | Time-based, cụ thể | "Lúc 10h sáng tôi đã fix bug auth #123" |
| **semantic** (khái niệm) | Facts, kiến thức chung | "OAuth 2.0 cần PKCE cho public clients" |
| **procedural** (kỹ năng) | How-to, step-by-step | "Cách deploy: npm build → docker push" |
| **working** (hiện tại) | Short-term, session context | "Task hiện tại: fix login bug" |
| **cache** | Fast retrieval, TTL-based | API response cache |

### HNSW — Tìm Kiếm Semantic (O(log n))

```
Layer 3 (thưa nhất):  ●─────────────────●
                       │                 │
Layer 2:               ●────●────────────●────●
                       │    │            │    │
Layer 1:               ●────●────●───────●────●────●
                       │    │    │       │    │    │
Layer 0 (dày nhất):    ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●
                       (tất cả vectors đều ở đây)
```

Optimizations:
- Binary Heap thay Array.sort: 3-5x speedup
- Pre-normalized Cosine: chỉ cần dot product, 2x nhanh hơn
- Vector Quantization: Int8 = 3.92x nén, 50-75% giảm RAM

### BM25 Hybrid Search (MỚI v3.5)

Kết hợp semantic (HNSW) + keyword (BM25):

```
Query: "OAuth PKCE implementation"
         │
         ├──► HNSW Semantic Search → cosine similarity scores
         ├──► BM25 Keyword Search  → TF-IDF scores
         └──► Hybrid Fusion: α·HNSW + (1-α)·BM25 → final ranking
```

| Trường hợp | Engine tốt nhất |
|-----------|----------------|
| "tìm code liên quan đến auth" | HNSW (semantic) |
| "tìm file chứa `PKCE`" | BM25 (keyword) |
| "OAuth security best practices" | Hybrid (cả hai) |

### DiskANN (MỚI v3.5 — ADR-077)

Cho dataset lớn không fit trong RAM:

```
HNSW (in-memory):                    DiskANN (disk-based):
RAM: ████████████████████████         RAM: ████ (chỉ PQ codes)
     (toàn bộ vectors + graph)        Disk: ████████████████████
Giới hạn: ~1M vectors (16GB RAM)     Giới hạn: ~1B vectors (SSD)
Latency: <1ms                        Latency: 5-10ms
```

### File Watcher (MỚI v3.5)

Tự động index thay đổi file system vào AgentDB:

```
File System ──► File Watcher ──► AgentDB
  created   →   extract     →    store
  modified  →   re-embed    →    update
  deleted   →   remove      →    delete

Debounce: 300ms | Ignore: node_modules, .git, dist
Watched: **/*.ts, **/*.js, **/*.md, **/*.json, **/*.yaml
```

### Claude Code ↔ AgentDB Memory Bridge (MỚI v3.5 — ADR-076)

Đồng bộ Claude Code auto-memory sang AgentDB:

```
Claude Code auto-memory              AgentDB
~/.claude/projects/memory/   ──►    namespace: claude-memories
  ├── user.md                        (ONNX 384-dim vectors)
  ├── feedback.md
  └── project.md              ──►    Unified Search across both
```

### 19 AgentDB Controllers

| Controller | Mô tả |
|-----------|-------|
| agentdb | Core CRUD |
| episodic, semantic, procedural, working | Memory type queries |
| embedding, search, cache | Vector ops, ranking, TTL |
| **bridge** | Claude ↔ AgentDB sync (ADR-076) |
| **bm25** | BM25 keyword scoring |
| **diskann** | DiskANN graph search (ADR-077) |
| **filewatcher** | File system indexing |
| **intelligence** | Dedup + real metrics |
| **autopilot** | Persistent completion (ADR-072) |
| **guidance** | Capability discovery |
| **ruvector** | WASM embeddings |
| **learning** | Self-learning pipeline (ADR-075) |
| **analytics** | Real analyze + metrics |
| **health** | Doctor checks |

### Knowledge Graph

```
                   ┌─── "JWT Token" ───┐
                   │    (semantic)     │
         "OAuth 2.0"               "Bearer Auth"
         (semantic)  ─── related ───  (semantic)
              │                            │
         "Fix login bug"            "Security audit"
          (episodic)    ← depends ─   (episodic)

Edge types: depends_on, related_to, parent_of, derived_from
```

---

## Tình Trạng Hiện Tại (v3.5.72)

| Thành phần | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| AgentDB (SQLite) | **Stable** | 19 controllers, event-driven |
| HNSW Index | **Stable** | 150x-12,500x faster, persistent |
| BM25 Engine | **MỚI v3.5** | Keyword search, hybrid fusion |
| DiskANN | **MỚI v3.5** | Disk-based ANN cho large datasets |
| File Watcher | **MỚI v3.5** | Auto-index file changes |
| Memory Bridge | **MỚI v3.5** | Claude ↔ AgentDB sync |
| Cache (LRU + TTL) | **Stable** | 10k entries, 95%+ hit rate |
| Query Builder | **Stable** | Fluent API |
| Knowledge Graph | **Stable** | 4 edge types |

---

## Cách Sử Dụng Ở Project Khác

### Qua MCP Tools (recommended)

```bash
# Lưu kiến thức
# Claude tự gọi: memory_store({ key: "auth-pattern", content: "...", namespace: "patterns" })

# Tìm kiếm semantic
# Claude tự gọi: memory_search({ query: "authentication best practices", limit: 5 })

# Tìm kiếm unified (hybrid HNSW + BM25)
# Claude tự gọi: memory_search_unified({ query: "OAuth PKCE", limit: 5 })
```

### Qua CLI

```bash
# Store
npx @claude-flow/cli@latest memory store \
  --key "pattern-auth" \
  --value "JWT with refresh tokens" \
  --namespace patterns \
  --tags "auth,jwt"

# Search (hybrid)
npx @claude-flow/cli@latest memory search \
  --query "authentication patterns" \
  --limit 10

# List
npx @claude-flow/cli@latest memory list --namespace patterns

# Retrieve
npx @claude-flow/cli@latest memory retrieve --key "pattern-auth"

# Delete
npx @claude-flow/cli@latest memory delete --key "pattern-auth"
```

### Qua API (programmatic)

```typescript
import { UnifiedMemoryService } from '@claude-flow/memory';

const memory = new UnifiedMemoryService({
  backend: 'hybrid',
  path: './data/memory'
});

// Store
await memory.store({
  key: 'oauth-pattern',
  content: 'Always use PKCE for public OAuth clients',
  type: 'semantic',
  namespace: 'security',
  tags: ['oauth', 'critical']
});

// Search (fluent API)
const results = await memory.query(
  query()
    .semantic('security vulnerabilities')
    .inNamespace('security')
    .withTags(['critical'])
    .threshold(0.8)
    .limit(10)
    .build()
);
```

### Cấu Hình Memory

```json
{
  "memory": {
    "backend": "hybrid",
    "path": "./data/memory",
    "hnsw": {
      "M": 16,
      "efConstruction": 200,
      "efSearch": 200
    },
    "bm25": {
      "k1": 1.2,
      "b": 0.75
    },
    "cache": {
      "maxEntries": 10000,
      "ttl": 3600
    }
  }
}
```

### Lưu ý

1. **Data persistence**: Memory lưu trong SQLite, restart không mất
2. **Namespace isolation**: Dùng namespaces để phân tách kiến thức giữa các domain
3. **Auto-bridge**: Memory Bridge tự sync Claude Code memories khi session start
4. **File watcher**: Tự index source code changes, không cần gọi thủ công
