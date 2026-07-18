# Hammer Commerce Agent V0.4

个人使用、移动端优先的 AI 电商智能体。V0.4 按 CEO 新路线加入 Task Chain：用户只输入一个目标，Agent 连续执行多个工具，在需要真实外部结果或主人授权时保存进度并安全等待，条件满足后从断点继续。

## V0.4 已完成

- “自动任务”成为手机端默认入口
- 一句话创建连续任务链，例如“帮我今天卖一个商品”或“帮我今天赚100块”
- `ChainPlanner` 生成 8 个连续步骤
- `ChainExecutor` 自动推进、持久化、失败候选重试和断点恢复
- 从本机商品库寻找候选；利润不合格时自动放弃并继续寻找
- 自动生成个人卖家风格标题、描述、客服回复和图片准备清单
- 发布前安全等待主人确认，不伪装已经操作外部平台
- 发布后进入成交等待状态，刷新页面仍可继续
- 成交后记录销售收入和真实利润
- 自动生成当日给主人汇报，并判断利润目标是否达成
- Task Chain、步骤输出、失败尝试和成交记录均保存在当前浏览器
- 保留 V0.1–V0.3 的目标任务、商品分析和选品对比能力
- PWA 安装与离线缓存基础

## Task Chain

```text
用户目标
  → 寻找候选商品
  → 检查利润是否可卖
      └─ 不合格：自动换下一个候选
  → 生成商品资料
  → 准备图片任务
  → 准备发布
      └─ 等待主人确认 / 后续 Browser Agent
  → 等待成交结果
  → 记录真实利润
  → 生成今日汇报
```

任务链状态：

```text
WAITING → RUNNING → BLOCKED → RUNNING → SUCCESS
                         └────────────→ FAILED
```

`BLOCKED` 不是执行失败，而是 Agent 已完成当前可自动完成的工作，正在等待必要条件：

- `NEED_PRODUCTS`：商品库暂无候选
- `NO_VIABLE_PRODUCTS`：现有候选全部未达标
- `CONFIRM_PUBLISH`：发布资料已准备，等待授权范围内的真实发布结果
- `WAIT_SALE_RESULT`：等待真实成交或未成交结果

## 核心模块

```text
src/core/chain-planner.js     Task Chain 规划
src/core/chain-executor.js    自动推进、重试与恢复
src/core/chain-store.js       任务链持久化
src/core/sales-store.js       成交与利润记录
src/tools/chain-tools.js      任务链工具集合
```

所有能力通过 Tool Registry 注册，后续可独立增加 Browser、OCR、图片识别、价格识别、物流、通知、文件、Excel 和长期记忆工具。

## 运行与测试

```bash
npm install
npm run dev
npm test
npm run build
```

## 当前真实边界

V0.4 已实现任务链核心，但 Browser Agent 尚未接入，因此不能自动登录、搜索或发布到真实电商平台。需要外部平台操作时，任务链会明确暂停并等待主人确认，不会虚构搜索、发布或成交结果。

当前不包含自动下单、支付、库存系统或大型后台。下一阶段直接开发授权范围内的 Browser Agent，不继续扩建评分、图表和统计页面。
