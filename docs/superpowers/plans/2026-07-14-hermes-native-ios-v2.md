# Hermes Native iOS v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Hermes iOS WebView shell with a fully native React Native client that reproduces the current v1.0.7 WebUI information architecture, features, and custom collaboration workflow while keeping Hermes execution and persistent state on DBB3.

**Architecture:** The iOS app renders every surface with React Native components and talks to the existing Hermes REST, JSON-RPC WebSocket, plugin, and attachment APIs. A narrow mobile-auth seam gives a dedicated bearer key full dashboard API access without changing browser cookie auth; the collaboration backend also registers APNs devices and sends completion notifications. DBB3 remains authoritative for sessions, profiles, config, work, files, and logs; the phone persists only the server base URL and mobile API key.

**Tech Stack:** Expo SDK 54, React Native 0.81, React Navigation 7, Expo Local Authentication, Expo Notifications, Expo Secure Store, Expo Image Picker, Expo File System, Lucide React Native, native fetch/WebSocket, FastAPI/Pydantic, Hermes dashboard auth providers, pytest, Node test runner.

## Global Constraints

- Freeze behavior against Hermes Agent commit `4272ccd44`, Hermes iOS commit `39ab97b`, Collaboration `2.1.36`, and WebView release `v1.0.7`.
- Do not render any app screen through `react-native-webview`, `WKWebView`, an iframe, remotely supplied HTML, or a browser DOM.
- The first production native release is `v2.0.0`; beta builds use `com.given33.hermesagent.nativebeta`, while the final release returns to `com.given33.hermesagent`.
- Support iOS/iPadOS 16 and later, iPhone and iPad, portrait and landscape, with iPhone drawer navigation and iPad persistent sidebar navigation.
- Preserve customized `web/src/App.tsx` route composition exactly: built-in Chat/Sessions/Analytics/Models/Logs/Cron/Skills/Plugins/MCP/Channels/Webhooks/Pairing/Profiles/Config/Keys/System/Docs sidebar entries; reachable but non-sidebar Files and profile-builder routes; Analytics visibility gated by `dashboard.show_token_analytics`; and manifest-driven plugin insertion, hidden routes, and overrides (including Kanban/Achievements at the frozen baseline).
- Preserve current custom behavior: unified conversations, automatic simple/work routing, DBB3-hosted execution, dispatcher/worker/reviewer/reporter role messages, structured tool activity, attachments, model/profile selection, cancellation, recovery, and GitHub IPA update checks.
- All submitted turns remain server-owned and continue when the app backgrounds, locks, exits, loses network, or is killed; reopening reconstructs the complete server timeline.
- Persist `baseUrl` and `apiKey` in iOS Keychain/Secure Store. The user additionally permits local persistence for the WebUI theme/font preference and for a bounded, secret-redacted log mirror used by the native Logs screen. Conversation content, messages, attachments, task results, configuration, Profiles, and pending work remain server-authoritative. Offline unsent text may live only in memory and is lost if the process is killed.
- After first provisioning, Face ID directly unlocks the saved API key. Do not require Face ID for foreground resumes or privileged actions. Preserve the WebUI's existing confirmation dialogs for destructive actions.
- Task-completion notifications include completion status and the full result. Tapping a notification requires Face ID and opens the corresponding conversation.
- Keep existing high-privilege capabilities, including gateway restart, Hermes update, key/config changes, session/profile deletion, plugin/skill management, and Kanban operations.
- Keep browser WebUI installed as an emergency surface, but native iOS must not depend on its assets, routes, DOM, cookies, or release lifecycle.
- Hermes backend updates remain controlled: compatibility checks must pass before deployment; native app updates ship only as signed/unsigned IPA releases, never OTA.
- Do not add third-party analytics or crash telemetry. Diagnostics remain on DBB3 or the local PC and retain secret redaction.
- User-specific motion override: preserve the login `slide-up` animation at `600ms` with CSS `ease-out` (`cubic-bezier(0, 0, 0.58, 1)`) on every device. Do not port the WebUI's `prefers-reduced-motion` branch or otherwise reduce/disable this animation.
- Follow TDD for every production behavior: write a failing test, observe the expected failure, implement minimally, and rerun the covering suite.
- Use `scripts/run_tests.sh` for Hermes Python tests. Use `pnpm test`, `pnpm typecheck`, and `expo-doctor` for the iOS repository.

---

### Task 1: Freeze the Native v2 Contract and Remove the WebView Runtime

**Files:**
- Create: `tests/native-v2-architecture.test.ts`
- Create: `src/app/route-registry.ts`
- Create: `src/app/HermesNativeApp.tsx`
- Modify: `App.tsx`
- Modify: `package.json`
- Modify: `app.json`
- Modify: `index.ts`
- Delete: WebView-only assertions from `tests/native-layout.test.ts`

**Interfaces:**
- Produces: `HERMES_NATIVE_ROUTES: readonly NativeRouteDefinition[]` and a root `HermesNativeApp` component.
- Produces: an app dependency graph with no `react-native-webview` import or package.

- [ ] **Step 1: Write the failing native architecture tests**

```ts
test('native v2 has no WebView runtime', () => {
  assert.doesNotMatch(appSource, /react-native-webview|<WebView|injectedJavaScript/);
  assert.equal(packageConfig.dependencies['react-native-webview'], undefined);
});

test('native v2 registers every frozen WebUI destination', () => {
  assert.deepEqual(
    HERMES_NATIVE_ROUTES.map(route => route.id),
    ['chat', 'sessions', 'models', 'logs', 'cron', 'skills', 'plugins', 'mcp',
     'channels', 'webhooks', 'pairing', 'profiles', 'config', 'env', 'system',
     'docs', 'kanban', 'achievements'],
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx --yes pnpm@10.15.1 test`

Expected: FAIL because `route-registry.ts` and `HermesNativeApp` do not exist and `App.tsx` still imports `react-native-webview`.

- [ ] **Step 3: Install the compatible native dependencies**

Run:

```powershell
npx expo install expo-local-authentication expo-notifications expo-image-picker expo-clipboard expo-haptics react-native-gesture-handler react-native-reanimated react-native-screens react-native-svg
npx pnpm add @react-navigation/native@^7 @react-navigation/drawer@^7 @react-navigation/native-stack@^7 lucide-react-native@^0.468 react-native-markdown-display@^7
npx pnpm remove react-native-webview
```

Keep the resolved Expo-compatible versions in `pnpm-lock.yaml`; do not hand-edit the lockfile.

- [ ] **Step 4: Add the frozen route registry**

```ts
export interface NativeRouteDefinition {
  id: 'chat' | 'sessions' | 'models' | 'logs' | 'cron' | 'skills' | 'plugins' |
    'mcp' | 'channels' | 'webhooks' | 'pairing' | 'profiles' | 'config' | 'env' |
    'system' | 'docs' | 'kanban' | 'achievements';
  label: string;
  title: string;
}

export const HERMES_NATIVE_ROUTES = [
  { id: 'chat', label: '单聊', title: '单聊' },
  { id: 'sessions', label: '会话', title: '会话' },
  { id: 'models', label: '模型', title: '模型' },
  { id: 'logs', label: '日志', title: '日志' },
  { id: 'cron', label: '定时任务', title: '定时任务' },
  { id: 'skills', label: '技能', title: '技能' },
  { id: 'plugins', label: '插件管理', title: '插件管理' },
  { id: 'mcp', label: 'MCP', title: 'MCP' },
  { id: 'channels', label: '消息渠道', title: '消息渠道' },
  { id: 'webhooks', label: '网络钩子', title: '网络钩子' },
  { id: 'pairing', label: '设备配对', title: '设备配对' },
  { id: 'profiles', label: '多Agent配置', title: '多Agent配置' },
  { id: 'config', label: '配置', title: '配置' },
  { id: 'env', label: '密钥', title: '密钥' },
  { id: 'system', label: '系统监控', title: '系统监控' },
  { id: 'docs', label: '文档', title: '文档' },
  { id: 'kanban', label: '看板', title: '看板' },
  { id: 'achievements', label: '成就', title: '成就' },
] as const satisfies readonly NativeRouteDefinition[];
```

- [ ] **Step 5: Replace `App.tsx` with the native root and configure plugins**

`App.tsx` must only compose `GestureHandlerRootView`, `SafeAreaProvider`, and `HermesNativeApp`. Add Expo plugins for Secure Store biometric access, notifications, local authentication, image picker, and splash screen. Set beta bundle id and version `2.0.0-beta.1` / build `9`.

- [ ] **Step 6: Run tests, typecheck, and Expo Doctor**

Run:

```powershell
npx pnpm test
npx pnpm typecheck
npx pnpm doctor
```

Expected: architecture tests pass, TypeScript exits 0, Expo Doctor reports all checks passing.

- [ ] **Step 7: Commit**

```powershell
git add App.tsx app.json index.ts package.json pnpm-lock.yaml src/app tests
git commit -m "feat: establish native Hermes v2 runtime"
```

---

### Task 2: Add Full-Admin Mobile Bearer Authentication to Hermes

**Files:**
- Create: `../hermes-agent/hermes_cli/dashboard_auth/mobile_api_provider.py`
- Modify: `../hermes-agent/hermes_cli/dashboard_auth/token_auth.py`
- Modify: `../hermes-agent/hermes_cli/dashboard_auth/registry.py`
- Modify: `../hermes-agent/hermes_cli/config.py`
- Modify: `../hermes-agent/hermes_cli/web_server.py`
- Test: `../hermes-agent/tests/hermes_cli/dashboard_auth/test_mobile_api_auth.py`

**Interfaces:**
- Produces: `register_optional_token_prefix(prefix: str)` and bearer authentication that coexists with browser cookies.
- Consumes: secret `HERMES_MOBILE_API_KEY` from the server `.env`.
- Produces: `GET /api/mobile/v1/handshake` returning API version, Hermes version, profiles, capabilities, and server time.

- [ ] **Step 1: Write failing auth seam tests**

```python
def test_optional_mobile_prefix_preserves_browser_cookie_auth(client):
    response = client.get('/api/status', cookies=valid_dashboard_cookie())
    assert response.status_code == 200

def test_optional_mobile_prefix_accepts_mobile_bearer(client, mobile_key):
    response = client.get('/api/status', headers={'Authorization': f'Bearer {mobile_key}'})
    assert response.status_code == 200

def test_invalid_mobile_bearer_fails_closed(client):
    response = client.get('/api/status', headers={'Authorization': 'Bearer wrong'})
    assert response.status_code == 401

def test_handshake_reports_versioned_capabilities(client, mobile_key):
    response = client.get('/api/mobile/v1/handshake', headers=bearer(mobile_key))
    assert response.json()['api_version'] == 1
    assert 'chat' in response.json()['capabilities']
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from the Hermes worktree:

```bash
scripts/run_tests.sh tests/hermes_cli/dashboard_auth/test_mobile_api_auth.py -q
```

Expected: FAIL because optional token prefixes and the handshake route do not exist.

- [ ] **Step 3: Implement optional bearer-prefix semantics**

The middleware contract is:

```python
_optional_token_prefixes: set[str] = set()

def register_optional_token_prefix(prefix: str) -> None:
    normalized = '/' + prefix.strip('/')
    with _lock:
        _optional_token_prefixes.add(normalized)

async def token_auth_middleware(request: Request, call_next):
    if any(request.url.path == p or request.url.path.startswith(f'{p}/')
           for p in _optional_token_prefixes):
        if not extract_bearer_token(request):
            return await call_next(request)
        principal, unreachable = authenticate_token(request)
        if principal is not None:
            request.state.token_principal = principal
            request.state.token_authenticated = True
            return await call_next(request)
        return token_failure_response(request, unreachable)
    # retain the existing exact token-route behavior unchanged
```

- [ ] **Step 4: Implement the constant-time mobile provider**

```python
class MobileApiKeyProvider(DashboardAuthProvider):
    name = 'mobile-api'
    supports_session = False
    supports_token = True

    def verify_token(self, *, token: str) -> Optional[TokenPrincipal]:
        expected = os.environ.get('HERMES_MOBILE_API_KEY', '').strip()
        if not expected or not hmac.compare_digest(token, expected):
            return None
        return TokenPrincipal(provider=self.name, subject='ios-native', scopes=('dashboard:admin',))
```

Register it only when the key is configured. Add `HERMES_MOBILE_API_KEY` to secret metadata, never log its value, and never return it from an endpoint.

- [ ] **Step 5: Add the handshake route and mobile prefix registration**

Register optional bearer auth for `/api`, include the provider before middleware startup, and return stable capability ids rather than current enumeration counts.

- [ ] **Step 6: Run focused and dashboard regression tests**

Run:

```bash
scripts/run_tests.sh tests/hermes_cli/dashboard_auth/test_mobile_api_auth.py tests/plugins/test_collaboration_dashboard.py -q
```

Expected: mobile auth tests pass and all collaboration tests remain green.

- [ ] **Step 7: Commit**

```bash
git add hermes_cli/dashboard_auth hermes_cli/config.py hermes_cli/web_server.py tests/hermes_cli/dashboard_auth
git commit -m "feat(api): add native mobile bearer authentication"
```

---

### Task 3: Build Secure Face ID Provisioning and the Native API Client

**Files:**
- Create: `assets/fonts/Collapse-*.ttf` and `assets/fonts/RulesCompressed-*.ttf` from the exact tracked WebUI font outlines
- Create: `src/design/fonts.ts`
- Create: `src/auth/credential-contract.ts`
- Create: `src/auth/credential-store.ts`
- Create: `src/auth/auth-state.ts`
- Create: `src/auth/AuthProvider.tsx`
- Create: `src/auth/LoginScreen.tsx`
- Create: `src/api/HermesApiClient.ts`
- Create: `src/api/hermes-types.ts`
- Create: `src/api/ws-ticket.ts`
- Test: `tests/auth-state.test.ts`
- Test: `tests/api-client.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `SavedConnection { baseUrl: string; apiKey: string }`, stored with `requireAuthentication: true`.
- Produces: `HermesApiClient.request<T>()`, profile-scoped requests, attachment URLs, and fresh WebSocket tickets.
- Consumes: `/api/mobile/v1/handshake` and existing Hermes `/api/*` routes.

- [ ] **Step 1: Write failing pure-state and transport tests**

```ts
test('normalizes the fixed server URL and rejects non-http schemes', () => {
  assert.equal(normalizeBaseUrl('https://8.138.40.16/'), 'https://8.138.40.16');
  assert.throws(() => normalizeBaseUrl('file:///tmp/hermes'));
});

test('adds bearer auth and profile scope without leaking the key into URLs', async () => {
  const calls: RequestInit[] = [];
  const client = createTestClient(calls);
  await client.request('/api/config', { profile: 'reviewer' });
  assert.equal(calls[0].headers.Authorization, 'Bearer mobile-secret');
  assert.doesNotMatch(client.lastUrl, /mobile-secret/);
  assert.match(client.lastUrl, /profile=reviewer/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx pnpm test`

Expected: FAIL because the auth state and client modules do not exist.

- [ ] **Step 3: Implement Secure Store with Face ID-protected reads**

Use two keys only: `hermes.native.baseUrl` and `hermes.native.apiKey`. Store the API key with `requireAuthentication: true` and `authenticationPrompt: '使用 Face ID 登录 Hermes'`. Do not persist sessions, routes, messages, drafts, profiles, or notification results.

- [ ] **Step 4: Implement provisioning and direct Face ID unlock**

The first-run form accepts Base URL and API key, verifies the handshake, then stores both. Later cold starts load the base URL and request the protected API key; a successful Secure Store read is the login. Do not re-prompt on normal foreground resumes.

The native login must also reproduce `hermes_cli/dashboard_auth/login_page.py` literally: load the same Collapse and Rules Compressed font outlines from the tracked `web/public/fonts` assets in an iOS-supported container; reproduce the radial top glow and 3px dither with `react-native-svg`; and copy every CSS color, mix percentage, dimension, spacing, case, tracking, bevel, and state. Install missing conversion/runtime dependencies. System-font fallback or visually similar substitutes do not satisfy this step.

Always run the source `slide-up` motion (`opacity 0 -> 1`, `translateY(6px) -> 0`, `600ms`, `cubic-bezier(0, 0, 0.58, 1)`). Per the user's explicit override, do not disable or shorten it for reduced-motion settings.

- [ ] **Step 5: Implement the typed API client and WS ticket minting**

```ts
export interface HermesRequestOptions extends RequestInit {
  profile?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export class HermesApiClient {
  constructor(readonly baseUrl: string, private readonly apiKey: string) {}
  request<T>(path: string, options?: HermesRequestOptions): Promise<T>;
  createWebSocketUrl(path: '/api/ws' | '/api/events', profile?: string): Promise<string>;
}
```

For WebSockets, call `POST /api/auth/ws-ticket` with bearer auth and append only the short-lived ticket to the `wss:` URL.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run:

```powershell
npx pnpm test
npx pnpm typecheck
```

Commit:

```powershell
git add src/auth src/api tests
git commit -m "feat: add Face ID protected Hermes connection"
```

---

### Task 4: Build the Hermes Native Design System and Adaptive Shell

**Files:**
- Create: `src/design/webui-snapshot.ts`
- Create: `src/design/tokens.ts`
- Create: `src/design/typography.ts`
- Create: `src/design/theme-state.tsx`
- Add: `@react-native-async-storage/async-storage` as the native localStorage-equivalent for the WebUI theme/font preference keys only
- Create: `assets/fonts/*` from every font used by the customized WebUI, retaining the exact tracked/downloaded font outlines in an iOS-compatible container
- Create: `src/components/ui/NativeButton.tsx`
- Create: `src/components/ui/NativeInput.tsx`
- Create: `src/components/ui/ScreenState.tsx`
- Create: `src/components/ui/ConfirmDialog.tsx`
- Create: `src/app/navigation/HermesDrawer.tsx`
- Create: `src/app/navigation/HermesSidebar.tsx`
- Create: `src/app/navigation/HermesNavigator.tsx`
- Create: `src/app/navigation/route-composition.ts`
- Create: `src/app/useAdaptiveLayout.ts`
- Modify: `src/app/route-registry.ts`
- Test: `tests/design-contract.test.ts`
- Test: `tests/route-registry.test.ts`

**Interfaces:**
- Produces: adaptive `compact` (<768 points) and `split` (>=768 points) layouts.
- Produces: shared Hermes primitives used by every later screen, mechanically translated from the customized WebUI rather than independently styled.
- Consumes as canonical design source: `web/src/index.css`, `web/src/themes/{types,presets,context,fonts}.ts[x]`, `web/src/App.tsx`, `web/src/components/*`, `web/src/pages/*`, and `web/public/fonts/*` at Hermes Agent `4272ccd44`.
- Preserves every built-in/custom theme token and theme-switching state exposed by the customized WebUI. The native default is the exact `defaultTheme` snapshot, not a new iOS palette.
- Mirrors the WebUI's `hermes-dashboard-theme` and `hermes-dashboard-font` local preferences through AsyncStorage to avoid a startup flash, then reconciles with `/api/dashboard/themes` and `/api/dashboard/font`, which remain authoritative across devices. Do not use AsyncStorage for conversations, messages, attachments, task results, config, or Profiles.
- Produces the same route/nav composition functions as customized `App.tsx`: non-sidebar routes remain deep-linkable, Analytics visibility follows config, plugin `position` hints are preserved, hidden plugins stay out of navigation, and plugin overrides replace rather than duplicate built-ins.

- [ ] **Step 1: Extract the canonical WebUI design snapshot and write failing contract tests**

Before writing native styles, record the exact source file, selector/component, token, value, and native mapping for the shell and shared controls. Do not infer colors such as `panel`, `raised`, or `accent` that do not exist in the source; derived colors must use the same `color-mix` percentages as `web/src/index.css`.

```ts
test('native default theme is an exact snapshot of customized WebUI defaultTheme', () => {
  assert.deepEqual(themes.default.palette, {
    background: { hex: '#041c1c', alpha: 1 },
    midground: { hex: '#ffe6cb', alpha: 1 },
    foreground: { hex: '#ffffff', alpha: 0 },
    warmGlow: 'rgba(255, 189, 56, 0.35)',
    noiseOpacity: 1,
  });
  assert.equal(themes.default.layout.radius, '0.5rem');
  assert.equal(themes.default.layout.density, 'comfortable');
  assert.equal(themes.default.typography.baseSize, '15px');
});

test('adaptive layout preserves native phone/iPad behavior and exact WebUI dimensions', () => {
  assert.equal(resolveLayoutMode(402), 'compact');
  assert.equal(resolveLayoutMode(834), 'split');
  assert.equal(shell.sidebarWidth, 256); // WebUI w-64
  assert.equal(shell.collapsedSidebarWidth, 56); // WebUI w-14
  assert.equal(shell.headerHeight, 56); // WebUI h-14
});

test('route composition follows customized App.tsx instead of an old static list', () => {
  assert.equal(routeByPath('/files').visibleInSidebar, false);
  assert.equal(routeByPath('/analytics').visibilityFlag, 'dashboard.show_token_analytics');
  assert.deepEqual(composePluginRoutes(manifests), expectedManifestOrder);
});
```

- [ ] **Step 2: Verify RED, then implement the exact theme/token resolver**

Run: `npx pnpm test`

Expected: FAIL because tokens and layout resolver do not exist.

Port the complete built-in theme registry and the customized WebUI's color derivations, typography, radius, density, terminal colors, series colors, and theme override semantics. Server-supplied theme choice remains server-authoritative; do not create a separate native-only theme model.

Port the WebUI's local preference/server reconciliation order exactly: seed theme/font from the two local preference keys, fetch server values, migrate/validate ids, update the visible theme, and persist changes both locally and through the existing theme/font API routes.

- [ ] **Step 3: Reuse the tracked WebUI typefaces and implement native primitives**

Use the tracked `web/public/fonts` files and the exact font URLs declared by the customized WebUI theme registry as the source of truth. The relevant packages and repository are MIT licensed. Convert/bundle the same outlines in an iOS-supported font container, register them through Expo, and map every WebUI font family/style/weight exactly, including Collapse, Rules Compressed, Rules Expanded, Mondwest, JetBrains Mono, and fonts selected by built-in themes. Install missing tooling or runtime packages. Do not use a system fallback, metrically similar font, or visual approximation when the WebUI selects a named font. Implement each primitive from its actual `@nous-research/ui`/customized-WebUI counterpart, copying radius, border, bevel, opacity, spacing, text case, and interaction states literally. A 44-point native hit target may wrap the unchanged visible control without changing its visible geometry.

- [ ] **Step 4: Implement adaptive navigation**

On iPhone, the menu button opens a drawer and the content remains full-width. On iPad, render the native adaptation with the WebUI's exact 256-point expanded and 56-point collapsed sidebar widths plus a flexible detail pane. Preserve the `App.tsx` ordering and dimensions: brand/collapse header, profile switcher, core navigation, plugin navigation, system actions, theme/language controls, auth widget, and status footer. Port `buildNavItems`, `partitionSidebarNav`, and `buildRoutes` behavior rather than hardcoding only the currently installed plugins. Use native navigation and sheets while leaving visible labels, icons, hierarchy, colors, and states unchanged.

- [ ] **Step 5: Run tests, typecheck, and commit**

```powershell
npx pnpm test
npx pnpm typecheck
git add src/app src/components src/design tests
git commit -m "feat: build adaptive native Hermes shell"
```

---

### Task 5: Port Profiles, Status, and Shared Server State

**Files:**
- Create: `src/state/server-state.tsx`
- Create: `src/state/profile-state.tsx`
- Create: `src/hooks/useHermesResource.ts`
- Create: `src/components/ProfileSwitcher.tsx`
- Create: `src/components/GatewayStatus.tsx`
- Create: `src/components/PageHeader.tsx`
- Test: `tests/profile-state.test.ts`
- Test: `tests/resource-generation.test.ts`

**Interfaces:**
- Produces: backend-authoritative `ServerState` and `ProfileState` with stale-response guards.
- Consumes: `/api/status`, `/api/profiles`, `/api/profiles/active`, and profile query parameters.

- [ ] **Step 1: Write failing state tests**

Test that switching from `default` to `reviewer` clears only profile-scoped data, preserves the shell, and ignores a late `default` response. Test that gateway status distinguishes loading, online, reconnecting, degraded, and offline.

- [ ] **Step 2: Verify RED and implement generation-based resource loading**

```ts
export interface ResourceState<T> {
  data: T | null;
  error: string | null;
  generation: number;
  phase: 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';
}
```

Each request captures the current generation and publishes only when it still matches.

- [ ] **Step 3: Implement the profile switcher and gateway controls**

The switcher lists `default`, `dbb3-worker`, `ops-watchdog`, `pc-worker`, and `reviewer` from the server rather than hardcoding them. Preserve current profile isolation and confirmation behavior for gateway restart and Hermes update.

- [ ] **Step 4: Run tests and commit**

```powershell
npx pnpm test
npx pnpm typecheck
git add src/state src/hooks src/components tests
git commit -m "feat: add native server and profile state"
```

---

### Task 6: Port Unified Chat, Hosted Workflows, and Realtime Activity

**Files:**
- Create: `src/features/chat/chat-types.ts`
- Create: `src/features/chat/chat-reducer.ts`
- Create: `src/features/chat/ChatScreen.tsx`
- Create: `src/features/chat/ConversationList.tsx`
- Create: `src/features/chat/MessageBubble.tsx`
- Create: `src/features/chat/RoleActivityGroup.tsx`
- Create: `src/features/chat/Composer.tsx`
- Create: `src/features/chat/hosted-events.ts`
- Create: `src/features/chat/attachment-actions.ts`
- Test: `tests/chat-reducer.test.ts`
- Test: `tests/hosted-events.test.ts`
- Test: `tests/attachment-actions.test.ts`

**Interfaces:**
- Consumes: Collaboration `/profiles`, `/route`, `/single/conversations*`, `/hosted-turns`, `/hosted-events`, attachments, and cancellation endpoints.
- Produces: the frozen WeChat-style dispatcher/worker/reviewer/reporter timeline and per-role collapsible structured activity.

- [ ] **Step 1: Write failing reducer tests**

Cover conversation selection races, simple/work route labels, streaming delta merge, reasoning/final answer de-duplication, `tool.generating`/`tool.start` de-duplication, role-order preservation, partial progress after failure, and terminal-state flush.

- [ ] **Step 2: Verify RED and implement pure event reduction**

```ts
export function reduceChatEvent(state: ChatState, event: ChatEvent): ChatState;
export function visibleMessages(conversation: Conversation): ChatMessage[];
```

Reducers must be pure and preserve reference identity on no-op events.

- [ ] **Step 3: Implement the native transcript and composer**

Use `FlatList` with stable item heights where possible, Markdown rendering for assistant text, white user bubbles, separate role avatars/names, compact activity summaries, and a native multiline composer that tracks the keyboard without geometry injection.

- [ ] **Step 4: Implement hosted event reconnect and server recovery**

Use a native event transport with bounded backoff. On resume, fetch the authoritative conversation before reconnecting. Never reconstruct results from local cache. If the app is killed, reopening the saved server and Face ID unlock must recover the full timeline from DBB3.

- [ ] **Step 5: Implement attachments**

Support photo library, camera, document picker, multipart upload, native preview, download, share, and save-to-Files. Do not persist attachment content locally after the operation finishes.

- [ ] **Step 6: Run tests and commit**

```powershell
npx pnpm test
npx pnpm typecheck
git add src/features/chat tests
git commit -m "feat: port unified Hermes chat to native iOS"
```

---

### Task 7: Port Sessions, Files, Analytics, Models, Logs, Cron, and Profiles Management

**Files:**
- Create: `src/features/sessions/SessionsScreen.tsx`
- Create: `src/features/files/FilesScreen.tsx`
- Create: `src/features/analytics/AnalyticsScreen.tsx`
- Create: `src/features/models/ModelsScreen.tsx`
- Create: `src/features/logs/LogsScreen.tsx`
- Create: `src/features/logs/local-log-store.ts`
- Create: `src/features/cron/CronScreen.tsx`
- Create: `src/features/profiles/ProfilesScreen.tsx`
- Create: `src/components/resources/ResourceList.tsx`
- Create: `src/components/resources/EditorSheet.tsx`
- Test: `tests/management-primary.test.ts`

**Interfaces:**
- Consumes: the corresponding methods and types copied from `web/src/lib/api.ts` without DOM dependencies.
- Produces: every built-in route and management flow in this group, including the WebUI's reachable `/files` route and conditionally visible `/analytics` route.
- Produces: a bounded local log mirror for native display. DBB3 remains the authoritative server log source; local files must redact the mobile API key and authorization headers, use a documented size/retention cap, and contain no conversation or task-result cache.

- [ ] **Step 1: Write failing endpoint-mapping and action tests**

Assert each screen maps to its existing API paths, profile scoping is preserved, destructive actions invoke the shared confirmation dialog, and failed optimistic writes roll back.

- [ ] **Step 2: Verify RED and implement the shared list/editor primitives**

Use full-width flat sections, stable rows, native sheets for editors, segmented controls for modes, toggles for booleans, and icon buttons for row actions.

- [ ] **Step 3: Implement all seven screens**

Sessions must search, open, rename, export, and delete. Files and Analytics must preserve their actual route reachability and `dashboard.show_token_analytics` navigation rule from customized `App.tsx`. Models must select provider/model and edit auxiliary/fallback behavior. Logs must filter and refresh without polling while backgrounded, and may save/display the bounded redacted local mirror explicitly permitted by the user. Cron must create/edit/pause/resume/run/delete. Profiles must create/clone/rename/delete, change model/description/SOUL, and open scoped management.

- [ ] **Step 4: Run tests and commit**

```powershell
npx pnpm test
npx pnpm typecheck
git add src/features src/components/resources tests
git commit -m "feat: port primary Hermes management screens"
```

---

### Task 8: Port Skills, Plugins, MCP, Channels, Webhooks, and Pairing

**Files:**
- Create: `src/features/skills/SkillsScreen.tsx`
- Create: `src/features/plugins/PluginsScreen.tsx`
- Create: `src/features/mcp/McpScreen.tsx`
- Create: `src/features/channels/ChannelsScreen.tsx`
- Create: `src/features/webhooks/WebhooksScreen.tsx`
- Create: `src/features/pairing/PairingScreen.tsx`
- Test: `tests/management-integrations.test.ts`

**Interfaces:**
- Consumes: current integration endpoints from `web/src/lib/api.ts`.
- Produces: full current enable/configure/install/remove/auth/approve/revoke behavior.

- [ ] **Step 1: Write failing capability and mutation tests**

Cover loading/empty/error states, profile scoping, masked secrets, plugin enable/disable, MCP OAuth/device flow, channel restart requirements, webhook secret handling, and pairing approve/revoke/clear.

- [ ] **Step 2: Verify RED and implement the six screens**

Do not persist forms or secrets after leaving a screen. Use native browser handoff only for external OAuth authorization pages; return to the app via the `hermes-agent` scheme. This is not a WebView and must not render Hermes UI remotely.

- [ ] **Step 3: Run tests and commit**

```powershell
npx pnpm test
npx pnpm typecheck
git add src/features tests
git commit -m "feat: port Hermes integration management"
```

---

### Task 9: Port Config, Keys, System, Docs, Kanban, and Achievements

**Files:**
- Create: `src/features/config/ConfigScreen.tsx`
- Create: `src/features/env/EnvScreen.tsx`
- Create: `src/features/system/SystemScreen.tsx`
- Create: `src/features/docs/DocsScreen.tsx`
- Create: `src/features/kanban/KanbanScreen.tsx`
- Create: `src/features/achievements/AchievementsScreen.tsx`
- Test: `tests/management-system.test.ts`

**Interfaces:**
- Consumes: core config/env/system/docs APIs and Kanban/Achievements plugin APIs.
- Produces: the remaining frozen WebUI destinations with native controls.

- [ ] **Step 1: Write failing page-contract tests**

Cover structured and raw config edits, masked env values, system status/actions, local native docs navigation, Kanban task lifecycle, and achievements progress.

- [ ] **Step 2: Verify RED and implement the six screens**

Config and Keys retain the current confirmation and save semantics. Docs render fetched Markdown natively. Kanban preserves root/child hierarchy, status filters, comments, assignment, completion, blocking, archiving, and live refresh. Achievements preserve categories, progress, and earned states.

- [ ] **Step 3: Run tests and commit**

```powershell
npx pnpm test
npx pnpm typecheck
git add src/features tests
git commit -m "feat: complete native Hermes management parity"
```

---

### Task 10: Add APNs Registration and Full-Result Completion Notifications

**Files:**
- Create: `src/notifications/notification-registration.ts`
- Create: `src/notifications/notification-routing.ts`
- Modify: `src/app/HermesNativeApp.tsx`
- Create: `../hermes-agent/plugins/collaboration/dashboard/mobile_notifications.py`
- Modify: `../hermes-agent/plugins/collaboration/dashboard/plugin_api.py`
- Modify: `../hermes-agent/plugins/collaboration/dashboard/manifest.json`
- Test: `tests/notification-routing.test.ts`
- Test: `../hermes-agent/tests/plugins/test_mobile_notifications.py`

**Interfaces:**
- Produces: `POST /api/plugins/collaboration/mobile/devices`, DELETE revoke route, and APNs notification delivery.
- Consumes: native APNs device token plus server `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_BUNDLE_ID`, and `APPLE_APNS_PRIVATE_KEY` secrets.
- Produces: notification payload with status, full result, conversation id, and turn id.

- [ ] **Step 1: Write failing native routing tests**

Test that a notification deep-link is held while locked, Face ID unlock occurs, and the app then selects the exact conversation without persisting the notification result.

- [ ] **Step 2: Write failing backend notification tests**

Test device registration/revocation, token redaction, completed/failed/cancelled terminal statuses, APNs payload size truncation that preserves status and conversation ids, and no duplicate push on recovery replay.

- [ ] **Step 3: Verify both RED suites**

Run:

```powershell
npx pnpm test
```

Run from Hermes:

```bash
scripts/run_tests.sh tests/plugins/test_mobile_notifications.py -q
```

- [ ] **Step 4: Implement native APNs registration**

Request notification permission after login, obtain the native APNs token, register it with DBB3, and unregister on logout. Do not store task content or notification results locally.

- [ ] **Step 5: Implement direct APNs delivery**

Store device tokens server-side under the Hermes home with restrictive permissions. Sign ES256 provider tokens, use the production/sandbox APNs host selected by the registered environment, redact tokens in logs, and collapse duplicate terminal events by `(conversation_id, turn_id, terminal_status)`.

- [ ] **Step 6: Run tests and commit both repositories**

Commit iOS:

```powershell
git add src/notifications src/app tests app.json package.json pnpm-lock.yaml
git commit -m "feat: add native Hermes completion notifications"
```

Commit Hermes:

```bash
git add plugins/collaboration tests/plugins
git commit -m "feat(collaboration): send APNs workflow results"
```

---

### Task 11: Lifecycle, Offline Memory Queue, Updates, and Compatibility Gates

**Files:**
- Create: `src/lifecycle/app-lifecycle.ts`
- Create: `src/lifecycle/offline-outbox.ts`
- Create: `src/updates/app-updates.ts`
- Create: `src/updates/backend-updates.ts`
- Modify: `src/app/HermesNativeApp.tsx`
- Modify: `.github/workflows/ios-unsigned.yml`
- Modify: `.github/workflows/ci.yml`
- Test: `tests/lifecycle.test.ts`
- Test: `tests/offline-outbox.test.ts`
- Test: `tests/update-compatibility.test.ts`

**Interfaces:**
- Produces: memory-only pending sends, authoritative foreground recovery, GitHub IPA checks, and backend compatibility blocking.

- [ ] **Step 1: Write failing lifecycle tests**

Cover background network suspension, no duplicate reconnect, in-memory offline send replay with idempotency key, loss of unsent drafts after process restart, full server resync on foreground, and notification deep-link precedence.

- [ ] **Step 2: Verify RED and implement lifecycle behavior**

Sockets close after entering background; DBB3 keeps work running. Foreground resume performs one handshake, one active-conversation fetch, and one event reconnect. The memory-only outbox retries in original order and is never written to Secure Store or the filesystem.

- [ ] **Step 3: Implement separate app/backend update flows**

App update checks GitHub Releases and opens the unsigned IPA asset. Backend update first compares `api_version`, `minimum_app_version`, and capability requirements; incompatible updates stay disabled with a concrete explanation. Keep the current Hermes update confirmation dialog.

- [ ] **Step 4: Update CI and run tests**

CI must reject any `react-native-webview` dependency/import, run tests/typecheck/Doctor, run Expo prebuild, build unsigned IPA, verify entitlements include notifications and Face ID usage text, and upload SHA-256.

- [ ] **Step 5: Commit**

```powershell
git add src/lifecycle src/updates src/app tests .github
git commit -m "feat: harden native lifecycle and controlled updates"
```

---

### Task 12: Parity Audit, Device Verification, Deployment, and Native v2 Beta IPA

**Files:**
- Create: `docs/native-v2-parity.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `app.json`
- Modify: `../hermes-agent/deploy/dbb3/deploy-collaboration-dashboard.sh`
- Modify: `../hermes-agent/plugins/collaboration/dashboard/manifest.json`

**Interfaces:**
- Produces: a route/action parity matrix, deployed Mobile API/notification backend, and side-by-side beta IPA.

- [ ] **Step 1: Generate and complete the parity matrix**

The matrix must list every frozen page, visible control, API route, mutation, loading/empty/error state, profile scope, destructive confirmation, and native adaptation. No row may remain unverified.

- [ ] **Step 2: Run complete fresh verification**

Run iOS:

```powershell
npx pnpm test
npx pnpm typecheck
npx pnpm doctor
npx expo export --platform ios
```

Run Hermes:

```bash
scripts/run_tests.sh tests/hermes_cli/dashboard_auth/test_mobile_api_auth.py tests/plugins/test_collaboration_dashboard.py tests/plugins/test_mobile_notifications.py -q
npm test --workspace web
npm run build --workspace web
```

Expected: zero test failures, zero type errors, Expo Doctor all checks passing, iOS export exit 0, Web tests/build exit 0.

- [ ] **Step 3: Verify native layouts with real content**

Verify iPhone `402x874` and iPad `834x1194` in portrait and landscape. Check nonblank rendering, sidebar/drawer behavior, long Chinese labels, keyboard/composer geometry, 50+ message transcripts, activity expansion, every modal, file flows, offline/reconnect, profile switching, and no overlap or horizontal clipping.

- [ ] **Step 4: Deploy the backend with rollback**

Generate a new mobile API key on DBB3 without printing it, configure APNs secrets, back up the installed plugin, deploy atomically, restart only the dashboard when required, and verify browser cookie auth plus native bearer auth. Do not modify model, proxy, Profile, Feishu, or Kanban data.

- [ ] **Step 5: Build and publish `v2.0.0-beta.1`**

Use bundle id `com.given33.hermesagent.nativebeta`, publish the unsigned IPA and SHA-256 to GitHub, and verify it installs beside v1.0.7. Do not replace the production bundle id until parity acceptance is recorded.

- [ ] **Step 6: Final review and branch completion**

Run a broad code review against both branch merge bases, fix every Critical/Important finding, rerun all affected tests, then follow `finishing-a-development-branch` without merging until the user chooses the integration option.
