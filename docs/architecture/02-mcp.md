# 2. MCP — Model Context Protocol

> MCP là giao thức cho phép Claude Code gọi các công cụ bên ngoài một cách chuẩn hóa. Ruflo tạo ra một MCP server gồm 259+ tools mà Claude có thể gọi theo yêu cầu.

---

## Mô Tả

**MCP (Model Context Protocol)** là chuẩn giao tiếp giữa Claude Code và các hệ thống bên ngoài. Claude Code được Anthropic build sẵn là **MCP client** — nó biết cách gọi tools từ MCP servers. Ruflo cung cấp **MCP server** với 259+ tools chuyên biệt cho memory, agents, neural learning, security, v.v.

Giao thức sử dụng **JSON-RPC 2.0** qua 3 transport modes: STDIO (default), HTTP, và WebSocket.

## Giải Thích Chi Tiết

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

// 259+ tools được phân nhóm:
const TOOL_REGISTRY = {
  // Agent tools: spawn, list, stop, metrics
  // Swarm tools: init, coordinate, status
  // Memory tools: store, search, retrieve, delete
  // Neural tools: train, predict, patterns
  // Security tools: scan, audit, validate
  // Guidance tools: discover, navigate
  // Bridge tools: import, status, unified search
  // ... và nhiều hơn
}
```

### Performance

| Metric | Target | Ý nghĩa |
|--------|--------|---------|
| Server startup | <400ms | CLI ready sau 400ms |
| Health check | <10ms | Ping mỗi 30 giây |
| Tool response | <100ms | Mỗi lần Claude gọi tool |
| Graceful shutdown | <5s | SIGTERM → SIGKILL nếu quá 5s |

---

## Tình Trạng Hiện Tại (v3.5.72)

| Metric | Giá trị |
|--------|---------|
| Tổng số tools | 259+ |
| Transport modes | STDIO (default), HTTP, WebSocket |
| Startup time | <400ms |
| Tool categories | Agent, Swarm, Memory, Neural, Security, Guidance, Bridge, Hooks, Analytics |

### Cải Tiến Trong v3.5 (kể từ 01/03/2026)

- **259+ tools** (tăng từ 215): thêm memory bridge, guidance, analytics, file watcher tools
- **Self-detection fix**: MCP server không còn tự kill chính nó khi startup (bug #1381)
- **Stale PID protection**: Tránh false positives từ PID cũ
- **Guidance tools** (MỚI): `guidance_discover` cho capability discovery và navigation
- **stdio transport fix**: Self-detection chính xác cho stdio mode

---

## Cách Sử Dụng Ở Project Khác

### Đăng ký MCP Server

```bash
# Cách 1: Đăng ký vào Claude Code (recommended)
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest mcp start

# Cách 2: Start thủ công (HTTP mode)
npx @claude-flow/cli@latest mcp start --transport http --port 3000

# Cách 3: Start thủ công (WebSocket mode)
npx @claude-flow/cli@latest mcp start --transport ws --port 3001
```

### Kiểm tra MCP Server

```bash
# Kiểm tra server đang chạy
npx @claude-flow/cli@latest status

# Health check
npx @claude-flow/cli@latest doctor
```

### Các Nhóm Tool Quan Trọng

Khi MCP server chạy, Claude Code tự động thấy tất cả tools. Các nhóm chính:

| Nhóm | Prefix | Ví dụ | Mô tả |
|------|--------|-------|-------|
| **Memory** | `memory_` | `memory_store`, `memory_search` | Lưu trữ và tìm kiếm kiến thức |
| **Agent** | `agent_` | `agent_spawn`, `agent_list` | Quản lý agent lifecycle |
| **Swarm** | `swarm_` | `swarm_init`, `swarm_status` | Điều phối multi-agent |
| **Neural** | `neural_` | `neural_train`, `neural_predict` | Machine learning |
| **Security** | `security_` | `security_scan`, `security_audit` | Bảo mật |
| **Hooks** | `hooks_` | `hooks_pre_task`, `hooks_post_task` | Sự kiện vòng đời |
| **Guidance** | `guidance_` | `guidance_discover` | Capability discovery |
| **Bridge** | `memory_import_claude`, `memory_bridge_status` | Sync Claude ↔ AgentDB |

### Cấu Hình MCP

Trong `claude-flow.config.json`:

```json
{
  "mcp": {
    "transport": "stdio",
    "port": 3000,
    "host": "localhost"
  }
}
```

Environment variables:

```bash
CLAUDE_FLOW_MCP_PORT=3000
CLAUDE_FLOW_MCP_HOST=localhost
CLAUDE_FLOW_MCP_TRANSPORT=stdio
```

### Tích hợp với MCP config JSON

Nếu project dùng file MCP config (`.claude/mcp.json`):

```json
{
  "servers": {
    "claude-flow": {
      "command": "npx",
      "args": ["-y", "@claude-flow/cli@latest", "mcp", "start"]
    }
  }
}
```
