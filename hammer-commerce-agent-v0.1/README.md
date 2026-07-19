# Hammer OS

**Agent Operating System · Architecture Freeze No.001**

Hammer 不再是 Commerce App。系统内核固定为 Orchestrator、Runtime、Agent、Tool、Plugin 五层，Commerce 是第一个 Plugin。

本阶段冻结所有新页面、新业务功能、新评分模型、新选品策略和新发布流程。完整架构图、目录、事件流与边界规则见 [`hammer-os/ARCHITECTURE.md`](hammer-os/ARCHITECTURE.md)。

## Architecture Freeze No.001 已交付

- Orchestrator：Mission 创建、Planner 调度、优先级与生命周期入口
- Runtime：Mission、Task、Worker、Retry、Schedule、Queue、Checkpoint、Cancel
- EventBus：Agent 禁止互相调用，事件统一送达 Decision、Memory、Logger 和 Mission 投影
- Memory Service：Agent 与 Runtime Checkpoint 使用统一读写服务
- Decision Service：通用 Policy 内核，不包含 Commerce 判断
- BaseAgent：统一生命周期、Event、Memory、Decision 和 Tool Registry 接口
- Tool Registry：统一 Browser、OCR、Search、Excel、Filesystem、Database、Notification、LLM 类型
- Plugin Manager：统一注册 Agent、Tool、Planner、Decision Policy 和 Event Subscription
- Commerce Plugin：现有 Commerce 通过唯一兼容桥接入，不再作为系统本身
- Architecture Test：验证新增 `FinanceAgent extends BaseAgent` 无需修改 Runtime

## 最高开发原则

> 每新增一个功能，都必须减少用户至少一次操作。

每个 Sprint 必须提交改造前操作数、改造后操作数和实际减少数。不能减少人工操作的页面、图表、评分或装饰性功能暂不开发。

## Sprint 05：Browser Agent Real Execution

已完成真实浏览执行：

- `BrowserSearchPlanner`：从一句目标提取关键词、最高采购价和最低预计利润
- `Browser Service`：创建 `WAITING → RUNNING → SUCCESS/FAILED` 浏览任务并支持查询
- Playwright + Chromium 真正打开服务端白名单公开商品页面
- 读取公开商品名称、价格、图片、来源链接，以及页面公开的销量、评价数量和评分字段
- `EvidenceFileStore`：保存整页截图、逐商品价格截图和完整 JSON 执行证据
- `ProductSource`：保存来源平台、URL、抓取时间、截图、价格和标题
- `EvidenceStore`：手机端保存证据索引、来源和采集时间
- 自动把公开页面候选写入商品库并继续利润筛选
- 自动生成《今日选品报告》
- 报告包含来源价、市场参考、预计利润、推荐、原因和公开来源
- 浏览服务未连接、需要登录、出现验证或没有结果时安全暂停，不生成假数据
- 不支持自动登录、发布、下单或付款

自动流程：

```text
用户输入一句找货目标
  → Search Planner 自动拆解
  → Playwright 打开服务端白名单公开页面
  → 搜索并读取公开商品信息
  → 保存来源、时间、图片和价格截图
  → 筛选价格与预计利润
  → 保存候选商品
  → 生成《今日选品报告》
  → 原任务链继续推进
```

验收标准：

```text
以前：搜索 → 看价格 → 比较 → 算利润 → 写记录
现在：输入一句话 → 等待报告
人工操作：5 步 → 1 步，减少 4 步
```

## Browser Tool 运行方式

前端仍是移动端 PWA。真实浏览器运行在独立的轻量 Node.js 服务中，避免手机浏览器的跨域限制。

```bash
npm install
npm run browser:serve
```

前端构建时配置：

```text
VITE_BROWSER_AGENT_URL=https://你的-browser-agent-地址
```

容器部署：

```bash
docker build -f Dockerfile.browser-agent -t hammer-browser-agent .
docker run -p 8787:8787 --env-file .env.browser hammer-browser-agent
```

`BROWSER_SOURCE_CONFIG_JSON` 只在服务端配置允许访问的公开来源与页面选择器。客户端不能提交任意 URL，基础版不会绕过登录、验证码或平台安全机制。

默认的 Webscraper 测试商城仅用于验证 Browser Tool 链路，并在报告中明确标记为测试源。接入真实商业平台前，应确认平台公开访问规则并建立专用白名单适配器。

## V1.0 其他已完成能力

- 连续 Task Chain、失败候选自动重试和断点恢复
- 一句话商品资料解析、分析、保存并自动恢复任务链
- 商品内容与图片任务准备
- 发布确认、成交等待、利润记录和主人日报
- PWA 手机端安装与本机持久化

## 核心模块

```text
src/core/browser-search-planner.js     Search Planner
src/core/browser-agent-client.js       手机端 Browser Gateway 客户端
src/core/evidence-store.js             手机端证据索引
src/core/product-judgment-engine.js     商品证据判断引擎
src/tools/browser-tools.js             Browser/Evidence/Report Tools
server/public-browser-runner.js        Playwright 公开页面执行器
server/browser-agent-server.js         Browser Agent HTTP 服务
server/browser-task-store.js           浏览任务状态
server/chromium-runtime.js              可部署 Chromium 运行时
server/evidence-file-store.js          截图与 JSON 证据保存
Dockerfile.browser-agent               浏览服务容器
```

## 验证

```bash
npm test
npm run build
```

真实执行验收已通过：Browser Service 打开 Webscraper 公开测试商城，自动抓取 3 个商品，保存 1 张整页截图、3 张商品截图和 JSON 会话证据，并由前端 Task Chain 生成《今日选品报告》。该来源只用于验证真实浏览闭环；接入商业平台时仍需先确认公开访问规则并配置平台白名单适配器。

## Sprint 06：商品判断 Agent

Browser Agent 找到商品后，新增 `browser.product.judge` 自动判断步骤，不再让用户逐个查看和选择：

- `TEST`：利润、利润率、来源证据和公开需求信号达到门槛，自动进入商品资料生成
- `WATCH`：存在利润空间，但销量、评价或成交价证据不足，继续找同类来源补证据
- `REJECT`：无正利润、利润缓冲过低或公开评分风险明显，停止生成资料并尝试下一个商品
- 判断结果写回商品库，保存理由、风险、置信度、门槛结果和下一步动作
- 不增加新页面，判断结果直接合并进《今日选品报告》
- 自动发布仍保持人工确认，不进行登录、发布、下单或付款

验收结果：真实公开商品抓取后，Agent 自动选择 `Nokia 123` 为 `TEST`，继续生成商品资料并停在安全发布确认点。人工流程由“搜索、打开、记录、算利润、判断、写报告”6步减少为“一句话等待报告”1步。
