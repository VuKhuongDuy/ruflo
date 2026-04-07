# Chạy Ruflo MCP Server

## Thêm vào Claude Code

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest mcp start
```

Sau khi thêm, mọi project dùng Claude Code đều có thể gọi ruflo MCP tools.

---

## CLI Flags (`mcp start`)

| Flag | Short | Type | Default | Mô tả |
|------|-------|------|---------|-------|
| `--port` | `-p` | number | 3000 | Server port |
| `--host` | `-h` | string | localhost | Server host |
| `--transport` | `-t` | `stdio` \| `http` \| `websocket` | `stdio` | Transport protocol |
| `--tools` | — | string | `all` | Tools bật (comma-separated hoặc "all") |
| `--daemon` | `-d` | boolean | false | Chạy background |
| `--force` | `-f` | boolean | false | Force restart (kill server cũ) |

---

## Environment Variables

```bash
CLAUDE_FLOW_MCP_TRANSPORT=stdio    # override transport
CLAUDE_FLOW_MCP_PORT=3000          # override port
CLAUDE_FLOW_MCP_HOST=localhost     # override host
```

---

## Ví Dụ

```bash
# Mặc định (stdio) — dùng với Claude Code
npx @claude-flow/cli@latest mcp start

# HTTP trên port 8080
npx @claude-flow/cli@latest mcp start -t http -p 8080

# WebSocket, cho phép remote
npx @claude-flow/cli@latest mcp start -t websocket -h 0.0.0.0 -p 3001

# Chỉ bật một số tools
npx @claude-flow/cli@latest mcp start --tools memory_search,neural_train,task_create

# Daemon mode
npx @claude-flow/cli@latest mcp start -d
```

---

## Config Nâng Cao

Các options dưới đây cấu hình qua file config (`claude-flow.config.json`) hoặc programmatic API, không qua CLI flags.

### TLS

| Option | Type | Mô tả |
|--------|------|-------|
| `tlsEnabled` | boolean | Bật HTTPS |
| `tlsCert` | string | Path đến TLS certificate |
| `tlsKey` | string | Path đến TLS private key |

### Authentication

| Option | Type | Mô tả |
|--------|------|-------|
| `auth.enabled` | boolean | Bật authentication |
| `auth.method` | `token` \| `oauth` \| `api-key` \| `none` | Phương thức xác thực |
| `auth.tokens` | string[] | Danh sách token hợp lệ |
| `auth.apiKeys` | string[] | Danh sách API key hợp lệ |
| `auth.jwtSecret` | string | JWT signing secret |

### CORS

| Option | Type | Mô tả |
|--------|------|-------|
| `corsEnabled` | boolean | Bật CORS |
| `corsOrigins` | string[] | Allowed origins |

### Performance

| Option | Type | Default | Mô tả |
|--------|------|---------|-------|
| `enableMetrics` | boolean | true | Thu thập metrics |
| `enableCaching` | boolean | true | Bật response cache |
| `cacheTTL` | number | 10000 | Cache TTL (ms) |
| `maxRequestSize` | number | 10MB | Kích thước request tối đa |
| `requestTimeout` | number | 30000 | Timeout mỗi request (ms) |

### Load Balancer

| Option | Type | Mô tả |
|--------|------|-------|
| `loadBalancer.enabled` | boolean | Bật load balancing |
| `loadBalancer.maxConcurrentRequests` | number | Số request đồng thời tối đa |
| `loadBalancer.rateLimit.requestsPerSecond` | number | Rate limit |
| `loadBalancer.rateLimit.burstSize` | number | Burst cho phép |
| `loadBalancer.circuitBreaker.failureThreshold` | number | Số lỗi trước khi ngắt |
| `loadBalancer.circuitBreaker.resetTimeout` | number | Thời gian reset (ms) |

### Connection Pool

| Option | Type | Mô tả |
|--------|------|-------|
| `connectionPool.maxConnections` | number | Số connection tối đa |
| `connectionPool.minConnections` | number | Số connection tối thiểu |
| `connectionPool.idleTimeout` | number | Timeout connection idle (ms) |

### Logging

| Option | Type | Default | Mô tả |
|--------|------|---------|-------|
| `logLevel` | `debug` \| `info` \| `warn` \| `error` | `info` | Mức log |

---

## Transport Types

| Transport | Khi nào dùng | Cần host/port? |
|-----------|-------------|----------------|
| **stdio** | Claude Code integration (mặc định) | Không |
| **http** | Remote access, multiple clients | Có |
| **websocket** | Real-time, bidirectional | Có |

**Lưu ý**: Khi dùng với `claude mcp add`, transport luôn là `stdio`. Các flag `--port`, `--host` chỉ relevant cho `http`/`websocket`.

---

## Limitations

- **Auto-learn chưa hoạt động**: SONA learning pipeline không tự trigger khi dùng qua MCP. Xem [tasks/auto-learn.md](tasks/auto-learn.md).
