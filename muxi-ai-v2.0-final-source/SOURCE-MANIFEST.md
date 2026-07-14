# muxi-ai-v2.0-final 源码缺失清单

审查结论：本目录创建前，GitHub 仓库中没有 V2.0 Final 源码。下面列出的源码和发布文件目前全部缺失。

## 1. Web / PWA 根文件

- `README.md`
- `CHANGELOG.md`
- `index.html`
- `manifest.webmanifest`
- `service-worker.js`
- `.gitignore`
- `LICENSE`

## 2. UI 与静态资源

- `css/styles.css`
- `css/v1.1.css`
- `css/automation.css`
- `assets/avatar.svg`
- `assets/icons/icon.svg`
- `assets/icons/icon-192.png`
- `assets/icons/icon-512.png`
- `assets/icons/maskable-512.png`

## 3. 应用、语音、存储与聊天

- `js/app.js`
- `js/ai-client.js`
- `js/storage.js`
- `js/voice.js`
- `js/conversation/ConversationManager.js`
- `js/repository/ChatRepository.js`

## 4. AI Provider 预留层

- `js/api/OpenAIService.js`
- `js/providers/OpenAIProvider.js`

## 5. Agent Core

- `js/agent/Task.js`
- `js/agent/TaskStateManager.js`
- `js/agent/TaskQueue.js`
- `js/agent/AgentCore.js`
- `js/agent/AgentExecutor.js`
- `js/agent/IntentRouter.js`
- `js/agent/Step.js`
- `js/agent/ExecutionPlan.js`
- `js/agent/AgentPlanner.js`

## 6. Agent 与 Tool SDK

- `js/agents/FileOrganizerAgent.js`
- `js/agents/LocalProductivityAgent.js`
- `js/tools/Tool.js`
- `js/tools/ToolRegistry.js`
- `js/tools/FileTool.js`
- `js/tools/LocalProductivityTool.js`
- `js/tools/examples/EchoTool.js`

## 7. 本地自动化层

- `js/automation/IntentParser.js`
- `js/automation/ActionPlanner.js`
- `js/automation/ActionValidator.js`
- `js/automation/ActionExecutor.js`
- `js/automation/ExecutionLogger.js`
- `js/automation/AutomationRepository.js`
- `js/automation/AutomationEngine.js`

## 8. 本地服务与文档

- `server/package.json`
- `server/server.mjs`
- `docs/API-CONTRACT.md`

## 9. 自动测试

- `scripts/test-agent-core.mjs`
- `scripts/test-agent-executor.mjs`
- `scripts/test-agent-planner.mjs`
- `scripts/test-automation.mjs`
- `scripts/test-file-organizer-agent.mjs`
- `scripts/test-intent-router.mjs`
- `scripts/test-local-dialogue.mjs`
- `scripts/test-running-cancellation.mjs`
- `scripts/test-task-queue.mjs`
- `scripts/test-tool-registry.mjs`
- `scripts/test-tool-sdk.mjs`
- `scripts/test-v2-beta.mjs`
- `scripts/test-v2-rc.mjs`

## 10. Android 可复现构建文件

当前 APK 已存在，但仓库缺少可独立重新构建 APK 的 Android 工程。至少还需要：

- Android 构建说明
- `AndroidManifest.xml`
- Gradle 配置文件
- Android 资源目录
- WebView 原生入口源码
- APK 构建脚本
- 签名说明（只提供说明，不提交私钥）

## 11. 发布校验文件

- `release.json`
- `SHA256SUMS.txt`
- 完整源码 ZIP：`muxi-ai-v2.0-final-source.zip`

## 当前已有但不能代替源码的文件

- `downloads/muxi-ai-v2.0-final-android-test.apk`
- `downloads/muxi-ai-v2.0-final-dialogue-fix.apk`
- 两个旧版 V2.0 Local Automation ZIP
- V1.3 完整 ZIP
