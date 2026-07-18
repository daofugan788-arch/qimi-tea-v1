# Hammer Commerce Agent V0.1

个人使用的移动端 AI 电商智能体。第一阶段完成 Sprint 01 Agent 核心：用户输入一句目标，系统创建任务、拆解步骤、调用工具、汇总执行报告并保存本机历史。

## 当前完成

- 移动端聊天式目标输入
- Task 数据结构：`id`、`goal`、`createdAt`、`status`、`result`
- Task 状态：`WAITING`、`RUNNING`、`SUCCESS`、`FAILED`
- Agent Planner 任务拆解
- Agent Executor 顺序执行、进度更新和失败处理
- Tool Registry 独立工具注册机制
- 执行报告生成
- LocalStorage 任务历史
- PWA manifest、Service Worker、桌面安装入口
- OpenAI 兼容配置结构预留：`BASE_URL`、`API_KEY`、`MODEL`

## Agent 执行链路

```text
用户目标
  → Task Store 创建任务
  → Agent Planner 拆解步骤
  → Agent Executor 调用 Tool Registry
  → Report Tool 汇总结果
  → 本机保存任务历史
```

Sprint 01 默认工具：

- `goal.analyze`：识别平台、类目、利润率目标
- `scope.define`：生成选品筛选条件
- `execution.plan`：输出下一步工作方案
- `report.compose`：生成执行报告

## 运行

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```

测试：

```bash
npm test
```

## 当前边界

本版本只完成 Sprint 01，不接支付、库存、商城或复杂后台。实时商品搜索尚未接入，因此不会虚构货源与市场价格；Sprint 02 将在当前 Agent 架构上增加商品成本、售价、运费、平台费、利润与风险计算工具。
