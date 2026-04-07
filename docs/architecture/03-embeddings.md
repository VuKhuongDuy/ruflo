# 3. Embeddings — Biểu Diễn Vector

> Embeddings chuyển text thành vector số (mảng float) để máy tính có thể so sánh ngữ nghĩa giữa các đoạn text.

---

## Mô Tả

Embedding là nền tảng cho **tất cả** tính năng semantic trong Ruflo: memory search, neural learning, pattern matching. Khi bạn lưu một kiến thức, nó được chuyển thành vector 384 chiều. Khi tìm kiếm, query cũng được embed rồi so sánh khoảng cách vector.

```
"con mèo" → [0.15, -0.23, 0.87, ...]  (384 số)
"cat"      → [0.14, -0.22, 0.85, ...]  (384 số, tương tự!)
"ô tô"    → [0.91, 0.34, -0.12, ...]  (rất khác)

Cosine similarity("con mèo", "cat") ≈ 0.95  ← rất gần
Cosine similarity("con mèo", "ô tô") ≈ 0.12 ← rất xa
```

## Giải Thích Chi Tiết

### 5 Embedding Providers

Ruflo tự động chọn provider tốt nhất có sẵn theo thứ tự ưu tiên:

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

Vì embedding model có giới hạn input (~512 tokens), tài liệu dài cần được chia nhỏ:

```
Tài liệu 2000 từ
         │
         ▼  chunk_size=200, overlap=50
┌──────────────────────────────────────────────────────────┐
│ Chunk 1: [0-200]   "OAuth 2.0 là giao thức..."           │
│ Chunk 2: [150-350] "...xác thực. Access token được..."   │  ← overlap 50
│ Chunk 3: [300-500] "...cấp bởi Authorization Server..."  │  ← overlap 50
└──────────────────────────────────────────────────────────┘

Chunking Strategies:
- Character: Đơn giản, cắt theo ký tự
- Sentence:  Giữ nguyên câu, không cắt giữa câu  ← tốt nhất
- Paragraph: Nhóm theo \n\n
- Token:     ~4 chars/token heuristic
```

### Hyperbolic Embeddings — Poincaré Ball

Công nghệ đặc biệt cho **dữ liệu có cấu trúc cây** (hierarchy):

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

### Cache Architecture (3 tầng)

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

## Tình Trạng Hiện Tại (v3.5.72)

| Thành phần | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| Transformers.js (ONNX) | **Stable** | all-MiniLM-L6-v2, 384 dimensions, offline |
| agentic-flow ONNX | **Stable** | 3-4x faster với SIMD + double cache |
| OpenAI API | **Stable** | text-embedding-3-small/large |
| RVF (TypeScript) | **Stable** | 52KB, <1ms, fallback |
| RuVector WASM | **MỚI v3.5** | Real semantic embeddings, không cần API |
| Hyperbolic (Poincaré) | **Stable** | Cho hierarchical data |
| 3-tier Cache | **Stable** | LRU + SQLite + Model, 95%+ hit rate |
| Document Chunking | **Stable** | Character, Sentence, Paragraph, Token |

---

## Cách Sử Dụng Ở Project Khác

### Tự động (qua MCP)

Khi bạn dùng Ruflo MCP server, embeddings **tự động hoạt động**. Mỗi khi bạn gọi `memory_store` hoặc `memory_search`, Embedding Service tự chọn provider tốt nhất và cache kết quả.

### Cấu hình provider

```bash
# Mặc định: tự chọn theo priority (agentic-flow > transformers.js > OpenAI > RVF)
# Không cần cấu hình gì

# Nếu muốn dùng OpenAI (cần API key):
export OPENAI_API_KEY=sk-...
```

### Sử dụng trực tiếp (programmatic)

```typescript
import { EmbeddingService } from '@claude-flow/embeddings';

const service = new EmbeddingService();

// Embed text
const vector = await service.embed("OAuth authentication pattern");
// → Float32Array(384)

// Embed batch
const vectors = await service.embedBatch([
  "OAuth pattern",
  "JWT security",
  "rate limiting"
]);

// So sánh similarity
const similarity = service.cosineSimilarity(vectorA, vectorB);
// → 0.0 đến 1.0
```

### CLI Commands

```bash
# Embed text
npx @claude-flow/cli@latest embeddings embed "OAuth authentication"

# Batch embed
npx @claude-flow/cli@latest embeddings batch --input texts.json

# Search (dùng embeddings ngầm)
npx @claude-flow/cli@latest embeddings search "authentication patterns"

# Init embeddings cache
npx @claude-flow/cli@latest embeddings init
```

### Lưu ý khi dùng ở project khác

1. **Offline-first**: Transformers.js chạy local, không cần API key. Model (~22MB) tự download lần đầu
2. **Cache persistent**: Embeddings được cache trong SQLite, restart không mất
3. **Dimension cố định**: Tất cả providers output 384-dim vectors (trừ OpenAI large = 3072)
4. **Pre-normalized**: Vectors đã L2-normalized sẵn, chỉ cần dot product để tính similarity
