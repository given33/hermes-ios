# Hermes iOS ⇄ hermes-agent — 前后端接口契约（API-CONTRACT）

按 2026-07-26 iOS 代码实况逐方法枚举 App **实际调用**的端点（非设计稿）。主要来源：`src/api/HermesCloudApi.ts`（云门面）、`src/auth/mobile-auth.ts`（认证面）、`src/api/HermesApiClient.ts`（传输）、`src/design/theme-api.ts`、`src/context/IOSIntelligenceApi.ts`、`src/notifications/mobile-notifications.ts`。已与后端仓库 `hermes-agent/docs/spec/API-HTTP.md`（同日版本）逐条对照；不一致处标 **⚠️未对齐**，后端文档声明不在其范围内的插件面标 **文档未覆盖**。

## 0. 通用传输约定（客户端侧强制）

| 约定 | 内容 | 来源 |
|---|---|---|
| Base URL | 根 origin，无 userinfo；HTTPS 强制，明文 HTTP 仅限 loopback/`*.localhost`/`*.local` 或 `EXPO_PUBLIC_HERMES_ALLOW_HTTP=1`；违规抛 `HermesCleartextBaseUrlError`(code `HERMES_CLEARTEXT_BASE_URL`) | HermesApiClient.ts:41-99 |
| 认证 | 除 §1 认证面外全部 `Authorization: Bearer <access_token>`（后端把 mobile token provider 注册到 `/api` 前缀，scope `dashboard:admin`，见 API-HTTP.md §2.1） | HermesApiClient.ts:321-332 |
| 401 语义 | 收到 401 → 用 refresh token 换新（携 `rejectedToken` 防回退）→ **重试一次**；refresh 本身 401 → 会话过期登出 | HermesApiClient.ts:300-318，AuthProvider.tsx:612-639 |
| 超时 | 业务 30s（`HERMES_REQUEST_DEADLINE_MS`），认证面 20s；SSE 无 deadline 只受 AbortSignal | HermesApiClient.ts:7，mobile-auth.ts:64 |
| profile 参数 | `HermesRequestOptions.profile` 统一以 query `?profile=` 附加 | HermesApiClient.ts:127 |
| 同源 | 请求 URL 与响应终点（若 runtime 报告）必须同 origin；凭据出现在 URL 任何组件即拒发 | HermesApiClient.ts:237-270、334-353 |
| 错误细节 | 优先 JSON `detail`/`error`/`message`；HTML 错误页不透出；密钥脱敏；240 字截断 | HermesApiClient.ts:383-404 |
| 幂等 | 写操作用 `Idempotency-Key` 头 + body `request_id`/`idempotency_key`（生成器 `newClientRequestId(prefix)`） | HermesCloudApi.ts:1786-1792 |

## 1. 移动认证面（无 Bearer；`src/auth/mobile-auth.ts`）

对齐 API-HTTP.md §2.6（`dashboard_auth/owner_mobile.py`）。

| 方法 | HTTP | 请求要点 | 响应要点 | 错误语义（客户端处理） |
|---|---|---|---|---|
| `getStatus` | GET `/auth/mobile/status` | — | `{registration_open, account_configured, email_verification_required, owner_email_configured}`（4 个 bool 严格校验） | 非法形状抛 invalid status |
| `requestRegistrationCode` | POST `/auth/mobile/registration-code` | `{email}`(小写) | `{ok:true, expires_in>0, resend_after≥0}` | 429 限流→提示稍后；502/503→邮箱服务未配置 |
| `register` | POST `/auth/mobile/register` | `{email, verification_code(6位), username, password, device{id,name,model,os_version,app_version}}` | 会话对象（同下） | 403 验证码/注册关闭；409 已有 owner；422 格式 |
| `login` | POST `/auth/mobile/token` | `{username, password, device}` | `{access_token, refresh_token, token_type:'bearer', expires_at, device_id, account{username,display_name}}` 严格校验 | 401 密码错；429 限流 |
| `refresh` | POST `/auth/mobile/refresh` | `{refresh_token}` | 同上（**refresh token 轮换**：客户端先持久化后继再 handshake） | 401 → 会话失效（或触发删号终态判定） |
| `logout` | POST `/auth/mobile/logout` | `{refresh_token}` + 可选 Bearer | `{ok,revoked}` | 失败忽略（本地登出必须完成） |

## 2. 设备/握手/APNs（Bearer）

对齐 API-HTTP.md §2.6。

| 客户端调用点 | HTTP | 要点 |
|---|---|---|
| 登录/恢复后的契约探针 `assertMobileHandshake` | GET `/api/mobile/v1/handshake` | `{api_version, hermes_version, profiles, capabilities, …}`；形状不符 → "incompatible mobile handshake"（判终态失效）。来源:AuthProvider.tsx:314-323、908-914，hermes-types.ts |
| 设备清单 | GET `/api/mobile/v1/devices` | `{devices:[…]}`；找当前 device 判断 APNs 状态。来源:mobile-notifications.ts:53-58 |
| APNs 登记 | PUT `/api/mobile/v1/devices/{deviceId}/apns` | 限当前设备；403/422/404 见后端文档。来源:mobile-notifications.ts:72 |
| APNs 注销 | DELETE 同路径 | 登出前 2.5s deadline 尽力执行。来源:AuthProvider.tsx:925-946 |

## 3. Dashboard 域（`HermesCloudApi`，全部 Bearer）

### 3.1 会话（官方 CLI 会话，只读 + 收编用）

| 方法 | HTTP | 请求要点 | 响应要点 |
|---|---|---|---|
| `getStatus` | GET `/api/status` | — | 服务器存活/版本（公开端点） |
| `getSessions` / `getAllSessions` | GET `/api/sessions` | `limit,offset,order=recent,?profile`（自动翻页） | `PaginatedSessions` |
| `getProfileSessions` / `getAll…` | GET `/api/profiles/sessions` | `profile=all,archived=exclude,min_messages=0` | 跨 profile 合并列表 |
| `getSession` | GET `/api/sessions/{id}` | `?profile` | 会话详情；404 |
| `getSessionMessages` | GET `/api/sessions/{id}/messages` | `?profile` | `{session_id, messages[]}` |
| `renameSession` | PATCH `/api/sessions/{id}` | `{title, profile}` | `{ok,title}`；404/400 |
| `deleteSession` | DELETE `/api/sessions/{id}` | `?profile` | `{ok}`（幂等） |

### 3.2 托管文件区 `/api/files`

`listFiles` GET `/api/files?path=`；`readFile` GET `/api/files/read?path=`；`createDirectory` POST `/api/files/mkdir` `{path}`；`deleteFile` DELETE `/api/files` `{path,recursive}`；`downloadManagedFile` GET `/api/files/download?path=`（blob）；`uploadManagedFile` POST `/api/files/upload-stream`（multipart `path/overwrite/file`）。错误：400/403/404/409/413（来源:HermesCloudApi.ts:561-599；对齐 API-HTTP.md §2.10 托管文件）。

### 3.3 模型

| 方法 | HTTP | 请求要点 | 响应要点/错误 |
|---|---|---|---|
| `getModelInfo` | GET `/api/model/info` | `?profile` | 当前 provider/model/上下文长度（公开） |
| `getModelOptions` | GET `/api/model/options` | `?profile&include_unconfigured=1` | providers[]（含认证态/定价/能力）；后端已实现并测试该参数，用于返回未配置 provider 骨架 |
| `getCustomModel` | GET `/api/model/custom` | `?profile` | api_key 掩码形式（`api_key_configured`/`api_key_preview`） |
| `saveCustomModel` | PUT `/api/model/custom` | `{api_key,api_mode,base_url,context_length,model,reasoning_effort,profile}`；base_url 客户端先规范化（HTTP 仅回环） | — |
| `testCustomModel` | POST `/api/model/custom/test` | 同上子集 | `{ok,reachable,status,latency_ms,message}` |
| `discoverCustomModels` | POST `/api/model/custom/discover` | `{api_key,base_url,profile}` | `{models[],ok,reachable,…}`（后端做 SSRF 校验） |
| `setModel` | POST `/api/model/set` | `{provider,model,scope:'main',confirm_expensive_model}` `?profile` | `confirm_required=true` 时客户端弹确认后重发；非 ok 且非 confirm → 抛 detail |
| `getModelCredentials` | GET `/api/model/credentials` | `?profile` | `{credentials[]}` |
| `deleteModelCredential` | DELETE `/api/model/credentials/{id}` | `?profile` | `{ok,removed}` |

### 3.4 配置 / 环境变量 / Profiles

- `getConfig` = GET `/api/config`(+`?profile`) ∥ GET `/api/config/defaults` ∥ GET `/api/config/schema`（后两个公开）；`saveConfig` PUT `/api/config` `{config}`（深合并）。
- `getEnvironment` GET `/api/env?profile=`（值脱敏）；`setEnvironmentVariable` PUT `/api/env` `{key,value,profile}`；`deleteEnvironmentVariable` DELETE `/api/env` `{key,profile}`（JSON body）。
- Profiles：GET `/api/profiles` + GET `/api/profiles/active`（并为每个 profile 顺带 GET `/{name}/soul` 补 soul 内容，单个失败忽略）；POST `/api/profiles`；POST `/api/profiles/active` `{name}`；DELETE `/api/profiles/{name}`；GET/PUT `/api/profiles/{name}/soul` `{content}`（来源:HermesCloudApi.ts:901-968；对齐 §2.10）。

### 3.5 Cron

GET `/api/cron/jobs?profile=`（默认 `all`）；POST `/api/cron/jobs`；**PUT** `/api/cron/jobs/{id}` body `{updates:{…}}`；POST `…/{id}/pause|resume|trigger`;DELETE `…/{id}`（全部带 `?profile=`）。对齐 §2.9（注意后端 dashboard 面是 PUT + `/trigger`，gateway 面才是 PATCH + `/run`——iOS 走 dashboard 面，正确）；`CronJobUpdate.updates` 已由后端源码和测试确认。

### 3.6 Skills / Plugins / MCP / 托管安装

- Skills：GET `/api/skills?profile=` ∥ GET `/api/tools/toolsets` ∥ 托管安装单；PUT `/api/skills/toggle` `{name,enabled,profile}`；GET/PUT `/api/skills/content`（query `name,profile` / body `{name,content,profile}`）。
- Plugins：GET `/api/dashboard/plugins`（公开，仅已启用清单）∥ GET `/api/dashboard/plugins/hub`（Token）；启停 POST `/api/dashboard/agent-plugins/{name}/enable|disable`。
- MCP：GET `/api/mcp/servers?profile=` ∥ GET `/api/mcp/catalog`；POST `/api/mcp/servers`；PUT `/api/mcp/servers/{name}/enabled` `{enabled}`；DELETE `/api/mcp/servers/{name}`。
- 托管安装：GET `/api/managed-installations?kind=&profile=&limit=`；POST `/api/managed-installations` `{identifier,kind:mcp|project|skill,locality?,scope?,targets?,request_id}` → 202 `{accepted,operation}`（skills/mcp 页 2s 轮询安装态）。
（来源:HermesCloudApi.ts:755-848；对齐 §2.10。）

### 3.7 配对 / 渠道 / Webhooks

Pairing：GET `/api/pairing`；POST `/api/pairing/approve` `{platform,code}` / `/revoke` `{platform,user_id}` / `/clear-pending`。渠道：GET `/api/messaging/platforms?profile=`；PUT `/api/messaging/platforms/{id}`（409=冲突）。Webhooks：GET/POST `/api/webhooks`；PUT `/api/webhooks/{name}/enabled` `{enabled}`；DELETE `/api/webhooks/{name}`（来源:HermesCloudApi.ts:850-899；对齐 §2.10）。

### 3.8 系统 / 托管节点 / 网关 / 日志 / 分析

`getSystem` = GET `/api/status` ∥ `/api/system/stats` ∥ `/api/managed-nodes/status`；`recoverManagedNodes` POST `/api/managed-nodes/recover` `{node_id}`；`restartGateway` POST `/api/gateway/restart`；`updateHermes` POST `/api/hermes/update`（容器内禁用→由错误文案透出）；`getLogs` GET `/api/logs?lines&level&component`；`getAnalytics` GET `/api/analytics/usage` ∥ `/api/analytics/models`（`?days&profile`）（来源:HermesCloudApi.ts:601-606、983-1003、708-716；对齐 §2.10）。

### 3.9 主题 / 字体（`src/design/theme-api.ts`）

GET `/api/dashboard/themes`（公开）；PUT `/api/dashboard/theme` `{name}`；GET/PUT `/api/dashboard/font` `{font}`（对齐 §2.10 Dashboard UI）。

### 3.10 记忆（Studio 三段式）

`getStudioMemory` GET **`/api/hermes/memory`** `?profile`；`saveStudioMemory` PUT 同路径 `{section: memory|soul|user, content}`，响应含 `memory/soul/user` 文本与 mtime（来源:HermesCloudApi.ts:464-479、403-430）。
**已对齐**：产品后端已实现并登记该扩展路由。Profile 名称严格校验；GET 返回三个文件的完整 UTF-8 内容和真实 mtime；PUT 仅接受 `memory|soul|user` 并使用原子、owner-only 文件写入，随后返回权威快照。

## 4. Collaboration 插件面（前缀 `/api/plugins/collaboration`）

对齐 API-HTTP.md §3（53 条路由中 iOS 使用的子集）。

### 4.1 会话与 hosted turns

| 方法 | HTTP | 请求要点 | 响应/错误 |
|---|---|---|---|
| `getConversations` | GET `/single/conversations` | — | `{conversations: SingleConversation[]}`（owner 作用域） |
| `getConversation` | GET `/single/conversations/{id}` | — | `{conversation}`；404 |
| `createConversation` | POST `/single/conversations` | `{client_id?, profile, title}`（client_id 幂等，正则 `chat_[A-Za-z0-9._:-]{8,251}`） | `{conversation}`；400/422 |
| `adoptOfficialConversation` | POST `/single/conversations/adopt` | `{messages(规范化后), profile, session_id, title}` | `{conversation, created}` |
| `renameConversation` | PATCH `/single/conversations/{id}` | `{title}` | `{conversation}` |
| `deleteConversation` | DELETE `/single/conversations/{id}` | — | `{ok}`；404 |
| `recordConversationMessage` | POST `/single/conversations/{id}/record` | CollaborationMessage（只记不跑 agent） | `{message}` |
| `saveRuntimeSession` | POST `/single/conversations/{id}/runtime-session` | `{profile, session_id, turn_id, status: running|completed|failed}` | 绑定运行时会话映射 |
| `enqueueHostedTurn` | POST `/single/conversations/{id}/enqueue` | `{request_id, turn_id, message, profiles?, recent_messages, attachment_ids, attachment_context, delivery_context}` | `{accepted, replayed, message, route(RouteDecision), hosted_turn, error?{code,message,retryable}}`；409=幂等冲突 |
| `createHostedTurn` | POST `/single/conversations/{id}/hosted-turns` | `{turn_id, content, title, profiles, artifact_required, attachment_*, mode, route_metadata}` | 直接开一轮；409/422 |
| `cancelHostedTurn` | POST `…/hosted-turns/{turnId}/cancel` | `{reason}` | 404 |
| `interveneHostedTurn` | POST `…/hosted-turns/{turnId}/interventions` | `{content, message_id}` | `{accepted, hosted_turn, message, targets[]}`；409=非运行中 |
| `cancelRuntimeRun`/`retryRuntimeRun` | POST（服务器下发的 action URL） | URL 必须匹配 `^/api/plugins/collaboration/single/conversations/…/hosted-turns/…/(cancel|retry)$` 否则客户端拒绝 | `Idempotency-Key` + `{request_id, reason?}`（来源:HermesCloudApi.ts:1163-1174、2005-2015） |
| `routeMessage` | POST `/route` | `{content, recent_messages, attachments, mode:'auto'}` | `RouteDecision{mode:chat|work, profiles[], …}`；422 |

### 4.2 Hosted events（SSE）

`openHostedConversationEvents` → GET `/single/conversations/{id}/hosted-events?cursor=N`，头 `Accept: text/event-stream`、Bearer。帧契约（来源:src/api/hosted-conversation-events.ts:62-100）：
- 只处理 `event: conversation`；`data:` 为 JSON `{conversation: SingleConversation, cursor}`；`id:` 亦可携带 cursor。
- 客户端 cursor 取 `max(local, payload.cursor, id)`，断线经 `?cursor=` 续传（后端另支持 `Last-Event-ID`，客户端未用——兼容）。
- Content-Type 非 `text/event-stream` → 抛 "non-streaming hosted event response"。
- 重连 1.5s；平行轮询快照 15s（流健康）/1s（断流）；后台挂起。

### 4.3 会话附件

- 上传：POST `/single/conversations/{id}/attachments`，**raw body**（≤64MB 客户端先拦），头 `Content-Type`、`X-Filename`(encodeURIComponent)、`X-Upload-ID`（幂等）、`X-Message-ID`、`X-Profile`、`X-Turn-ID`。错误 400/409/410/413/422。后端已确认消费后三个上下文头并持久化至文件记录，契约测试锁定该行为。
- 下载：GET 服务器给出的 `download_url`（客户端强制前缀 `/api/plugins/collaboration/single/conversations/`；bucket ∈ uploads/outputs，403=逃逸、404）。

### 4.4 移动门面（mobile facade）

| 方法 | HTTP | 要点 | 错误 |
|---|---|---|---|
| `getConversationSessionState` | GET `/mobile/conversations/{id}/session-state?profile=` | context+lineage+branchable_messages | 404；409=无运行时会话 |
| `forkConversationFromMessage` | POST `/mobile/conversations/{id}/messages/{messageId}/fork` | `{idempotency_key, profile, title}` | 404/409/422 |
| `compressConversation` | POST `/mobile/conversations/{id}/compress` | `{focus_topic, idempotency_key, profile}` | 404/409/422 |
| `getWriteApprovals` | GET `/mobile/write-approvals?profile=&state=pending` | 待审写入清单 | 422 |
| `getWriteApproval` | GET `/mobile/write-approvals/{id}?profile=` | 详情含 diff 与 `payload_digest` | 404 |
| `decideWriteApproval` | POST `/mobile/write-approvals/{id}/decision` | `{decision:approve|reject, expected_revision, profile, payload_digest?}` + `Idempotency-Key` 头 | **409 = payload_digest 不匹配或修订冲突**；404/422 |
| `getRuntimeRuns` | GET `/mobile/runtime-runs?limit=200&profile=` | 活跃/近期运行 | 422 |
| `getRuntimeRun` | GET `/mobile/runtime-runs/{id}?profile=` | 单运行 | 404 |

**409 payload_digest 语义（安全关键）**：客户端必须回显自己**实际渲染给用户**的审批记录的 `payload_digest`；服务器常量时间比对将要执行的 payload 摘要，不符→409 拒绝。目的：封死 confused-deputy——agent 可自由选择 `summary`（与 `payload` 异列存储），无摘要绑定时被操纵的 agent 可用无害摘要配敌意 payload 骗取真实批准。`payloadDigest` 参数仅为兼容旧服务器才是可选；`HERMES_WRITE_APPROVAL_REQUIRE_DIGEST=1` 的服务器拒绝缺省（来源:HermesCloudApi.ts:1113-1151 注释；对齐 API-HTTP.md §3.5）。

### 4.5 群聊房间 / 账号文件库

- 房间：GET/POST `/rooms`；GET/DELETE `/rooms/{id}`；POST `/rooms/{id}/messages` `{content, profiles, request_id('room-request-…'), turn_id('room-turn-…')}`（幂等；4xx 除 401/408/429 判永久失败丢弃 outbox 项）；房间 hosted turn 取消复用 4.1。
- 文件库：GET `/files`（query `q,date_from,date_to,source,status,type,limit≤200,offset`）；GET `/files/{id}`；GET `/files/{id}/download?preview=`；DELETE `/files/{id}`；POST `/files`（raw body + `X-Filename`/`X-Upload-ID`，≤64MB）。
  **已对齐**：后端规范参数为 `file_type`，并显式兼容 iOS 使用的 `type` 别名；两者同时出现时 `file_type` 优先，契约测试锁定该行为。

## 5. 其他插件面（后端 API-HTTP.md 明示"插件路由不在枚举范围"——以下为 iOS 消费的实际契约，**文档未覆盖**，形状以插件源码为准）

### 5.1 Workflows（`/api/plugins/workflows`）

GET `/definitions?profile_id=`；GET `/definitions/{id}`；POST `/definitions/{id}/runs` `{inputs:{}, profile_id}` + `Idempotency-Key`；GET `/runs?limit=100&profile_id=`；POST `/runs/{runId}/cancel` `{expected_revision, profile_id, reason:'mobile_user'}`；POST `/runs/{runId}/nodes/{nodeId}/retry|approval`（approval body 含 `decision:'approve'`、`request_id`）；GET `/runs/{runId}/workspace-changes(:changeSetId)`（变更集摘要/明细，含 per-file patch）（来源:HermesCloudApi.ts:1013-1099）。乐观并发：`expected_revision` 不符预期由服务器拒绝（状态码`待确认`）。

### 5.2 Kanban（`/api/plugins/kanban`）

GET `/board`；POST `/tasks`；PATCH `/tasks/{id}`（来源:HermesCloudApi.ts:1176-1186）。

### 5.3 Achievements（`/api/plugins/hermes-achievements`）

GET `/achievements`；POST `/rescan`（来源:HermesCloudApi.ts:1005-1011）。

### 5.4 iOS Intelligence（`/api/plugins/ios-intelligence`，`src/context/IOSIntelligenceApi.ts`）

| 方法 | HTTP | 要点 |
|---|---|---|
| `snapshot` | GET `/snapshot?timezone=` | 当日轨迹/地点/预报快照 |
| `uploadEvents` | POST `/events/batch` | `{cursor, device_id, events[], timezone}` → `{accepted, duplicates, next_cursor}`（设备事件去重靠 id） |
| `recordCapabilities` | POST `/capabilities` | `{device_id, capabilities, observed_at}` |
| `pullCommands` | POST `/commands/pull` | `{device_id, cursor, limit:50}` → `{commands[], cursor?}` |
| `acknowledgeCommand` | POST `/commands/{id}/ack` | `{device_id, status: completed|failed, result, error}` |
| `evaluate` / `feedback` | POST `/evaluate`、`/feedback` | 行为预测评估与用户反馈 |
| `exportAccount` | POST `/account/export` | `{encrypt:true, export_passphrase, include_cold:true}` → 加密 blob（不落明文导出） |
| `deleteAccount` | POST `/account/delete` | `{confirm:true, owner_scope}` → 删除计数（登出删号 saga 的远端步骤） |

## 6. 契约核对清单（对照 hermes-agent/docs/spec/API-HTTP.md）

1. **`GET/PUT /api/hermes/memory`**（§3.10）：已在产品后端实现并由后端契约测试覆盖；iOS 记忆页与服务端 Profile 文件现已闭环。
2. **账号文件库筛选参数 `type` vs `file_type`**（§4.5）：已确认并测试后端兼容别名，文档已补齐。
3. **会话附件上传上下文头**（§4.3）：已确认服务器消费并持久化 `X-Message-ID/X-Profile/X-Turn-ID`，文档与测试已补齐。
4. **`/api/model/options?include_unconfigured=1`**：已由后端实现、测试和文档确认。
5. **Cron 更新 body `{updates:{…}}` 包裹**（§3.5）：已由 `CronJobUpdate` 实现、测试和文档确认。
6. **插件面整体**（workflows/kanban/achievements/ios-intelligence，§5）：后端 API-HTTP.md §8 明言插件 `plugin_api.py` 路由不在枚举范围。iOS 对这四个面的依赖是硬依赖，建议后端补一份插件 API 附录，否则 iOS 侧契约只能以插件源码为准。
7. **已核对齐（抽样）**：`/auth/mobile/*`、`/api/mobile/v1/*`、`/single/conversations*`（含 enqueue/hosted-events/interventions/retry/cancel）、write-approvals 的 409+digest、`/api/sessions*`、`/api/files*`、`/api/model/*`、`/api/config*`、`/api/env`、`/api/cron/jobs*`（dashboard 面动词）、`/api/skills*`、`/api/mcp/*`、`/api/pairing*`、`/api/messaging/platforms*`、`/api/webhooks*`、`/api/profiles*`、`/api/managed-nodes/*`、`/api/managed-installations`、`/api/gateway/restart`、`/api/hermes/update`、`/api/logs`、`/api/analytics/*`、`/api/dashboard/themes|theme|font|plugins`。
8. **实时传输**：iOS 原生聊天优先使用认证的一次性 `/api/auth/ws-ticket` 与
   `/api/plugins/collaboration/single/conversations/{id}/hosted-events-ws`
   WebSocket 镜像；代理、旧网关或升级失败时自动回退到同一游标契约的
   `hosted-events` SSE，再以受限快照轮询兜底。不使用旧的 `/api/ws`、
   `/api/events` 或 TUI JSON-RPC，也不直连 gateway REST 面（:8642）。

## 7. 新增调用的清单（给加功能的人）

1. 后端已有端点？→ 查本文件与后端 API-HTTP.md；插件端点直接读插件源码。
2. 在 `HermesCloudApi`（领域相近处）加**命名方法**——`request` 是 private，别绕。写操作带 `Idempotency-Key`/request_id；路径相对、同源。
3. 401/超时/脱敏/同源由 `HermesApiClient` 统一处理，不要在方法里自补。
4. SwiftUI 页面用数据 → `loadRoute` 加 case → route-data 快照（见 ARCHITECTURE.md §6/§12）。
5. `tests/cloud-api.test.ts` 补方法级桩测试；涉及错误语义的补 `tests/api-client.test.ts`。
