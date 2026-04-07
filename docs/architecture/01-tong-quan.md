# 1. Tổng Quan Kiến Trúc Ruflo v3.5

> Ruflo v3.5 là hệ thống multi-agent AI mở rộng Claude Code với persistent memory, self-learning, và swarm orchestration.

---

## Mô Tả

Ruflo v3.5 bao gồm 8 package chính phối hợp với nhau qua MCP (Model Context Protocol). Hệ thống chạy như một **MCP server** mà Claude Code kết nối đến, cung cấp 259+ tools cho agent sử dụng.

## Sơ Đồ Kiến Trúc

```
┌──────────────────────────────────────────────────────────────────────┐
│                       RUFLO v3.5 ARCHITECTURE                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   User / Claude Code                                                 │
│        │                                                             │
│        ▼                                                             │
│   ┌─────────┐    JSON-RPC 2.0     ┌──────────────────────────────┐  │
│   │   CLI   │◄──────────────────►│    MCP Server (259+ tools)   │  │
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
│   ┌────────────┐  ┌────────────┐  ┌──────────────┐               │  │
│   │ Embeddings │  │ File       │  │ Memory       │  ← MỚI v3.5  │  │
│   │  Service   │  │ Watcher    │  │ Bridge       │               │  │
│   └────────────┘  └────────────┘  │(Claude↔AgentDB)│             │  │
│                                   └──────────────┘               │  │
└──────────────────────────────────────────────────────────────────────┘
```

## Các Package Chính

| Package | Đường dẫn | Mục đích |
|---------|-----------|---------|
| `@claude-flow/cli` | `v3/@claude-flow/cli/` | CLI + MCP server (259+ tools) |
| `@claude-flow/embeddings` | `v3/@claude-flow/embeddings/` | Chuyển text → vector |
| `@claude-flow/memory` | `v3/@claude-flow/memory/` | Lưu trữ + tìm kiếm ngữ nghĩa (HNSW + BM25 + DiskANN) |
| `@claude-flow/neural` | `v3/@claude-flow/neural/` (trong CLI) | Học từ kinh nghiệm (SONA) |
| `@claude-flow/hooks` | `v3/@claude-flow/hooks/` | Sự kiện vòng đời |
| `@claude-flow/security` | `v3/@claude-flow/security/` | Bảo mật, validation |
| `@claude-flow/guidance` | `v3/@claude-flow/guidance/` | Governance control plane (MỚI v3.5) |
| `@claude-flow/codex` | `v3/@claude-flow/codex/` | Dual-mode Claude + Codex collaboration (MỚI v3.5) |

## Vòng Lặp Học Tập

Điểm đặc biệt là các hệ thống **không độc lập** — chúng tạo thành một vòng lặp:

```
Làm việc → Hooks ghi nhận → Neural học → Memory lưu → Embeddings index
    ↑                                                        │
    ├── File Watcher theo dõi thay đổi → auto-index ────────┤
    ├── Memory Bridge sync Claude memories ──────────────────┤
    └────────────── Hybrid search (HNSW + BM25) ─────────────┘
```

---

## Tình Trạng Hiện Tại (v3.5.72 — 07/04/2026)

| Thành phần | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| CLI + MCP Server | **Stable** | 259+ tools, 26 commands, 140+ subcommands |
| Memory (AgentDB) | **Stable** | HNSW + BM25 + DiskANN, 19 controllers |
| Embeddings | **Stable** | 5 providers, RuVector WASM |
| Neural/SONA | **Stable** | End-to-end pipeline wired (ADR-075) |
| Hooks | **Stable** | 17 hooks + 12 background workers |
| Memory Bridge | **Stable** | Claude Code ↔ AgentDB sync (ADR-076) |
| File Watcher | **MỚI** | Auto-index file changes |
| Security | **Stable** | ADR-061, cross-platform |
| Guidance | **MỚI** | Capability discovery |
| Codex (dual-mode) | **Alpha** | Claude + Codex collaboration |

---

## Cách Sử Dụng Ở Project Khác (MCP Server)

### Bước 1: Cài đặt

```bash
# Thêm Ruflo làm MCP server cho Claude Code
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest mcp start

# Hoặc cài global
npm install -g @claude-flow/cli
```

### Bước 2: Khởi tạo project

```bash
cd your-project/

# Khởi tạo với wizard (tạo config + hooks + CLAUDE.md)
npx @claude-flow/cli@latest init --wizard

# Hoặc dùng preset
npx @claude-flow/cli@latest init --preset default
```

### Bước 3: Start daemon

```bash
# Start background daemon (quản lý workers, memory, hooks)
npx @claude-flow/cli@latest daemon start

# Kiểm tra health
npx @claude-flow/cli@latest doctor --fix
```

### Bước 4: Sử dụng trong Claude Code

Khi Claude Code kết nối MCP server, tất cả 259+ tools sẽ available. Claude tự động sử dụng:

- **Memory tools**: `memory_store`, `memory_search`, `memory_retrieve` — lưu/tìm kiến thức
- **Agent tools**: `agent_spawn`, `agent_list` — quản lý agents
- **Swarm tools**: `swarm_init`, `swarm_status` — điều phối multi-agent
- **Neural tools**: `neural_train`, `neural_predict` — machine learning
- **Security tools**: `security_scan`, `security_audit` — bảo mật

### Cấu Hình Tùy Chỉnh

File `claude-flow.config.json` ở root project:

```json
{
  "topology": "hierarchical",
  "maxAgents": 8,
  "strategy": "specialized",
  "memory": {
    "backend": "hybrid",
    "path": "./data/memory"
  },
  "hooks": {
    "enabled": true,
    "workers": true
  }
}
```

---

## Tài Liệu Chi Tiết Từng Thành Phần

| File | Nội dung |
|------|---------|
| [02-mcp.md](02-mcp.md) | MCP — Model Context Protocol |
| [03-embeddings.md](03-embeddings.md) | Embeddings — Biểu Diễn Vector |
| [04-memory.md](04-memory.md) | Memory — Lưu Trữ & Tìm Kiếm |
| [05-neural-sona.md](05-neural-sona.md) | Neural/SONA — Học Máy Thích Nghi |
| [06-hooks.md](06-hooks.md) | Hooks — Vòng Đời Sự Kiện |
| [07-luong-du-lieu.md](07-luong-du-lieu.md) | Luồng Dữ Liệu Tổng Hợp |
| [08-thuat-toan.md](08-thuat-toan.md) | Bảng Thuật Toán |
| [09-so-sanh-claude-cli.md](09-so-sanh-claude-cli.md) | So Sánh Claude CLI vs Ruflo |
| [10-agents-swarm.md](10-agents-swarm.md) | Agents & Swarm |
| [11-changelog.md](11-changelog.md) | Changelog v3.5.3 → v3.5.72 |
