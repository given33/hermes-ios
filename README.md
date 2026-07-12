# Hermes Agent iOS

这是 Hermes WebUI 的独立 iOS 客户端。应用在原生 WebView 中连接 `https://8.138.40.16/chat`，不会跳转 Safari，并保留官方 Hermes UI、中文界面、登录 Cookie 和当前会话。

## 已实现

- iPhone 16 Pro 和 11 英寸 iPad 自适应，支持横竖屏与安全区域。
- Expo Go 局域网/隧道调试，以及 EAS development、preview、production 构建配置。
- GitHub Actions 使用 macOS 编译未签名 IPA，可交给自签软件签名安装。
- 网络断开与恢复提示；回到前台后恢复页面连接和流式输出。
- 当前聊天地址持久化，重启应用后回到原会话。
- Web 文件选择器支持照片和文件上传；下载完成后调用 iOS 分享/存储面板。
- 启动时检查 GitHub Release；有新版本时提供 IPA 下载入口。

## 调试

1. 在 iPhone 上从 [App Store 安装 Expo Go](https://apps.apple.com/app/expo-go/id982107779)。
2. 双击桌面的 `Hermes iOS 调试.cmd`。电脑和 iPhone 连接同一个 Wi-Fi 时使用该入口速度最快。
3. 使用 Expo Go 扫描终端中的二维码。
4. 不在同一局域网时，运行 `scripts/start-expo.ps1 -Tunnel`。

如果 Expo Go 显示 `The request timed out`，双击桌面的 `Hermes iOS 修复调试网络.cmd` 并允许 UAC。该脚本只允许本地子网访问 Metro 的 TCP 8081，不会向公网开放其他端口。当前网络会重置 ngrok 连接，因此同一 Wi-Fi 下优先使用局域网调试入口。

## 构建 IPA

`expo build` 已停止维护，本项目使用它的官方替代方案 EAS Build。EAS 签名构建需要先登录 Expo，并提供 Apple 开发者凭据；运行 `scripts/build-eas-preview.ps1` 会进入官方引导。

GitHub 的 `Build unsigned iOS IPA` 工作流不需要 Apple 证书。手动运行工作流，或推送 `v1.0.0` 形式的 tag，即可得到 `Hermes-Agent-unsigned.ipa`。该文件必须先由自签软件写入有效证书和 provisioning profile，不能直接安装。

## 后台任务

iOS 会暂停后台 WebView，因此应用不在手机本地执行长任务。用户提交任务后由 DBB3 服务端继续运行；应用关闭、锁屏或网络切换不会终止任务。再次打开应用时会恢复原会话并读取服务端结果。

## 配置

- Hermes 地址：环境变量 `EXPO_PUBLIC_HERMES_URL`，默认 `https://8.138.40.16`。
- GitHub 仓库：环境变量 `EXPO_PUBLIC_GITHUB_REPOSITORY`，默认 `given33/hermes-ios`。
- bundle identifier：`com.given33.hermesagent`。

应用不内置 Hermes 密码、SSH 私钥或 GitHub token。登录状态由 iOS WebView Cookie 保存。
