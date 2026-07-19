# Employee Tool Gateway 交付报告

版本：Hammer OS V0.12

## 目标

让 Employee 可以使用 Browser、OCR、Search、Filesystem、Database、Notification 和 LLM 等统一 Tool，同时保持权限边界和高风险人工确认。

## 新增能力

### 受控 Gateway

- Employee 使用 `this.useTool(name, input)`。
- Employee Context 不暴露原始 Tool Registry。
- 所有执行仍经过统一 Tool Registry 和 Event Bus。
- Tool Context 自动附带 Employee ID、Employee Type 和 Mission ID。

### 默认拒绝权限模型

```js
class ResearchEmployee extends BaseEmployee {
  static allowedTools = ["public.search", "TYPE:BROWSER"];
}
```

- 未声明 Tool 无法执行。
- 支持按精确 Tool Name 或 Tool Type 授权。
- 自定义权限写入 Employee Roster，重启恢复后保留。

### 高风险审批

`HIGH` 风险 Tool 的执行流程：

1. Employee 请求 Tool。
2. Employee 自动进入 `WAITING`。
3. Supervisor 看到待审批请求。
4. Supervisor 执行 `approveTool()` 或 `rejectTool()`。
5. 只有批准后 Tool 才执行。
6. 拒绝、超时或进程重启均不执行 Tool。

### 审计与隐私

- 审批记录保存到 `employee.tool-approvals`。
- 保存 `PENDING / APPROVED / REJECTED / EXPIRED` 状态。
- 密码、Token、API Key、Authorization 和 Cookie 自动替换为 `[REDACTED]`。
- 重启时旧的待审批请求自动过期。

## 验收结果

| 验收项 | 结果 |
|---|---|
| 已授权低风险 Tool 正常执行 | 通过 |
| 未授权 Tool 默认拒绝 | 通过 |
| 高风险 Tool 未批准不执行 | 通过 |
| Supervisor 可批准和拒绝 | 通过 |
| 敏感字段脱敏 | 通过 |
| Tool 权限跨进程恢复 | 通过 |
| 旧审批请求重启后过期 | 通过 |
| 不安装 Commerce Plugin 仍可运行 | 通过 |

本版未开发 Commerce 业务、页面、商城、登录、发布、下单或付款。
