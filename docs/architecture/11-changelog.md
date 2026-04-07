# 11. Changelog: Cải Tiến Từ 01/03/2026 → 07/04/2026

> **119 commits** | v3.5.3 → v3.5.72 | 36 ngày phát triển

---

## Mô Tả

Tài liệu này ghi lại tất cả cải tiến đáng kể của Ruflo trong 36 ngày từ 01/03/2026 đến 07/04/2026. Trong giai đoạn này, Ruflo đã trải qua 3 nỗ lực chính:
1. **Tính năng mới**: BM25, DiskANN, File Watcher, Memory Bridge, Self-Learning Pipeline
2. **Honesty Audit**: Loại bỏ toàn bộ fake/simulated data (~20 commits)
3. **Ổn định hóa**: ~30 bug fixes P0-P2, security, cross-platform

## Tính Năng Mới

| Tính năng | ADR | Phiên bản | Mô tả |
|-----------|-----|-----------|-------|
| **BM25 Hybrid Search** | — | v3.5.72 | Kết hợp keyword search (BM25) với semantic search (HNSW) |
| **File Watcher** | — | v3.5.72 | Theo dõi thay đổi file system, tự động index nội dung |
| **Logger Module** | — | v3.5.72 | Structured logging cho memory package |
| **DiskANN Backend** | ADR-077 | v3.5.70 | Vector search cho dataset lớn, lưu trên SSD thay vì RAM |
| **Memory Bridge Phase 2** | ADR-076 | v3.5.68 | MCP tools: import, bridge status, unified search |
| **Claude ↔ AgentDB Bridge** | ADR-076 | v3.5.67 | Đồng bộ Claude Code auto-memory sang AgentDB với ONNX embeddings |
| **Self-Learning Pipeline** | ADR-075 | v3.5.65 | Wire end-to-end: hooks → SONA → ReasoningBank → AgentDB |
| **Autopilot Completion** | ADR-072 | v3.5.44 | Persistent task completion system |
| **RuVector WASM** | — | v3.5.40 | Real semantic embeddings qua WASM, không cần API call |
| **Guidance MCP Tools** | — | v3.5.39 | Capability discovery và navigation tools |
| **22 Real CLI Commands** | — | v3.5.38 | Thay thế 22 stub commands bằng real implementations |
| **RuFlo Chat UI** | — | v3.5.3 | Chat UI với ruvocal fork, MCP bridge, Docker setup |

## Chiến Dịch "Honesty Audit" (~20 commits)

Effort lớn nhất trong giai đoạn này — loại bỏ toàn bộ fake/simulated data:

| Vấn đề | Giải pháp | Versions |
|--------|----------|----------|
| Fabricated metrics trong README | Xóa hoặc thay bằng real data | v3.5.53-59 |
| Hardcoded benchmark results | Populate từ hook activity thực tế | v3.5.55-56 |
| Simulated scores (random) | Thay bằng real metric sources | v3.5.53-55 |
| Fake heuristics trong statusline | Real data sources (AgentDB stats) | v3.5.60 |
| Auto-completion/fake delays | Xóa hoàn toàn | v3.5.57 |
| Intelligence store duplicates | Dedup + persist deduped state | v3.5.54 |

## Bug Fixes Nghiêm Trọng (P0/P1)

| Bug | Phiên bản | Mô tả |
|-----|-----------|-------|
| Daemon startup crash | v3.5.49 | ESM controller-registry, memory-bridge init |
| ReasoningBank + SQLite path | v3.5.50 | 4 critical: namespace, init hooks |
| Terminal execute | v3.5.51 | Agent results, security scan, global CLAUDE.md |
| 5 critical bugs | v3.5.52 | cwd, intelligence hang, memory init, ruvector |
| MCP server self-kill | v3.5.38 | Prevent self-kill on startup (#1381) |
| Stale PID false positives | v3.5.39 | MCP server startup detection |
| CPU maxCpuLoad | v3.5.23 | CPU-proportional thay hardcoded 2.0 (#1369) |
| AIDefence regex | v3.5.59 | API key regex quá strict |
| Intelligence dedup | v3.5.54 | Duplicate entries trong intelligence store |
| Hive-mind status | v3.5.42 | Real agent state thay hardcoded values (#1385) |

## Security

| Cải tiến | ADR/Issue | Mô tả |
|---------|-----------|-------|
| ADR-061 Security Fixes | ADR-061 | Cross-platform hooks, Windows parity |
| Security Audit Response | #1375 | Address findings từ security audit |
| Path Resolution | v3.5.15 | `$CLAUDE_PROJECT_DIR` cho hooks path (chống traversal) |
| AIDefence Fix | v3.5.59 | API key regex + facade tests |
| v3.5.45-48 Security | — | P1 fixes, WASM CLI security |

## Platform & Compatibility

| Cải tiến | Mô tả |
|---------|-------|
| **Windows Parity** | Settings, hooks, cross-platform support đầy đủ |
| **ESM/CJS Interop** | Nhiều fix cho `'default'` module check, export paths |
| **Branding** | Claude Flow → **Ruflo** rename across toàn bộ codebase |
| **Statusline** | Branding RuFlo V3.5, Opus 4.6 (1M context) |
| **Agent YAML** | Standardize frontmatter to Claude Code spec |
| **Plugin Manager** | Fix priority + version checks |
| **Hooks Package** | Fix type export paths |

## So Sánh Architecture: Trước vs Sau

| Thành phần | Trước (v3.5.3) | Sau (v3.5.72) |
|-----------|----------------|---------------|
| MCP tools | 215 | 259+ |
| Search engines | HNSW only | HNSW + BM25 + DiskANN |
| AgentDB controllers | 8 | 19 |
| File indexing | Không có | File Watcher tự động |
| Memory bridge | Không có | Claude Code ↔ AgentDB bridge |
| Self-learning | Chưa wired | End-to-end pipeline (ADR-075) |
| Embeddings | API/ONNX | + RuVector WASM (real semantic, offline) |
| CLI commands | 22 stubs | 22 real implementations |
| Metrics | Một số fabricated | 100% real data sources |
| Platform | Linux/Mac | + Windows parity |

---

## Tình Trạng Hiện Tại (v3.5.72)

Tất cả cải tiến trên đều **stable** và đã được merge vào main. Version hiện tại: **v3.5.72** (07/04/2026).

Branch hiện tại (`feat/file-watcher`) đang phát triển thêm:
- File Watcher cho indexing file contents
- Logger module cho memory package
- BM25 hybrid search

---

## Cách Theo Dõi Changelog

```bash
# Xem commits gần nhất
git log --oneline -20

# Xem commits từ một ngày
git log --oneline --since="2026-03-01"

# Xem changes giữa 2 versions
git log --oneline v3.5.3..v3.5.72
```
