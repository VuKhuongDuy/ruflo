# @claude-flow V3 — Architecture Overview

Monorepo gồm **22 packages** được tổ chức theo **4 layer** từ dưới lên.

---

## Layer 1: Foundation (không phụ thuộc package nào)

| Package | Mục đích | File chính cần đọc |
|---------|----------|---------------------|
| **shared** | Types, events, DDD interfaces, config | `src/index.ts`, `src/core/`, `src/events/` |
| **security** | Input validation, path traversal, CVE fix | `src/index.ts`, 6 validators |
| **mcp** | MCP server (stdio/http/ws) | `src/server.ts`, `src/transport/` |
| **providers** | Multi-LLM (Anthropic, OpenAI, Google...) | `src/provider-manager.ts` |
| **embeddings** | Vector embeddings, ONNX, hyperbolic | `src/embedding-service.ts` |
| **performance** | Benchmark framework, Flash Attention | `src/index.ts` |
| **deployment** | Release management, npm publishing | `src/release-manager.ts` |

---

## Layer 2: Core (phụ thuộc Foundation)

| Package | Phụ thuộc | Mục đích | File chính |
|---------|-----------|----------|------------|
| **memory** | shared, embeddings | AgentDB + HNSW (150x-12,500x faster) | `src/index.ts`, `src/hnsw-lite.ts`, `src/hybrid-backend.ts` |
| **neural** | memory | SONA, ReasoningBank, RL algorithms | `src/index.ts`, `src/sona-manager.ts`, `src/algorithms/` |
| **swarm** | memory, neural | 15-agent hierarchical mesh | `src/unified-coordinator.ts`, `src/consensus/` |
| **hooks** | memory, swarm | 27 hooks + 12 workers | `src/index.ts`, `src/workers/` |
| **guidance** | memory | CLAUDE.md compiler & enforcement | `src/compiler.ts`, `src/gates.ts` |
| **testing** | shared | TDD London School framework | `src/index.ts` |

---

## Layer 3: Advanced (phụ thuộc Core)

| Package | Phụ thuộc | Mục đích | File chính |
|---------|-----------|----------|------------|
| **cli** | shared, memory, swarm, hooks, neural | 26 commands, 140+ subcommands | `src/index.ts`, `src/commands/`, `src/mcp-tools/` |
| **integration** | neural, swarm, memory, providers | agentic-flow bridge, token optimizer | `src/agentic-flow-bridge.ts` |
| **plugins** | shared | Plugin SDK, 60+ plugins | `src/index.ts`, `src/sdk/` |
| **browser** | memory, hooks, neural | Browser automation, 50+ MCP tools | `src/application/browser-service.ts` |
| **aidefence** | memory, neural | Prompt injection defense | `src/index.ts`, `src/domain/` |
| **claims** | shared, swarm | Issue claiming & handoff (ADR-016) | `src/domain/`, `src/api/mcp-tools.ts` |

---

## Layer 4: Standalone

| Package | Mục đích |
|---------|----------|
| **codex** | Claude Code ↔ Codex migration & dual-mode |
| **agents** | YAML config cho 5 agent types (không phải TS) |

---

## Dependency Graph

```
                    ┌──────────┐
                    │   CLI    │  ← entry point
                    └────┬─────┘
           ┌─────────┬───┴───┬──────────┐
           ▼         ▼       ▼          ▼
       ┌───────┐ ┌──────┐ ┌─────┐ ┌──────────┐
       │ hooks │ │swarm │ │neural│ │integration│
       └───┬───┘ └──┬───┘ └──┬──┘ └─────┬─────┘
           │     ┌───┘        │          │
           ▼     ▼            ▼          │
       ┌────────────┐   ┌──────────┐    │
       │   memory    │◄──┤ guidance │    │
       └──────┬──────┘   └──────────┘    │
              │                          │
              ▼                          ▼
       ┌────────────┐           ┌───────────┐
       │ embeddings │           │ providers  │
       └────────────┘           └───────────┘
              │                       │
              ▼                       ▼
       ┌─────────────────────────────────────┐
       │           shared + security          │  ← foundation
       └─────────────────────────────────────┘
```

---

## Gợi ý thứ tự đọc code

1. **shared** → hiểu types, events, DDD interfaces trước
2. **memory** → hiểu data layer (HNSW, backends)
3. **neural** → hiểu learning system (SONA, ReasoningBank)
4. **swarm** → hiểu coordination (topology, consensus)
5. **hooks** → hiểu event lifecycle
6. **cli** → hiểu cách mọi thứ kết nối lại với nhau

Mỗi package đều có `src/index.ts` là điểm vào — đọc file đó trước để biết package export gì, rồi đi sâu vào từng file cụ thể.

---

## Key Architectural Patterns

- **ADR-002**: Domain-Driven Design throughout
- **ADR-003**: Unified SwarmCoordinator
- **ADR-007**: Event sourcing in shared
- **ADR-008**: Vitest over Jest
- **ADR-016**: Claims-based issue management
- **ADR-048**: Auto-memory bridge
- **ADR-053**: Controller registry
