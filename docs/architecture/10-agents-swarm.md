# 10. Agents & Swarm — Cách Hoạt Động

> Multi-agent system cho phép spawn nhiều Claude instances song song, phối hợp qua shared Memory và swarm topologies.

---

## Mô Tả

Mỗi **agent** là một instance Claude riêng biệt chạy song song, được spawn bằng **Task tool** của Claude Code. Ruflo cung cấp 60+ loại agent chuyên biệt và swarm orchestration để phối hợp chúng.

## Giải Thích Chi Tiết

### Agent là gì?

```javascript
// 3 lệnh trong CÙNG 1 message → chạy SONG SONG
Task("Coder",    "Implement OAuth login", "coder")
Task("Tester",   "Write tests for OAuth", "tester")
Task("Reviewer", "Review security",       "reviewer")
```

Mỗi agent có:
- **Loại riêng**: 60+ loại (`coder`, `tester`, `architect`, `researcher`...)
- **Context riêng**: Mỗi agent có prompt và instructions riêng
- **Giao tiếp qua Memory**: Shared AgentDB namespace

### 60+ Agent Types

| Nhóm | Agents |
|------|--------|
| **Core Development** | coder, reviewer, tester, planner, researcher |
| **V3 Specialized** | security-architect, security-auditor, memory-specialist, performance-engineer |
| **Swarm Coordination** | hierarchical-coordinator, mesh-coordinator, adaptive-coordinator |
| **Consensus** | byzantine-coordinator, raft-manager, gossip-coordinator, quorum-manager |
| **GitHub** | pr-manager, code-review-swarm, issue-tracker, release-manager |
| **SPARC** | sparc-coord, sparc-coder, specification, pseudocode, architecture |
| **Specialized** | backend-dev, mobile-dev, ml-developer, cicd-engineer, api-docs |

### Swarm Topologies

```
HIERARCHICAL (mặc định):        MESH:                ADAPTIVE:
                                 A ─── B              Tự thay đổi
    Coordinator                  │ ╲ ╱ │              topology theo
    ╱    │    ╲                  │  ╳  │              workload
Coder  Tester  Reviewer          │ ╱ ╲ │
                                 C ─── D
Coordinator điều phối,           Mọi agent nói chuyện  Hybrid
agent khác báo cáo lên           trực tiếp với nhau
```

Ruflo dùng **hierarchical** làm mặc định vì ít drift nhất — coordinator duy trì authoritative state.

### Auto-Swarm Trigger

```
┌──────────────────────────────────────────────────────────┐
│                   AUTO-SWARM TRIGGER                     │
├──────────────────┬───────────────────────────────────────┤
│  CÓ spawn swarm  │  Thay đổi 3+ files                   │
│  (tự động)       │  Feature implementation mới          │
│                  │  Refactoring across modules           │
│                  │  API changes + tests                  │
│                  │  Security/performance work            │
├──────────────────┼───────────────────────────────────────┤
│  KHÔNG spawn     │  Single file edit                    │
│  (Claude trả lời │  Simple bug fix (1-2 lines)          │
│   trực tiếp)     │  Documentation/config changes        │
└──────────────────┴───────────────────────────────────────┘
```

### Luồng Prompt Phức Tạp: "Thêm OAuth login với tests"

```
Bạn prompt
    │
    ▼
Claude nhận ra: cần 3+ files, feature mới → AUTO-SPAWN SWARM

1 message duy nhất, tất cả chạy song song:
  ├── MCP: swarm_init(topology="hierarchical", maxAgents=8)
  ├── Task("Coordinator", "điều phối agents, ghi vào memory")
  ├── Task("Architect",   "thiết kế cấu trúc OAuth")
  ├── Task("Coder",       "implement OAuth endpoints")
  ├── Task("Tester",      "viết tests")
  └── Task("Reviewer",    "review security")

                Memory Namespace "oauth-feature"
                ┌─────────────────────────────────┐
  Architect ───►│ design: "dùng PKCE, JWT 256bit" │
  Coder ───────►│ impl: "auth.ts đã xong"         │◄── Tester đọc
  Tester ───────►│ tests: "coverage 85%"           │
  Reviewer ────►│ findings: "cần rate limiting"   │
                └─────────────────────────────────┘

Coordinator tổng hợp → báo cáo cho bạn
```

Agents **không nói chuyện trực tiếp** — họ dùng shared Memory (AgentDB namespace).

### So Sánh

| | Claude CLI gốc | Ruflo Swarm |
|--|--|--|
| 1 prompt | 1 Claude trả lời | N agents song song |
| Context | Chỉ conversation | Shared memory (AgentDB) |
| Tốc độ | Sequential | Parallel (N lần nhanh hơn) |
| Kiến thức | Mất sau session | Persistent qua HNSW |
| Auto-trigger | Không | Có (task complexity detection) |

---

## Tình Trạng Hiện Tại (v3.5.72)

| Thành phần | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| 60+ Agent Types | **Stable** | Tất cả types hoạt động |
| Hierarchical Topology | **Stable** | Default, anti-drift |
| Mesh Topology | **Stable** | Fully connected |
| Adaptive Topology | **Stable** | Auto-switching |
| Agent Teams | **Stable** | Task tool + SendMessage |
| Auto-Swarm Trigger | **Stable** | Complexity detection |
| Swarm Activity Tracking | **Fixed v3.5** | Real agent state (#1354) |
| Hive-Mind Status | **Fixed v3.5** | Real state thay hardcoded (#1385) |

---

## Cách Sử Dụng Ở Project Khác

### Qua MCP (auto)

Khi Ruflo MCP server chạy, Claude Code tự phát hiện tasks phức tạp và spawn swarm. Bạn không cần làm gì.

### Qua CLI

```bash
# Init swarm
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Spawn agent
npx @claude-flow/cli@latest agent spawn -t coder --name my-coder

# List agents
npx @claude-flow/cli@latest agent list

# Check agent status
npx @claude-flow/cli@latest agent status --name my-coder

# Stop agent
npx @claude-flow/cli@latest agent stop --name my-coder

# Swarm status
npx @claude-flow/cli@latest swarm status
```

### Qua Agent Teams (Claude Code native)

```javascript
// Enable trong .claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}

// Spawn teammates
Task({
  prompt: "Design the API",
  subagent_type: "system-architect",
  name: "architect",
  run_in_background: true
})
```

### Agent Routing (Anti-Drift)

| Code | Task | Agents |
|------|------|--------|
| 1 | Bug Fix | coordinator, researcher, coder, tester |
| 3 | Feature | coordinator, architect, coder, tester, reviewer |
| 5 | Refactor | coordinator, architect, coder, reviewer |
| 7 | Performance | coordinator, perf-engineer, coder |
| 9 | Security | coordinator, security-architect, auditor |
| 11 | Memory | coordinator, memory-specialist, perf-engineer |
| 13 | Docs | researcher, api-docs |

### Cấu Hình Swarm

```json
{
  "topology": "hierarchical",
  "maxAgents": 8,
  "strategy": "specialized",
  "consensus": "raft"
}
```

### Lưu ý

1. **Hierarchical preferred**: Ít drift nhất — coordinator duy trì authoritative state
2. **Max 6-8 agents**: Nhóm nhỏ = phối hợp tốt hơn
3. **Background execution**: Luôn dùng `run_in_background: true`
4. **Don't poll**: Không check status liên tục — chờ agents trả về
5. **Shared memory**: Agents giao tiếp qua AgentDB namespace, không trực tiếp
