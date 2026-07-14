# Hermes Agent iOS

这是当前定制 Hermes WebUI 的 SwiftUI 原生 iOS 前端，不包含 WebView 或 WKWebView。WebUI 源代码是 UI、字体、颜色、尺寸、渲染、特效、动画和功能行为的唯一规格；Expo 仅保留进程、认证和系统能力桥接，可见业务界面由 SwiftUI 绘制。

## 已实现

- 原生登录、Keychain 凭据保护和 Face ID 快速解锁。
- 与定制 WebUI 对齐的主题、全部字体、路由信息结构和基础控件视觉契约。
- 原生实时背景模糊、径向边框和连续动画，不使用截图或静态替代。
- iPhone 和 iPad 自适应，支持横竖屏与安全区域。
- EAS development、preview、production 构建配置，以及签名 IPA 发布流程。
- Hermes 长任务由服务器继续执行，应用恢复后重新读取完整会话和任务结果。

## 调试

项目包含 `HermesLiveBlur` 本地 iOS 模块，调试必须使用 development build，不能使用缺少该模块的通用运行容器。

1. 运行 `pnpm eas:development` 构建并在 iPhone 上安装 development IPA。
2. 双击桌面的 `Hermes iOS 调试.cmd`。电脑和 iPhone 连接同一个 Wi-Fi 时使用该入口速度最快。
3. 在 Hermes development client 中打开终端二维码对应的项目。
4. 不在同一局域网时，运行 `scripts/start-expo.ps1 -Tunnel`。

如果 development client 显示 `The request timed out`，双击桌面的 `Hermes iOS 修复调试网络.cmd` 并允许 UAC。该脚本只允许本地子网访问 Metro 的 TCP 8081，不会向公网开放其他端口。当前网络会重置 ngrok 连接，因此同一 Wi-Fi 下优先使用局域网调试入口。

## 构建 IPA

`expo build` 已停止维护，本项目使用它的官方替代方案 EAS Build。EAS 签名构建需要先登录 Expo，并提供 Apple 开发者凭据；运行 `scripts/build-eas-preview.ps1` 会进入官方引导。

GitHub 的 `Build unsigned iOS IPA` 工作流不需要 Apple 证书。手动运行工作流，或推送 `v1.0.0` 形式的 tag，即可得到 `Hermes-Agent-unsigned.ipa`。该文件必须先由自签软件写入有效证书和 provisioning profile，不能直接安装。

当前 unsigned IPA 工作流设置 `EXPO_PUBLIC_FRONTEND_PREVIEW=1`，Release 包会直接进入 SwiftUI 前端预览，不连接 Hermes 后端。未设置该变量的正式构建仍使用登录和认证流程。

## 后台任务

应用不在手机本地执行 Hermes 长任务。用户提交任务后由 DBB3 服务端继续运行；应用关闭、锁屏或网络切换不会终止任务。再次打开应用时会从服务端恢复原会话并读取完整结果。

## 配置

- Hermes 地址：环境变量 `EXPO_PUBLIC_HERMES_URL`，默认 `https://8.138.40.16`。
- GitHub 仓库：环境变量 `EXPO_PUBLIC_GITHUB_REPOSITORY`，默认 `given33/hermes-ios`。
- bundle identifier：`com.given33.hermesagent.nativebeta`。
- 最低系统版本：iOS 18.0。

应用不内置 Hermes 密码、SSH 私钥或 GitHub token。本机只持久化 Base URL、受 Keychain 和 Face ID 保护的 API key、主题/字体偏好，以及后续有明确边界的本地日志；会话、消息、附件、任务结果、配置和 Profile 由服务器保存。
