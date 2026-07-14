# muxi-ai-v2.0-final 源码发布清单

## 发布状态

- 发布标识：`muxi-ai-v2.0-final`
- Web / PWA 源码：已包含
- 本地 Agent 与自动化源码：已包含
- AI Provider 预留层：已包含
- 本地服务：已包含
- 自动测试：13 套，已包含
- Android WebView 入口源码和 Nitron 配置：已包含
- API Key、聊天记录、长期记忆、签名私钥：未包含

## 主要目录

- `assets/`：图标和头像资源
- `css/`：现有 UI 样式
- `docs/`：接口契约
- `js/agent/`：Agent Core、任务、队列、执行器、路由和规划器
- `js/agents/`：File Organizer Agent 与 Local Productivity Agent
- `js/automation/`：本地自动化解析、规划、校验、执行和日志
- `js/tools/`：Tool SDK、注册中心和示例工具
- `js/providers/`、`js/api/`：可替换大模型接口预留
- `server/`：本地静态服务和安全代理示例
- `scripts/`：自动测试脚本
- `android-release/`：Android 包装配置和 WebView 原生入口源码

## 尚未包含

- `LICENSE`：需要项目所有者选择开源许可后再添加
- 完整 Gradle Android Studio 工程：当前 APK 使用 Nitron 模板打包
- 正式发布签名私钥：安全原因不得提交到 GitHub

