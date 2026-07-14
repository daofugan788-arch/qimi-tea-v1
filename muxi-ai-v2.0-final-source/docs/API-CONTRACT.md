# 暮曦 AI V1.0 接口约定

前端调用安全代理，模型密钥仅保存在服务端。

`POST /api/chat`

请求包含 `assistantName`、`userName`、`messages` 和 `memories`，响应格式为：

```json
{"reply":"暮曦的回复"}
```

健康检查：`GET /api/health`。
