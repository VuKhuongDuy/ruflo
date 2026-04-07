# Ruflo v3 — Kiến Trúc Kỹ Thuật Chuyên Sâu

> Tài liệu này giải thích 5 hệ thống cốt lõi của Ruflo v3: **MCP**, **Neural/SONA**, **Embeddings**, **Memory**, và **Hooks**. Mỗi phần mô tả mục đích, thuật toán, và cách chúng phối hợp với nhau.

---

## Mục Lục

1. [Tổng Quan Kiến Trúc](#1-tổng-quan-kiến-trúc)
2. [MCP — Model Context Protocol](#2-mcp--model-context-protocol)
3. [Embeddings — Biểu Diễn Vector](#3-embeddings--biểu-diễn-vector)
4. [Memory — Lưu Trữ & Tìm Kiếm Ngữ Nghĩa](#4-memory--lưu-trữ--tìm-kiếm-ngữ-nghĩa)
5. [Neural/SONA — Học Máy Thích Nghi](#5-neuralsona--học-máy-thích-nghi)
6. [Hooks — Vòng Đời Sự Kiện](#6-hooks--vòng-đời-sự-kiện)
7. [Luồng Dữ Liệu Tổng Hợp](#7-luồng-dữ-liệu-tổng-hợp)
8. [Bảng Thuật Toán Tổng Hợp](#8-bảng-thuật-toán-tổng-hợp)

---

## 1. Tổng Quan Kiến Trúc

```
┌──────────────────────────────────────────────────────────────────────┐
│                         RUFLO v3 ARCHITECTURE                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │◊
│   User / Claude Code                                                 │
│        │                                                             │
│        ▼                                                             │
│   ┌─────────┐    JSON-RPC 2.0     ┌──────────────────────────────┐  │
│   │   CLI   │◄──────────────────►│     MCP Server (215 tools)   │  │
│   └─────────┘                    └──────────┬───────────────────┘  │
│        │                                    │                       │
│        │           ┌────────────────────────┼────────────────────┐  │
│        │           │                        │                    │  │
│        ▼           ▼                        ▼                    │  │
│   ┌─────────┐ ┌─────────┐          ┌─────────────┐              │  │
│   │  Hooks  │ │  Neural │          │   Memory    │              │  │
│   │ System  │ │  /SONA  │          │  (AgentDB)  │              │  │
│   └────┬────┘ └────┬────┘          └──────┬──────┘              │  │
│        │           │                      │                      │  │
│        └───────────┼──────────────────────┘                      │  │
│                    │                                              │  │
│                    ▼                                              │  │
│             ┌────────────┐                                        │  │
│             │ Embeddings │  ← Cung cấp vector cho tất cả         │  │
│             │  Service   │                                        │  │
│             └────────────┘                                        │  │
└──────────────────────────────────────────────────────────────────────┘
```

Các package chính và vị trí:

| Package | Đường dẫn | Mục đích |
|---------|-----------|---------|
| `@claude-flow/cli` | `v3/@claude-flow/cli/` | CLI + MCP server (215 tools) |
| `@claude-flow/embeddings` | `v3/@claude-flow/embeddings/` | Chuyển text → vector |
| `@claude-flow/memory` | `v3/@claude-flow/memory/` | Lưu trữ + tìm kiếm ngữ nghĩa |
| `@claude-flow/neural` | `v3/@claude-flow/neural/` (trong CLI) | Học từ kinh nghiệm (SONA) |
| `@claude-flow/hooks` | `v3/@claude-flow/hooks/` | Sự kiện vòng đời |
| `@claude-flow/security` | `v3/@claude-flow/security/` | Bảo mật, validation |

---

## 2. MCP — Model Context Protocol

### MCP là gì?

MCP là giao thức cho phép Claude Code gọi các **công cụ bên ngoài** một cách chuẩn hóa. Thay vì hardcode logic vào Claude, MCP tạo ra một "hộp công cụ" gồm 215+ tools mà Claude có thể gọi theo yêu cầu.

### Giao thức JSON-RPC 2.0

```
Claude Code                    MCP Server
    │                              │
    │── initialize ──────────────►│  (bắt tay, khai báo capabilities)
    │◄─ capabilities ─────────────│
    │                              │
    │── tools/list ──────────────►│  (hỏi danh sách tools)
    │◄─ [tool1, tool2, ...] ──────│
    │                              │
    │── tools/call ──────────────►│  (gọi một tool cụ thể)
    │   { name: "memory_store",   │
    │     arguments: {...} }      │
    │◄─ { result: {...} } ────────│
    │                              │
    │── ping ────────────────────►│  (health check mỗi 30s)
    │◄─ pong ─────────────────────│
```

### 3 Transport Modes

```
┌─────────────────────────────────────────────────────────┐
│                   MCP Transport Modes                    │
├─────────────┬──────────────────┬────────────────────────┤
│    STDIO    │      HTTP        │      WebSocket         │
├─────────────┼──────────────────┼────────────────────────┤
│ In-process  │ Separate process │ Separate process       │
│ stdin/stdout│ REST endpoint    │ Bi-directional         │
│ Default CLI │ CI/CD, scripts   │ Real-time dashboard    │
│ Latency: 0  │ Latency: ~5ms    │ Latency: ~2ms          │
└─────────────┴──────────────────┴────────────────────────┘
```

### Cấu Trúc Tool Registry

```typescript
// Mỗi tool có dạng:
interface MCPTool {
  name: string;           // "memory_store"
  description: string;    // "Store data in AgentDB"
  inputSchema: JSONSchema; // Validate input
  handler: (input) => Promise<Result>;
}

// 215 tools được phân nhóm:
const TOOL_REGISTRY = {
  // Agent tools: spawn, list, stop, metrics
  // Swarm tools: init, coordinate, status
  // Memory tools: store, search, retrieve, delete
  // Neural tools: train, predict, patterns
  // Security tools: scan, audit, validate
  // ... và nhiều hơn
}
```

### Performance MCP

| Metric | Target | Ý nghĩa |
|--------|--------|---------|
| Server startup | <400ms | CLI ready sau 400ms |
| Health check | <10ms | Ping mỗi 30 giây |
| Tool response | <100ms | Mỗi lần Claude gọi tool |
| Graceful shutdown | <5s | SIGTERM → SIGKILL nếu quá 5s |

---

## 3. Embeddings — Biểu Diễn Vector

### Embedding là gì?

Embedding chuyển **text thành vector số** (mảng float) để máy tính có thể so sánh ngữ nghĩa. Ví dụ:

```
"con mèo" → [0.15, -0.23, 0.87, ...]  (384 số)
"cat"      → [0.14, -0.22, 0.85, ...]  (384 số, tương tự!)
"ô tô"    → [0.91, 0.34, -0.12, ...]  (rất khác)

Cosine similarity("con mèo", "cat") ≈ 0.95  ← rất gần
Cosine similarity("con mèo", "ô tô") ≈ 0.12 ← rất xa
```

### 5 Embedding Providers

```
┌─────────────────────────────────────────────────────────────────┐
│                    EmbeddingService Factory                      │
│                                                                 │
│  Priority (auto-select):                                        │
│                                                                 │
│  1. agentic-flow ──► ONNX + SIMD + double cache (3-4x faster)  │
│         ↓ fallback                                              │
│  2. transformers.js ► Local ONNX model (offline, private)       │
│         ↓ fallback                                              │
│  3. OpenAI API ─────► text-embedding-3-small/large (best qual)  │
│         ↓ fallback                                              │
│  4. RVF ────────────► Pure TypeScript hash (52KB, <1ms)         │
│         ↓ fallback                                              │
│  5. Mock ───────────► Hash-based PRNG (test only)               │
└─────────────────────────────────────────────────────────────────┘
```

### Transformers.js Provider — Cách Hoạt Động

```
Input: "OAuth authentication pattern"
         │
         ▼
   Tokenize (WordPiece)
   ["OAuth", "##authen", "##tication", "pattern"]
         │
         ▼
   BERT Encoder (all-MiniLM-L6-v2, 22MB ONNX)
   6 transformer layers × 384 hidden dims
         │
         ▼
   Mean Pooling (trung bình token embeddings)
   Float32Array(384) [0.15, -0.23, ...]
         │
         ▼
   L2 Normalization (||v|| = 1)
   Final embedding: [0.12, -0.18, ...]
```

### 4 Phương Pháp Chuẩn Hóa Vector

```
Vector gốc: v = [3, 4, 0, -1, ...]

┌──────────────────────────────────────────────────────────────┐
│ L2 Normalization  │  v / ||v||  │ ||v||=5 → [0.6, 0.8, ...] │
│ (phổ biến nhất)   │            │ Dùng cho cosine similarity  │
├──────────────────────────────────────────────────────────────┤
│ L1 Normalization  │  v / Σ|v|  │ Σ=8 → [0.375, 0.5, ...]   │
│                   │            │ Sparse, Manhattan distance  │
├──────────────────────────────────────────────────────────────┤
│ Min-Max           │ (v-min)    │ → [0, 1] range              │
│                   │ /(max-min) │ Dùng khi cần bounded range  │
├──────────────────────────────────────────────────────────────┤
│ Z-Score           │ (v-μ)/σ   │ → μ=0, σ=1                  │
│                   │            │ Chuẩn hóa phân phối         │
└──────────────────────────────────────────────────────────────┘
```

### Document Chunking — Chia Nhỏ Tài Liệu

Tại sao cần chunk? Vì embedding model có giới hạn input (~512 tokens). Tài liệu dài cần được chia nhỏ.

```
Tài liệu 2000 từ
         │
         ▼  chunk_size=200, overlap=50
┌──────────────────────────────────────────────────────────┐
│ Chunk 1: [0-200]   "OAuth 2.0 là giao thức..."           │
│ Chunk 2: [150-350] "...xác thực. Access token được..."   │  ← overlap 50
│ Chunk 3: [300-500] "...cấp bởi Authorization Server..."  │  ← overlap 50
│ ...                                                       │
└──────────────────────────────────────────────────────────┘

Chunking Strategies:
- Character: Đơn giản, cắt theo ký tự
- Sentence:  Giữ nguyên câu, không cắt giữa câu  ← tốt nhất
- Paragraph: Nhóm theo \n\n
- Token:     ~4 chars/token heuristic
```

### Hyperbolic Embeddings — Poincaré Ball

Đây là công nghệ đặc biệt cho **dữ liệu có cấu trúc cây** (hierarchy):

```
Euclidean space (flat):           Poincaré Ball (hyperbolic):

[Cat]───[Animal]───[Dog]          [Animal] ← ở trung tâm
   ↕                                 ╱    ╲
[Kitten]                       [Cat]      [Dog]
                                  │
                               [Kitten]   ← ở rìa (sâu hơn)

Vấn đề: Euclidean không thể      Giải pháp: Khoảng cách tăng
biểu diễn tốt quan hệ cha-con    theo cấp bậc → phù hợp hơn
```

Công thức chuyển đổi:
- **Euclidean → Poincaré**: `tanh(√c · ||v|| / 2) · v / (√c · ||v||)`
- **Hyperbolic distance**: `arcosh(1 + 2c·||a-b||² / ((1-c·||a||²)(1-c·||b||²))) / √c`

### Cache Architecture

```
Request: embed("authentication pattern")
         │
         ▼
   L1: In-memory LRU (1000 entries, <1ms)
   ─ Hit? → return immediately
   │ Miss?
         ▼
   L2: Persistent SQLite Cache (sql.js, 10000 entries, ~10-50ms)
   ─ Hit? → load from disk, update L1
   │ Miss?
         ▼
   L3: Embedding Model (API call or local ONNX, 50-500ms)
   ─ Compute → save to L1 + L2
```

---

## 4. Memory — Lưu Trữ & Tìm Kiếm Ngữ Nghĩa

### Memory là gì trong ngữ cảnh AI Agent?

Thay vì chỉ biết những gì trong conversation hiện tại, agent có thể **nhớ** kiến thức từ các phiên làm việc trước:

```
Session 1: Agent học "OAuth pattern X là tốt nhất"
                ↓ lưu vào Memory với embedding
Session 5: Agent hỏi "authentication patterns?"
                ↓ tìm kiếm semantic trong Memory
           → Tìm ra "OAuth pattern X" từ session 1!
```

### Kiến Trúc Phân Lớp

```
┌─────────────────────────────────────────────────────────────┐
│                  UnifiedMemoryService                        │
│              (API cấp cao cho agent)                         │
├─────────────────────────────────────────────────────────────┤
│                   AgentDBAdapter                             │
│         (implements IMemoryBackend interface)                │
├────────────────────┬────────────────────────────────────────┤
│    HNSW Index      │        CacheManager                    │
│  (vector search)   │    (LRU + TTL, 10k entries)            │
├────────────────────┴────────────────────────────────────────┤
│                      AgentDB                                 │
│               (event-driven storage)                         │
├─────────────────────────────────────────────────────────────┤
│    SQLite (native)  │  sql.js (WASM)  │  RVF (binary)       │
│    Production       │  Cross-platform │  Lightweight        │
└─────────────────────────────────────────────────────────────┘
```

### MemoryEntry — Cấu Trúc Dữ Liệu Cốt Lõi

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

```
┌────────────────┬───────────────────────────────────────────┐
│  episodic      │ "Lúc 10h sáng tôi đã fix bug auth #123"  │
│  (sự kiện)     │ Time-based, cụ thể                        │
├────────────────┼───────────────────────────────────────────┤
│  semantic      │ "OAuth 2.0 cần PKCE cho public clients"   │
│  (khái niệm)   │ Facts, kiến thức chung                    │
├────────────────┼───────────────────────────────────────────┤
│  procedural    │ "Cách deploy: npm build → docker push"    │
│  (kỹ năng)     │ How-to, step-by-step                      │
├────────────────┼───────────────────────────────────────────┤
│  working       │ "Task hiện tại: fix login bug"            │
│  (hiện tại)    │ Short-term, session context               │
├────────────────┼───────────────────────────────────────────┤
│  cache         │ API response cache                        │
│                │ Fast retrieval, TTL-based                  │
└────────────────┴───────────────────────────────────────────┘
```

### HNSW — Thuật Toán Tìm Kiếm Nhanh

**HNSW (Hierarchical Navigable Small World)** là thuật toán tìm kiếm láng giềng gần nhất xấp xỉ (ANN) với độ phức tạp O(log n).

#### Tại sao cần HNSW?

```
Brute-force search (n=1,000,000 vectors):
  So sánh với TẤT CẢ 1M vectors → O(n) = 1,000,000 phép tính → CHẬM

HNSW search (n=1,000,000 vectors):
  Chỉ duyệt ~20 nodes mỗi layer × ~16 layers → O(log n) → NHANH 150x-12,500x
```

#### Cấu Trúc Graph Nhiều Tầng

```
Layer 3 (thưa nhất):  ●─────────────────●
                       │                 │
Layer 2:               ●────●────────────●────●
                       │    │            │    │
Layer 1:               ●────●────●───────●────●────●
                       │    │    │       │    │    │
Layer 0 (dày nhất):    ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●
                       (tất cả vectors đều ở đây)

Mỗi node kết nối với M=16 láng giềng gần nhất trong cùng layer.
```

#### Quá Trình Tìm Kiếm

```
Query vector Q:
         │
Step 1:  │  Bắt đầu từ entry point (layer cao nhất)
         ▼
         [Layer 3] Greedy search → tìm node gần Q nhất
         │
Step 2:  │  Xuống Layer 2, tiếp tục từ node vừa tìm
         ▼
         [Layer 2] Greedy search → tìm node gần hơn
         │
Step 3:  │  Xuống Layer 1, 0
         ▼
         [Layer 0] Beam search với ef=200 (top candidates)
         │
         ▼
         Trả về top-k results theo distance
```

#### Optimizations trong Ruflo

```
1. Binary Heap (thay Array.sort):
   - BinaryMinHeap: O(log n) per operation
   - BinaryMaxHeap: Bounded top-k tracking
   - vs Array.sort: 3-5x speedup

2. Pre-normalized Cosine (quan trọng!):
   - Cosine thường: (a·b) / (||a||·||b||)  ← cần 3 sqrt
   - Pre-normalized: chỉ cần a·b (dot product) ← 2x nhanh hơn
   - Ruflo L2-normalize khi insert, không cần normalize khi search

3. Vector Quantization (nén vector):
   - Binary:  1 bit/dim → 32x nén  (tốc độ max, chất lượng thấp)
   - Scalar:  8 bit/dim → 4x nén   (balance)
   - Product: codebook  → 8-16x nén (tốt nhất)
   - Int8 quantization: 3.92x nén, 50-75% giảm bộ nhớ
```

### Query Builder — API Tìm Kiếm

```typescript
// Fluent API, đọc như tiếng Anh tự nhiên:
const results = await memory.query(
  query()
    .semantic('security vulnerabilities')   // Tìm kiếm ngữ nghĩa
    .inNamespace('security')                // Trong namespace security
    .withTags(['critical', 'cve'])          // Có các tag này
    .threshold(0.8)                         // Độ tương đồng >= 80%
    .limit(10)                              // Lấy 10 kết quả
    .sortBy('recency')                      // Sắp xếp theo thời gian
    .build()
)
```

### 8 AgentDB Controllers

```
┌────────────────┬─────────────────────────────────────────┐
│  agentdb       │ Core CRUD operations                    │
│  episodic      │ Time-based memory queries               │
│  semantic      │ Fact/concept storage & retrieval        │
│  procedural    │ Skill/how-to knowledge                  │
│  working       │ Current session context                  │
│  embedding     │ Vector operations (insert/search)       │
│  search        │ Query processing, ranking               │
│  cache         │ TTL-based caching layer                 │
└────────────────┴─────────────────────────────────────────┘
```

### Memory Graph — Knowledge Graph

```
                   ┌─── "JWT Token" ───┐
                   │    (semantic)     │
                   │                   │
         "OAuth 2.0"               "Bearer Auth"
         (semantic)  ─── related ───  (semantic)
              │                            │
         "Fix login bug"            "Security audit"
          (episodic)    ← depends ─   (episodic)

Edge types: depends_on, related_to, parent_of, derived_from
```

---

## 5. Neural/SONA — Học Máy Thích Nghi

### SONA là gì?

**SONA (Self-Optimizing Neural Architecture)** là hệ thống học từ kinh nghiệm của agent. Thay vì chỉ dùng kiến thức pre-trained của Claude, SONA cho phép agent **học thêm từ công việc thực tế** và cải thiện theo thời gian.

### 4-Step Learning Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    SONA Learning Pipeline                        │
│                                                                 │
│  Raw Experience                                                 │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────┐                   │
│  │  STEP 1: RETRIEVE                       │                   │
│  │  Dùng HNSW tìm kinh nghiệm tương tự     │                   │
│  │  Query: embedding của task hiện tại     │                   │
│  │  Result: top-3 patterns liên quan       │                   │
│  └──────────────────┬──────────────────────┘                   │
│                     │                                           │
│                     ▼                                           │
│  ┌─────────────────────────────────────────┐                   │
│  │  STEP 2: JUDGE                          │                   │
│  │  LLM đánh giá trajectory               │                   │
│  │  → TrajectoryVerdict {                  │                   │
│  │      quality: 0.85,                     │                   │
│  │      shouldLearn: true,                 │                   │
│  │      feedback: "good approach"          │                   │
│  │    }                                    │                   │
│  └──────────────────┬──────────────────────┘                   │
│                     │                                           │
│                     ▼                                           │
│  ┌─────────────────────────────────────────┐                   │
│  │  STEP 3: DISTILL (LoRA)                 │                   │
│  │  Rút ra bài học chính                   │                   │
│  │  → DistilledMemory {                    │                   │
│  │      strategy: "Use PKCE for OAuth",    │                   │
│  │      keyLearnings: ["always validate"], │                   │
│  │      embedding: Float32Array(384),      │                   │
│  │    }                                    │                   │
│  └──────────────────┬──────────────────────┘                   │
│                     │                                           │
│                     ▼                                           │
│  ┌─────────────────────────────────────────┐                   │
│  │  STEP 4: CONSOLIDATE (EWC++)            │                   │
│  │  Hợp nhất vào kho kiến thức             │                   │
│  │  - Loại bỏ duplicate (threshold 0.8)    │                   │
│  │  - Phát hiện mâu thuẫn                  │                   │
│  │  - EWC++ ngăn quên kiến thức cũ         │                   │
│  └─────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### LoRA — Low-Rank Adaptation

LoRA là kỹ thuật fine-tune **nhẹ và nhanh**. Thay vì cập nhật toàn bộ model weights (rất chậm), LoRA thêm hai ma trận nhỏ A và B:

```
Bình thường: W_new = W_old + ΔW    ← ΔW rất lớn (hidden_dim × hidden_dim)

LoRA:        W_new = W_old + B·A   ← A: (rank × hidden_dim)
                                      B: (hidden_dim × rank)
                                      rank = 1..16 (rất nhỏ!)

Ví dụ: hidden_dim=768, rank=4
  ΔW bình thường: 768 × 768 = 589,824 tham số
  LoRA A+B:       768×4 + 4×768 = 6,144 tham số  ← 96x ít hơn!
```

### EWC++ — Chống "Catastrophic Forgetting"

Vấn đề: Khi học điều mới, neural network thường **quên** điều cũ.

```
Trước EWC:                        Sau EWC++:
  Học task A                        Học task A
  Học task B  → quên task A!        Học task B → giữ task A!

Cơ chế EWC++:
  Fisher Information Matrix F  ← đo tầm quan trọng của mỗi weight với task A

  Loss = Loss_B + λ Σ F_i (θ_i - θ*_i)²

  Weights quan trọng cho task A sẽ bị "phạt" nếu thay đổi nhiều
  → Học task B mà không phá vỡ task A

Online EWC (trong Ruflo):
  fisher[i] *= decay   ← giảm dần tầm quan trọng theo thời gian
  ewcState.taskCount++ ← đếm số task đã học
```

### 5 SONA Learning Modes

```
┌────────────┬──────────┬─────────────────────────────────────┐
│ Mode       │ Latency  │ Khi nào dùng                        │
├────────────┼──────────┼─────────────────────────────────────┤
│ real-time  │ 0.5ms    │ Production, cần phản hồi ngay       │
│ balanced   │ 18ms     │ Default, balance speed/quality      │
│ research   │ 100ms    │ Offline, chất lượng cao nhất        │
│ edge       │ 1ms      │ IoT, thiết bị hạn chế tài nguyên    │
│ batch      │ 50ms     │ Xử lý nhiều trajectories cùng lúc   │
└────────────┴──────────┴─────────────────────────────────────┘
```

### 7 RL Algorithms

```
┌────────────────────┬─────────────────────────────────────────┐
│ PPO                │ Default. Clipped objective ngăn update  │
│ (Proximal Policy   │ quá lớn. Dùng GAE để estimate returns.  │
│  Optimization)     │ Phổ biến nhất cho LLM fine-tuning.      │
├────────────────────┼─────────────────────────────────────────┤
│ DQN                │ Discrete actions. Replay buffer để     │
│ (Deep Q-Network)   │ giảm correlation. Target network để    │
│                    │ stabilize training. ε-greedy explore.  │
├────────────────────┼─────────────────────────────────────────┤
│ A2C                │ Continuous control. Policy + Value     │
│ (Advantage Actor-  │ networks. Advantage = Q(s,a) - V(s).   │
│  Critic)           │ Giảm variance so với REINFORCE.         │
├────────────────────┼─────────────────────────────────────────┤
│ Decision           │ Trajectory as sequence. Transformer    │
│ Transformer        │ học context-dependent actions.          │
├────────────────────┼─────────────────────────────────────────┤
│ Q-Learning         │ Simple tabular method. Bellman eq.     │
│ SARSA              │ On-policy Q-learning.                   │
│ Curiosity          │ Intrinsic reward cho exploration.       │
└────────────────────┴─────────────────────────────────────────┘
```

### Trajectory — Đơn Vị Học Tập

```typescript
interface Trajectory {
  trajectoryId: string;
  context: string;               // "Fix OAuth login bug"
  domain: 'code' | 'reasoning' | 'chat' | ...;
  steps: [
    { action: "read auth.ts", reward: 0.1, stateEmbedding: Float32Array },
    { action: "found bug", reward: 0.5, stateEmbedding: Float32Array },
    { action: "fix bug", reward: 1.0, stateEmbedding: Float32Array },
  ];
  qualityScore: 0.85;
  verdict: { shouldLearn: true, feedback: "efficient debugging" };
  distilledMemory: { strategy: "check imports first" };
}
```

### ReasoningBank — Kho Lưu Trữ Kinh Nghiệm

```
┌─────────────────────────────────────────────────────────────┐
│                    ReasoningBank                             │
│                                                             │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │   Raw Store     │    │    Distilled Store           │   │
│  │  (trajectories) │    │  (patterns, learnings)       │   │
│  │  max: 5000      │    │  HNSW-indexed                │   │
│  └────────┬────────┘    └──────────────┬───────────────┘   │
│           │                            │                    │
│           └──────────┬─────────────────┘                    │
│                      │                                      │
│              AgentDB + HNSW Index                           │
│              namespace: "reasoning-bank"                    │
│                                                             │
│  Config:                                                    │
│    vectorDimension: 768                                     │
│    dedupThreshold: 0.8   (loại bỏ nếu quá giống)           │
│    distillationThreshold: 0.6 (chỉ lưu nếu quality >= 0.6) │
│    retrievalK: 3          (lấy top-3 tương tự)             │
│    mmrLambda: 0.7         (cân bằng relevance + diversity)  │
└─────────────────────────────────────────────────────────────┘
```

### MMR — Maximal Marginal Relevance

Khi tìm kiếm top-k results, MMR đảm bảo kết quả **đa dạng** (không chỉ lấy k results gần nhau nhất):

```
MMR score = λ · Relevance(doc, query) - (1-λ) · max Similarity(doc, selected)
                                                    ↑
                                          Phạt nếu quá giống docs đã chọn

λ = 0.7 → 70% relevance, 30% diversity
```

---

## 6. Hooks — Vòng Đời Sự Kiện

### Hooks là gì?

Hooks là **sự kiện được kích hoạt tự động** tại các điểm quan trọng trong vòng đời làm việc. Chúng kết nối các hệ thống với nhau.

### 17 Hooks + 12 Workers

```
LIFECYCLE HOOKS:
  pre-edit ──────► Trước khi sửa file
  post-edit ─────► Sau khi sửa file → train patterns
  pre-command ───► Trước khi chạy CLI command
  post-command ──► Sau khi chạy command → record outcome
  pre-task ──────► Trước khi agent nhận task
  post-task ─────► Sau khi task xong → store results, train neural

SESSION HOOKS:
  session-start ─► Session mới → restore context từ Memory
  session-end ───► Session kết thúc → export metrics, persist state
  session-restore► Khôi phục session cũ

INTELLIGENCE HOOKS:
  route ─────────► Trước khi dispatch task → routing suggestion
  explain ───────► Giải thích tại sao route như vậy
  pretrain ──────► Scan repo → bootstrap intelligence
  build-agents ──► Generate agent configs tối ưu

LEARNING HOOKS:
  intelligence ──► Neural events (trajectory-start/step/end)
  transfer ──────► Chuyển học sang platform khác (Claude ↔ Codex)

AGENT TEAMS HOOKS:
  teammate-idle ─► Teammate rảnh → auto-assign task mới
  task-completed ► Task xong → train patterns, notify lead
```

### Data Flow Qua Hooks

```
User edits file.ts
        │
        ▼
   pre-edit hook
   ┌─────────────────────────────────────────────┐
   │ 1. Check path safety (PathValidator)        │
   │ 2. Get relevant context from Memory         │
   │ 3. Validate no secrets in file              │
   └─────────────────────────────────────────────┘
        │
        ▼
   [EDIT HAPPENS]
        │
        ▼
   post-edit hook
   ┌─────────────────────────────────────────────┐
   │ 1. Record edit in episodic memory           │
   │ 2. Extract patterns → store in semantic     │
   │ 3. Train SONA with edit trajectory          │
   │ 4. Update HNSW index                        │
   │ 5. Trigger background workers if needed     │
   └─────────────────────────────────────────────┘
```

### 12 Background Workers

```
┌──────────────┬──────────┬────────────────────────────────────┐
│ Worker       │ Priority │ Mô tả                              │
├──────────────┼──────────┼────────────────────────────────────┤
│ ultralearn   │ normal   │ Deep knowledge từ codebase         │
│ optimize     │ HIGH     │ Tối ưu performance                 │
│ consolidate  │ low      │ Hợp nhất memory entries            │
│ predict      │ normal   │ Preload data có thể cần            │
│ audit        │ CRITICAL │ Security scan liên tục             │
│ map          │ normal   │ Map toàn bộ codebase               │
│ preload      │ low      │ Tải trước resources                │
│ deepdive     │ normal   │ Phân tích code sâu                 │
│ document     │ normal   │ Tự động tạo tài liệu               │
│ refactor     │ normal   │ Gợi ý refactoring                  │
│ benchmark    │ normal   │ Benchmark performance              │
│ testgaps     │ normal   │ Tìm test coverage gaps             │
└──────────────┴──────────┴────────────────────────────────────┘
```

### 3-Tier Model Routing

Hooks hỗ trợ routing thông minh để tiết kiệm chi phí:

```
Task nhận vào
      │
      ▼
 Phân tích độ phức tạp
      │
      ├── Complexity < 30% (simple transforms: var→const, add types)
      │         ▼
      │   Agent Booster (WASM) — <1ms, $0  ← BỎ QUA LLM hoàn toàn!
      │
      ├── 30-60% (simple tasks, short answers)
      │         ▼
      │   Haiku — ~500ms, $0.0002
      │
      └── > 60% (complex reasoning, architecture, security)
                ▼
          Sonnet/Opus — 2-5s, $0.003-0.015
```

---

## 7. Luồng Dữ Liệu Tổng Hợp

### Store Operation — Lưu một Knowledge Entry

```
Agent muốn lưu: "OAuth PKCE là bắt buộc cho public clients"

1. AGENT
   │── memory.store({ key: "oauth-pkce", content: "..." })
   │
2. HOOKS (pre-task)
   │── Log operation
   │── Validate input (InputValidator)
   │
3. EMBEDDINGS SERVICE
   │── Check L1 LRU cache → MISS
   │── Check L2 SQL cache → MISS
   │── Call Transformers.js ONNX model
   │── Tokenize → Encode → Mean pool → L2 normalize
   │── Float32Array(384) = [0.12, -0.18, 0.45, ...]
   │── Save to L1 + L2 cache
   │
4. MEMORY (AgentDBAdapter)
   │── Create MemoryEntry with embedding
   │── Insert into AgentDB
   │── Update HNSW index (layer assignment + connect neighbors)
   │── Update namespace/key/tag indexes
   │── Update CacheManager LRU
   │
5. NEURAL (post-task hook)
   │── Record to trajectory
   │── If trajectory complete: trigger ReasoningBank
   │
6. DONE ✓
```

### Search Operation — Tìm Kiếm Ngữ Nghĩa

```
Agent hỏi: "authentication security best practices?"

1. EMBEDDINGS SERVICE
   │── Embed query → Float32Array(384)
   │── L2 normalize (pre-normalize for HNSW)
   │
2. HNSW INDEX
   │── Entry point: layer 16 node
   │── Layer 16 → 15 → ... → 0 (greedy descent)
   │── Layer 0: beam search (ef=200 candidates)
   │── Binary heap tracking top-k
   │── Return: [(id_1, dist=0.05), (id_2, dist=0.12), ...]
   │
3. MEMORY (AgentDBAdapter)
   │── L1 Cache lookup cho mỗi id → HIT hoặc MISS
   │── Load từ AgentDB nếu MISS
   │── Filter by namespace/tags/threshold
   │── Sort by distance
   │── Return MemoryEntry[]
   │
4. NEURAL (optional MMR)
   │── Re-rank với MMR (λ=0.7) để đảm bảo diversity
   │
5. AGENT nhận kết quả:
   │── "OAuth PKCE bắt buộc" (dist=0.05)
   │── "JWT secret phải >= 256 bit" (dist=0.12)
   │── "Never store plaintext passwords" (dist=0.18)
```

### Learning Loop — SONA Học Từ Kinh Nghiệm

```
Session bắt đầu
      │
  session-start hook
      │── Restore memory từ AgentDB
      │── HNSW warm up
      │
Agent làm task: "Fix authentication bug"
      │
  intelligence hook (trajectory-start)
      │── trajectoryId = uuid()
      │── Embed context: "Fix authentication bug" → Float32Array
      │
Agent thực hiện các bước:
      │── Step 1: read auth.ts → reward: 0.1
      │── Step 2: found bug  → reward: 0.5
      │── Step 3: fixed bug  → reward: 1.0
      │── intelligence hook (trajectory-step) ghi lại mỗi bước
      │
Task xong
      │
  post-task hook
      │
  SONA.completeTrajectory()
      │
  ReasoningBank pipeline:
      │── RETRIEVE: HNSW tìm 3 trajectories tương tự từ quá khứ
      │── JUDGE: quality = 0.87 → shouldLearn = true
      │── DISTILL: "Always check imports before refactoring auth code"
      │── CONSOLIDATE:
      │       - Dedup check (threshold 0.8) → unique, giữ lại
      │       - EWC++ update fisher matrix
      │       - Store DistilledMemory vào AgentDB
      │
  session-end hook
      │── Export metrics
      │── Persist HNSW index
      │── Persist LoRA weights
      │
Session kết thúc → Knowledge được lưu cho session sau!
```

---

## 8. Bảng Thuật Toán Tổng Hợp

| Thuật Toán | Package | Mục Đích | Độ Phức Tạp |
|-----------|---------|---------|-------------|
| **HNSW** | memory | Approximate nearest neighbor search | O(log n) |
| **LRU Cache** | memory, embeddings | Eviction policy cho cache | O(1) |
| **L2 Normalization** | embeddings | Chuẩn hóa vector | O(d) |
| **Mean Pooling** | embeddings | Tổng hợp token embeddings | O(n·d) |
| **Poincaré Ball** | embeddings | Hyperbolic space cho hierarchy | O(d) |
| **Möbius Addition** | embeddings | Phép cộng hyperbolic | O(d) |
| **Sentence Chunking** | embeddings | Chia tài liệu | O(n) |
| **Binary Heap** | memory | Priority queue cho HNSW | O(log n) |
| **Int8 Quantization** | memory | Nén vector 4x | O(d) |
| **LoRA** | neural | Lightweight adaptation | O(rank·d) |
| **EWC++** | neural | Chống catastrophic forgetting | O(params) |
| **PPO** | neural | Policy optimization | O(T·batch) |
| **DQN** | neural | Q-learning với replay buffer | O(batch) |
| **Decision Transformer** | neural | Sequence-based learning | O(T²·d) |
| **MMR** | neural | Diverse retrieval | O(k²) |
| **JSON-RPC 2.0** | mcp | Protocol giao tiếp | O(1) |
| **Fréchet Mean** | embeddings | Hyperbolic centroid | O(n·d) |

---

---

## 9. Claude CLI Mặc Định vs Ruflo v3

| Tính năng | Claude CLI (mặc định) | Ruflo v3 thêm vào |
|-----------|----------------------|-------------------|
| **MCP** | ✅ Có — là MCP *client* (gọi tools) | Thêm MCP *server* với 215 tools |
| **Memory** | ❌ Không — chỉ có context window | `@claude-flow/memory` + AgentDB + HNSW |
| **Embeddings** | ❌ Không | `@claude-flow/embeddings` + 5 providers |
| **Hooks** | ⚠️ Có cơ bản (`.claude/hooks/`) | 17 hooks + 12 background workers |
| **Neural/SONA** | ❌ Không | ReasoningBank + LoRA + EWC++ |

**MCP** — Claude Code được Anthropic build sẵn để làm **MCP client** (gọi tools từ MCP servers). Nhưng bản thân nó không có sẵn server. Ruflo tự tạo MCP server (`npx claude-flow mcp start`) rồi đăng ký vào Claude.

**Memory** — Claude chỉ nhớ trong phạm vi **context window** của conversation hiện tại. Khi đóng session, tất cả mất. Ruflo xây dựng persistent memory riêng bằng AgentDB + SQLite + HNSW.

**Embeddings** — Claude không expose embedding API ra CLI. Ruflo tự gọi OpenAI API hoặc chạy local ONNX model (Transformers.js).

```
Claude CLI gốc:  session 1 → quên → session 2 → quên → ...

Ruflo v3:        session 1 → lưu vào AgentDB
                 session 2 → tìm lại từ AgentDB → học thêm
                 session N → ngày càng thông minh hơn
```

---

## 10. Agents & Swarm — Cách Hoạt Động

### Agent là gì?

Mỗi **agent** là một instance Claude riêng biệt chạy song song, được spawn bằng **`Task` tool** của Claude Code:

```javascript
// 3 lệnh trong CÙNG 1 message → chạy SONG SONG
Task("Coder",    "Implement OAuth login", "coder")
Task("Tester",   "Write tests for OAuth", "tester")
Task("Reviewer", "Review security",       "reviewer")
```

Mỗi agent có loại riêng (60+ loại: `coder`, `tester`, `architect`, `researcher`...), context riêng, và giao tiếp qua Memory namespace chung.

### Swarm Topologies

```
HIERARCHICAL (mặc định):        MESH:                ADAPTIVE:
                                 A ─── B              Tự thay đổi
    Coordinator                  │ ╲ ╱ │              topology theo
    ╱    │    ╲                  │  ╳  │              workload
Coder  Tester  Reviewer          │ ╱ ╲ │
                                 C ─── D
Coordinator điều phối,           Mọi agent nói chuyện  Hybrid
agent khác báo cáo lên           trực tiếp với nhau
```

Ruflo dùng **hierarchical** làm mặc định vì ít drift nhất — coordinator duy trì authoritative state.

### Khi bạn Prompt — Có Tự Động Tạo Agent Không?

```
┌──────────────────────────────────────────────────────────┐
│                   AUTO-SWARM TRIGGER                     │
├──────────────────┬───────────────────────────────────────┤
│  CÓ spawn swarm  │  Thay đổi 3+ files                   │
│  (tự động)       │  Feature implementation mới          │
│                  │  Refactoring across modules           │
│                  │  API changes + tests                  │
│                  │  Security/performance work            │
├──────────────────┼───────────────────────────────────────┤
│  KHÔNG spawn     │  Single file edit                    │
│  (Claude trả lời │  Simple bug fix (1-2 lines)          │
│   trực tiếp)     │  Documentation/config changes        │
└──────────────────┴───────────────────────────────────────┘
```

### Luồng Prompt Phức Tạp: "Thêm OAuth login với tests"

```
Bạn prompt
    │
    ▼
Claude nhận ra: cần 3+ files, feature mới → AUTO-SPAWN SWARM

1 message duy nhất, tất cả chạy song song:
  ├── MCP: swarm_init(topology="hierarchical", maxAgents=8)
  ├── Task("Coordinator", "điều phối agents, ghi vào memory")
  ├── Task("Architect",   "thiết kế cấu trúc OAuth")
  ├── Task("Coder",       "implement OAuth endpoints")
  ├── Task("Tester",      "viết tests")
  └── Task("Reviewer",    "review security")

                Memory Namespace "oauth-feature"
                ┌─────────────────────────────────┐
  Architect ───►│ design: "dùng PKCE, JWT 256bit" │
  Coder ───────►│ impl: "auth.ts đã xong"         │◄── Tester đọc
  Tester ───────►│ tests: "coverage 85%"           │
  Reviewer ────►│ findings: "cần rate limiting"   │
                └─────────────────────────────────┘

Coordinator tổng hợp → báo cáo cho bạn
```

Agents **không nói chuyện trực tiếp** với nhau — họ dùng shared Memory (AgentDB namespace) để chia sẻ kết quả.

### So Sánh Cuối Cùng

| | Claude CLI gốc | Claude-Flow Swarm |
|--|--|--|
| 1 prompt | 1 Claude trả lời | N agents song song |
| Context | Chỉ conversation | Shared memory (AgentDB) |
| Tốc độ | Sequential | Parallel (N lần nhanh hơn) |
| Kiến thức | Mất sau session | Persistent qua HNSW |
| Auto-trigger | Không | Có (task complexity detection) |

---

## Kết Luận

Ruflo v3 là một hệ thống multi-agent AI với:

1. **MCP** — Chuẩn hóa giao tiếp Claude ↔ Tools qua JSON-RPC 2.0
2. **Embeddings** — Chuyển text → vector với 5 providers, hyperbolic support
3. **Memory** — HNSW-indexed semantic storage với AgentDB backend
4. **Neural/SONA** — Học từ kinh nghiệm qua LoRA + EWC++ + ReasoningBank
5. **Hooks** — Event-driven lifecycle kết nối tất cả hệ thống

Điểm đặc biệt là các hệ thống này **không độc lập** — chúng tạo thành một vòng lặp học tập:

```
Làm việc → Hooks ghi nhận → Neural học → Memory lưu → Embeddings index
    ↑                                                        │
    └────────────── Tìm kiếm kinh nghiệm cũ ────────────────┘
```

Càng dùng nhiều, agent càng thông minh hơn.