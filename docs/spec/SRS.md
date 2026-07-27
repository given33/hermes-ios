# Hermes iOS — 软件需求规格说明书（SRS）

本文按 2026-07-26 工作区代码实况提取（版本 `2.0.0-beta.1`，build 31，`app.base.json`）。目标读者：后续要**新增功能**的开发者。每个需求给出：需求描述、边界条件、错误处理、来源引用。无法确证之处标注 `待确认`。

配套文档：`docs/spec/ARCHITECTURE.md`（分层与模块边界）、`docs/spec/API-CONTRACT.md`(前后端契约)。后端侧背景见 hermes-agent 仓库 `docs/architecture/mobile-hosted-collaboration.md`、`docs/architecture/hermes-studio-mobile-parity.md`。

## 0. 产品定位

Hermes iOS 是 hermes-agent 后端（主服务器）的**原生客户端**：App 内不内嵌 agent 运行时，账号、会话、任务状态、文件、通知全部由服务器持有；手机断开不拥有也不取消服务器任务（来源:hermes-agent/docs/architecture/mobile-hosted-collaboration.md）。技术栈：Expo SDK 54 + React Native 0.81 + 自研 Expo 原生模块（Swift），部署目标 iOS 18（来源:package.json、app.base.json:66-69）。默认服务器 `https://daxueshenmai.top`，可用 `EXPO_PUBLIC_HERMES_URL` 覆盖（来源:src/config.ts:20-22）。

---

## 1. 认证与会话（FR-AUTH）

### FR-AUTH-1 Owner 注册 / 密码登录

**需求描述**：登录页在启动时探测 `/auth/mobile/status`，据此进入两种模式之一：`registrationOpen=true` → 注册模式（邮箱 + 6 位验证码 + 用户名 + 密码），否则 `accountConfigured=true` → 登录模式；两者都不满足则报"Hermes owner account is unavailable"（来源:src/auth/mobile-auth.ts:265-269，src/auth/LoginScreen.tsx:76-171）。注册需先请求验证码（`/auth/mobile/registration-code`，返回 `expiresIn/resendAfter`，UI 做重发倒计时）。登录/注册均随请求上送设备身份（id/name/model/os_version/app_version，来源:src/auth/mobile-auth.ts:302-312、src/auth/device-identity.ts）。成功后获得 `{accessToken, refreshToken, expiresAt, deviceId, account}` 会话（strict 校验 `token_type=bearer` 等，来源:src/auth/mobile-auth.ts:271-300）。

**边界条件**：
- 验证码必须 6 位数字（客户端正则 `/^\d{6}$/`，来源:src/auth/mobile-auth.ts:107）。
- 邮箱统一 trim + 小写后上送。
- 登录成功 ≠ 完成：还必须通过 `/api/mobile/v1/handshake` 契约探针校验（`assertMobileHandshake`）后才持久化并进入已认证态（来源:src/auth/AuthProvider.tsx:314-323）。
- 认证请求 20s 超时；响应若带 final URL 则必须同源、无 userinfo（RN 常见空 `Response.url` 视为"未观察到重定向"而放行，来源:src/auth/mobile-auth.ts:314-330）。
- 记住密码开关（见 FR-AUTH-2）失败时自动回滚为不记住，登录本身不失败（来源:src/auth/AuthProvider.tsx:360-370）。

**错误处理**：`authenticationErrorMessage` 将状态码映射为中文文案：401→用户名或密码不正确；403→验证码错误/已过期/注册未开放；409→已有 owner 账号请登录；422→格式不符合要求；429→尝试次数过多；502/503→QQ 邮箱验证码服务未配置；HermesApiError 401/403→"登录成功但会话未被服务器接受"；404→"服务器未部署移动端接口"（来源:src/auth/AuthProvider.tsx:948-984）。错误详情做密钥脱敏并拒绝渲染 HTML 错误页（来源:src/auth/mobile-auth.ts:332-364）。

### FR-AUTH-2 Keychain 凭据存储（生物识别门）

**需求描述**：凭据全部存 expo-secure-store（iOS Keychain），键名带 `hermes.native.v2.` 前缀（v2 换名是为了让旧的带生物识别 ACL 的条目永远不会被原地更新而意外重新弹出认证 UI，来源:src/auth/credential-contract.ts:1-22）。分级保护：
- **refresh token**：设备可用生物识别时写入带 Face ID/Touch ID ACL 的条目（`requireAuthentication: true`，提示语"使用 Face ID 解锁 Hermes 连接"）；不可用则降级为设备解锁保护。实际采用哪种记录在**无保护的模式标志** `credentialProtection`（`biometric`|`device`）里，冷启动只读该标志即可决定是否要出解锁屏，不会误触发 Face ID（来源:src/auth/credential-store.ts:104-130、404-423，credential-contract.ts:15-22）。
- refresh token 每次都写入**新的随机键**（`hermes.native.v2.refreshToken.<uuid>`）+ 指针键，保证带 ACL 的条目从不被原地 update（写入不弹窗，只有读取弹窗），旧键写完后删除（来源:src/auth/credential-store.ts:263-276、436-446）。
- **access token / expiresAt / baseUrl / username / deviceId**：仅设备解锁保护，前台刷新永不弹窗（来源:src/auth/credential-store.ts:241-257 注释）。
- **记住的密码**：只允许写入带 Face ID ACL 的条目；无生物识别注册时拒绝保存并回滚偏好，绝不静默写明文副本；写前先删旧条目防止 keychain 搜索顺序里的无保护副本遮蔽（来源:src/auth/credential-store.ts:176-224）。读取密码（登录页"显示已存密码"）必须由显式用户操作触发（来源:src/auth/AuthProvider.tsx:511-523）。
- app.base.json 为 expo-secure-store 配置中文 Face ID 用途说明（faceIDPermission，来源:app.base.json:128-134），并由测试锁定（tests/native-v2-architecture.test.ts:143-148）。

**边界条件**：legacy（v1 无前缀名）条目在首次启动时**不读取值直接删除**（读取会弹 Face ID）；保存失败自动 `deleteAll` 回滚；`clearSession` 在"记住登录"开启时保留 username/密码条目，其余全清（来源:src/auth/credential-store.ts:71-95、359-402）。Access-group：Screen Time 共享密钥使用 keychain access group `group.app.sunstone1029.fig1171.hermes`（见 FR-CTX-1）；登录凭据本身未设置 access group（`kSecAttrAccessGroup` 仅出现于 Screen Time 密钥，来源:modules/hermes-ios-context/ios/HermesScreenTimeService.swift:263-268）。

**错误处理**：所有删除用 `Promise.allSettled`，任一 rejected 时 `clear`/`clearSession` 抛错并由上层提示"无法移除已保存的连接"（来源:src/auth/credential-store.ts:347-402，AuthProvider.tsx:109）。

### FR-AUTH-3 会话恢复（冷启动 / Face ID 解锁）

**需求描述**：冷启动只读无保护元数据（记住登录偏好 + 保护模式标志）。若 `credentialProtection=biometric` → 进入 `locked` 态展示解锁屏（refresh token 保持关闭）；解锁屏出现时自动触发一次 Face ID，之后重试都在显式按钮后面（来源:src/auth/AuthProvider.tsx:152-283、LoginScreen.tsx:119-126）。若为 `device` 保护 → 静默恢复。恢复路径统一走 `adoptSavedSession`：refresh 轮换 → **先持久化后继 token 再做 handshake**（防止 handshake 瞬断导致重放已消费 token 而吊销设备）→ 处理未完成的账号删除 → handshake 校验 → 激活原生 ownerScope（来源:src/auth/AuthProvider.tsx:858-923）。

**边界条件**：
- Face ID 失败预算：应用层最多 `MAX_FACE_ID_ATTEMPTS = 5` 次，超限清空已存会话，防陌生人反复探测（来源:src/auth/auth-state.ts:4、AuthProvider.tsx:417-431）。
- 取消 Face ID 不消耗次数；生物识别不可用/重新注册导致条目失效 → 立即降级为密码登录（来源:AuthProvider.tsx:408-443）。
- 保护标志存在但 baseUrl 缺失 = 部分擦除，直接清残留进入登录页（来源:AuthProvider.tsx:180-184）。
- refresh 返回的账号必须与保存的 username 一致，否则视为致命（"refreshed a different account"，来源:AuthProvider.tsx:870-872）。

**错误处理**：`savedSessionFailureInvalidatesCredentials` 定义失效判据——`MobileAuthApiError`/`HermesApiError` 且 4xx（排除 408/425/429），**或命中明文 baseUrl 终态判定 `savedSessionFailureIsCleartextBaseUrl`**（`HermesCleartextBaseUrlError` 实例 / `code === 'HERMES_CLEARTEXT_BASE_URL'` / 消息含 "base URL must use HTTPS outside local development"），或消息匹配 `refreshed a different account|incompatible mobile handshake`；命中则清会话并提示"登录已过期"；未命中（网络瞬断等）则保留凭据、5 秒后自动重试（来源:src/auth/session-restore-policy.ts:12-35，AuthProvider.tsx:107、145-151、256-262）。明文 baseUrl 单列终态的原因：HTTPS 加固会在请求出设备前就拒绝已保存的 `http://` baseUrl，重试永远不会改变判定——此前该错误被误判为瞬态，冷启动恢复无限重试，造成无 UI 出口的永久锁死（来源:session-restore-policy.ts:8-24 注释）。特殊终态：若本地存有"账号删除意图"（saga）且 refresh 被 401 拒绝，视为服务器删除已提交，完成本地擦除而不复活账号（来源:AuthProvider.tsx:229-255、843-849）。

### FR-AUTH-4 运行期 token 刷新

**需求描述**：`AccessTokenController` 实现 `HermesAccessTokenProvider`：到期前 60s 内或调用方 `forceRefresh` 时用 refresh token 换新对，单飞（in-flight 合并）、失败退避（`refreshBlockedUntil`），刷新成功先持久化再回调 `SESSION_REFRESHED`（来源:src/auth/access-token-controller.ts:17-60+，AuthProvider.tsx:602-657）。`HermesApiClient` 对 401 响应自动 `forceRefresh` 重试一次，携带 `rejectedToken` 防止旧 token 覆盖新 token（来源:src/api/HermesApiClient.ts:300-317）。refresh 401 → 使认证代数失效、清会话、派发 `SESSION_EXPIRED`（来源:AuthProvider.tsx:612-639）。

**边界条件**：token/设备 reducer 更新不重建 controller（重建会与 401 重试竞态）；会话切换用 `AuthLifecycleCoordinator` 代数号防陈旧操作写入（来源:AuthProvider.tsx:583-657）。

### FR-AUTH-5 服务器地址规则（HTTPS 强制）

**需求描述**：Bearer 流量禁止明文 HTTP 出本机。`normalizeBaseUrl` 要求：http/https、无 userinfo、必须是根 origin（path=/、无 query/hash）；`http:` 仅当 `cleartextHttpAllowed(hostname)` 为真——`localhost`、`*.localhost`、`::1`、`127.0.0.0/8`、`*.local`（mDNS），或 dev 构建显式设 `EXPO_PUBLIC_HERMES_ALLOW_HTTP=1`（来源:src/api/HermesApiClient.ts:41-82）。构建期 origin 覆盖 `EXPO_PUBLIC_HERMES_URL` 在模块加载时即做同一传输校验，违规直接 throw（来源:src/config.ts:6-22）。自定义模型 Base URL 另有更严规则：HTTP 仅限回环（不含 `.local`），见 FR-SET-2。

**错误处理**：违规抛专用错误类 `HermesCleartextBaseUrlError`（`name='HermesCleartextBaseUrlError'`，`code='HERMES_CLEARTEXT_BASE_URL'`，消息 "Hermes base URL must use HTTPS outside local development"，来源:src/api/HermesApiClient.ts:41-61、91）；构建期覆盖违规文案为 "EXPO_PUBLIC_HERMES_URL must use HTTPS outside local development"。该错误在会话恢复中被判为**终态**而非瞬态（见 FR-AUTH-3；来源:src/auth/session-restore-policy.ts:12-24）。tests/config.test.ts、tests/api-client.test.ts 锁定行为。

### FR-AUTH-6 登出与账号删除

**需求描述**：登出顺序：① DELETE 本设备 APNs 注册（2.5s deadline，失败忽略）→ ② `/auth/mobile/logout` 远端吊销（8s deadline、fire-and-forget）→ ③ 本地 `clearSession`（来源:src/auth/AuthProvider.tsx:706-747、925-946）。删除账号是 saga：`begin(ownerScope)` 持久化意图 → 服务器 `/api/plugins/ios-intelligence/account/delete` → `markRemoteDone` → 本地清理任务（原生 `deleteOwnerScope` + `purgeLocalAccountData`）→ `clear()` 全清 Keychain（来源:AuthProvider.tsx:749-791、833-842，src/context/IOSIntelligenceApi.ts:161-170，src/auth/local-account-cleanup-saga.ts）。

**边界条件**：产品边界——登出/会话过期**只清凭据**；Always 定位在进程存活期间继续采集，队列事件留在本地等下次认证后上传（来源:AuthProvider.tsx:727-731 注释）。服务器删除成功但后续本地步骤失败时，仍强制完成本地擦除并登出（来源:AuthProvider.tsx:769-783）。

**错误处理**：登出失败派发 `LOGOUT_FAILED` 且向调用方抛"无法移除已保存的连接，请重试。"（authenticated 分支故意保留会话身份以便 token controller 重建，来源:AuthProvider.tsx:736-747）。

---

## 2. 聊天与托管工作流（FR-CHAT）

聊天由 RN 实现，签名版 SwiftUI 局部前端明确**不**替换 chat。`src/studio/PreviewChatPage.tsx` 约 904 行，仅承担组合与页面级协调；索引、快照、SSE、乐观消息、发送、取消、介入、outbox、附件、滚动和展示分别位于 `src/studio/chat/` 的 controller/service/component 中（见 tests/chat-message-rendering.test.ts 与 tests/frontend-preview-source.test.ts）。

### FR-CHAT-1 会话索引与历史

**需求描述**：默认历史面只来自账号作用域的 collaboration 会话（`GET /single/conversations`）；旧部署的进程级 `/api/profiles/sessions` 不再合并。官方 CLI 会话可显式“收编”（adopt）为 collaboration 会话：拉 session 详情 + 消息 → 规范化 → `POST /single/conversations/adopt`；占位 id 格式 `official:v3:<profile>:<sessionId>:<fnv1a 校验和>`。会话索引、刷新与生命周期由 `useConversationIndexController`/`useConversationIndexLifecycle` 管理，刷新前先重放持久 outbox。本地缓存 AsyncStorage 采用 **v4 分片结构**：每 owner 一份小索引文档（`hermes.native.conversations.v4` 前缀）+ 每会话一行；写入“行先落、索引后落”，缺行/坏行只影响单会话并由云同步重建。实现分布在 `conversation-cache-repository.ts`、`conversation-cache-sync.ts` 与薄门面 `conversation-local-store.ts`；缓存仅作显示加速，服务器永远权威。

### FR-CHAT-2 发送一轮（hosted turn 入队）

**需求描述**：发送 = 乐观 user 消息 + 持久 outbox 项（AsyncStorage `hermes.native.hosted-turn-outbox.v1`）+ `POST /single/conversations/{id}/enqueue`，携带 `request_id`/`turn_id` 幂等键、最近消息窗口、附件 id/上下文。`useHostedSendController` 负责发起轮次，`hosted-turn-delivery-service` 负责附件和服务端交付，`useHostedOutboxReplayController` 负责恢复。响应含路由决策（`chat|work`）；`work` 模式进入协作态（`lifting` → 持久化 workflow 进展或协作角色消息出现后提升为 `active`）。

**边界条件**：
- 乐观消息按 id/内容与服务器消息对账，确认后仍保留 2 分钟宽限（`OPTIMISTIC_CONFIRMATION_GRACE_MS`）防副本回退闪烁（来源:chat-view-model.ts:344-404）。
- 服务器未确认任务启动时显示合成失败消息"服务器没有确认任务已启动…"（`hostedTurnVisibilityFailure`），一旦轮次在权威会话中出现即撤下（来源:chat-view-model.ts:97-126、830-843）。
- 新鲜度窗口：runtime run 30 分钟、hosted turn 36 小时；超窗的 `running` 状态在视图层判为 `failed`（来源:HermesCloudApi.ts:7-8、runningConversationRecordIsFresh:1931-1950，chat-view-model.ts:481-511）。
- 模型未配置时发送前置拦截，提示去"模型与工具"配置（`chatModelConfigurationError`，来源:chat-view-model.ts:291-324）。

**错误处理**：入队失败落 outbox 重放；可重试错误码集合 `RETRYABLE_TURN_ERROR_CODES`（http_5xx/model_timeout/model_empty_response/model_not_configured/hosted_turn_failed 等）+ 消息正则（超时/bad gateway/未配置/繁忙）驱动"重试"按钮（来源:chat-view-model.ts:723-758）。

### FR-CHAT-3 实时更新：SSE 主通道 + 轮询兜底

**需求描述**：活跃会话有运行中工作时打开 `GET /single/conversations/{id}/hosted-events`（SSE，`Accept: text/event-stream`，经 `expo/fetch` 流式实现）。只消费 `event: conversation` 帧，data 为 `{conversation, cursor}`，cursor 单调递增并按会话续传。`useHostedConversationStream` 管理前后台、重连和 cursor；`useConversationSnapshotController` 提供快照轮询兜底。流健康 15s 一次快照、断流 1s 一次、单次 20s 超时；断线 1.5s 重连；App 进入后台时暂停流并中止。

**边界条件**：SSE 响应 Content-Type 非 `text/event-stream` 视为协议错误；应用回前台立即重连并刷新（来源:HermesApiClient.openEventStream、useHostedConversationStream）。本地缓存永不作为权威。

### FR-CHAT-4 托管群聊时间线（多角色）

**需求描述**：collaboration 消息投影为视图消息：角色阶段归一化为 `chat|dispatcher|worker|reviewer|supervisor|reporter`；`dbb3-manager` profile 显示名固定"Hermes 调度员"（英文 Hermes Manager），worker/审阅员/汇报员等均有中英显示名与阶段标签；头像角色按 profile 关键字（dbb3/pc/wsl/review/监督）推断（来源:chat-view-model.ts:406-591、1140-1282）。活动（activities）从 message.activities/meta 的 tool_calls/reasoning/searches/files/commands 等多源合并、按 id 去重合并、按时间排序，分类为 reasoning/search/file/command/model/mcp/skill/subagent/handoff/status（来源:chat-view-model.ts:951-1263）。计时标签：进行中 chat 阶段显示"正在思考/正在执行/正在重连 (n/5)"（重连计数从运行状态活动文本解析），终态显示耗时（来源:chat-view-model.ts:513-547、1314-1331）。

**边界条件**：`kind === 'route'` 消息不渲染；同 turn 的 chat 进度消息（opening/progress/milestone）在终态后隐藏，最终 chat 消息只保留最新一条；cancelled turn 隐藏其 chat 消息；60s 窗口内同 turn 同内容的 assistant 消息去重（来源:chat-view-model.ts:135-289、1087-1126）。取消（`POST .../hosted-turns/{turnId}/cancel`）与运行中介入（`POST .../interventions`）均可用（来源:HermesCloudApi.ts:1547-1579）。

### FR-CHAT-5 附件生命周期（选取→加密暂存→上传→重试→清理）

**需求描述**：
1. **选取**：`useChatAttachmentController` 统一调用 expo-image-picker / expo-document-picker；来自 App 缓存目录的临时文件标记 `ownedTemporary`。
2. **体积闸**：声明大小或实测大小 > 64MB（`MAX_CONVERSATION_ATTACHMENT_BYTES`）的拒收并提示（来源:src/api/attachment-size-policy.ts、useChatAttachmentController.ts）。
3. **加密暂存**：`chat-attachments.ts` 的 `persistPendingAttachments` 把每个附件经原生 `HermesIOSContext.encryptAttachment` 写为 `.hermes-encrypted` 信封，落在 `<Application Support>/hermes-outbox/owner-<sha256(owner)>/<requestId>/`；失败整体回滚已写目标。
4. **原生保险库规则**（HermesAttachmentVault.swift）：AES.GCM 密封，`HATTV001` magic + combined box，AAD 绑定 owner（`hermes-attachment-v1\0<owner>`）；每 owner 一把 32 字节随机密钥存 Keychain（`app.hermes.attachment-vault.v1`，AfterFirstUnlockThisDeviceOnly）；**允许的加密源仅限**：Caches、NSTemporaryDirectory、新旧 outbox 根（防被劫持的 JS 用它外带任意容器文件）；目标必须是 outbox 根后代；**后代判定先解析双方 symlink 再按路径分量比较**（防 /var vs /private/var 差异与树内 symlink 逃逸，也防 `/rootX` 匹配 `/root` 前缀）；文件 `completeFileProtection` + 排除 iCloud 备份（来源:modules/hermes-ios-context/ios/HermesAttachmentVault.swift:23-67、186-198、336-351）。
5. **上传**：解密到 Caches 下一次性明文（`withDecryptedAttachment` 用后即删；进程启动时清空整个明文缓存目录）→ raw body POST `/single/conversations/{id}/attachments`，头 `Content-Type`/`X-Filename`(URI 编码)/`X-Upload-ID`/`X-Message-ID`/`X-Profile`/`X-Turn-ID`（来源:attachment-outbox-crypto.ts:26-43，HermesAttachmentVault.swift:14-21、69-109，HermesCloudApi.ts:1581-1604）。
6. **重试/清理**：outbox 项含附件计划，重放时目标已存在则跳过加密；成功或终态后删除请求目录并清理自有临时源；旧版 Documents 根的记录经 `remapLegacyOutboxUri` 重指向（来源:hosted-turn-delivery-service.ts、attachment-outbox-root.ts、attachment-draft-lifecycle.ts）。

**边界条件**：outbox 放 Application Support 而非 Documents，因为 `UIFileSharingEnabled=true` 会把 Documents 暴露进"文件"App；旧 Documents outbox 一次性迁移、失败可重试（来源:HermesAttachmentVault.swift:167-231）。owner 注销/删号后密钥进入 revoked 墓碑，加解密均拒绝（`ownerRevoked`），重新登录 `activate` 解除（来源:HermesAttachmentVault.swift:121-160、249-270）。下载附件 URL 必须以 `/api/plugins/collaboration/single/conversations/` 开头，否则拒绝（来源:HermesCloudApi.ts:1606-1611）。

**错误处理**：`File must be 64 MB or smaller: <name>`；加密失败回滚；解密后上传失败保留加密信封供重试。

### FR-CHAT-6 会话操作（分叉/压缩/改名/删除）

**需求描述**：按消息分叉 `POST /mobile/conversations/{id}/messages/{messageId}/fork`（幂等键必传）、压缩 `POST /mobile/conversations/{id}/compress`（focus_topic 可选）、session-state 提供 lineage 与可分叉点；改名 PATCH、删除 DELETE `single/conversations/{id}`（来源:HermesCloudApi.ts:1368-1405、1450-1463）。SwiftUI sessions 路由亦暴露 rename/delete/compress 动作并同步修剪本地缓存（来源:src/app/useHermesSwiftUIRouteData.ts:386-410）。

---

## 3. 设备上下文能力（FR-CTX）

原生能力全部经唯一 Expo 模块 `HermesIOSContext` 暴露（60+ 个 AsyncFunction，来源:modules/hermes-ios-context/ios/HermesIOSContextModule.swift:40-516，modules/hermes-ios-context/index.ts:110-398）。权限文案集中在 app.base.json infoPlist（中文，来源:app.base.json:32-44）。

### FR-CTX-1 Screen Time / DeviceActivity（含 AES.GCM 密封交接）

**需求描述**：能力探测（entitlement `com.apple.developer.family-controls` + FamilyControls 框架可用性）→ `requestScreenTimeAuthorization`（individual）→ `startScreenTimeMonitoring(identifier, startHour, endHour)` 建 `DeviceActivitySchedule`（小时钳制 0-23/0-24，24 视为 23:59:59，repeats）（来源:modules/hermes-ios-context/ios/HermesScreenTimeService.swift:16-155）。两个 App Extension 产生数据：
- `HermesDeviceActivityMonitor`（interval-start/interval-end/threshold 回调）→ 事件（来源:native-extensions/HermesDeviceActivityMonitor/HermesDeviceActivityMonitor.swift:10-37）。
- `HermesDeviceActivityReport`（DeviceActivityReport 扩展）→ 当日总时长摘要（来源:native-extensions/HermesDeviceActivityReport/HermesDeviceActivityReport.swift:30-60）。RN 侧经 `HermesScreenTimeReportView` 原生视图展示（来源:index.ts:429-501）。

**密封规则（安全关键）**：扩展与主 App 经 App Group UserDefaults（`group.app.sunstone1029.fig1171.hermes`）交接，而共享 plist 在磁盘上是明文——因此扩展**只允许写 AES.GCM 密封信封**（base64(combined)，AAD `hermes-screen-time-v1`）；32 字节密钥放共享 Keychain access group（service `app.hermes.screen-time` / account `shared-activity-key-v1`），**只由主 App provision**（每次 arm 监控/设置 generation 时），扩展绝不创建，密钥缺失时回调直接丢弃（来源:HermesDeviceActivityMonitor.swift:31-68，HermesDeviceActivityReport.swift:45-90，HermesScreenTimeService.swift:109-115、242-296）。主 App 持"打开"半边：解封 → 按 `accountGeneration` 过滤跨账号残留 → 批量入上下文队列 → **精确删除已消费的记录**（比对 identity，避免抹掉持久化期间扩展新写的回调；无法解码的异形/撕裂信封随批丢弃）（来源:HermesScreenTimeService.swift:24-107）。

**边界条件**：事件保留上限：扩展侧 500 条、快照返回最近 100 条；`stopAllMonitoring` 清 identifiers/events/summary；账号切换 bump generation 使旧数据不再被消费（来源:HermesScreenTimeService.swift:34、168-181，HermesDeviceActivityMonitor.swift:36）。预密封时代的裸字典事件可一次性排干（来源:HermesScreenTimeService.swift:85-98）。

**错误处理**：无 entitlement → `entitlement-required`；未授权 → `permissionRequired` 抛错；授权失败返回 `denied`（来源:HermesScreenTimeService.swift:117-155、217-229）。

### FR-CTX-2 上下文事件队列（owner-scope 硬门）

**需求描述**：所有设备事件（location/motion/place-visit/power/health/screen-time…）进入 `HermesContextEventQueue`：AES.GCM 加密的 append-only 日志 `<Application Support>/HermesContext/pending-events.encjsonl`（每行 base64 信封），密钥在 Keychain（service `app.hermes.ios-context`），文件保护 `completeUntilFirstUserAuthentication`（后台唤醒可写）（来源:modules/hermes-ios-context/ios/HermesContextEventQueue.swift:15-30、485-575、647-716）。**required-scope 规则**：读取与确认（`read`/`acknowledge`）必须携带**当前活跃 ownerScope**，陈旧或外来 scope 一律排空为 0；跨 scope 清理只能走显式 `deleteOwnerScope` 生命周期（来源:HermesContextEventQueue.swift:151-183 注释，index.ts:296-304 注释）。入队要求：未 suspend、ownerScope 非空、事件 generation 与当前一致、时间戳不早于 generation 开始时间（来源:HermesContextEventQueue.swift:59-149）。

**边界条件**：`activateOwnerScope`（登录/恢复时调用）从删除墓碑集合移除该 scope，scope 变化或曾 suspend 时 generation+1；`deleteOwnerScope` 删除事件/待执行命令/游标/执行结果，若删的是当前 scope 则 suspend 采集、清 relay wakes、记墓碑，且带 `requestedAt` 早于当前 generation 的请求被忽略（防陈旧删除，来源:HermesContextEventQueue.swift:241-385）。写失败的事件进入内存 deferred 列表随后重试；解不开的行隔离到 `pending-events-corrupt-<ts>.encjsonl`（来源:HermesContextEventQueue.swift:498-582、626-631）。命令通道（服务器下发的设备命令）游标/完成集/执行结果全部按 scope 分桶（来源:HermesContextEventQueue.swift:185-483）。

**错误处理**：批量入队部分失败抛 `persistenceFailed`（调用方如 Screen Time 消费者据此不删除共享区源记录，保证不丢——来源:HermesScreenTimeService.swift:61-62）。

### FR-CTX-3 位置/运动/健康/日历/提醒/Watch/电量

**需求描述**：自适应定位（`startAdaptiveLocation`、visit 监测、预测出发时间 `setPredictedDeparture`）、运动状态、HealthKit 摘要（心率/血氧/睡眠/步数/锻炼等）、EventKit 日历与提醒（读 + 显式命令创建 `createCalendarEventForCommand` 等幂等变体）、共享到备忘录、WatchConnectivity 快照/消息、电量/散热/磁盘快照（来源:modules/hermes-ios-context/index.ts:127-246 接口全表；各 `Hermes*Service.swift`）。事件经 `IOSContextProvider` 聚合上传（见 FR-CTX-5）。地图页 Smart Weather 使用 MapKit（默认）或 AMap（需配置 key + 隐私同意，`HermesStandardMap` 模块，来源:index.ts:249-267、442-458）。`待确认`：各 service 内部采样/节流参数（本轮未逐行读 HermesLocationService.swift 等）。

### FR-CTX-4 后台任务与 relay wakes

**需求描述**：BGTaskScheduler 注册两个标识 `…hermes.context-refresh` / `…hermes.context-processing`（app.base.json:53-56）；UIBackgroundModes：fetch/location/processing/remote-notification（app.base.json:47-52）。后台唤醒记录为持久 relay wake（存加密 relay-state.enc，上限 100 条），原生后台启动可在 JS 订阅挂上之前排空；JS 用 `listPendingRelayWakes`/`completeBackgroundRelay` 收尾（来源:HermesContextEventQueue.swift:195-239，index.ts:370-373、394-397）。

### FR-CTX-5 上行/下行（ios-intelligence 插件 API）

**需求描述**：事件批量上传 `POST /api/plugins/ios-intelligence/events/batch`（cursor + device_id + timezone，响应 accepted/duplicates/next_cursor）；能力上报 `/capabilities`；设备命令 `POST /commands/pull`（limit 50）+ `POST /commands/{id}/ack`（completed|failed）；快照 `GET /snapshot?timezone=`；行为评估 `/evaluate`、反馈 `/feedback`；账号导出（加密 blob）与删除（来源:src/context/IOSIntelligenceApi.ts:71-179）。命令执行结果/完成游标在原生侧按 scope 持久化以实现幂等（FR-CTX-2）。

---

## 4. 设置 / 主题 / 模型管理（FR-SET）

### FR-SET-1 主题与字体

**需求描述**：主题清单来自服务器 `GET /api/dashboard/themes`（公开端点），选择经 `PUT /api/dashboard/theme`、字体经 `GET/PUT /api/dashboard/font`；本地偏好持久化 AsyncStorage `hermes-dashboard-theme` / `hermes-dashboard-font`（来源:src/design/theme-api.ts:10-36，theme-store.ts:1-32）。主题体系把 WebUI/Studio 主题快照冻结进源码（theme-presets.ts），派生原生语义色、密度、显示字体，服务器与本地状态经 theme-reconciliation 合并；SwiftUI 页面经 `swiftUIThemeProps` 继承同一主题（禁止固定 palette，tests/swiftui-partial-frontend-source.test.ts:316-347）。设计契约由 tests/design-contract.test.ts 与 tests/theme-*.test.ts 锁定（快照逐色相等）。预览模式外观持久化仅限 theme 与 font 两键（tests/frontend-preview-source.test.ts）。

**边界条件**：字体目录 50 个字面（7 UI + 40 Google + 3 terminal），bundle、许可、hash 全部被 tests/native-font-assets.test.ts / tests/webui-fonts.test.ts 钉死；新增字体必须同步 scripts/font-sources.json 与生成目录。

### FR-SET-2 模型管理

**需求描述**：模型页数据 = `/api/model/info` + `/api/model/options?include_unconfigured=1` + `/api/model/custom` 三合一（`getModels`）。自定义模型：保存 `PUT /api/model/custom`（api_key/api_mode/base_url/context_length/model/reasoning_effort/profile）、连通性测试 `POST /api/model/custom/test`、模型发现 `POST /api/model/custom/discover`；正式选型 `POST /api/model/set`（scope=main），昂贵模型服务器可返回 `confirm_required` + 文案，客户端确认后携 `confirm_expensive_model=true` 重发（来源:src/api/HermesCloudApi.ts:608-706）。凭据清单/删除：`/api/model/credentials`（来源:HermesCloudApi.ts:970-981）。RN 页面 `ModelsManagementPage` 与 SwiftUI models 路由共用这些方法；字段归一化（`customApiMode`/`customReasoningEffort` 未知值回退 chat_completions/medium）**只在 HermesCloudApi 一处**，路由层禁止复制（tests/swiftui-partial-frontend-source.test.ts:160-164，HermesCloudApi.ts:1952-1967）。

**边界条件**：Base URL 规范化：去尾斜杠、剥 query/hash、拒绝 userinfo；**HTTP 仅限本机回环**（localhost/*.localhost/::1/127.x），局域网或公网必须 HTTPS——文案"HTTP 模型地址仅限本机回环；局域网或公网模型必须使用 HTTPS"（来源:HermesCloudApi.ts:1969-1999）。

**错误处理**：`setModel` 非 ok 且非 confirmRequired 时抛服务器 detail；SwiftUI 侧模型操作有 running/success/error 三态 operation 快照与本地化文案（来源:useHermesSwiftUIRouteData.ts:281-294、473-500）。

### FR-SET-3 其余设置面（SwiftUI 路由）

**需求描述**：config（深合并 `PUT /api/config`，stream_output/auto_compact 等开关即时写回）、env 凭据（列表 + 删除；**environmentUpsert 已被移除**，禁止回加——tests/swiftui-partial-frontend-source.test.ts:165-167）、profiles（创建/激活/删除/SOUL.md 编辑）、cron、skills（含内容编辑 `PUT /api/skills/content`）、plugins/mcp/channels/webhooks（integration 系列动作）、pairing、system（重启网关/恢复托管节点/更新 Hermes；离线时数据过期标注而非编造指标）、files（文件导入走 security-scoped resource + NSFileCoordinator staged import）、kanban、collaboration 房间、workflows（start/cancel/retry/approve，均带 Idempotency-Key）、approvals（见 API 契约 409 语义）、runtime-center（来源:src/app/hermes-route-data.ts:144-505 动作分发表，swiftui-route-contract.ts:466-527 动作枚举）。

### FR-SET-4 记忆页

**需求描述**：读取/保存 MEMORY.md、SOUL.md、USER.md 三段：`GET/PUT /api/hermes/memory`（section=memory|soul|user；产品后端已实现并加入契约测试）（来源:HermesCloudApi.ts、src/studio/PreviewMemoryPage.tsx）。

---

## 5. 国际化（FR-I18N）

**需求描述**：产品语言以中文为主（`CFBundleDevelopmentRegion: zh_CN`、`CFBundleAllowMixedLocalizations`，app.base.json:27-28）。机制分三层：
1. **路由/骨架标签**：`route-composition` 每个条目携带 `labels: Record<'en'|'zh', string>`，按 locale 取值（来源:src/app/route-composition.ts:124-164、306-357）。
2. **控件文案**：`NativeLocalizationProvider` 提供 `t()`：查 `ZH_TRANSLATIONS` 字典 → 动态模式（如 `Reveal X`→`显示 X`）→ 已含非 ASCII 原样 → PRESERVE_PATTERNS 保留（来源:src/i18n/NativeLocalization.tsx:462-502）。预览版额外合并 `PREVIEW_ZH_TRANSLATIONS`（生产构建被 metro 替换为空模块，见 ARCHITECTURE.md §7）。
3. **服务器内容**：服务器返回的英文名/描述经 `hermes-server-content-zh.ts` 本地化（integration 名称、描述、通用文本，tests/hermes-server-content-zh.test.ts 锁定）。

**边界条件**：SwiftUI 路由动作把 locale 传入数据层（`performHermesSwiftUIRouteAction(..., locale === 'zh')`），队列过期通知等提示必须双语（tests/swiftui-partial-frontend-source.test.ts:445-449）。预览壳默认 `locale='zh'`（来源:src/studio/FrontendPreviewApp.tsx:130）。`待确认`：locale 的用户切换入口与持久化键（本轮只确认了 FrontendPreviewApp 内 state 与 NativeShell 透传）。

---

## 6. 通知（FR-NOTIF）

**需求描述**：APNs：设备登记 `PUT /api/mobile/v1/devices/{deviceId}/apns`（限当前设备）、注销 DELETE 同路径（登出前 2.5s deadline 尝试）、设备清单 `GET /api/mobile/v1/devices`（来源:src/notifications/mobile-notifications.ts、AuthProvider.tsx）。通知点开携带 conversationId 时，经 `notificationTarget` 交给 `useConversationIndexController` 定向打开该会话。本地通知/Live Activity 经原生模块（`scheduleLocalNotification`/`updateLiveActivity`，`NSSupportsLiveActivities=true`）。aps-environment=production（app.base.json:17）。

---

## 7. 非功能需求（NFR）

| # | 要求 | 依据 |
|---|---|---|
| NFR-1 | 全部业务请求 30s deadline（认证 20s），SSE 除外；AbortSignal 全链路可取消 | src/api/HermesApiClient.ts:7、454-486，mobile-auth.ts:64 |
| NFR-2 | 凭据绝不进入 URL（多重编码检测）、错误详情脱敏、HTML 错误页不入 UI | HermesApiClient.ts:251-270、383-448 |
| NFR-3 | 响应重定向终点必须同源且无 userinfo（RN 空 Response.url 放行） | HermesApiClient.ts:334-353 |
| NFR-4 | 无 WebView 运行时（禁止 react-native-webview/WKWebView/DOM/iframe） | tests/native-v2-architecture.test.ts:20-39 |
| NFR-5 | ProMotion：原生帧率控制器（CADisplayLink + CAFrameRateRange），UI 线程动画 | tests/swiftui-partial-frontend-source.test.ts:200-231，tests/native-shell-source.test.ts |
| NFR-6 | 触达目标 ≥44pt、键盘先于导航收起、Reduce Motion 由产品决定不自动降级 | tests/native-shell-source.test.ts、tests/frontend-preview-source.test.ts |
| NFR-7 | 生产 bundle 禁运完整 PEM 私钥；必须包含关键 marker（见 ARCHITECTURE.md §7） | tests/production-artifact-contract.test.ts:10-50，scripts/verify-production-bundle.mjs |
| NFR-8 | 断网/杀进程不丢用户输入：hosted-turn/房间消息/介入三类持久 outbox + 乐观消息账本 | conversation-local-store.ts:12-22 |
