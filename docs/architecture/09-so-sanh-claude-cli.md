# 9. Claude CLI Mặc Định vs Ruflo v3.5

> So sánh chi tiết giữa Claude Code vanilla và Ruflo v3.5 — hiểu rõ Ruflo thêm gì so với Claude CLI gốc.

---

## Mô Tả

Claude Code (CLI) là công cụ chính thức của Anthropic cho lập trình viên. Nó là **MCP client** — biết cách gọi tools từ MCP servers. Tuy nhiên, bản thân Claude CLI không có persistent memory, neural learning, hay multi-agent swarm.

Ruflo mở rộng Claude Code bằng cách cung cấp **MCP server** với 259+ tools, biến Claude từ "stateless assistant" thành "learning multi-agent system".

## Bảng So Sánh

| Tính năng | Claude CLI (mặc định) | Ruflo v3.5 thêm vào |
|-----------|----------------------|-------------------|
| **MCP** | ✅ Có — là MCP *client* (gọi tools) | Thêm MCP *server* với 259+ tools |
| **Memory** | ❌ Không — chỉ có context window | `@claude-flow/memory` + AgentDB + HNSW + BM25 + DiskANN |
| **Embeddings** | ❌ Không | `@claude-flow/embeddings` + 5 providers + RuVector WASM |
| **Hooks** | ⚠️ Có cơ bản (`.claude/hooks/`) | 17 hooks + 12 background workers |
| **Neural/SONA** | ❌ Không | ReasoningBank + LoRA + EWC++ + self-learning pipeline |
| **Memory Bridge** | ❌ Không | Claude auto-memory ↔ AgentDB sync (MỚI v3.5) |
| **File Watcher** | ❌ Không | Auto-index file changes vào AgentDB (MỚI v3.5) |
| **Multi-agent** | ⚠️ Có Task tool | + Swarm orchestration, topologies, coordination |
| **Security** | ⚠️ Basic | + CVE scanning, path validation, input sanitization |

## Giải Thích Từng Điểm

### MCP

**Claude Code** được Anthropic build sẵn để làm **MCP client** (gọi tools từ MCP servers). Nhưng bản thân nó không có sẵn server. Ruflo tự tạo MCP server (`npx claude-flow mcp start`) rồi đăng ký vào Claude.

### Memory

**Claude** chỉ nhớ trong phạm vi **context window** của conversation hiện tại. Khi đóng session, tất cả mất. Ruflo xây dựng persistent memory riêng bằng AgentDB + SQLite + HNSW + BM25 hybrid search.

### Embeddings

**Claude** không expose embedding API ra CLI. Ruflo tự gọi OpenAI API hoặc chạy local ONNX model (Transformers.js), hoặc RuVector WASM cho real semantic embeddings.

### Memory Bridge (MỚI v3.5)

Claude Code có auto-memory (`~/.claude/projects/*/memory/*.md`) nhưng không có vector search. Ruflo bridge đồng bộ chúng vào AgentDB với ONNX embeddings, cho phép unified semantic search.

### Tóm Tắt Bằng Sơ Đồ

```
Claude CLI gốc:  session 1 → quên → session 2 → quên → ...

Ruflo v3.5:      session 1 → lưu vào AgentDB + bridge Claude memories
                 session 2 → hybrid search (HNSW + BM25) → học thêm
                 session N → ngày càng thông minh hơn + file watcher indexing
```

---

## Tình Trạng Hiện Tại (v3.5.72)

Ruflo v3.5 đã **stable** với tất cả tính năng trên. Điểm nổi bật:
- 259+ MCP tools (tăng từ 215)
- 19 AgentDB controllers (tăng từ 8)
- 3 search engines (HNSW + BM25 + DiskANN)
- End-to-end self-learning pipeline
- Cross-platform (Linux, Mac, Windows)
- 100% real metrics (honesty audit hoàn tất)

---

## Cách Sử Dụng Ở Project Khác

### Biến Claude Code thành Ruflo-powered system

```bash
# Bước 1: Thêm MCP server
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest mcp start

# Bước 2: Init project
cd your-project/
npx @claude-flow/cli@latest init --wizard

# Bước 3: Start daemon
npx @claude-flow/cli@latest daemon start

# Done! Claude Code giờ có:
# ✅ Persistent memory (HNSW + BM25)
# ✅ Self-learning (SONA pipeline)
# ✅ 259+ tools
# ✅ Multi-agent swarm
# ✅ Background workers
```

### Khi nào nên dùng Ruflo?

| Trường hợp | Nên dùng? | Lý do |
|-----------|----------|-------|
| Project nhỏ, single-file edits | ❌ Không cần | Claude CLI đủ |
| Feature implementation lớn | ✅ Nên | Multi-agent + memory |
| Long-term project (nhiều sessions) | ✅ Nên | Persistent learning |
| Team collaboration | ✅ Nên | Shared memory + patterns |
| Security-sensitive | ✅ Nên | Security scanning + validation |
| One-off questions | ❌ Không cần | Overhead không đáng |
