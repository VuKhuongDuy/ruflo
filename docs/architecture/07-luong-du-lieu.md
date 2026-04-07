# 7. Luồng Dữ Liệu Tổng Hợp

> Mô tả chi tiết cách dữ liệu chảy qua các hệ thống khi Store, Search, và Learning.

---

## Mô Tả

Tài liệu này mô tả 3 luồng dữ liệu chính: **Store** (lưu kiến thức), **Search** (tìm kiếm), và **Learning Loop** (học từ kinh nghiệm). Mỗi luồng đi qua nhiều hệ thống: Hooks → Embeddings → Memory → Neural.

## Store Operation — Lưu Một Knowledge Entry

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
   │── Update BM25 inverted index (tokenize + store TF)
   │── Update namespace/key/tag indexes
   │── Update CacheManager LRU
   │
5. NEURAL (post-task hook)
   │── Record to trajectory
   │── If trajectory complete: trigger ReasoningBank
   │
6. DONE ✓
```

## Search Operation — Tìm Kiếm Ngữ Nghĩa

```
Agent hỏi: "authentication security best practices?"

1. EMBEDDINGS SERVICE
   │── Embed query → Float32Array(384)
   │── L2 normalize (pre-normalize for HNSW)
   │
2. HYBRID SEARCH (v3.5)
   │
   ├── HNSW INDEX (semantic)
   │   │── Entry point: layer 16 node
   │   │── Layer 16 → 15 → ... → 0 (greedy descent)
   │   │── Layer 0: beam search (ef=200 candidates)
   │   │── Binary heap tracking top-k
   │   │── Return: [(id_1, dist=0.05), (id_2, dist=0.12), ...]
   │
   ├── BM25 ENGINE (keyword)
   │   │── Tokenize query
   │   │── Lookup inverted index
   │   │── Score: IDF × TF / (TF + k1 × length_norm)
   │   │── Return: [(id_3, score=8.5), (id_1, score=7.2), ...]
   │
   └── HYBRID FUSION
       │── Normalize scores to [0, 1]
       │── hybrid = α·HNSW + (1-α)·BM25
       │── Merge and re-rank
   │
3. MEMORY (AgentDBAdapter)
   │── L1 Cache lookup cho mỗi id → HIT hoặc MISS
   │── Load từ AgentDB nếu MISS
   │── Filter by namespace/tags/threshold
   │── Sort by hybrid score
   │── Return MemoryEntry[]
   │
4. NEURAL (optional MMR)
   │── Re-rank với MMR (λ=0.7) để đảm bảo diversity
   │
5. AGENT nhận kết quả:
   │── "OAuth PKCE bắt buộc" (score=0.95)
   │── "JWT secret phải >= 256 bit" (score=0.88)
   │── "Never store plaintext passwords" (score=0.82)
```

## Learning Loop — SONA Học Từ Kinh Nghiệm

```
Session bắt đầu
      │
  session-start hook
      │── Restore memory từ AgentDB
      │── Bridge import Claude Code memories (MỚI v3.5)
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

## Tình Trạng Hiện Tại (v3.5.72)

| Luồng | Trạng thái | Ghi chú |
|-------|-----------|---------|
| Store | **Stable** | HNSW + BM25 indexing đồng thời |
| Search | **Stable** | Hybrid fusion (HNSW + BM25) |
| Learning Loop | **Stable** | End-to-end wired (ADR-075) |
| Bridge Import | **MỚI v3.5** | Auto trên session-start |
| File Watcher Index | **MỚI v3.5** | Auto trên file change |

---

## Cách Sử Dụng Ở Project Khác

Các luồng dữ liệu này **tự động hoạt động** khi:

1. **Store**: Agent gọi `memory_store` qua MCP → tự embed + index
2. **Search**: Agent gọi `memory_search` qua MCP → hybrid HNSW + BM25
3. **Learning**: Hooks ghi trajectory → SONA tự learn → persist

Bạn không cần cấu hình gì thêm. Chỉ cần:

```bash
# Init project (cài hooks + config)
npx @claude-flow/cli@latest init --wizard

# Start daemon (cho background workers)
npx @claude-flow/cli@latest daemon start

# Done! Tất cả luồng tự hoạt động
```
