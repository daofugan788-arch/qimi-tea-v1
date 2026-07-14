# 暮曦 AI — muxi-ai-v2.0-final

手机端优先的 AI 语音助手 PWA。muxi-ai-v2.0-final 在保留文字聊天、语音、长期记忆和远程模型接口预留的基础上，新增安全的本地自动化框架。

## 功能

- 主页、聊天、长期记忆、自动化、设置
- 安卓 Chrome 语音识别与中文播报
- 自动提取称呼和偏好
- 本地聊天记录与长期记忆
- 本地固定指令解析、Action 规划、风险校验和执行日志
- 自动化模板：启动暮曦、检查服务、重启暮曦、部署新版
- LOW / MEDIUM / HIGH 三级动作安全策略
- Termux 固定命令白名单和外部执行提示
- 数据导入、导出和清除
- PWA 安装、离线缓存和桌面图标
- 安全大模型代理示例

## 自动化边界

- PWA 可以真实执行页面导航、显示提示、等待、复制文本和打开网页。
- 打开 Termux 与运行 Termux 命令只生成操作卡片，需要用户确认并手动执行。
- PWA 不会宣称已经控制 Android，不需要 Root，也不绕过权限。
- 删除文件、安装应用、发送消息、付款、修改系统设置和任意 Shell 属于 HIGH 风险，本版本不执行。
- “解压最新暮曦 ZIP”只显示人工步骤，并可生成白名单内的目录查看命令。

## Termux 命令白名单

只允许固定形式的 `cd`、`ls`、`pwd`、`npm install`、`npm start`、`node`、`pkill node` 和 `curl http://127.0.0.1:8787`。`npm install` 不允许附加包名或参数。

## 运行

```bash
node server/server.mjs
```

打开 `http://localhost:8787`。部署到 HTTPS 后，可在安卓 Chrome 中添加到主屏幕。

## 自测

```bash
node scripts/test-automation.mjs
```

## 目录

```text
muxi-ai-v1/
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── css/styles.css
├── css/automation.css
├── js/app.js
├── js/storage.js
├── js/voice.js
├── js/ai-client.js
├── js/automation/
│   ├── IntentParser.js
│   ├── ActionPlanner.js
│   ├── ActionValidator.js
│   ├── ActionExecutor.js
│   ├── ExecutionLogger.js
│   ├── AutomationRepository.js
│   └── AutomationEngine.js
├── assets/
├── docs/
├── scripts/
└── server/
```
