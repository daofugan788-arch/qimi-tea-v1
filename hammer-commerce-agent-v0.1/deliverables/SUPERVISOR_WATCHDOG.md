# Supervisor Watchdog 交付报告

版本：Hammer OS V0.11

## 新增的员工能力

Supervisor 现在会持续巡检在职 Employee，而不只是保存一条心跳。

| 状态 | 判断 |
|---|---|
| `NEED_HELP` | Employee 主动请求 Supervisor 介入 |
| `WAITING_TOO_LONG` | Employee 处于 WAITING 且超过时限 |
| `STUCK` | Mission 正在执行，但进度长时间没有变化 |
| `STALE` | 心跳超过预警时限 |
| `DEAD` | 心跳超过死亡时限 |

## Incident Lifecycle

1. Watchdog 检测到异常。
2. 为 Employee 创建一条 `OPEN` Incident。
3. 同一异常重复心跳只增加观测次数，不重复建单。
4. Incident 写入统一 Memory Service 的 `employee.incidents`。
5. 同时向 Event Bus 发布异常 Event。
6. Employee 恢复后，Incident 自动变为 `RESOLVED`。

## Supervisor API

```js
const report = await hammer.supervisor.inspectWorkforce();

report.totalEmployees;
report.healthyEmployees;
report.incidents;
```

Watchdog 默认自动启动，检查周期可配置：

```js
createHammerOS({
  employeeHealth: {
    watchdogIntervalMs: 30_000,
    stuckAfterMs: 120_000,
    waitingTooLongAfterMs: 300_000,
    staleAfterMs: 90_000,
    deadAfterMs: 180_000,
  },
});
```

## 验收结果

- 识别卡住、等待过久、求助、失联和死亡：通过。
- 同一异常不重复建单：通过。
- 异常记录跨进程保存：通过。
- Employee 恢复后自动关闭异常：通过。
- 不安装 Commerce Plugin 时正常工作：通过。

本版未新增 Commerce 业务、页面、商城、用户系统或交易能力。
