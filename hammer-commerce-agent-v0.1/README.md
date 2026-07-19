# Hammer OS V0.12 — Employee Tool Gateway

当前版本已停止扩展 Commerce 业务，进入 Architecture Sprint 2。Hammer 的产品目标从单个 Agent 升级为 AI Company：Supervisor 管理多个独立 Employee，Employee 通过 Message 协作并共享 Knowledge。

V0.12 让 Employee 可以真正调用 Hammer OS 工具，但不暴露原始 Tool Registry。每个 Employee 只能使用明确授权的 Tool；高风险操作会自动暂停等待 Supervisor 批准。V0.10 的重启恢复与 V0.11 的 Watchdog 能力继续保留。

## 本版交付

- `BaseEmployee`：未来 Commerce、Research、Finance、Sales、Marketing Employee 的统一基类。
- `Employee Lifecycle`：`CREATED → IDLE → WORKING → WAITING → SLEEPING → RESUME → FINISHED`。
- `Employee Workspace`：每个员工独立拥有 Mission、Memory、Knowledge、History、Queue、Decision。
- `Supervisor`：招聘、分配 Mission、查看状态、暂停、恢复、回收。
- `Employee Message Bus`：员工之间不直接调用，统一请求、响应和信箱。
- `30 秒 Heartbeat`：上报当前 Mission、Progress、Waiting、Need Help。
- `Knowledge Center`：共享 rules、market、platform、experience。
- `Employee Plugin`：Plugin 通过 `employees: [ResearchEmployee]` 注册员工类型，Supervisor 按类型招聘。
- `Employee Recovery`：持久化员工花名册与状态，进程重启后恢复 Workspace，并把中断 Mission 放回 Queue 继续执行。
- `Supervisor Watchdog`：按心跳和进度时间识别 `STUCK / WAITING_TOO_LONG / NEED_HELP / STALE / DEAD`。
- `Incident Memory`：同一异常只创建一条事件，恢复后自动标记 `RESOLVED`，保留可复盘记录。
- `Employee Tool Gateway`：Employee 通过 `useTool()` 使用统一 Tool Registry，不持有 Registry 实例。
- `Tool Allowlist`：默认拒绝全部 Tool，Employee 需通过 `allowedTools` 明确声明权限。
- `High-risk Approval`：`HIGH` 风险 Tool 统一由 Supervisor 批准或拒绝，审批历史进入 Memory。

详细架构见 [`hammer-os/ARCHITECTURE.md`](hammer-os/ARCHITECTURE.md)。

## 最小新增员工

```js
import { BaseEmployee, createHammerOS } from "./hammer-os/index.js";

class ResearchEmployee extends BaseEmployee {
  static employeeType = "research";

  async execute(mission) {
    this.reportProgress(100, "done");
    return { missionId: mission.id };
  }
}

const hammer = createHammerOS();
const employee = await hammer.supervisor.hire(ResearchEmployee);
await hammer.supervisor.assign(employee.id, { goal: "研究公开市场" });
```

新增 ResearchEmployee 不修改 Hammer Core。

插件安装方式：

```js
const researchPlugin = definePlugin({
  manifest: { id: "research-employee", version: "1.0.0" },
  employees: [ResearchEmployee],
});

const hammer = createHammerOS({ plugins: [researchPlugin] });
const employee = await hammer.supervisor.hireByType("research");
```

进程重启后：

```js
const hammer = createHammerOS({ memoryAdapter, plugins: [researchPlugin] });
await hammer.supervisor.recover();
```

Employee 使用 Tool：

```js
class ResearchEmployee extends BaseEmployee {
  static employeeType = "research";
  static allowedTools = ["public.search"];

  async execute(mission) {
    return this.useTool("public.search", { keyword: mission.goal });
  }
}
```

Employee Context 只能看到受控 `tools` Gateway，不能访问原始 `toolRegistry`。

## 架构验收

```bash
npm install
npm run test:employee
npm run employee:framework:validate
npm test
npm run build
```

验收目标：

1. 不安装 Commerce Plugin，Hammer OS 仍正常启动。
2. Research 与 Finance Employee 无需修改 Core 即可并行运行。
3. Employee 支持暂停、Checkpoint、RESUME、继续和回收。
4. Employee 只通过 Message 协作。
5. Supervisor 能通过心跳识别卡住、等待过久、求助、失联和死亡。
6. Plugin 注册 Employee 不修改 Plugin Manager 业务逻辑。
7. 重启后恢复员工私人经验和未完成 Mission。
8. Watchdog 异常去重、持久化，员工恢复后自动关闭。
9. 未授权 Tool 默认拒绝，高风险 Tool 必须人工批准。
10. Tool 权限跨进程恢复，旧审批请求不会在重启后误执行。

交付报告见 [`deliverables/ARCHITECTURE_SPRINT_2_EMPLOYEE_FRAMEWORK.md`](deliverables/ARCHITECTURE_SPRINT_2_EMPLOYEE_FRAMEWORK.md)。

V0.10 报告见 [`deliverables/EMPLOYEE_PLUGIN_AND_RECOVERY.md`](deliverables/EMPLOYEE_PLUGIN_AND_RECOVERY.md)。

V0.11 报告见 [`deliverables/SUPERVISOR_WATCHDOG.md`](deliverables/SUPERVISOR_WATCHDOG.md)。

V0.12 报告见 [`deliverables/EMPLOYEE_TOOL_GATEWAY.md`](deliverables/EMPLOYEE_TOOL_GATEWAY.md)。

## 兼容层

原 Commerce Employee Alpha V0.8 代码和真实运行记录保留为第一个业务 Plugin，但自动班次已经冻结，只能人工触发。本 Sprint 未新增选品、评分、页面、商城、用户系统或交易功能。旧 Agent Runtime 暂时保留，后续业务员工迁移到 Employee Framework 后再安全下线。
