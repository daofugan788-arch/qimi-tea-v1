# Hammer Commerce Agent MVP V0.7

个人赚钱测试版，运行在现有 Hammer OS 上。目标是让用户只输入一句话，系统自动完成公开商品收集、完整成本计算、TEST/WATCH/REJECT 决策、商品资料生成和今日报告。

## 已完成闭环

```text
一句话目标
  → Orchestrator 创建 Mission
  → Product Search Agent 读取白名单公开商品目录
  → Data Tool 统一商品、价格、图片和来源链接
  → Profit 分析采购价 + 运费 + 平台成本 + 其他成本
  → Decision Service 输出 TEST / WATCH / REJECT 与原因
  → Content Agent 生成标题、描述、卖点、图片建议和客服话术
  → Memory Service 保存 Opportunity Database、报告与学习结果
  → 输出《今日商业机会报告》
```

Commerce 仍是 Plugin；Runtime、Agent、Memory、Tool Registry 和 Decision Service 没有被业务代码替代。V0.7 不执行登录、发布、付款或交易。

人工流程按“搜索、打开、记录、比较、算完整成本、判断、排序、写标题、写描述、写日报”10步计，一句话入口变为1步，减少9步（90%）；每日08:00自动任务为0步。

## 手机一句话入口

```bash
npm install
npm run employee:serve
```

手机浏览器打开：

```text
http://服务器地址:8788
```

页面只有一个目标输入框。完成后显示商品列表、成本/利润、推荐排序、可复制发布资料和今日报告。

API：

```text
POST /api/missions          创建并执行一句话 Mission
GET  /api/reports/latest    获取最新报告
GET  /health               查看员工心跳
```

公网部署可设置 `HAMMER_ACCESS_TOKEN`；带口令访问页面时使用 `/?token=你的口令`。

## 命令行与每日员工

立即执行一句话：

```bash
npm run employee:ask -- "帮我找赚钱商品"
npm run employee:ask -- "找成本30元以内，利润20元以上的小商品"
```

作为长期员工运行：

```bash
npm run employee:run
```

进程每分钟写心跳，并在 `Asia/Shanghai` 每日 08:00 幂等创建 Mission；08:00 后启动会自动补跑当天任务。机会库、Checkpoint、学习反馈和日报持久化到 `data/hammer-memory.json`。

记录真实结果，供下一次决策调整权重：

```bash
node server/commerce-employee-worker.js --record-outcome "手机支架" SOLD 22
```

## 真实公开数据源

默认每天只读取三个公开商品目录：Kikkerland、ColourPop、BlendJet。不会绕过登录、验证码或安全机制，也不会用生成数据冒充商品。

可用服务端变量替换成自己的允许来源：

```text
COMMERCE_SHOPIFY_SOURCES_JSON=[{"name":"供应源A","baseUrl":"https://example.com","currency":"CNY"}]
```

公开目录中的当前价被视为采购参考价，`compare_at_price` 被视为市场参考价。报告会计入默认运费和平台费，但它只是测试机会，不是利润保证；发布前仍需核对真实采购、库存、运费和平台规则。

## 主要配置

复制 `.env.commerce.example` 后按部署环境设置：

```text
COMMERCE_SHIPPING_COST=5
COMMERCE_PLATFORM_RATE=0.05
COMMERCE_OTHER_COST=0
COMMERCE_DAILY_TIMEZONE=Asia/Shanghai
COMMERCE_DAILY_HOUR=8
HAMMER_ACCESS_TOKEN=
BASE_URL=
API_KEY=
MODEL=
```

配置 OpenAI 兼容的 `BASE_URL / API_KEY / MODEL` 后，Content Tool 使用模型生成资料；未配置或接口失败时使用安全模板，并明确标记 `SAFE_TEMPLATE`，不会编造库存、销量或发货承诺。

## 验证

```bash
npm test
npm run build
npm run employee:ask -- "帮我找赚钱商品"
```

- 自动测试：31/31 通过
- 手机入口：HTTP 200
- 真实 API Mission：已返回商品列表、利润分析、决策、发布资料和日报
- 真实执行报告：[`deliverables/V0.7_REAL_REPORT.md`](deliverables/V0.7_REAL_REPORT.md)
- Hammer OS 架构说明：[`hammer-os/ARCHITECTURE.md`](hammer-os/ARCHITECTURE.md)

## V0.8 边界

V0.8 再增强 Browser Agent，增加更多公开网页适配与截图证据。V0.7 不继续消耗时间优化浏览器底层，也不开发自动登录、自动发布、自动付款、自动交易或复杂 UI。
