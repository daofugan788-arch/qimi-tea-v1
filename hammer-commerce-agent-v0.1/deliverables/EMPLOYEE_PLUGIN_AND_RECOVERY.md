# Employee Plugin & Recovery 交付报告

版本：Hammer OS V0.10

## 新增能力

### Employee Plugin

- Plugin Contract 新增 `employees` 声明。
- Plugin Manager 把 Employee 类型注册到 Supervisor。
- Plugin 的 `onInstall` 可以获得 Supervisor、Employee Runtime、Employee Message Bus 和 Knowledge Center。
- Supervisor 支持 `hireByType(type)`，业务插件无需修改 Core。
- 相同类型被不同类重复注册时会拒绝，避免员工身份冲突。

### Employee Roster

Supervisor 统一持久化：

- Employee ID
- Employee Type
- 来源 Plugin
- 是否在职
- 当前状态与进度
- Lifecycle 快照
- 招聘、恢复、回收时间

### Restart Recovery

Hammer 重启后执行 `supervisor.recover()`：

1. 读取在职员工花名册。
2. 检查对应 Employee Plugin 是否已经安装。
3. 恢复独立 Workspace 和 Lifecycle。
4. 保留私人经验、知识引用、History、Queue 和 Decision。
5. 将崩溃前未完成的 Mission 放回 Queue。
6. Employee 自动继续 Mission。

退休员工不会被恢复；缺少 Plugin 时报告 `MISSING_EMPLOYEE_PLUGIN`。

## 真实架构验证

- Research / Finance 由同一个 Employee Plugin 注册。
- Supervisor 按 `research` / `finance` 类型招聘。
- Research 通过 Message 请求 Finance 复核，不持有 Finance 实例。
- 模拟进程中断后，新 Hammer OS 实例恢复 Employee 私人经验。
- 中断前 Mission `mission-before-restart` 自动回到 Queue 并完成。
- Commerce Plugin 未安装，Hammer OS 正常运行。

## 验收结果

| 指标 | 结果 |
|---|---|
| 新员工只需继承 BaseEmployee | 通过 |
| Employee 由 Plugin 安装 | 通过 |
| 不修改 Core 即可招聘新类型 | 通过 |
| 重启后恢复 Workspace | 通过 |
| 重启后继续未完成 Mission | 通过 |
| 缺少 Commerce 仍正常运行 | 通过 |

本 Sprint 没有新增 Commerce 业务、页面、商城、用户系统或交易能力。
