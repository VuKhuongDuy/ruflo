# Task: Auto-Learn — Tự động trigger SONA learning qua MCP

> **Status**: Open
> **Priority**: High
> **Created**: 2026-04-07

---

## Vấn đề

Doc tuyên bố "SONA tự học từ mỗi task, không cần gọi thủ công" nhưng thực tế:

- MCP server emit event `tool:completed` sau khi tool chạy xong
- **Không có listener** nào bắt event đó để trigger `post-task` hook
- Pipeline 4 bước (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE) chỉ chạy khi gọi thủ công:
  ```bash
  npx @claude-flow/cli@latest hooks post-task --task-id "xxx" --success true
  ```

### Flow hiện tại (broken)

```
User prompt → Claude Code → MCP tool execute → Result trả về
                                              ❌ Không trigger hooks
                                              ❌ Không ghi trajectory
                                              ❌ Không học gì cả
```

### Flow mong muốn

```
User prompt → Claude Code → MCP tool execute → Result trả về
                                              ✅ Auto trigger post-task hook
                                              ✅ Ghi trajectory vào ReasoningBank
                                              ✅ JUDGE → DISTILL → CONSOLIDATE chạy tự động
```

---

## Giải pháp đề xuất

Thêm bridge trong MCP server — sau khi tool hoàn thành, tự gọi `PostTask` hook:

### Vị trí cần sửa

1. **`v3/@claude-flow/mcp/src/server.ts`** — Thêm auto-trigger sau `toolRegistry.execute()`
2. **`v3/@claude-flow/hooks/src/executor/index.ts`** — Đảm bảo executor có thể được gọi programmatically

### Code sketch

```typescript
// Trong MCPServer.handleToolsCall(), sau khi tool execute xong:
const result = await this.toolRegistry.execute(toolName, params);

// AUTO-LEARN: trigger post-task hook nếu neural enabled
if (this.config.neural?.enabled !== false) {
  try {
    await this.hookExecutor.run('PostTask', {
      taskId: toolCall.id,
      taskDescription: toolName,
      success: !result.isError,
      agent: params._agentType || 'unknown',
      quality: result.quality || 0.85
    });
  } catch (e) {
    // Learning failure không nên block tool response
    logger.warn('Auto-learn hook failed:', e.message);
  }
}

return result;
```

### Lưu ý thiết kế

- Learning failure **không được block** tool response — wrap trong try/catch
- Nên có config flag `neural.autoLearn: true/false` để user tắt được
- Cân nhắc debounce/batch nếu nhiều tool calls liên tiếp
- Cần filter: không phải mọi tool call đều đáng học (vd: `memory list` thì không cần)

---

## Acceptance Criteria

- [ ] Khi dùng ruflo MCP server ở project khác, mỗi task hoàn thành tự động trigger learning pipeline
- [ ] Trajectory được ghi vào ReasoningBank sau mỗi task
- [ ] Có config flag `neural.autoLearn` để bật/tắt (default: true)
- [ ] Learning failure không block tool response
- [ ] Filter: chỉ learn từ task-level tools, không learn từ query/read tools
- [ ] Test: verify trajectory count tăng sau khi chạy task qua MCP

---

## Files liên quan

- `v3/@claude-flow/mcp/src/server.ts` — MCP server entry point
- `v3/@claude-flow/hooks/src/executor/index.ts` — Hook executor
- `v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` — post-task hook implementation (line 1256-1399)
- `v3/@claude-flow/cli/src/memory/intelligence.ts` — Intelligence/trajectory recording
- `v3/@claude-flow/memory/src/auto-memory-bridge.ts` — Auto-memory bridge (có `recordInsight()`)
- `docs/architecture/05-neural-sona.md` — Doc đã sửa ghi chú về limitation
