# 8. Bảng Thuật Toán Tổng Hợp

> Tất cả thuật toán được sử dụng trong Ruflo v3.5, phân theo package.

---

## Mô Tả

Ruflo v3.5 sử dụng 20 thuật toán chính từ các lĩnh vực: vector search, machine learning, caching, cryptography, và distributed systems. Bảng dưới đây liệt kê đầy đủ.

## Bảng Thuật Toán

| Thuật Toán | Package | Mục Đích | Độ Phức Tạp |
|-----------|---------|---------|-------------|
| **HNSW** | memory | Approximate nearest neighbor search | O(log n) |
| **BM25** | memory | Keyword scoring (TF-IDF variant) | O(q·d) |
| **DiskANN** | memory | Disk-based ANN search cho large datasets | O(log n) |
| **Hybrid Fusion** | memory | Kết hợp HNSW + BM25 scores | O(k) |
| **LRU Cache** | memory, embeddings | Eviction policy cho cache | O(1) |
| **Binary Heap** | memory | Priority queue cho HNSW | O(log n) |
| **Int8 Quantization** | memory | Nén vector 4x | O(d) |
| **L2 Normalization** | embeddings | Chuẩn hóa vector | O(d) |
| **Mean Pooling** | embeddings | Tổng hợp token embeddings | O(n·d) |
| **Poincaré Ball** | embeddings | Hyperbolic space cho hierarchy | O(d) |
| **Möbius Addition** | embeddings | Phép cộng hyperbolic | O(d) |
| **Fréchet Mean** | embeddings | Hyperbolic centroid | O(n·d) |
| **Sentence Chunking** | embeddings | Chia tài liệu | O(n) |
| **LoRA** | neural | Lightweight model adaptation | O(rank·d) |
| **EWC++** | neural | Chống catastrophic forgetting | O(params) |
| **PPO** | neural | Policy optimization | O(T·batch) |
| **DQN** | neural | Q-learning với replay buffer | O(batch) |
| **Decision Transformer** | neural | Sequence-based learning | O(T²·d) |
| **MMR** | neural | Diverse retrieval | O(k²) |
| **JSON-RPC 2.0** | mcp | Protocol giao tiếp | O(1) |

### Thuật Toán Mới Trong v3.5

| Thuật Toán | Package | Mục Đích | Độ Phức Tạp |
|-----------|---------|---------|-------------|
| **BM25** | memory | Keyword-based scoring (TF-IDF variant) | O(q·d) |
| **DiskANN** | memory | Disk-based ANN search cho large datasets | O(log n) |
| **Hybrid Fusion** | memory | Kết hợp HNSW + BM25 scores | O(k) |
| **File Watcher** | memory | Debounced filesystem change detection | O(1) per event |
| **ONNX Bridge** | memory | Claude memory → AgentDB vector sync | O(n·d) |

## Giải Thích Ký Hiệu

| Ký hiệu | Ý nghĩa |
|---------|---------|
| n | Số lượng vectors/documents |
| d | Số chiều của vector (384) |
| k | Số kết quả trả về (top-k) |
| q | Số từ trong query |
| T | Số bước trong trajectory |
| batch | Kích thước batch training |
| rank | LoRA rank (1-16) |
| params | Tổng số tham số model |

---

## Tình Trạng Hiện Tại (v3.5.72)

Tất cả 20 thuật toán đều **implemented và stable**. 5 thuật toán mới được thêm trong v3.5 (BM25, DiskANN, Hybrid Fusion, File Watcher, ONNX Bridge).

---

## Cách Sử Dụng Ở Project Khác

Các thuật toán này hoạt động **ngầm** bên trong Ruflo. Bạn không cần gọi chúng trực tiếp. Khi bạn:

- Gọi `memory_search` → HNSW + BM25 + Hybrid Fusion tự chạy
- Gọi `memory_store` → L2 Norm + HNSW insert + BM25 index tự cập nhật
- Agent hoàn thành task → PPO + LoRA + EWC++ tự train
- Edit file → File Watcher + ONNX Bridge tự index

Tuy nhiên, bạn có thể tune tham số qua config:

```json
{
  "memory": {
    "hnsw": { "M": 16, "efSearch": 200 },
    "bm25": { "k1": 1.2, "b": 0.75 }
  },
  "neural": {
    "lora": { "rank": 4 },
    "ewc": { "lambda": 0.4 },
    "mmr": { "lambda": 0.7 }
  }
}
```
