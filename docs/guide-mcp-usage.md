# Hướng Dẫn Sử Dụng Ruflo MCP Server Ở Project Khác

> Guide này dành cho người đã add ruflo MCP server vào Claude Code và muốn tận dụng hết tính năng: memory, embedding, learning, hooks, neural,...

---

## 1. Setup

### Bước 1: Thêm MCP server

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest mcp start
```

### Bước 2: Tạo CLAUDE.md cho project của bạn

Thêm hướng dẫn vào `CLAUDE.md` ở root project để Claude **tự động** sử dụng ruflo tools:

```markdown
## Ruflo MCP Integration

### Memory
- Trước khi bắt đầu task, search memory: `memory_search({ query: "<mô tả task>" })`
- Sau khi hoàn thành task quan trọng, lưu pattern: `memory_store({ key: "pattern-xxx", value: "...", namespace: "patterns" })`
- Dùng `memory_search_unified` để tìm kiếm semantic across tất cả namespaces

### Hooks — Learning Pipeline
- Đầu session: `hooks_session-start({ sessionId: "<id>" })`
- Trước mỗi task: `hooks_pre-task({ description: "<mô tả>" })`
- Sau mỗi task: `hooks_post-task({ taskId: "<id>", success: true, quality: 0.85 })`
- Cuối session: `hooks_session-end({ exportMetrics: true })`

### Neural
- Sau vài session, train patterns: `neural_train({ modelType: "moe", epochs: 10 })`
- Trước task phức tạp, hỏi gợi ý: `neural_predict({ context: "<mô tả task>" })`
```

### Bước 3 (optional): Init ruflo trong project

```bash
cd your-project
npx @claude-flow/cli@latest init
```

Tạo `claude-flow.config.json` với neural, memory, hooks enabled.

---

## 2. Cách Prompt Để Dùng Từng Tính Năng

### Memory — Nhớ xuyên session

**Prompt lưu kiến thức:**
```
Hãy lưu pattern vừa dùng vào memory với key "auth-oauth-pkce"
và namespace "patterns"
```
Claude sẽ gọi: `memory_store({ key: "auth-oauth-pkce", value: "...", namespace: "patterns" })`

**Prompt tìm kiến thức cũ:**
```
Trước khi implement, hãy search memory xem mình đã có pattern nào
liên quan đến authentication chưa
```
Claude sẽ gọi: `memory_search({ query: "authentication patterns" })`

**Prompt tìm kiếm semantic across tất cả:**
```
Search unified memory cho "error handling strategy"
```
Claude sẽ gọi: `memory_search_unified({ query: "error handling strategy" })`

---

### Hooks — Lifecycle & Learning

**Prompt bắt đầu session:**
```
Bắt đầu session mới, init hooks
```
Claude sẽ gọi: `hooks_session-start({ sessionId: "..." })`

**Prompt sau khi hoàn thành task:**
```
Task xong rồi, hãy record kết quả vào hooks để SONA học
```
Claude sẽ gọi: `hooks_post-task({ taskId: "...", success: true })`

**Prompt routing thông minh:**
```
Phân tích task này và suggest agent phù hợp nhất
```
Claude sẽ gọi: `hooks_route({ task: "..." })` hoặc `hooks_model-route({ task: "..." })`

---

### Neural/SONA — Học từ kinh nghiệm

**Prompt train patterns:**
```
Train neural patterns từ những gì đã học được
```
Claude sẽ gọi: `neural_train({ modelType: "moe", epochs: 10 })`

**Prompt dùng patterns đã học:**
```
Dựa trên neural patterns, predict approach tốt nhất cho việc
refactor module authentication này
```
Claude sẽ gọi: `neural_predict({ context: "refactor authentication module" })`

**Prompt xem patterns đã học:**
```
Show tất cả neural patterns đã học được
```
Claude sẽ gọi: `neural_patterns()`

---

### Embeddings — Vector Search

**Prompt generate embedding:**
```
Tạo embedding cho file src/auth.ts để search semantic sau này
```
Claude sẽ gọi: `embeddings_generate({ text: "...", model: "all-MiniLM-L6-v2" })`

**Prompt search bằng embedding:**
```
Tìm code nào trong project tương tự nhất với đoạn logic này
```
Claude sẽ gọi: `embeddings_search({ query: "...", limit: 5 })`

---

### Intelligence — Trajectory Recording

Để SONA học được, cần ghi lại **trajectory** (chuỗi hành động):

**Prompt bắt đầu trajectory:**
```
Bắt đầu record trajectory cho task "implement user API"
```
Claude sẽ gọi: `intelligence_trajectory-start({ context: "implement user API" })`

**Prompt ghi step:**
```
Record step: đã đọc xong code hiện tại, found pattern X
```
Claude sẽ gọi: `intelligence_trajectory-step({ action: "analyzed code", reward: 0.5 })`

**Prompt kết thúc trajectory:**
```
Task xong, end trajectory với verdict success
```
Claude sẽ gọi: `intelligence_trajectory-end({ verdict: "success" })`

---

### AgentDB — Knowledge Graph

**Prompt lưu pattern có cấu trúc:**
```
Lưu pattern "PKCE auth flow" vào AgentDB với tags security, oauth
```
Claude sẽ gọi: `agentdb_pattern-store({ pattern: "...", tags: ["security", "oauth"] })`

**Prompt tìm pattern:**
```
Tìm trong AgentDB patterns liên quan đến security
```
Claude sẽ gọi: `agentdb_pattern-search({ query: "security patterns" })`

**Prompt feedback loop:**
```
Record feedback: approach vừa dùng rất hiệu quả, quality 0.9
```
Claude sẽ gọi: `agentdb_feedback({ taskId: "...", quality: 0.9, success: true })`

---

## 3. Workflow Mẫu — Một Task Hoàn Chỉnh

Đây là cách prompt một task để dùng hết tính năng:

```
Tôi cần thêm API GET /users/:id cho user service.

Trước khi code:
1. Search memory xem có pattern API nào đã lưu chưa
2. Check neural predict cho approach tốt nhất
3. Start trajectory recording

Khi code xong:
4. Lưu pattern vào memory
5. Record hooks post-task
6. End trajectory
```

Claude sẽ tự gọi tuần tự:

```
① memory_search({ query: "REST API GET endpoint pattern" })
② neural_predict({ context: "add GET /users/:id endpoint" })
③ intelligence_trajectory-start({ context: "add GET /users/:id" })
④ [... code ...]
⑤ memory_store({ key: "pattern-get-user-api", value: "...", namespace: "patterns" })
⑥ hooks_post-task({ taskId: "...", success: true })
⑦ intelligence_trajectory-end({ verdict: "success" })
```

---

## 4. Tự Động Hóa Bằng CLAUDE.md

Thay vì prompt thủ công mỗi lần, thêm rules vào `CLAUDE.md`:

```markdown
## Ruflo Auto-Learning Rules

### Bắt buộc cho MỌI task:
- Đầu task: gọi `memory_search` với mô tả task
- Cuối task thành công: gọi `hooks_post-task` với success=true
- Cuối task thất bại: gọi `hooks_post-task` với success=false

### Cho task phức tạp (3+ files):
- Start trajectory recording trước khi code
- Record mỗi step quan trọng (found bug, designed solution, implemented fix)
- End trajectory khi hoàn thành
- Lưu pattern vào memory nếu approach mới

### Mỗi 5 sessions:
- Chạy `neural_train` để consolidate patterns
- Chạy `neural_optimize` để tối ưu
```

---

## 5. Danh Sách Tools Theo Nhóm

### Memory (10 tools)
`memory_store`, `memory_retrieve`, `memory_search`, `memory_search_unified`, `memory_list`, `memory_delete`, `memory_stats`, `memory_migrate`, `memory_import_claude`, `memory_bridge_status`

### Hooks (55+ tools)
**Core**: `hooks_pre-task`, `hooks_post-task`, `hooks_pre-edit`, `hooks_post-edit`, `hooks_session-start`, `hooks_session-end`
**Intelligence**: `intelligence_trajectory-start`, `intelligence_trajectory-step`, `intelligence_trajectory-end`, `intelligence_pattern-store`, `intelligence_pattern-search`, `intelligence_stats`
**Workers**: `hooks_worker-list`, `hooks_worker-dispatch`, `hooks_worker-status`
**Model routing**: `hooks_model-route`, `hooks_model-outcome`, `hooks_model-stats`

### Neural (6 tools)
`neural_train`, `neural_status`, `neural_patterns`, `neural_predict`, `neural_optimize`, `neural_compress`

### Embeddings (7 tools)
`embeddings_generate`, `embeddings_search`, `embeddings_compare`, `embeddings_init`, `embeddings_status`, `embeddings_neural`, `embeddings_hyperbolic`

### AgentDB (15 tools)
`agentdb_pattern-store`, `agentdb_pattern-search`, `agentdb_feedback`, `agentdb_session-start`, `agentdb_session-end`, `agentdb_hierarchical-store`, `agentdb_hierarchical-recall`, `agentdb_semantic-route`, `agentdb_context-synthesize`, `agentdb_causal-edge`, `agentdb_consolidate`, `agentdb_route`, `agentdb_batch`, `agentdb_health`, `agentdb_controllers`

### Swarm (9 tools)
`swarm_init`, `swarm_status`, `swarm_health`, `swarm_shutdown`, `swarm_exists`, `agents`, `coordinator`, `topology`, `persistence`

### Task (7 tools)
`task_create`, `task_list`, `task_status`, `task_assign`, `task_complete`, `task_cancel`, `task_update`

---

## 6. Tips

1. **CLAUDE.md là chìa khóa**: Claude chỉ gọi MCP tools khi có lý do. Viết rules rõ ràng trong CLAUDE.md để Claude tự động gọi đúng tools.

2. **Memory namespace**: Dùng namespace để tổ chức — `patterns` cho code patterns, `decisions` cho architecture decisions, `bugs` cho bug patterns đã gặp.

3. **Không cần gọi hết**: Bắt đầu với `memory_search` + `hooks_post-task`. Thêm dần khi quen.

4. **Neural cần thời gian**: Patterns chỉ hữu ích sau vài chục tasks. Chạy `neural_train` định kỳ.

5. **Auto-learn chưa hoàn chỉnh**: Hiện tại SONA không tự trigger qua MCP — cần gọi hooks thủ công hoặc viết rules trong CLAUDE.md. Xem [tasks/auto-learn.md](tasks/auto-learn.md).
