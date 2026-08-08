# Hermes iOS — 架构设计（ARCHITECTURE）

按 2026-07-26 代码实况提取。目标：加功能的人一眼找到"插在哪一层、要满足哪个契约、哪个测试会拦你"。配套：`SRS.md`（功能需求）、`API-CONTRACT.md`（HTTP 契约）。

## 1. 分层总览

```
┌────────────────────────────────────────────────────────────────────┐
│ RN 应用层  App.tsx → HermesNativeApp → NativeShell(导航壳)          │
│   ├─ 聊天(RN): studio/PreviewChatPage 编排 + studio/chat 状态层  │
│   ├─ 管理页(签名版 SwiftUI): HermesSwiftUIRouteView + route-data    │
│   └─ Provider 栈: Auth / Theme / Localization / Notification / Ctx │
├────────────────────────────────────────────────────────────────────┤
│ 产品 API 层  src/api/HermesCloudApi.ts(类型化门面, 唯一入口)         │
│              src/design/theme-api.ts · context/IOSIntelligenceApi  │
├────────────────────────────────────────────────────────────────────┤
│ 传输层  src/api/HermesApiClient.ts(纯 transport: Bearer/401重试/    │
│         deadline/同源/SSE) + src/auth/mobile-auth.ts(无token认证面) │
├────────────────────────────────────────────────────────────────────┤
│ hermes-agent 后端 HTTP  (dashboard + /api/plugins/* 插件面)         │
└────────────────────────────────────────────────────────────────────┘
   RN ⇄ Swift 原生桥（Expo Modules）：
   modules/hermes-ios-context (设备上下文/保险库/事件队列)
   modules/hermes-ios-controls (SwiftUI 局部前端/帧率/控件)
   modules/hermes-live-blur · hermes-sheet-controller · hermes-swipe-actions
   modules/hermes-context-menu · hermes-quick-look
   native-extensions/ (DeviceActivity Monitor/Report · WatchApp · WeatherWidget)
```

三条数据通路：
1. **RN → HermesApiClient → 后端 HTTP**：所有业务数据，服务器为唯一权威（本地只有缓存与 outbox）。
2. **RN → Expo 原生桥 → Swift 服务**：设备能力（定位/健康/Screen Time/附件加密/事件队列），数据先落本地加密存储，再经通路 1 上传。
3. **RN → SwiftUI 局部前端（route-data JSON 快照 ⇄ 动作事件）**：管理页在签名构建用 SwiftUI 渲染，RN 只做数据装配与动作执行（§5）。

## 2. 目录导航

| 目录 | 职责 | 加功能时 |
|---|---|---|
| `src/api/` | transport + 云 API 门面 + 会话缓存/outbox + 视图模型 | 新 API 调用加在 HermesCloudApi 方法上（§4） |
| `src/app/` | 路由注册/组合、NativeShell、SwiftUI route-data 桥 | 新页面注册处（§6、§10） |
| `src/auth/` | 登录/凭据/会话恢复状态机 | 动 Keychain 键先看 credential-contract.ts |
| `src/studio/` | 实际发布的 RN 产品 UI：壳、聊天、记忆、工作流与共享控件 | 新的生产 RN 页面放这里；不得依赖未被 Metro 替换的 fixture |
| `src/preview/` | Expo 设计走查页、fixture 数据和生产空替身 | 仅放预览数据/页面；注意 §7 的构建切换 |
| `src/design/` | 主题快照/令牌/字体目录/theme-api | 改主题必须过 design-contract 测试 |
| `src/context/` | IOSContextProvider、智能天气、权限协调 | 新设备能力的 JS 侧编排 |
| `src/i18n/` | 中文翻译层 | 新文案进 ZH_TRANSLATIONS 或路由 labels |
| `src/models/` `src/notifications/` `src/legal/` | 模型管理页、APNs、第三方声明 | |
| `modules/*/` | 7 个 Expo 原生模块（index.ts 是 JS 契约，ios/*.swift 是实现） | 新原生能力（§9） |
| `native-extensions/` | 4 个伴生 target（config plugin 注入 Xcode 工程） | |
| `plugins/with-hermes-native-extensions.js` | Expo config plugin：把 native-extensions 装配进构建 | |
| `tests/` | node:test 套件（`pnpm test` = `tsx --test tests/*.test.ts`） | §11 列出每个"架构测试"钉住的规则 |

## 3. 传输层（HermesApiClient）

单一职责：同源 HTTP + Bearer。**不含任何产品端点**（tests/frontend-preview-source.test.ts："the transport client carries no product endpoints"）。要点（来源:src/api/HermesApiClient.ts）：
- `normalizeBaseUrl`：根 origin、无 userinfo、HTTPS 强制（`cleartextHttpAllowed` 白名单：loopback/`*.localhost`/`*.local`/`EXPO_PUBLIC_HERMES_ALLOW_HTTP=1`）；明文违规抛 `HermesCleartextBaseUrlError`（`code='HERMES_CLEARTEXT_BASE_URL'`，L41-61、91），该错误被 `session-restore-policy` 判为终态（不可重试）以避免冷启动无限重试锁死。
- 凭据可为固定 token 或 `HermesAccessTokenProvider`（AccessTokenController 实现）；401 → `getAccessToken({forceRefresh, rejectedToken})` 换新后**重试一次**（L278-319）。
- `request/download`：30s deadline（`withRequestDeadline` + AbortController 级联）；JSON 按 Content-Type 判定；错误细节做密钥脱敏 + HTML 拦截 + 240 字截断（L114-187、383-448）。
- `openEventStream`：SSE 专用，`Accept: text/event-stream`、`cache: no-store`，默认经 `expo/fetch`（RN 内建 fetch 不支持流式 body）（L189-228）。
- 防泄漏：URL 任意组件含凭据（含 %XX 大小写两种编码与表单编码）即抛错（L251-270、436-452）。
- 响应终点同源校验：仅当 runtime 提供非空 `Response.url` 时执行（L334-353）。

认证面（无 token 阶段）另用 `MobileAuthApiClient`（src/auth/mobile-auth.ts），同样 20s deadline、同源校验、脱敏。

## 4. 产品 API 层（HermesCloudApi 门面）

`HermesCloudApi`（src/api/HermesCloudApi.ts，约 1660 行）是**唯一**类型化服务器门面："It intentionally stores no business data"。内部 `request` 已设为 **private**：需要新端点时**必须**在门面或匹配的领域模块增加命名方法，不许在调用点手搓路径绕过。构造经组合根 `hermes-api-registry.ts`：`hermesCloudApiFor(client)`（WeakMap，每个 client 一实例）与 `sharedConversationLocalStore()`（进程单例）——页面代码禁止散落 `new`（tests/frontend-preview-source 锁定）。设计面端点独立于 `src/design/theme-api.ts`（HermesApiClient 不依赖设计 payload 形状）。`loadRoute(routeId, profile, selectedId)` 是 SwiftUI 路由的数据装配总开关。H8 整改的领域拆分已覆盖 cron、skills/installations/plugins/MCP、Studio memory 和模型目录/检测/切换，分别位于 `src/api/cloud/cron.ts`、`extensions.ts`、`memory.ts`、`models.ts`。门面保留同名委托，调用点零变化；领域模块只拿到门面私有 request/json 闭包。路径/动词/query/body 契约由 tests/cloud-api-domains.test.ts 钉住，门面不得残留第二份端点实现。

聊天生产模块不再把状态机内联在一个 5480 行组件中。`src/studio/PreviewChatPage.tsx` 现在约 904 行，只负责组合根、服务注入和 hook 编排；`src/studio/chat/` 分别拥有会话索引/快照、SSE、乐观消息、发送、取消、介入、outbox 重放、附件、导航、滚动和纯展示组件。页面状态变化必须先进入对应 controller/service，禁止把新的持久状态机重新写回页面 JSX。

## 5. 认证状态机

`authReducer`（src/auth/auth-state.ts）状态：`provisioning`（登录页，busy/error 子态）→ `locked`（生物识别门，failedAttempts 计数，MAX=5）→ `authenticated`（携 SavedConnection）。并发控制三件套（src/auth/auth-lifecycle.ts）：
- `AuthLifecycleCoordinator`：代数号（generation），mount/beginOperation/invalidate，一切异步完成后先 `isCurrent` 再落地，杜绝旧登录写覆盖新登录。
- `CredentialMutationQueue`：Keychain 变更串行化。
- `LocalAccountCleanupSaga`：账号删除意图持久化（begin/markRemoteDone/run/pending），支撑"服务器已删、本地未完"的崩溃恢复。
客户端会话对象（client + AccessTokenController）由 `clientSessionKey = generation\0baseUrl\0username` 记忆化；旧 session 的 controller 在替换后 `dispose()`（AuthProvider.tsx:580-674）。

## 6. SwiftUI 局部前端（route-data 模式）

签名构建里，管理路由由 SwiftUI 渲染，但**数据与动作全部留在 JS**：

```
useHermesSwiftUIRouteData(routeId, profile, locale)      ── src/app/useHermesSwiftUIRouteData.ts
  reload(): HermesCloudApi.loadRoute → loadHermesSwiftUIRouteSnapshot
            → 纯数据快照(版本号 HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION)
            → encode 成 dataJson ────────────────► <HermesSwiftUIRouteView dataJson=…>
  onAction(action, payloadJson):                       ◄──── Swift 发 HermesRouteAction 事件
    decodeHermesSwiftUIRouteAction → performHermesSwiftUIRouteAction(api, event, profile, zh)
    → 调 HermesCloudApi 写操作 → 'reload' / message / detectedModels / confirmRequired
```

- **契约文件**：`docs/spec/swiftui-route-actions.json` 是动作名、顶层快照字段和动作载荷字段的单一事实源；`scripts/generate-swiftui-route-actions.mjs` 同时生成 TypeScript 动作/载荷校验器和 Swift 动作/载荷结构。`src/app/swiftui-route-contract.ts` 只组合生成类型与 per-route 快照类型，`HermesSwiftUIRouteData.swift` 只保留解码/编码运行时。**加新动作 = 修改 JSON 规范 + 在 `hermes-route-data.ts` 增加行为分支 + 运行 `npm run contract:generate`**；`npm run contract:check` 和跨语言源码测试拒绝生成产物漂移或手写载荷镜像回潮。
- **数据装配**：`src/app/hermes-route-data.ts`（loadHermesSwiftUIRouteSnapshot 按 routeId switch，L47-120+；performHermesSwiftUIRouteAction 动作分发，L144-505）。
- **刷新节奏**：前台 15s；skills/mcp 因安装轮询加密到 2s；models 路由不自动刷新（表单页）；AppState 回前台即刷；system 路由失败时给数据打"过期"标记而不是编造指标（useHermesSwiftUIRouteData.ts:49-50、221-265，managed-node-status.ts）。
- **swiftui-partial-frontend-source 测试还钉住**（tests/swiftui-partial-frontend-source.test.ts）：chat 路由在 SwiftUI 侧必须是 `EmptyView`（聊天永远是 RN，L70-75）；四个宿主视图必须 `ExpoSwiftUI.WithHostingView`；管理页写操作集合（skillUpdate/kanban*/model*/integrationUpdate/configImport/fileImport 的 security-scoped + staged 流程）；模型归一化只在 HermesCloudApi（禁止 route 层复制 customApiMode）；协作房间发送的 draft 保留 + requestId 幂等 + 401/408/429 之外的 4xx 判永久失败；主题经 props 注入禁止固定 palette；env 路由禁止 environmentUpsert 复活。
- 原生模块 JS 契约：`modules/hermes-ios-controls/index.ts` 暴露原生路由、模型工具、毛玻璃表面与帧率控制器；侧边栏统一由 React Native/JS 实现。

## 7. Studio 产品 UI 与 preview 设计走查

发布的 RN 产品页面位于 `src/studio/`；Expo 设计数据和仅供走查的管理页面位于 `src/preview/`：
- **预览构建**（`EXPO_PUBLIC_FRONTEND_PREVIEW=1`，Expo Go / 设计走查）：加载 fixture 数据（preview-fixtures.ts 的假会话历史、chat-fixture-simulator.ts 的本地假回合、PreviewXxxPages 的设计稿页面、PREVIEW_ZH_TRANSLATIONS）。
- **生产构建**（默认）：`metro.config.js` 的 `resolver.resolveRequest` 把四类模块**在打包期整体替换**为空实现：`preview-fixtures → production-fixtures.ts`（全空数组）、`Preview(Automation|Core|Plugin|Settings)Pages|HermesStudioSettingsPage → production-route-stubs.tsx`（全部 `() => null`，注释明言"防止 design records 进入 IPA"）、`preview-localization → production-preview-localization.ts`、`chat-fixture-simulator → production-chat-simulator.ts`（来源:metro.config.js:7-52，production-route-stubs.tsx:1-3）。
- **契约**：`src/studio/frontend-preview-contract.ts` 定义 `FrontendPreviewAppProps`——Studio 壳可选注入 `client`（真实 HermesApiClient）、`account`、`cacheOwner`、`notificationTarget`；认证生产入口始终注入真实 client，设计走查模式才允许无 client fixture。
- **产物验证**：`scripts/verify-production-bundle.mjs` 要求 iOS bundle 必含 marker（`/single/conversations`、BSL 声明、`HermesStandardMap`、`hermes.native.conversations.v3`——该字面在缓存升到 v4 后仍作为迁移源常量存在于 conversation-local-store.ts，marker 继续成立）且不含完整 PEM 私钥（tests/production-artifact-contract.test.ts:10-16）。
- metro 另提供 `HERMES_WEB_PROXY_TARGET`：web 开发把 `/api/*`、`/auth/*` 反代到指定根 origin（校验同 base URL 规则，metro.config.js:54-115）。
- **目录边界**：`src/studio/README.md` 与 `src/preview/README.md` 分别声明产品与 fixture 所有权。tests/production-bundle-swap.test.ts **执行级**调用 `resolver.resolveRequest`，断言 fixture 四族被替换且 Studio 产品模块不被替换。`scripts/verify-production-source-graph.mjs` 从真实入口遍历依赖，只允许 `production-*` 三个空替身从 preview 目录进入生产图，并拒绝核心产品文件迁回 preview。

**加新管理页时**：设计走查页放 `src/preview/`，命名若匹配 `Preview(Automation|Core|Plugin|Settings)Pages` 会被自动 stub；必须进生产 IPA 的 RN 页面放 `src/studio/`，管理功能仍优先走 SwiftUI route-data 路线（§6）。

## 8. 状态与存储清单（谁拥有什么）

**服务器（唯一权威）**：账号、会话、消息、hosted turns、文件、审批、模型/主题偏好。

**iOS Keychain（expo-secure-store，src/auth/credential-contract.ts）**：

| 键 | 内容 | 保护 |
|---|---|---|
| `hermes.native.v2.baseUrl` / `.username` | 连接标识 | 设备解锁 |
| `hermes.native.v2.accessToken` / `.accessExpiresAt` | 短寿访问令牌 | 设备解锁（刷新不弹窗） |
| `hermes.native.v2.refreshToken.<uuid>` + `.refreshTokenKey`(指针) | 长寿刷新令牌 | 生物识别 ACL（可用时） |
| `hermes.native.v2.credentialProtection` | `biometric`\|`device` 模式标志 | 无（冷启动决策用） |
| `hermes.native.v2.rememberLogin` / `.rememberedPassword` | 记住登录偏好/密码 | 密码=生物识别 ACL |
| `hermes.native.v2.sessionVersion` (=“2”) / `hermes.native.deviceId` / `hermes.native.installationId` | 版本戳/设备 id | 设备解锁 |

**原生 Keychain（Swift 直写）**：附件保险库 owner 密钥（service `app.hermes.attachment-vault.v1`）+ revoked 墓碑；上下文队列密钥与安装 id（`app.hermes.ios-context`）；Screen Time 共享密钥（`app.hermes.screen-time`，access group `group.app.sunstone1029.fig1171.hermes`——**仓库里唯一使用 access group 的条目**）。

**AsyncStorage**（src/api/conversation-local-store.ts:12-22，src/design/theme-store.ts）：

| 键 | 内容 |
|---|---|
| `hermes.native.conversations.v4` 前缀：每 owner 一份索引 + 每会话一行 | 会话缓存（v4 分片；写入行先于索引，坏行只丢单会话）。v3 单 blob/v2/v1 为一次性迁移源：读一次、下次写入重分片、索引就位后删 v3 blob（来源:conversation-local-store.ts:12-19、156-197、274-307） |
| `hermes.native.hosted-turn-outbox.v1` | 待发/进行中聊天轮次（含附件计划） |
| `hermes.native.collaboration-room-outbox.v1` | 群聊房间待发消息 |
| `hermes.native.hosted-intervention-outbox.v1` | 运行中介入待发 |
| `hermes.native.optimistic-messages.v1` | 乐观消息账本 |
| `hermes-dashboard-theme` / `hermes-dashboard-font` | 主题/字体偏好 |

**文件系统**：
- `<Application Support>/hermes-outbox/owner-<sha256>/<requestId>/*.hermes-encrypted` — 附件加密 outbox（根 URI 由原生 `getAttachmentOutboxRootUri()` 提供，JS 经 `src/api/attachment-outbox-root.ts` 询问而非自拼，防 JS/Swift 分叉；无原生模块的平台回退 Documents 且无加密）。
- `<Application Support>/HermesContext/pending-events.encjsonl` + `relay-state.enc`（AES-GCM，`completeUntilFirstUserAuthentication`）。
- `<Caches>/hermes-attachment-plaintext-v1/<ownerHash>/…` — 上传瞬时明文（进程启动即清）。
- App Group UserDefaults `group.app.sunstone1029.fig1171.hermes` — Screen Time 密封信封 + account-generation + 监控 identifiers。

## 9. 原生模块桥（RN ⇄ Swift）

模式：每个模块 `index.ts` 用 `requireOptionalNativeModule` 拿原生实现，导出**显式 TypeScript 接口**（如 `IOSContextNativeModule`，modules/hermes-ios-context/index.ts:110-246）与 `hasNativeIOSContext` 探针；无原生环境（web/Expo Go）时能力优雅缺席而非崩溃。原生视图经 `getNativeViewContract()` 版本化发现（native-view-loader.ts），"注册表查到才可渲染"。

`HermesIOSContext` 模块（唯一设备上下文入口）内部服务划分：Location/Motion/Health/Device/Watch/ScreenTime/LiveActivity/Background 服务 + `HermesContextEventQueue`（事件与命令的加密持久层）+ `HermesAttachmentVault`（附件加密）。**加原生能力的路径**：Swift 里加 `AsyncFunction("name")`（HermesIOSContextModule.swift）→ index.ts 接口 + 包装（可选能力用 `typeof module.fn === 'function'` 探测，参照 `setPermissionCollectionReady`）→ tests/ios-context-native.test.ts 加桥接断言。伴生 extension targets 由 `plugins/with-hermes-native-extensions.js` 注入构建（tests/native-extensions.test.ts："native extension config declares every V4 companion target"）。

## 10. 导航

- 路由注册表 `src/app/route-registry.ts`：25 条路径（`/` 重定向 `/chat`），`visibleInSidebar` 决定侧栏露出；测试锁定完整路径清单（tests/native-v2-architecture.test.ts:41-74）。
- `route-composition.ts`：把注册表 + 服务器插件清单组合成侧栏（双语 labels、位置提示、去重、Puzzle 图标兜底；tests/route-composition.test.ts 8 条规则）。
- `NativeShell.tsx`：compact（iPhone）= react-native-drawer-layout 抽屉 + UIKit native-stack 边滑返回；regular（iPad）= split 双栏；侧边栏统一使用 React Native/JS 实现。导航前必收键盘；抽屉在目标路由 ready（onReady 探针）前保持覆盖（tests/native-shell-source、shell-contracts 系列）。
- 根组合被钉死：`GestureHandlerRootView > SafeAreaProvider > HermesNativeApp`，gesture-handler import 必须是入口第一条语句（tests/native-v2-architecture.test.ts:76-113）。

## 11. 架构测试防护网（tests/ 里谁在拦你）

源码扫描/契约类套件与其钉住的规则（标题即规则，来源:各 test 文件）：

| 套件 | 钉住的规则 |
|---|---|
| native-v2-architecture.test.ts | 无 WebView 运行时；25 条路由路径全集；gesture-handler import 顺序；根组合层级；bundle id/版本/构建号/必需 Expo 插件/Face ID 中文文案 |
| swiftui-partial-frontend-source.test.ts | TS/Swift 动作枚举逐字对齐；chat 不被 SwiftUI 替换；宿主视图 HostingView；管理页写操作全集；房间发送 draft/幂等/永久失败判定；主题 props 注入；帧率控制器形态；分析页先渲染后关抽屉；账号页"首次登录后自动恢复"文案（禁提 Face ID） |
| frontend-preview-source.test.ts | 预览渲染全路由且可挂真账号；IPA 永远启动认证生产前端;transport 无产品端点 + 共享组合根；预览持久化仅 theme/font；控件必须有真实回调 |
| production-bundle-swap.test.ts | 执行 metro `resolveRequest`：fixture 四族被替换为 production-* 空实现、Studio 产品模块保持直连、仅 `EXPO_PUBLIC_FRONTEND_PREVIEW=1` 恢复 fixture |
| cloud-api-domains.test.ts | H8 域拆分：cron/extensions/memory/models 已迁移方法经门面的路径/动词/query/body 线上契约；门面不得残留第二份端点实现 |
| native-shell-source.test.ts | 仅原生表面 + canonical 路由组合器；抽屉 UI 线程手势；ProMotion 8ms 滚动节奏；键盘先收后导航；侧栏选择替换 chat 栈 |
| shell-contracts.test.ts | 壳契约引用每个 WebUI 源；15px 根字号与密度；抽屉开合状态机；路径解析兜底（未知/环状路由） |
| design-contract.test.ts | WebUI/Studio 主题快照逐色冻结；语义色推导；密度/字体回退 |
| native-controls-source.test.ts | 控件无浏览器表面；iOS 18 部署目标一致；dev-client 启动 |
| native-extensions.test.ts | 4 个伴生 target 声明齐全；DeviceActivity 事件被主 App 吸收；Watch 数据入行为时间线 |
| native-font-assets.test.ts / webui-fonts.test.ts / third-party-assets.test.ts | 50 字面目录、hash/许可/来源钉死；BSL 声明 |
| login-visual-contract.test.ts | 登录视觉契约（颜色/辉光/按钮三层状态机）由 login-visual-contract.ts 单源供给 |
| production-artifact-contract.test.ts | 生产 bundle marker 白名单 + PEM 私钥拦截 |
| route-composition.test.ts / hermes-route-data.test.ts / swiftui-route-contract.test.ts | 侧栏组合规则；路由快照/动作行为；契约编解码 |
| ios-context-native.test.ts / ios-permission-coordinator 等 | 原生桥接面与权限编排行为 |

行为类套件（api-client / cloud-api / mobile-auth / auth-state / auth-lifecycle / chat-view-model / conversation-sync / hosted-* / attachment-* / theme-* / managed-node-status …）覆盖对应模块的状态机与解析逻辑。

## 12. 新功能接入速查

**加一个管理页（服务器数据）**：`route-registry.ts` 加路由 → `route-composition` labels → `HermesCloudApi.loadRoute` 加 case（数据方法也加在门面上）→ `hermes-route-data.ts` 快照函数 + 动作 case → `swiftui-route-contract.ts` 快照类型/动作常量 → Swift `HermesSwiftUIRouteData.swift` enum + `HermesSwiftUIPages.swift` 页面。会被拦的测试：native-v2-architecture(路径全集)、swiftui-partial-frontend-source(枚举对齐/写操作)、route-composition、hermes-route-data。

**加一个后端调用**：只在 `HermesCloudApi`（或对应领域 api 文件）加命名方法；路径必须同源相对路径；写操作考虑 `Idempotency-Key`/request_id 幂等；先查 `API-CONTRACT.md` 与后端 `docs/spec/API-HTTP.md` 是否已有端点。cloud-api.test.ts 需要补桩测试。

**加一个原生能力**：§9 三步（Swift AsyncFunction → index.ts 契约 → 测试）；涉及后台数据先过 `HermesContextEventQueue`（owner-scope 规则）；涉及文件写入必须落在受控根内并复用 descendant 校验模式。

**加聊天行为**：纯投影逻辑放 `src/api/chat-view-model.ts`；有生命周期的行为放 `src/studio/chat/use*Controller.ts` 或独立 service；页面只注入依赖并接线。持久化需求扩展对应的 `conversation-*-outbox.ts`/repository，不得把状态机重新塞回 facade 或页面组件。
