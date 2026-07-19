# Content Agents

Architecture Freeze 阶段仅保留扩展目录。未来 Content Agent 必须继承 `BaseAgent`，通过 EventBus 通信，并通过 Tool Registry 使用工具。
