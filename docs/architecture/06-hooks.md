# 6. Hooks — Vòng Đời Sự Kiện

> Hooks là sự kiện tự động kích hoạt tại các điểm quan trọng trong vòng đời làm việc, kết nối Memory, Neural, và Embeddings thành một hệ thống thống nhất.

---

## Mô Tả

Hooks là "keo dán" kết nối tất cả hệ thống trong Ruflo. Mỗi khi agent thực hiện một hành động (edit file, chạy command, hoàn thành task), hooks tự động:
- Ghi nhận vào memory
- Train neural patterns
- Update HNSW index
- Trigger background workers

Ruflo có **17 hooks** và **12 background workers**.

## Giải Thích Chi Tiết

### 17 Hooks

```
LIFECYCLE HOOKS:
  pre-edit ──────► Trước khi sửa file
  post-edit ─────► Sau khi sửa file → train patterns
  pre-command ───► Trước khi chạy CLI command
  post-command ──► Sau khi chạy command → record outcome
  pre-task ──────► Trước khi agent nhận task
  post-task ─────► Sau khi task xong → store results, train neural

SESSION HOOKS:
  session-start ─► Session mới → restore context từ Memory + bridge Claude memories
  session-end ───► Session kết thúc → export metrics, persist state
  session-restore► Khôi phục session cũ

INTELLIGENCE HOOKS:
  route ─────────► Trước khi dispatch task → routing suggestion (3-tier)
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

| Worker | Priority | Mô tả |
|--------|----------|-------|
| ultralearn | normal | Deep knowledge từ codebase |
| optimize | **HIGH** | Tối ưu performance |
| consolidate | low | Hợp nhất memory entries |
| predict | normal | Preload data có thể cần |
| audit | **CRITICAL** | Security scan liên tục |
| map | normal | Map toàn bộ codebase |
| preload | low | Tải trước resources |
| deepdive | normal | Phân tích code sâu |
| document | normal | Tự động tạo tài liệu |
| refactor | normal | Gợi ý refactoring |
| benchmark | normal | Benchmark performance |
| testgaps | normal | Tìm test coverage gaps |

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

## Tình Trạng Hiện Tại (v3.5.72)

| Thành phần | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| 17 Hooks | **Stable** | Tất cả hooks hoạt động |
| 12 Workers | **Stable** | Background daemon quản lý |
| 3-Tier Routing | **Stable** | Agent Booster / Haiku / Opus |
| Session hooks | **Stable** | Auto bridge Claude memories on start |
| Learning hooks | **Stable** | End-to-end pipeline (ADR-075) |
| Agent Teams hooks | **Stable** | teammate-idle, task-completed |

### Cải tiến v3.5

- **ADR-061**: Cross-platform hooks, Windows parity
- **Hook stdin fix**: ADR-060 Sprint 1
- **Path resolution**: `$CLAUDE_PROJECT_DIR` cho hooks path (chống traversal)
- **Semantic routing learning loop**: Closed trong hooks-tools (#1311)
- **Session-start**: Auto-import Claude memories vào AgentDB

---

## Cách Sử Dụng Ở Project Khác

### Tự động

Khi bạn `npx @claude-flow/cli@latest init`, hooks được cài đặt vào `.claude/hooks/`. Chúng tự động kích hoạt khi Claude Code chạy các hành động.

### Cấu hình hooks

File `.claude/settings.json`:

```json
{
  "hooks": {
    "pre-edit": ["npx @claude-flow/cli@latest hooks pre-edit --file $FILE"],
    "post-edit": ["npx @claude-flow/cli@latest hooks post-edit --file $FILE --train-patterns"],
    "pre-task": ["npx @claude-flow/cli@latest hooks pre-task --description \"$TASK\""],
    "post-task": ["npx @claude-flow/cli@latest hooks post-task --task-id $TASK_ID --success $SUCCESS"]
  }
}
```

### CLI Commands

```bash
# Core hooks
npx @claude-flow/cli@latest hooks pre-task --description "fix auth bug"
npx @claude-flow/cli@latest hooks post-task --task-id "task-123" --success true

# Session
npx @claude-flow/cli@latest hooks session-start --session-id "session-1"
npx @claude-flow/cli@latest hooks session-end --export-metrics true
npx @claude-flow/cli@latest hooks session-restore --session-id "session-1"

# Intelligence
npx @claude-flow/cli@latest hooks route --task "implement OAuth"
npx @claude-flow/cli@latest hooks explain --topic "why use PKCE"
npx @claude-flow/cli@latest hooks pretrain

# Workers
npx @claude-flow/cli@latest hooks worker list
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
npx @claude-flow/cli@latest hooks worker status

# Neural learning
npx @claude-flow/cli@latest hooks pretrain --model-type moe --epochs 10
npx @claude-flow/cli@latest hooks build-agents --agent-types coder,tester
```

### Background Workers

Workers chạy qua daemon:

```bash
# Start daemon (bắt buộc cho workers)
npx @claude-flow/cli@latest daemon start

# Kiểm tra workers
npx @claude-flow/cli@latest hooks worker list
npx @claude-flow/cli@latest hooks worker status

# Dispatch worker thủ công
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
npx @claude-flow/cli@latest hooks worker dispatch --trigger testgaps
```

### Lưu ý

1. **Daemon required**: Workers cần daemon chạy nền (`daemon start`)
2. **Auto-learning**: post-edit và post-task tự train patterns
3. **Session persistence**: session-end export metrics, session-start restore context
4. **Cross-platform**: Hooks hoạt động trên Linux, Mac, và Windows
5. **Path safety**: Hooks validate paths qua PathValidator (chống traversal)
