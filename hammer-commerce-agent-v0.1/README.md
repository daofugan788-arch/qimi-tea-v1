# Hammer Commerce Employee Alpha V0.8

第一个可长期工作的 Commerce 数字员工，运行在现有 Hammer OS 上。主人不操作时，它也会按时搜索公开商品、核验商品页、保存机会、学习成交反馈并生成日报。

## 已完成闭环

```text
一句话目标
  → Orchestrator 创建 Mission
  → Product Search Agent 读取白名单公开商品目录
  → Browser Agent 真实打开候选商品页并保存截图
  → Data Tool 写入 Opportunity Database
  → Profit 分析采购价 + 运费 + 平台成本 + 其他成本
  → Decision Service 输出 TEST / WATCH / REJECT 与原因
  → Content Agent 生成标题、描述、卖点、图片建议和客服话术
  → Memory Service 保存机会、日报与成交经验
  → 08:00 找10个机会，20:00 输出《今日商业机会报告》
```

Commerce 仍是 Plugin；Browser 通过独立 Browser Plugin 接入，Commerce Agent 不包含浏览器代码。Runtime、Agent、Memory、Tool Registry 和 Decision Service 没有被业务代码替代。V0.8 不执行登录、发布、付款或交易。

人工流程按“搜索、打开、记录、比较、算完整成本、判断、排序、写标题、写描述、写日报”10步计，一句话入口变为1步，减少9步（90%）；每日自动任务为0步。

## 手机一句话入口

```bash
npm install
npm run employee:serve
```

手机浏览器打开 `http://服务器地址:8788`。页面只有一个目标输入框；完成后显示商品列表、利润、推荐排序、可复制资料和日报。

API：

```text
POST /api/missions          创建并执行一句话 Mission
POST /api/feedback          回填成交单数和实际利润
GET  /api/reports/latest    获取最新报告
GET  /health                查看员工心跳
```

公网部署可设置 `HAMMER_ACCESS_TOKEN`；带口令访问页面时使用 `/?token=你的口令`。

## 命令行与每日员工

立即执行一句话：

```bash
npm run employee:ask -- "帮我找赚钱商品"
npm run employee:ask -- "找成本30元以内，利润20元以上的小商品"
```

作为常驻员工运行：

```bash
npm run employee:run
```

进程每分钟写心跳，在 `Asia/Shanghai` 每日 08:00 幂等创建找货 Mission，并在 20:00 汇总当日报告；08:00 后启动会自动补跑当天任务。机会库、Checkpoint、学习反馈和日报持久化到 `data/hammer-memory.json`。

记录真实结果，供下一次决策调整同类商品权重：

```bash
node server/commerce-employee-worker.js --feedback "手机支架" 3 60
```

## 真实公开数据与证据

默认只读取 Kikkerland、ColourPop、BlendJet 三个公开商品目录，再由 Browser Agent 打开白名单内候选商品页并截图。不会绕过登录、验证码或安全机制，也不会用生成数据冒充商品。

可用服务端变量替换允许来源：

```text
COMMERCE_SHOPIFY_SOURCES_JSON=[{"name":"供应源A","baseUrl":"https://example.com","currency":"CNY"}]
```

公开目录当前价视为采购参考价，`compare_at_price` 视为市场参考价。报告计入默认运费和平台费，但只是测试机会，不是利润保证；发布前仍需核对真实采购、库存、运费和平台规则。

## 主要配置

```text
COMMERCE_SHIPPING_COST=5
COMMERCE_PLATFORM_RATE=0.05
COMMERCE_OTHER_COST=0
COMMERCE_DAILY_TIMEZONE=Asia/Shanghai
COMMERCE_DAILY_HOUR=8
COMMERCE_EVENING_HOUR=20
HAMMER_ACCESS_TOKEN=
BASE_URL=
API_KEY=
MODEL=
```

配置 OpenAI 兼容的 `BASE_URL / API_KEY / MODEL` 后，Content Tool 使用模型生成资料；未配置或接口失败时使用安全模板并标记 `SAFE_TEMPLATE`，不会编造库存、销量或发货承诺。

## 验证

```bash
npm test
npm run build
npm run employee:alpha
```

- 自动测试：33/33 通过
- 真实首班：扫描60个商品，Browser 打开并截图11/12个候选，生成1个 TEST 和2个 WATCH 的 TOP3
- Alpha 启动报告：[`deliverables/V0.8_ALPHA_START.md`](deliverables/V0.8_ALPHA_START.md)
- Hammer OS 架构说明：[`hammer-os/ARCHITECTURE.md`](hammer-os/ARCHITECTURE.md)

## 长期运行部署

仓库根目录的 `.github/workflows/hammer-commerce-alpha.yml` 提供：

- 每小时一次持久化心跳；超过2.5小时没有心跳会重置“连续在线”计时。
- 北京时间 08:00 后执行真实 Browser Mission，保存机会库、截图和日报。
- 北京时间 20:00 汇总当天机会与反馈，生成 TOP3 商业报告。
- 每次运行保存14天审计产物，并更新公开只读状态页。
- 只有真实达到24小时、真实跨过7天且存在7份日报后，状态才会自动变成验收通过。

当前版本不开发漂亮 App、商城、后台或用户系统，也不登录、发布、下单、付款。商品页无法访问时会记录失败原因，不会把公开目录数据伪装成 Browser 已核验。
