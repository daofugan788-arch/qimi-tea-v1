# Android 构建说明

当前 Android 测试包使用 Nitron 1.3.0 将 Web / PWA 资源嵌入 WebView APK。

已保留：

- `muxi-ai-v2.0-final/app.js`：应用名称、包名、版本、权限和图标配置
- `muxi-ai-v2.0-final/package.json`：Android 测试包元数据
- `muxi-ai-v2.0-final/release.json`：发布标识
- `native-src/com/nicron/webview/MainActivity.java`：本地资源加载与麦克风权限处理

当前源码发布不包含签名私钥，也不包含完整 Gradle Android Studio 工程。APK 正式上架前，应建立独立 Gradle 工程并使用项目所有者保存的正式密钥签名。
