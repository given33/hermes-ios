# 2026-07 审计与优化变更说明（iOS 侧）

依据 2026-07-27 最终复验时的 `git status --porcelain` / `git diff --stat`（基线 commit `3dbfb6c`）：65 个已跟踪文件变更（+3042/−10583），另有 18 组新增未跟踪文件。本文记录当前已落盘并复验的状态；未完成的大型架构重构在根目录 `REMEDIATION-REPORT.md` 单独列出。

## 1. 安全加固

### 1.1 Keychain 凭据 v2 + Face ID 门（credential-contract.ts、credential-store.ts、AuthProvider.tsx、LoginScreen.tsx、app.base.json）
- **之前的问题**：旧键名（`hermes.native.*` 无 v2）可能被原地更新而意外携带/丢失生物识别 ACL；记住的密码存在无保护写入路径；冷启动为判断是否需要解锁会去读受保护条目（误弹 Face ID）。
- **现在的行为**：v2 新键名 + refresh token 随机新键写入（永不原地 update）；保护方式记录在无保护标志 `credentialProtection`，冷启动只读标志；记住密码仅允许 Face ID ACL 条目、无生物识别时拒绝并回滚；legacy 条目不读值直接删除；Face ID 失败预算 5 次后清会话。`app.base.json` 为 expo-secure-store 增加中文 `faceIDPermission` 文案（+1 行，被 native-v2-architecture 测试锁定）。
- **对用户可见**：首次开启"记住密码"或冷启动解锁时出现中文 Face ID 提示；解锁连续失败改走密码登录。
- **兼容性**：升级后旧会话条目被静默清除，需重新登录一次；无生物识别的设备静默恢复不受影响。

### 1.2 HTTPS 强制与明文逃生口（config.ts、HermesApiClient.ts、session-restore-policy.ts、tests/config*.test.ts）
- **之前的问题**：明文 HTTP 校验抛普通 Error；冷启动恢复把它当瞬态错误无限重试——保存过 `http://` baseUrl 的设备被永久锁死且无 UI 出口。
- **现在的行为**：`normalizeBaseUrl` 违规抛专用 `HermesCleartextBaseUrlError`（code `HERMES_CLEARTEXT_BASE_URL`）；`session-restore-policy` 将其判为**终态**→清除已存会话、回到登录页。开发逃生口保留：loopback/`*.localhost`/`*.local` 或 `EXPO_PUBLIC_HERMES_ALLOW_HTTP=1`；构建期 `EXPO_PUBLIC_HERMES_URL` 同规则前置校验。新增 tests/session-restore-policy.test.ts、tests/config-cleartext-origin.test.ts。
- **对用户可见**：曾保存明文地址的用户升级后直接见登录页（提示登录过期），不再卡启动。
- **兼容性**：局域网 IP + HTTP 的调试组合不再被放行（`.local` mDNS 名或环境变量才行）。

### 1.2.1 Web 预览会话不落浏览器存储

Web/Expo 预览的凭据适配器只保留当前 JavaScript 进程内存，不再写入 `sessionStorage` 或 `localStorage`。页面刷新后需要重新登录，这是避免 XSS 读取持久令牌的有意取舍；原生 iOS 继续使用 SecureStore，不受影响。源码门禁阻止浏览器存储调用回归。

### 1.3 附件保险库（HermesAttachmentVault.swift +100 行、attachment-outbox-root.ts 新增、modules/hermes-ios-context/index.ts）
- **之前的问题**：加密 outbox 位于 Documents（`UIFileSharingEnabled=true` 会把它整个暴露进"文件"App）；加密源路径无白名单（被劫持的 JS 可用 encrypt-and-return 外带容器内任意文件）；路径包含判定可被 symlink 与 `/var`↔`/private/var` 前缀差异绕过。
- **现在的行为**：outbox 迁至 Application Support（一次性合并迁移，可重试）；加密源仅限 Caches/NSTemporaryDirectory/新旧 outbox 根；descendant 判定先双侧 `resolvingSymlinksInPath` 再按路径分量比较；owner 注销后密钥进 revoked 墓碑；JS 侧经原生 `getAttachmentOutboxRootUri()` 询问根（新文件 attachment-outbox-root.ts），旧 Documents URI 记录读时重映射。
- **对用户可见**："文件"App 里不再出现 hermes-outbox 目录；待发附件在升级后继续可用。
- **兼容性**：预加密时代的明文附件仍被接受为加密源直至排干。

### 1.4 Screen Time 密封交接（HermesScreenTimeService.swift +134 行、两个 DeviceActivity 扩展各 +~40 行）
- **之前的问题**：DeviceActivity 扩展把事件明文写进共享 App Group UserDefaults（磁盘上是明文 plist）。
- **现在的行为**：扩展只写 AES.GCM 密封信封（密钥在共享 Keychain access group，仅主 App provision）；主 App 解封、按 accountGeneration 过滤、**精确删除已消费记录**（不再整键清空，避免抹掉持久化期间新写入的回调）；换账号 bump generation 隔离旧数据。
- **兼容性**：旧版扩展写的裸字典事件一次性排干；扩展在密钥未 provision 前静默丢弃回调（首次监控启动由主 App 补 provision）。

### 1.5 上下文事件队列 owner-scope 硬门（HermesContextEventQueue.swift、index.ts、local-account-purge.ts）
- **之前的问题**：读取/确认未强制 scope，账号切换/删号后存在跨账号排空与复活风险。
- **现在的行为**：`read`/`acknowledge` 必须携带当前活跃 ownerScope；删除带墓碑 + `requestedAt` 时间闸防陈旧删除；命令游标/完成集/执行结果按 scope 分桶；本地账号清删顺序由 local-account-purge(+order) 固化。

## 2. 历史死代码清理（旧 JSON-RPC WebSocket 聊天栈）

> 本节记录 2026-07 的旧 `/api/ws` JSON-RPC 聊天栈清理。2026-08-29 起，
> iOS 为 hosted collaboration 事件重新启用独立的低延迟 WebSocket 镜像：
> 通过 REST 铸造一次性 ticket，连接失败自动回退到 hosted-events SSE；
> 这不是已删除的旧 JSON-RPC 协议，详见 `docs/spec/API-CONTRACT.md` §6。

| 删除 | 原内容 | 替代 |
|---|---|---|
| `src/api/HermesChatStream.ts`（495 行） | 经 dashboard `/api/ws` 的 JSON-RPC WebSocket 聊天流运行时（重连/网络/AppState 编排） | hosted-events SSE + `useHostedConversationStream` + 快照轮询 |
| `src/api/native-chat-stream-runtime.ts`（22 行） | 上述运行时的 RN 适配器（NetInfo/AppState/WebSocket 工厂） | 同上 |
| `src/api/ws-ticket.ts`（43 行）+ `hermes-types.ts` 的 `WebSocketTicketResponse` | 旧 `/api/ws` 铸票与 wss URL 构造 | 旧实现删除；当前 hosted-events WS 在 `HermesApiClient.openWebSocket` 中使用同一一次性 ticket 机制 |
| `tests/hermes-chat-stream.test.ts`（135 行） | 上述模块的测试 | tests/hosted-conversation-events.test.ts 等 |
| `src/preview/attachment-draft-lifecycle.ts`（37 行） | 附件临时源清理逻辑的旧位置 | 迁至 `src/api/attachment-draft-lifecycle.ts`（tests 引用同步更新） |
| `src/preview/PreviewCorePages.tsx` −711 行 | 预览页中被 SwiftUI 路由/生产 stub 取代的死分支 | production-route-stubs / SwiftUI pages |

**对用户可见**：旧 JSON-RPC 聊天行为无变化；当前 hosted 对话优先获得更低延迟的 WebSocket 事件，升级失败仍由 SSE/轮询接管。包体与攻击面缩小。tests/swiftui-partial-frontend-source.test.ts 新增断言禁止 `new HermesChatStream|existingSessionId:` 回潮。

## 3. 会话缓存 v4 分片（conversation-local-store.ts；审计项 arch#4）

- **之前的问题**：v3 把整个账号历史存成单个 AsyncStorage blob——每改一条会话就整账号重写，大账号写放大且一处损坏全盘丢失。
- **现在的行为**：v4 = 每 owner 一份小索引 + 每会话一行；行先落、索引后落（崩溃时旧索引只指向完整行）；坏行只丢单会话，由下次云同步重建；行级 revision stamp 跳过未变行。
- **兼容性**：v3 blob 读一次、下次写入重分片、v4 索引就位后删除 blob——升级不丢历史。生产 bundle marker `hermes.native.conversations.v3` 仍成立（迁移常量保留字面）。

## 4. UX 修复与行为调整

- **LoginScreen.tsx**（+75）：锁屏出现自动触发一次 Face ID，后续重试须显式按钮；注册/登录/解锁三态文案与"显示已存密码"（Face ID 门控）整理。
- **useHermesSwiftUIRouteData.ts / hermes-route-data.ts**（+68/+188）：workflow start 单飞（WorkflowStartSingleFlight）+ running/success/error operation 快照；房间消息 outbox 重放与过期双语通知；文件导入 staged 流程（security-scoped + NSFileCoordinator）；system 路由离线过期标注。
- **ModelsManagementPage.tsx / ThemeProvider.tsx / FrontendPreviewApp.tsx / PreviewMemoryPage.tsx**：模型表单归一化收敛到 HermesCloudApi 单源；主题 props 化注入 SwiftUI；记忆页接 `/api/hermes/memory`（产品后端已补齐并由跨 Profile、原子失败与鉴权测试覆盖）。
- **聊天模块**：生产编排页从 5480 行拆至约 904 行；`src/studio/chat/` 独立承载会话索引/快照、SSE、发送、取消、介入、持久 outbox、附件、乐观消息、滚动、导航和展示组件。`conversation-local-store.ts` 同步收缩为 285 行门面，缓存与四类 outbox 分域存放。
- **HermesApiClient.ts**（+59 净）：401 刷新重试携 `rejectedToken`；秘密多编码检测；SSE 走 expo/fetch；错误详情 HTML 拦截。

## 5. 新增文件

| 文件 | 作用 |
|---|---|
| `src/api/attachment-outbox-root.ts` | 附件 outbox 根 URI 的 JS/Swift 单一事实源 + 旧 URI 重映射 |
| `src/api/hermes-api-registry.ts` | HermesCloudApi/本地缓存 store 组合根（per-client 单例） |
| `src/api/cloud/memory.ts` | 记忆域独立传输模块；Facade 公共方法不变，路径/动词/mtime 归一化由领域契约测试锁定 |
| `src/api/cloud/models.ts` | 模型目录、自定义模型保存/检测/发现与模型切换的独立领域模块；Facade 继续导出原类型、归一化函数和方法 |
| `src/design/theme-api.ts` | dashboard 主题/字体端点从 transport 层剥离到设计层 |
| `tests/config-cleartext-origin.test.ts`、`tests/session-restore-policy.test.ts` | §1.2 行为锁定 |
| `src/studio/ReasoningSection.tsx`、`WorkflowTimeline.tsx`、`team-participants-model.ts`、`workflow-timeline-model.ts`、`tests/workflow-timeline-model.test.ts` | 生产 Studio 群聊时间线、推理折叠、成员映射与纯状态模型；已纳入生产依赖图和全量测试 |
| `docs/spec/`（SRS/ARCHITECTURE/API-CONTRACT + 本文件） | 本次文档交付 |

## 6. 验证状态

`typecheck` 0 错误；2026-07-27 使用仓库既有 Node/tsx 运行时完成全套测试，`425/425` 通过。`tests/third-party-assets.test.ts` 已改为对来源许可证文本做换行归一化，Windows `core.autocrlf=true` 不再造成环境性误报。Cloud API 领域拆分的公开 facade、请求路径、HTTP 动词、Profile 和请求体另由 `tests/cloud-api-domains.test.ts` 固化。

### 6.1 C2 产品 UI 与 fixture 物理分离

实际发布的 RN 壳、聊天、记忆、工作流时间线、成员和公共控件已从 `src/preview/` 移至 `src/studio/`；`src/preview/` 只保留 Expo 设计走查页、fixture 数据和 `production-*` 空替身。生产入口改为直接引用 Studio 壳。源码图验证器从真实入口遍历依赖，preview 目录只允许三个空替身可达，并拒绝核心产品文件迁回旧目录。

### 6.2 审批摘要原生桥接

SwiftUI 审批快照现在显式携带后端返回的 `payload_digest`，用户点击批准/拒绝时原值经 Swift action fields 回传 TypeScript，再交给 `decideWriteApproval`。原先依赖模块级可变缓存关联 digest 的做法已删除，避免重载、并发快照或页面切换导致批准对象错配。跨语言字段和操作链由 `hermes-route-data.test.ts` 与 `swiftui-partial-frontend-source.test.ts` 锁定。

### 6.3 SwiftUI 动作协议单一来源

`docs/spec/swiftui-route-actions.json` 现在同时描述动作名、顶层快照字段和动作载荷的字段/类型/必填性。生成器输出 TypeScript 类型与运行时校验器，以及 Swift `HermesRouteActionPayload`/初始化器；两端原有手写载荷定义已删除。未知字段、非整数 position、错误字典/数组元素和缺失 route 会在进入原生桥前被拒绝。`contract:check` 与源码门禁同时阻止生成文件过期和手写双份契约回归。

## 7. 兼容性注意汇总

1. 升级即登出一次（Keychain v2 换名，legacy 清除）。
2. 保存过 `http://` 服务器地址的设备回到登录页；开发环境用 `EXPO_PUBLIC_HERMES_ALLOW_HTTP=1` 或 loopback/.local。
3. 附件 outbox Documents→Application Support 一次性迁移；会话缓存 v3→v4 一次性重分片；两者失败均可在下次启动重试且不丢数据。
4. iOS 不再使用旧 `/api/ws`、`/api/events` 或 TUI JSON-RPC；`/api/auth/ws-ticket`
   仅服务 hosted-events WebSocket 镜像，失败时自动回退 SSE。
5. Screen Time 扩展与主 App 必须同版本部署（密封/开封两半共享密钥与 AAD 常量）。

## 8. 2026-08-29 增量复验：Bot Mode 与 WebSocket

- Bot Mode 的核心移动端桥接已落地：`/api/bots` 返回官方 profile roster 和
  canonical `Bot Chat` 会话占位符；profile CRUD、Bot Chat 打开、名称修改、
  title/groups、隐藏/显示、置顶/取消置顶均通过带类型校验的 REST/action 契约
  进入原生 SwiftUI Bots 页面。
- hosted 对话事件优先使用一次性 ticket 认证的 WebSocket，连接失败自动退回
  SSE/轮询；这条链路不是旧 TUI JSON-RPC 聊天栈，旧 `/api/ws` 实现仍不作为
  iOS 聊天依赖。
- 复验结果：`pnpm typecheck`、`pnpm contract:check`、全量 `pnpm test` 均通过，
  当前统计为 799 tests / 799 pass。原生 Xcode 编译仍需 macOS runner。
- 明确范围：Bot Mode 的桌面 group-round 引擎、跨连接 relay、头像/宠物生成器和
  Routines 专用面板尚未被宣称为 iOS parity；它们只有在各自拥有 typed API、
  原生 route/action 和回归测试后才会升级为 verified。
- 2026-08-29 增补：Bot Mode 的官方 profile 能力与资产接口现已接入。后端
  `/api/bots/{name}/describe|configure|assets/{asset}` 直接调用已注册的
  `profiles.describe|configure|get_asset|set_asset` handler；iOS Bots 上下文菜单
  提供官方能力读取、JSON 能力编辑和原生头像导入（≤2 MB），服务端 roster
  同步 `has_avatar` 状态。新增 backend-wire、Cloud API、SwiftUI action 测试。
