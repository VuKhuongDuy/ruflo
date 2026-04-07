# 5. Neural/SONA — Học Máy Thích Nghi

> SONA (Self-Optimizing Neural Architecture) cho phép agent học từ kinh nghiệm thực tế và cải thiện theo thời gian qua pipeline 4 bước: RETRIEVE → JUDGE → DISTILL → CONSOLIDATE.

---

## Mô Tả

Thay vì chỉ dùng kiến thức pre-trained của Claude, SONA cho phép agent **học thêm từ công việc thực tế**. Mỗi task agent thực hiện được ghi lại thành trajectory, đánh giá chất lượng, rút ra bài học, và lưu vào kho kiến thức (ReasoningBank) cho các session sau.

Pipeline đã được **wired end-to-end** kể từ ADR-075 (v3.5.65).

## Giải Thích Chi Tiết

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

Fine-tune nhẹ và nhanh — thêm 2 ma trận nhỏ thay vì cập nhật toàn bộ weights:

```
Bình thường: W_new = W_old + ΔW    ← ΔW rất lớn (hidden_dim × hidden_dim)
LoRA:        W_new = W_old + B·A   ← A: (rank × hidden_dim), B: (hidden_dim × rank)

Ví dụ: hidden_dim=768, rank=4
  ΔW bình thường: 768 × 768 = 589,824 tham số
  LoRA A+B:       768×4 + 4×768 = 6,144 tham số  ← 96x ít hơn!
```

### EWC++ — Chống "Catastrophic Forgetting"

```
Trước EWC:                        Sau EWC++:
  Học task A                        Học task A
  Học task B  → quên task A!        Học task B → giữ task A!

Cơ chế: Fisher Information Matrix đo tầm quan trọng mỗi weight
  Loss = Loss_B + λ Σ F_i (θ_i - θ*_i)²
  → Weights quan trọng cho task A bị "phạt" nếu thay đổi nhiều
```

### 5 SONA Learning Modes

| Mode | Latency | Khi nào dùng |
|------|---------|-------------|
| real-time | 0.5ms | Production, cần phản hồi ngay |
| balanced | 18ms | Default, balance speed/quality |
| research | 100ms | Offline, chất lượng cao nhất |
| edge | 1ms | IoT, thiết bị hạn chế |
| batch | 50ms | Xử lý nhiều trajectories cùng lúc |

### 7 RL Algorithms

| Algorithm | Mô tả |
|----------|-------|
| **PPO** (default) | Clipped objective, GAE, phổ biến nhất cho LLM |
| **DQN** | Discrete actions, replay buffer, ε-greedy |
| **A2C** | Continuous, Advantage = Q(s,a) - V(s) |
| **Decision Transformer** | Trajectory as sequence |
| **Q-Learning** | Simple tabular, Bellman eq |
| **SARSA** | On-policy Q-learning |
| **Curiosity** | Intrinsic reward cho exploration |

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
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │   Raw Store     │    │    Distilled Store           │   │
│  │  (trajectories) │    │  (patterns, learnings)       │   │
│  │  max: 5000      │    │  HNSW-indexed                │   │
│  └────────┬────────┘    └──────────────┬───────────────┘   │
│           └──────────┬─────────────────┘                    │
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

Đảm bảo kết quả tìm kiếm **đa dạng**:

```
MMR score = λ · Relevance(doc, query) - (1-λ) · max Similarity(doc, selected)
λ = 0.7 → 70% relevance, 30% diversity
```

---

## Tình Trạng Hiện Tại (v3.5.72)

| Thành phần | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| 4-Step Pipeline | **Stable** | Wired end-to-end (ADR-075) |
| ReasoningBank | **Stable** | HNSW-indexed, dedup, MMR |
| LoRA Adaptation | **Stable** | rank 1-16 |
| EWC++ | **Stable** | Online mode với decay |
| Trajectory Recording | **Stable** | Auto qua hooks |
| Intelligence Dedup | **Fixed v3.5.54** | Không còn duplicate entries |
| Real Metrics | **Fixed v3.5.53-59** | Honesty audit hoàn tất |

### Cải tiến v3.5

- **ADR-075**: Self-learning pipeline wired end-to-end (hooks → SONA → ReasoningBank → AgentDB)
- **Honesty audit**: Loại bỏ toàn bộ simulated scores, thay bằng real metrics
- **Intelligence dedup**: Fix duplicate entries trong intelligence store (#1518)

---

## Cách Sử Dụng Ở Project Khác

### Tự động (recommended)

Neural/SONA **tự hoạt động** khi hooks enabled. Mỗi task agent thực hiện tự động:
1. Ghi trajectory qua `intelligence` hook
2. Đánh giá quality qua `post-task` hook
3. Distill + consolidate qua ReasoningBank
4. Lưu patterns vào AgentDB

### Qua CLI

```bash
# Train neural patterns
npx @claude-flow/cli@latest neural train --model-type moe --epochs 10

# Check neural status
npx @claude-flow/cli@latest neural status

# List learned patterns
npx @claude-flow/cli@latest neural patterns

# Predict (dùng patterns đã học)
npx @claude-flow/cli@latest neural predict --context "Fix auth bug"

# Optimize
npx @claude-flow/cli@latest neural optimize
```

### Qua MCP Tools

```
neural_train({ modelType: "moe", epochs: 10 })
neural_status()
neural_patterns()
neural_predict({ context: "authentication bug" })
```

### Qua Hooks (tùy chỉnh)

```bash
# Trigger pretrain (scan repo → bootstrap intelligence)
npx @claude-flow/cli@latest hooks pretrain

# Xem intelligence stats
npx @claude-flow/cli@latest hooks intelligence stats

# Train sau khi edit file
npx @claude-flow/cli@latest hooks post-edit --file "src/auth.ts" --train-patterns
```

### Cấu Hình

```json
{
  "neural": {
    "enabled": true,
    "mode": "balanced",
    "reasoningBank": {
      "maxTrajectories": 5000,
      "dedupThreshold": 0.8,
      "distillationThreshold": 0.6
    },
    "lora": {
      "rank": 4,
      "learningRate": 0.001
    },
    "ewc": {
      "lambda": 0.4,
      "decay": 0.999
    }
  }
}
```

### Lưu ý

1. **Auto-learning (chưa hoàn chỉnh)**: Pipeline SONA đã wired end-to-end, nhưng **chưa tự động trigger** khi dùng qua MCP server. Hiện tại cần gọi `hooks post-task` thủ công sau mỗi task để learning pipeline chạy. Xem [task auto-learn](../tasks/auto-learn.md) để theo dõi tiến độ fix.
2. **Persistence**: Patterns và LoRA weights persist qua sessions
3. **Dedup**: Tự loại bỏ knowledge trùng lặp (threshold 0.8)
4. **Quality gate**: Chỉ học từ trajectories có quality >= 0.6
