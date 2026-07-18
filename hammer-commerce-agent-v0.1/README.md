# Hammer Commerce Agent V1.0

**Autonomous Commerce Agent（自主商业 Agent）**。

目标是让用户尽量只说一句目标，由 Agent 连续完成商业任务，只在登录、发布、下单、支付等必要的安全与合规节点请求确认。

## 最高开发原则

> 每新增一个功能，都必须减少用户至少一次操作。

每个 Sprint 必须提交改造前操作数、改造后操作数和实际减少数。不能减少人工操作的页面、图表、评分或装饰性功能暂不开发。

## Sprint 04：Browser Agent V0.1

已完成基础版代码：

- `BrowserSearchPlanner`：从一句目标提取关键词、最高采购价和最低预计利润
- `BrowserPublicSearchTool`：调用 Playwright 浏览服务打开公开商品页面
- 读取公开商品名称、价格、销量文字、评价文字、图片和来源链接
- `EvidenceFileStore`：服务端保存商品卡价格截图和完整 JSON 执行证据
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
src/tools/browser-tools.js             Browser/Evidence/Report Tools
server/public-browser-runner.js        Playwright 公开页面执行器
server/browser-agent-server.js         Browser Agent HTTP 服务
server/evidence-file-store.js          截图与 JSON 证据保存
Dockerfile.browser-agent               浏览服务容器
```

## 验证

```bash
npm test
npm run build
```

当前 Browser Agent V0.1 已完成代码、Mock 全链路测试与 Docker 部署配置。真正的公开平台搜索还需要部署 Browser 服务并配置合规的平台白名单来源；未连接前系统会明确暂停，不会伪造结果。
