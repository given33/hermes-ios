import type { HermesCloudApi as HermesCloudApiType } from './HermesCloudApi';
import type { MobileHostedCommand, MobileHostedCommandResult } from './cloud/console';
import { HermesGitCloudApi } from './cloud/git';
import type { JsonRecord } from './cloud/transport';

/**
 * Optional surface methods are installed outside the facade's composition
 * root.  This keeps the facade below its architectural size ratchet while
 * preserving a typed, named method for every upstream dashboard endpoint.
 */
declare module './HermesCloudApi' {
export interface HermesCloudApi {
  getMemoryStatus(profile?: string): Promise<JsonRecord>; setMemoryProvider(provider: string, profile?: string): Promise<JsonRecord>;
  resetMemory(target?: 'all' | 'memory' | 'user', profile?: string): Promise<JsonRecord>;
  getMemoryProviderConfig(name: string, profile?: string, surface?: string): Promise<JsonRecord>;
  setupMemoryProvider(name: string, values?: JsonRecord): Promise<JsonRecord>;
  updateMemoryProviderConfig(name: string, values: JsonRecord, profile?: string, surface?: string): Promise<JsonRecord>;
  startMemoryProviderOAuth(name: string, profile?: string): Promise<JsonRecord>;
  getMemoryProviderOAuthStatus(name: string, profile?: string): Promise<JsonRecord>;
  getGitStatus(path: string): Promise<JsonRecord>; getGitGhAuth(refresh?: boolean): Promise<JsonRecord>;
  getGitWorktrees(path: string): Promise<JsonRecord>; getGitBranches(path: string): Promise<JsonRecord>;
  getGitBaseBranches(path: string): Promise<JsonRecord>; getGitReviewList(path: string, scope?: string, base?: string): Promise<JsonRecord>;
  getGitReviewDiff(path: string, file: string, scope?: string, base?: string, staged?: boolean): Promise<JsonRecord>;
  getGitFileDiff(path: string, file: string): Promise<JsonRecord>; getGitCommitContext(path: string): Promise<JsonRecord>;
  getGitRevParse(path: string, ref?: string): Promise<JsonRecord>; getGitShipInfo(path: string): Promise<JsonRecord>;
  listGitPullRequests(path: string, branches?: string[], numbers?: number[]): Promise<JsonRecord>;
  stageGitFile(path: string, file: string): Promise<JsonRecord>; unstageGitFile(path: string, file: string): Promise<JsonRecord>;
  revertGitFile(path: string, file: string): Promise<JsonRecord>; commitGit(path: string, message: string, push?: boolean): Promise<JsonRecord>;
  pushGit(path: string): Promise<JsonRecord>; createGitPullRequest(path: string): Promise<JsonRecord>;
  addGitWorktree(path: string, options?: { name?: string; branch?: string; base?: string; existingBranch?: string }): Promise<JsonRecord>;
  removeGitWorktree(path: string, worktreePath: string, force?: boolean): Promise<JsonRecord>;
  switchGitBranch(path: string, branch: string): Promise<JsonRecord>;
  streamFile(path: string, signal?: AbortSignal): Promise<Response>; listFilesystem(path?: string, depth?: number): Promise<JsonRecord>;
  readFilesystemText(path: string): Promise<JsonRecord>; writeFilesystemText(path: string, content: string): Promise<JsonRecord>;
  readFilesystemDataUrl(path: string): Promise<JsonRecord>; downloadFilesystem(path: string): Promise<Response>;
  getGitRoot(path?: string): Promise<JsonRecord>; getDefaultCwd(): Promise<JsonRecord>;
  getRecommendedDefaultModel(provider?: string): Promise<JsonRecord>; getAuxiliaryModels(profile?: string): Promise<JsonRecord>;
  getMoaModels(profile?: string): Promise<JsonRecord>; saveMoaModels(config: JsonRecord, profile?: string): Promise<JsonRecord>;
  getCustomProviderEndpoints(profile?: string): Promise<JsonRecord>; saveCustomProviderEndpoint(config: JsonRecord, profile?: string): Promise<JsonRecord>;
  activateCustomProviderEndpoint(id: string, profile?: string): Promise<JsonRecord>; deleteCustomProviderEndpoint(id: string, profile?: string): Promise<JsonRecord>;
  validateCustomProviderEndpoint(config: JsonRecord): Promise<JsonRecord>; validateProviderCredential(config: JsonRecord): Promise<JsonRecord>;
  getProviderOauth(): Promise<JsonRecord>; startProviderOauth(provider: string, body?: JsonRecord): Promise<JsonRecord>;
  submitProviderOauth(provider: string, body: JsonRecord): Promise<JsonRecord>; pollProviderOauth(provider: string, sessionId: string): Promise<JsonRecord>;
  cancelProviderOauth(sessionId: string): Promise<JsonRecord>;
  getToolsetConfig(name: string, profile?: string): Promise<JsonRecord>; setToolsetEnabled(name: string, enabled: boolean, profile?: string): Promise<JsonRecord>;
  getTerminalBackends(profile?: string): Promise<JsonRecord>; setTerminalBackend(backend: string, profile?: string): Promise<JsonRecord>;
  getComputerUseStatus(profile?: string): Promise<JsonRecord>; grantComputerUsePermissions(profile?: string): Promise<JsonRecord>;
  authMcpServer(name: string, profile?: string): Promise<JsonRecord>; getMcpOauthFlow(flowId: string): Promise<JsonRecord>;
  cancelMcpOauthFlow(flowId: string): Promise<JsonRecord>;
  testChannel(id: string, profile?: string): Promise<JsonRecord>; startTelegramOnboarding(botName?: string, profile?: string): Promise<JsonRecord>;
  getTelegramOnboarding(pairingId: string): Promise<JsonRecord>; applyTelegramOnboarding(pairingId: string, ids: string[], profile?: string): Promise<JsonRecord>;
  cancelTelegramOnboarding(pairingId: string): Promise<JsonRecord>; startWhatsappOnboarding(mode?: string, users?: string, profile?: string): Promise<JsonRecord>;
  getWhatsappOnboarding(pairingId: string): Promise<JsonRecord>; applyWhatsappOnboarding(pairingId: string, body: JsonRecord, profile?: string): Promise<JsonRecord>;
  cancelWhatsappOnboarding(pairingId: string): Promise<JsonRecord>;
  getBots(): Promise<JsonRecord>;
  ensureBotCanonicalChat(name: string): Promise<JsonRecord>;
  getBotMeta(name: string): Promise<JsonRecord>;
  updateBotMeta(name: string, patch: JsonRecord): Promise<JsonRecord>;
  describeBotProfile(name: string): Promise<JsonRecord>;
  configureBotProfile(name: string, patch: JsonRecord): Promise<JsonRecord>;
  getBotAsset(name: string, asset?: string): Promise<JsonRecord>;
  setBotAsset(name: string, data: string, asset?: string): Promise<JsonRecord>;
  clearBotAsset(name: string, asset?: string): Promise<JsonRecord>;
  generateBotAvatar(name: string, prompt?: string): Promise<JsonRecord>;
  getBotPetGallery(): Promise<JsonRecord>;
  setBotPetAvatar(name: string, slug: string, url?: string): Promise<JsonRecord>;
  getBotRelayRoster(): Promise<JsonRecord>;
  sendBotRelayMessage(target: string, message: string, senderProfile?: string): Promise<JsonRecord>;
  createProfile(profile: JsonRecord, bot?: boolean): Promise<JsonRecord>;
  deleteProfile(name: string, bot?: boolean): Promise<JsonRecord>;
  renameBot(name: string, newName: string): Promise<JsonRecord>;
  updateProfileDescription(name: string, description: string): Promise<JsonRecord>; updateProfileModel(name: string, provider: string, model: string): Promise<JsonRecord>;
  autoDescribeProfile(name: string): Promise<JsonRecord>; getProfileSetupCommand(name: string): Promise<JsonRecord>;
  renameProfile(name: string, newName: string): Promise<JsonRecord>;
  exportProfile(name: string, output?: string, extraFiles?: string[]): Promise<JsonRecord>; importProfiles(payload: JsonRecord): Promise<JsonRecord>;
  startGateway(profile?: string): Promise<JsonRecord>; stopGateway(profile?: string): Promise<JsonRecord>; drainGateway(profile?: string): Promise<JsonRecord>;
  getAuthProviders(): Promise<JsonRecord>; getAuthMe(): Promise<JsonRecord>;
  checkHermesUpdate(force?: boolean): Promise<JsonRecord>; getHermesUpdateReceipt(): Promise<JsonRecord>; getHealth(): Promise<JsonRecord>; getEgressStatus(): Promise<JsonRecord>;
  getCredentialPool(): Promise<JsonRecord>; addCredentialPoolEntry(provider: string, apiKey: string, label?: string): Promise<JsonRecord>;
  removeCredentialPoolEntry(provider: string, index: number): Promise<JsonRecord>;
  getMedia(path?: string): Promise<JsonRecord>; uploadChatImage(dataUrl: string, mimeType: string, filename?: string): Promise<JsonRecord>;
  getPortal(): Promise<JsonRecord>; getCurator(): Promise<JsonRecord>; setCuratorPaused(paused: boolean): Promise<JsonRecord>; runCurator(): Promise<JsonRecord>;
  getLearningGraph(profile?: string): Promise<JsonRecord>; getLearningNode(id: string, profile?: string): Promise<JsonRecord>; updateLearningNode(node: JsonRecord, profile?: string): Promise<JsonRecord>; deleteLearningNode(id: string, profile?: string): Promise<JsonRecord>;
  promptSize(payload: JsonRecord): Promise<JsonRecord>; dumpDiagnostics(payload?: JsonRecord): Promise<JsonRecord>; migrateConfig(payload?: JsonRecord): Promise<JsonRecord>; createDebugShare(payload?: JsonRecord): Promise<JsonRecord>;
  runDoctor(payload?: JsonRecord): Promise<JsonRecord>; runSecurityAudit(payload?: JsonRecord): Promise<JsonRecord>; createBackup(payload?: JsonRecord): Promise<JsonRecord>; downloadBackup(archive: string): Promise<Response>;
  importBackup(payload: JsonRecord): Promise<JsonRecord>; uploadImport(upload: { uri: string; name: string; mimeType?: string }, force?: boolean): Promise<JsonRecord>; getHooks(): Promise<JsonRecord>; createHook(payload: JsonRecord): Promise<JsonRecord>; deleteHook(payload: JsonRecord): Promise<JsonRecord>;
  getCheckpoints(): Promise<JsonRecord>; pruneCheckpoints(payload?: JsonRecord): Promise<JsonRecord>; getRawConfig(profile?: string): Promise<JsonRecord>; saveRawConfig(yamlText: string, profile?: string): Promise<JsonRecord>;
  getDashboardThemes(): Promise<JsonRecord>; setDashboardTheme(theme: string): Promise<JsonRecord>; getDashboardFont(): Promise<JsonRecord>; setDashboardFont(font: string): Promise<JsonRecord>;
  getUsageAnalytics(days?: number, profile?: string): Promise<JsonRecord>; getModelAnalytics(days?: number, profile?: string): Promise<JsonRecord>; getActionStatus(name: string, lines?: number, profile?: string): Promise<JsonRecord>;
  openSpeechStream(profile?: string, signal?: AbortSignal): Promise<WebSocket>;
  getDeliveryTargets(): Promise<JsonRecord>; getCronBlueprints(): Promise<JsonRecord>; instantiateCronBlueprint(blueprint: string, values?: JsonRecord, profile?: string): Promise<JsonRecord>;
  getCronJob(id: string, profile?: string): Promise<JsonRecord>; getCronJobRuns(id: string, profile?: string, limit?: number): Promise<JsonRecord>;
  getToolsetModels(name: string, provider?: string, profile?: string): Promise<JsonRecord>; setToolsetModel(name: string, model: string, provider?: string, profile?: string): Promise<JsonRecord>; getToolsetProviders(name: string, profile?: string): Promise<JsonRecord>; setToolsetProvider(name: string, provider: string, capability?: 'search' | 'extract', profile?: string): Promise<JsonRecord>; saveToolsetEnvironment(name: string, env: Record<string, string>, profile?: string): Promise<JsonRecord>; runToolsetPostSetup(name: string, key: string, profile?: string): Promise<JsonRecord>;
  installSkillHub(identifier: string, profile?: string): Promise<JsonRecord>; uninstallSkillHub(name: string, profile?: string): Promise<JsonRecord>; updateSkillsHub(profile?: string): Promise<JsonRecord>; getSkillHubSources(profile?: string): Promise<JsonRecord>; searchSkillHub(query?: string, source?: string, limit?: number, profile?: string): Promise<JsonRecord>; previewSkillHub(identifier: string, profile?: string): Promise<JsonRecord>; scanSkillHub(identifier: string, profile?: string): Promise<JsonRecord>;
  getManagedInstallation(operationId: string): Promise<JsonRecord>;
  revealEnvironmentVariable(key: string, profile?: string): Promise<JsonRecord>; openProfileTerminal(name: string): Promise<JsonRecord>; getProfileDesktopOverlay(name: string): Promise<JsonRecord>;
  enableWebhooks(): Promise<JsonRecord>;
  searchSessions(query: string, limit?: number, profile?: string, filters?: JsonRecord): Promise<JsonRecord>; getLatestDescendant(id: string, profile?: string): Promise<JsonRecord>; exportSession(id: string, profile?: string): Promise<JsonRecord>; setSessionArchived(id: string, archived: boolean, profile?: string): Promise<JsonRecord>; setSessionPinned(id: string, pinned: boolean, profile?: string): Promise<JsonRecord>; setSessionUnread(id: string, unread: boolean, profile?: string): Promise<JsonRecord>; bulkDeleteSessions(ids: string[], profile?: string): Promise<JsonRecord>; importSessions(sessions: JsonRecord[], profile?: string): Promise<JsonRecord>; countEmptySessions(profile?: string): Promise<JsonRecord>; deleteEmptySessions(profile?: string): Promise<JsonRecord>; getSessionStats(profile?: string): Promise<JsonRecord>; pruneSessions(payload?: JsonRecord, profile?: string): Promise<JsonRecord>;
  getProfileSessionsSidebar(options?: JsonRecord): Promise<JsonRecord>; getProfileProjectsTree(previewLimit?: number, sessionLimit?: number): Promise<JsonRecord>; scanProfileSessionPullRequests(ids: string[]): Promise<JsonRecord>;
  setConversationArchived(id: string, archived: boolean): Promise<JsonRecord>; setConversationPinned(id: string, pinned: boolean): Promise<JsonRecord>; setConversationUnread(id: string, unread: boolean): Promise<JsonRecord>;
  registerConversationArtifact(conversationId: string, input: { relativePath?: string; name?: string; artifactId?: string; status?: 'uploading' | 'available' | 'failed'; mimeType?: string; messageId?: string; turnId?: string; profile?: string; error?: string }, signal?: AbortSignal): Promise<{ file: JsonRecord }>;
  retryHostedTurn(conversationId: string, turnId: string, requestId: string, signal?: AbortSignal): Promise<{ hosted_turn: JsonRecord }>;
  getKanbanTask(id: string, options?: { board?: string; runStateType?: 'status' | 'outcome'; runStateName?: string }): Promise<JsonRecord>;
  openKanbanEventsWebSocket(cursor?: number, board?: string, deadlineMs?: number, signal?: AbortSignal): Promise<WebSocket>;
  deleteKanbanTask(id: string, board?: string): Promise<JsonRecord>;
  listKanbanTaskAttachments(taskId: string, board?: string): Promise<JsonRecord>;
  uploadKanbanTaskAttachment(taskId: string, file: Blob, filename: string, uploadedBy?: string, board?: string): Promise<JsonRecord>;
  downloadKanbanAttachment(id: number | string, board?: string): Promise<Blob>;
  deleteKanbanAttachment(id: number | string, board?: string): Promise<JsonRecord>;
  addKanbanComment(taskId: string, body: string, author?: string, board?: string): Promise<JsonRecord>;
  linkKanbanTasks(parentId: string, childId: string, board?: string): Promise<JsonRecord>;
  unlinkKanbanTasks(parentId: string, childId: string, board?: string): Promise<JsonRecord>;
  bulkUpdateKanbanTasks(ids: string[], update: JsonRecord, board?: string): Promise<JsonRecord>;
  getKanbanDiagnostics(options?: { board?: string; severity?: string }): Promise<JsonRecord>;
  getKanbanActiveWorkers(board?: string): Promise<JsonRecord>;
  getKanbanRun(id: number | string, board?: string): Promise<JsonRecord>;
  inspectKanbanRun(id: number | string, board?: string): Promise<JsonRecord>;
  terminateKanbanRun(id: number | string, reason?: string, board?: string): Promise<JsonRecord>;
  reclaimKanbanTask(taskId: string, reason?: string, board?: string): Promise<JsonRecord>;
  specifyKanbanTask(taskId: string, options?: { author?: string }, board?: string): Promise<JsonRecord>;
  reassignKanbanTask(taskId: string, profile: string, reclaim?: boolean, board?: string, reason?: string): Promise<JsonRecord>;
  estimateKanbanText(title: string, body?: string): Promise<JsonRecord>;
  estimateKanbanTask(taskId: string, board?: string): Promise<JsonRecord>;
  decomposeKanbanTask(taskId: string, options?: { author?: string }, board?: string): Promise<JsonRecord>;
  getKanbanTaskLog(taskId: string, options?: { board?: string; tail?: number }): Promise<JsonRecord>;
  dispatchKanban(options?: { board?: string; dryRun?: boolean; max?: number }): Promise<JsonRecord>;
  getKanbanModelOptions(): Promise<JsonRecord>; getKanbanConfig(): Promise<JsonRecord>;
  getKanbanHomeChannels(taskId?: string, board?: string): Promise<JsonRecord>;
  subscribeKanbanHome(taskId: string, platform: string, board?: string): Promise<JsonRecord>;
  unsubscribeKanbanHome(taskId: string, platform: string, board?: string): Promise<JsonRecord>;
  getKanbanStats(board?: string): Promise<JsonRecord>; getKanbanAssignees(board?: string): Promise<JsonRecord>;
  getKanbanProjects(): Promise<JsonRecord>; getKanbanBoards(includeArchived?: boolean): Promise<JsonRecord>;
  createKanbanBoard(payload: JsonRecord): Promise<JsonRecord>; updateKanbanBoard(slug: string, payload: JsonRecord): Promise<JsonRecord>;
  deleteKanbanBoard(slug: string, hardDelete?: boolean): Promise<JsonRecord>; exportKanbanBoard(slug: string, options?: { output?: string; attachments?: boolean; logs?: boolean }): Promise<JsonRecord>;
  importKanbanBoard(archive: string, slug?: string, switchBoard?: boolean): Promise<JsonRecord>; switchKanbanBoard(slug: string): Promise<JsonRecord>;
  getKanbanProfiles(): Promise<JsonRecord>; updateKanbanProfile(profile: string, description: string): Promise<JsonRecord>;
  describeKanbanProfile(profile: string, overwrite?: boolean): Promise<JsonRecord>;
  getKanbanOrchestration(): Promise<JsonRecord>; setKanbanOrchestration(payload: JsonRecord): Promise<JsonRecord>;
  getAchievementScanStatus(): Promise<JsonRecord>; getRecentAchievementUnlocks(): Promise<JsonRecord>;
  getSessionAchievementBadges(sessionId: string): Promise<JsonRecord>; resetAchievementState(): Promise<JsonRecord>;
  getCollaborationRoomMailbox(id: string, recipientId: string, afterId?: string, limit?: number): Promise<JsonRecord>;
  sendCollaborationRoomMailboxMessage(id: string, senderId: string, recipientId: string, body: JsonRecord, idempotencyKey?: string): Promise<JsonRecord>;
  getCollaborationRoomDependencies(id: string): Promise<JsonRecord>;
  setCollaborationRoomDependencies(id: string, nodes: JsonRecord[]): Promise<JsonRecord>;
  executeMobileHostedCommand(conversationId: string, command: MobileHostedCommand, text?: string, value?: string): Promise<MobileHostedCommandResult>;
}
}

const optionalDomains = new WeakMap<HermesCloudApiType, { git: HermesGitCloudApi }>();
function git(self: HermesCloudApiType) {
  let domains = optionalDomains.get(self);
  if (!domains) {
    const facade = self as unknown as {
      client: { request: Function };
      request: Function;
    };
    // Git is the one optional domain that cannot be retained as a facade
    // field because the facade has a physical-size budget.  Keep its tiny
    // transport shim on the same authenticated facade request path.  The
    // previous shim called the raw client directly for JSON mutations and
    // omitted Content-Type, which made FastAPI treat the body as text/plain
    // on real iOS requests (all Git writes then failed validation with 422).
    const t = {
      request: (p: string, o?: any) => facade.client.request(p, o),
      json: (p: string, m: any, b: any, o?: any) => facade.request(p, {
        ...o,
        method: m,
        headers: {
          ...Object.fromEntries(new Headers(o?.headers).entries()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(b),
      }),
    } as any;
    domains = { git: new HermesGitCloudApi(t) };
    optionalDomains.set(self, domains);
  }
  return domains.git;
}

export function installHermesCloudApiSurface(CloudApi: { prototype: object }) {
Object.assign(CloudApi.prototype, {
  getMemoryStatus(this: any, p = 'default') { return this.memory.getMemoryStatus(p); }, setMemoryProvider(this: any, provider: string, p = 'default') { return this.memory.setMemoryProvider(provider, p); }, resetMemory(this: any, t = 'all', p = 'default') { return this.memory.resetMemory(t, p); }, getMemoryProviderConfig(this: any, n: string, p = 'default', s = '') { return this.memory.getMemoryProviderConfig(n, p, s); }, setupMemoryProvider(this: any, n: string, v = {}) { return this.memory.setupMemoryProvider(n, v); }, updateMemoryProviderConfig(this: any, n: string, v: JsonRecord, p = 'default', s = '') { return this.memory.updateMemoryProviderConfig(n, v, p, s); }, startMemoryProviderOAuth(this: any, n: string, p = 'default') { return this.memory.startMemoryProviderOAuth(n, p); }, getMemoryProviderOAuthStatus(this: any, n: string, p = 'default') { return this.memory.getMemoryProviderOAuthStatus(n, p); },
  getGitStatus(this: HermesCloudApiType, p: string) { return git(this).getStatus(p); }, getGitGhAuth(this: HermesCloudApiType, r = false) { return git(this).getGhAuth(r); }, getGitWorktrees(this: HermesCloudApiType, p: string) { return git(this).getWorktrees(p); }, getGitBranches(this: HermesCloudApiType, p: string) { return git(this).getBranches(p); }, getGitBaseBranches(this: HermesCloudApiType, p: string) { return git(this).getBaseBranches(p); }, getGitReviewList(this: HermesCloudApiType, p: string, s = 'uncommitted', b = '') { return git(this).getReviewList(p, s, b); }, getGitReviewDiff(this: HermesCloudApiType, p: string, f: string, s = 'uncommitted', b = '', st = false) { return git(this).getReviewDiff(p, f, s, b, st); }, getGitFileDiff(this: HermesCloudApiType, p: string, f: string) { return git(this).getFileDiff(p, f); }, getGitCommitContext(this: HermesCloudApiType, p: string) { return git(this).getCommitContext(p); }, getGitRevParse(this: HermesCloudApiType, p: string, r = '') { return git(this).getRevParse(p, r); }, getGitShipInfo(this: HermesCloudApiType, p: string) { return git(this).getShipInfo(p); }, listGitPullRequests(this: HermesCloudApiType, p: string, b = [], n = []) { return git(this).listPullRequests(p, b, n); }, stageGitFile(this: HermesCloudApiType, p: string, f: string) { return git(this).stage(p, f); }, unstageGitFile(this: HermesCloudApiType, p: string, f: string) { return git(this).unstage(p, f); }, revertGitFile(this: HermesCloudApiType, p: string, f: string) { return git(this).revert(p, f); }, commitGit(this: HermesCloudApiType, p: string, m: string, push = false) { return git(this).commit(p, m, push); }, pushGit(this: HermesCloudApiType, p: string) { return git(this).push(p); }, createGitPullRequest(this: HermesCloudApiType, p: string) { return git(this).createPullRequest(p); }, addGitWorktree(this: HermesCloudApiType, p: string, o = {}) { return git(this).addWorktree(p, o); }, removeGitWorktree(this: HermesCloudApiType, p: string, w: string, f = false) { return git(this).removeWorktree(p, w, f); }, switchGitBranch(this: HermesCloudApiType, p: string, b: string) { return git(this).switchBranch(p, b); },
  streamFile(this: any, p: string, s?: AbortSignal) { return this.files.streamFile(p, s); }, listFilesystem(this: any, p = '', d = 1) { return this.files.listFilesystem(p, d); }, readFilesystemText(this: any, p: string) { return this.files.readFilesystemText(p); }, writeFilesystemText(this: any, p: string, c: string) { return this.files.writeFilesystemText(p, c); }, readFilesystemDataUrl(this: any, p: string) { return this.files.readFilesystemDataUrl(p); }, downloadFilesystem(this: any, p: string) { return this.files.downloadFilesystem(p); }, getGitRoot(this: any, p = '') { return this.files.getGitRoot(p); }, getDefaultCwd(this: any) { return this.files.getDefaultCwd(); },
  getRecommendedDefaultModel(this: any, p = '') { return this.models.getRecommendedDefault(p); }, getAuxiliaryModels(this: any, p = 'default') { return this.models.getAuxiliaryModels(p); }, getMoaModels(this: any, p = 'default') { return this.models.getMoaModels(p); }, saveMoaModels(this: any, c: JsonRecord, p = 'default') { return this.models.saveMoaModels(c, p); }, getCustomProviderEndpoints(this: any, p = 'default') { return this.models.getCustomProviderEndpoints(p); }, saveCustomProviderEndpoint(this: any, c: JsonRecord, p = 'default') { return this.models.saveCustomProviderEndpoint(c, p); }, activateCustomProviderEndpoint(this: any, i: string, p = 'default') { return this.models.activateCustomProviderEndpoint(i, p); }, deleteCustomProviderEndpoint(this: any, i: string, p = 'default') { return this.models.deleteCustomProviderEndpoint(i, p); }, validateCustomProviderEndpoint(this: any, c: JsonRecord) { return this.models.validateCustomProviderEndpoint(c); }, validateProviderCredential(this: any, c: JsonRecord) { return this.models.validateProviderCredential(c); }, getProviderOauth(this: any) { return this.models.getProviderOauth(); }, startProviderOauth(this: any, p: string, b = {}) { return this.models.startProviderOauth(p, b); }, submitProviderOauth(this: any, p: string, b: JsonRecord) { return this.models.submitProviderOauth(p, b); }, pollProviderOauth(this: any, p: string, s: string) { return this.models.pollProviderOauth(p, s); }, cancelProviderOauth(this: any, s: string) { return this.models.cancelProviderOauth(s); },
  getToolsetConfig(this: any, n: string, p = 'default') { return this.extensions.getToolsetConfig(n, p); }, setToolsetEnabled(this: any, n: string, e: boolean, p = 'default') { return this.extensions.setToolsetEnabled(n, e, p); }, getTerminalBackends(this: any, p = 'default') { return this.extensions.getTerminalBackends(p); }, setTerminalBackend(this: any, b: string, p = 'default') { return this.extensions.setTerminalBackend(b, p); }, getComputerUseStatus(this: any, p = 'default') { return this.extensions.getComputerUseStatus(p); }, grantComputerUsePermissions(this: any, p = 'default') { return this.extensions.grantComputerUsePermissions(p); }, authMcpServer(this: any, n: string, p = 'default') { return this.extensions.authMcpServer(n, p); }, getMcpOauthFlow(this: any, f: string) { return this.extensions.getMcpOauthFlow(f); }, cancelMcpOauthFlow(this: any, f: string) { return this.extensions.cancelMcpOauthFlow(f); },
  testChannel(this: any, i: string, p = 'default') { return this.management.testChannel(i, p); }, startTelegramOnboarding(this: any, b = 'Hermes Agent', p = 'default') { return this.management.startTelegramOnboarding(b, p); }, getTelegramOnboarding(this: any, i: string) { return this.management.getTelegramOnboarding(i); }, applyTelegramOnboarding(this: any, i: string, ids: string[], p = 'default') { return this.management.applyTelegramOnboarding(i, ids, p); }, cancelTelegramOnboarding(this: any, i: string) { return this.management.cancelTelegramOnboarding(i); }, startWhatsappOnboarding(this: any, m = 'pairing', u = '', p = 'default') { return this.management.startWhatsappOnboarding(m, u, p); }, getWhatsappOnboarding(this: any, i: string) { return this.management.getWhatsappOnboarding(i); }, applyWhatsappOnboarding(this: any, i: string, b: JsonRecord, p = 'default') { return this.management.applyWhatsappOnboarding(i, b, p); }, cancelWhatsappOnboarding(this: any, i: string) { return this.management.cancelWhatsappOnboarding(i); },
  getBots(this: any) { return this.management.getBots(); }, ensureBotCanonicalChat(this: any, n: string) { return this.management.ensureBotCanonicalChat(n); }, getBotMeta(this: any, n: string) { return this.management.getBotMeta(n); }, updateBotMeta(this: any, n: string, p: JsonRecord) { return this.management.updateBotMeta(n, p); }, describeBotProfile(this: any, n: string) { return this.management.describeBotProfile(n); }, configureBotProfile(this: any, n: string, p: JsonRecord) { return this.management.configureBotProfile(n, p); }, getBotAsset(this: any, n: string, a = 'avatar') { return this.management.getBotAsset(n, a); }, setBotAsset(this: any, n: string, d: string, a = 'avatar') { return this.management.setBotAsset(n, d, a); }, clearBotAsset(this: any, n: string, a = 'avatar') { return this.management.clearBotAsset(n, a); }, generateBotAvatar(this: any, n: string, p = '') { return this.management.generateBotAvatar(n, p); }, getBotPetGallery(this: any) { return this.management.getBotPetGallery(); }, setBotPetAvatar(this: any, n: string, s: string, u = '') { return this.management.setBotPetAvatar(n, s, u); }, getBotRelayRoster(this: any) { return this.management.getBotRelayRoster(); }, sendBotRelayMessage(this: any, target: string, message: string, senderProfile = 'default') { return this.management.sendBotRelayMessage(target, message, senderProfile); }, createProfile(this: any, p: JsonRecord, b = false) { return this.management.createProfile(p, b); }, deleteProfile(this: any, n: string, b = false) { return this.management.deleteProfile(n, b); }, renameBot(this: any, n: string, nn: string) { return this.management.renameBot(n, nn); },
  updateProfileDescription(this: any, n: string, d: string) { return this.management.updateProfileDescription(n, d); }, updateProfileModel(this: any, n: string, p: string, m: string) { return this.management.updateProfileModel(n, p, m); }, autoDescribeProfile(this: any, n: string) { return this.management.autoDescribeProfile(n); }, getProfileSetupCommand(this: any, n: string) { return this.management.getProfileSetupCommand(n); }, renameProfile(this: any, n: string, nn: string) { return this.management.renameProfile(n, nn); }, exportProfile(this: any, n: string, o = '', e: string[] = []) { return this.management.exportProfile(n, o, e); }, importProfiles(this: any, p: JsonRecord) { return this.management.importProfiles(p); }, startGateway(this: any, p = 'default') { return this.management.startGateway(p); }, stopGateway(this: any, p = 'default') { return this.management.stopGateway(p); }, drainGateway(this: any, p = 'default') { return this.management.drainGateway(p); }, checkHermesUpdate(this: any, force = false) { return this.management.checkHermesUpdate(force); }, getHermesUpdateReceipt(this: any) { return this.management.getHermesUpdateReceipt(); }, getHealth(this: any) { return this.management.getHealth(); }, getEgressStatus(this: any) { return this.management.getEgressStatus(); }, getCredentialPool(this: any) { return this.management.getCredentialPool(); }, addCredentialPoolEntry(this: any, p: string, k: string, l = '') { return this.management.addCredentialPoolEntry(p, k, l); }, removeCredentialPoolEntry(this: any, p: string, i: number) { return this.management.removeCredentialPoolEntry(p, i); },
  getMedia(this: any, p = '') { return this.operations.getMedia(p); }, uploadChatImage(this: any, d: string, m: string, f = 'image') { return this.operations.uploadChatImage(d, m, f); }, getPortal(this: any) { return this.operations.getPortal(); }, getCurator(this: any) { return this.operations.getCurator(); }, setCuratorPaused(this: any, p: boolean) { return this.operations.setCuratorPaused(p); }, runCurator(this: any) { return this.operations.runCurator(); }, getLearningGraph(this: any, p = 'default') { return this.operations.getLearningGraph(p); }, getLearningNode(this: any, i: string, p = 'default') { return this.operations.getLearningNode(i, p); }, updateLearningNode(this: any, n: JsonRecord, p = 'default') { return this.operations.updateLearningNode(n, p); }, deleteLearningNode(this: any, i: string, p = 'default') { return this.operations.deleteLearningNode(i, p); }, promptSize(this: any, p: JsonRecord = {}) { return this.operations.promptSize(p); }, dumpDiagnostics(this: any, p = {}) { return this.operations.dumpDiagnostics(p); }, migrateConfig(this: any, p = {}) { return this.operations.migrateConfig(p); }, createDebugShare(this: any, p = {}) { return this.operations.createDebugShare(p); }, runDoctor(this: any, p = {}) { return this.operations.runDoctor(p); }, runSecurityAudit(this: any, p = {}) { return this.operations.runSecurityAudit(p); }, createBackup(this: any, p = {}) { return this.operations.createBackup(p); }, downloadBackup(this: any, a: string) { return this.operations.downloadBackup(a); }, importBackup(this: any, p: JsonRecord) { return this.operations.importBackup(p); }, uploadImport(this: any, u: { uri: string; name: string; mimeType?: string }, f = false) { return this.operations.uploadImport(u, f); }, getHooks(this: any) { return this.operations.getHooks(); }, createHook(this: any, p: JsonRecord) { return this.operations.createHook(p); }, deleteHook(this: any, p: JsonRecord) { return this.operations.deleteHook(p); }, getCheckpoints(this: any) { return this.operations.getCheckpoints(); }, pruneCheckpoints(this: any, p = {}) { return this.operations.pruneCheckpoints(p); }, getRawConfig(this: any, p = 'default') { return this.operations.getRawConfig(p); }, saveRawConfig(this: any, c: string, p = 'default') { return this.operations.saveRawConfig(c, p); }, getDashboardThemes(this: any) { return this.operations.getDashboardThemes(); }, setDashboardTheme(this: any, t: string) { return this.operations.setDashboardTheme(t); }, getDashboardFont(this: any) { return this.operations.getDashboardFont(); }, setDashboardFont(this: any, f: string) { return this.operations.setDashboardFont(f); }, getUsageAnalytics(this: any, d = 30, p = 'default') { return this.operations.getUsageAnalytics(d, p); }, getModelAnalytics(this: any, d = 30, p = 'default') { return this.operations.getModelAnalytics(d, p); }, getActionStatus(this: any, n: string, l = 200, p = '') { return this.operations.getActionStatus(n, l, p); },
});
Object.assign(CloudApi.prototype, {
  executeMobileHostedCommand(this: any, conversationId: string, command: MobileHostedCommand, text = '', value = '') { return this.console.executeHostedCommand(conversationId, command, text, value); },
  openSpeechStream(this: any, profile = 'default', signal?: AbortSignal) { return this.audio.openSpeechStream(profile, signal); },
  getDeliveryTargets(this: any) { return this.cron.getDeliveryTargets(); },
  getCronBlueprints(this: any) { return this.cron.getBlueprints(); },
  instantiateCronBlueprint(this: any, b: string, v: JsonRecord = {}, p = 'default') { return this.cron.instantiateBlueprint(b, v, p); },
  getCronJob(this: any, i: string, p = 'default') { return this.cron.getCronJob(i, p); },
  getCronJobRuns(this: any, i: string, p = 'default', l = 20) { return this.cron.getCronJobRuns(i, p, l); },
  getToolsetModels(this: any, n: string, p?: string, profile = 'default') { return this.extensions.getToolsetModels(n, p, profile); },
  setToolsetModel(this: any, n: string, m: string, p?: string, profile = 'default') { return this.extensions.setToolsetModel(n, m, p, profile); },
  getToolsetProviders(this: any, n: string, p = 'default') { return this.extensions.getToolsetProviders(n, p); },
  setToolsetProvider(this: any, n: string, p: string, c?: 'search' | 'extract', profile = 'default') { return this.extensions.setToolsetProvider(n, p, c, profile); },
  saveToolsetEnvironment(this: any, n: string, e: Record<string, string>, p = 'default') { return this.extensions.saveToolsetEnvironment(n, e, p); },
  runToolsetPostSetup(this: any, n: string, k: string, p = 'default') { return this.extensions.runToolsetPostSetup(n, k, p); },
  installSkillHub(this: any, i: string, p = 'default') { return this.extensions.installSkillHub(i, p); },
  uninstallSkillHub(this: any, n: string, p = 'default') { return this.extensions.uninstallSkillHub(n, p); },
  updateSkillsHub(this: any, p = 'default') { return this.extensions.updateSkillsHub(p); },
  getSkillHubSources(this: any, p = 'default') { return this.extensions.getSkillHubSources(p); },
  searchSkillHub(this: any, q = '', s = 'all', l = 20, p = 'default') { return this.extensions.searchSkillHub(q, s, l, p); },
  previewSkillHub(this: any, i: string, p = 'default') { return this.extensions.previewSkillHub(i, p); },
  scanSkillHub(this: any, i: string, p = 'default') { return this.extensions.scanSkillHub(i, p); },
  getManagedInstallation(this: any, i: string) { return this.extensions.getManagedInstallation(i); },
  revealEnvironmentVariable(this: any, k: string, p = 'default') { return this.management.revealEnvironmentVariable(k, p); },
  openProfileTerminal(this: any, n: string) { return this.management.openProfileTerminal(n); },
  getProfileDesktopOverlay(this: any, n: string) { return this.management.getProfileDesktopOverlay(n); },
  enableWebhooks(this: any) { return this.management.enableWebhooks(); },
  searchSessions(this: any, q: string, l = 20, p = 'default', f: JsonRecord = {}) { return this.sessions.searchSessions(q, l, p, f); },
  getLatestDescendant(this: any, i: string, p = 'default') { return this.sessions.getLatestDescendant(i, p); },
  exportSession(this: any, i: string, p = 'default') { return this.sessions.exportSession(i, p); },
  setSessionArchived(this: any, i: string, a: boolean, p = 'default') { return this.sessions.setSessionArchived(i, a, p); },
  setSessionPinned(this: any, i: string, v: boolean, p = 'default') { return this.sessions.setSessionPinned(i, v, p); },
  setSessionUnread(this: any, i: string, v: boolean, p = 'default') { return this.sessions.setSessionUnread(i, v, p); },
  bulkDeleteSessions(this: any, ids: string[], p = 'default') { return this.sessions.bulkDeleteSessions(ids, p); },
  importSessions(this: any, s: JsonRecord[], p = 'default') { return this.sessions.importSessions(s, p); },
  countEmptySessions(this: any, p = 'default') { return this.sessions.countEmptySessions(p); },
  deleteEmptySessions(this: any, p = 'default') { return this.sessions.deleteEmptySessions(p); },
  getSessionStats(this: any, p = 'default') { return this.sessions.getSessionStats(p); },
  pruneSessions(this: any, v: JsonRecord = {}, p = 'default') { return this.sessions.pruneSessions(v, p); },
  getProfileSessionsSidebar(this: any, o: JsonRecord = {}) { return this.sessions.getProfileSessionsSidebar(o); },
  getProfileProjectsTree(this: any, l = 3, s = 2000) { return this.sessions.getProfileProjectsTree(l, s); },
  scanProfileSessionPullRequests(this: any, ids: string[]) { return this.sessions.scanProfileSessionPullRequests(ids); },
  setConversationArchived(this: any, i: string, a: boolean) { return this.conversations.setConversationArchived(i, a); },
  setConversationPinned(this: any, i: string, p: boolean) { return this.conversations.setConversationPinned(i, p); },
  setConversationUnread(this: any, i: string, u: boolean) { return this.conversations.setConversationUnread(i, u); },
  registerConversationArtifact(this: any, i: string, p: any, s?: AbortSignal) { return this.conversations.registerConversationArtifact(i, p, s); },
  retryHostedTurn(this: any, i: string, t: string, r: string, s?: AbortSignal) { return this.conversations.retryHostedTurn(i, t, r, s); },
  getKanbanTask(this: any, i: string, o = {}) { return this.collaboration.getKanbanTask(i, o); },
  openKanbanEventsWebSocket(this: any, c = 0, b = '', d = 5_000, s?: AbortSignal) { return this.collaboration.openKanbanEventsWebSocket(c, b, d, s); },
  deleteKanbanTask(this: any, i: string, b?: string) { return this.collaboration.deleteKanbanTask(i, b); },
  listKanbanTaskAttachments(this: any, i: string, b?: string) { return this.collaboration.listKanbanTaskAttachments(i, b); },
  uploadKanbanTaskAttachment(this: any, i: string, f: Blob, n: string, u?: string, b?: string) { return this.collaboration.uploadKanbanTaskAttachment(i, f, n, u, b); },
  downloadKanbanAttachment(this: any, i: number | string, b?: string) { return this.collaboration.downloadKanbanAttachment(i, b); },
  deleteKanbanAttachment(this: any, i: number | string, b?: string) { return this.collaboration.deleteKanbanAttachment(i, b); },
  addKanbanComment(this: any, i: string, body: string, author?: string, b?: string) { return this.collaboration.addKanbanComment(i, body, author, b); },
  linkKanbanTasks(this: any, p: string, c: string, b?: string) { return this.collaboration.linkKanbanTasks(p, c, b); },
  unlinkKanbanTasks(this: any, p: string, c: string, b?: string) { return this.collaboration.unlinkKanbanTasks(p, c, b); },
  bulkUpdateKanbanTasks(this: any, ids: string[], update: JsonRecord, b?: string) { return this.collaboration.bulkUpdateKanbanTasks(ids, update, b); },
  getKanbanDiagnostics(this: any, o = {}) { return this.collaboration.getKanbanDiagnostics(o); },
  getKanbanActiveWorkers(this: any, b?: string) { return this.collaboration.getKanbanActiveWorkers(b); },
  getKanbanRun(this: any, i: number | string, b?: string) { return this.collaboration.getKanbanRun(i, b); },
  inspectKanbanRun(this: any, i: number | string, b?: string) { return this.collaboration.inspectKanbanRun(i, b); },
  terminateKanbanRun(this: any, i: number | string, reason = '', b?: string) { return this.collaboration.terminateKanbanRun(i, reason, b); },
  reclaimKanbanTask(this: any, i: string, reason = '', b?: string) { return this.collaboration.reclaimKanbanTask(i, reason, b); },
  specifyKanbanTask(this: any, i: string, o = {}, b?: string) { return this.collaboration.specifyKanbanTask(i, o, b); },
  reassignKanbanTask(this: any, i: string, p: string, r = false, b?: string, reason = '') { return this.collaboration.reassignKanbanTask(i, p, r, b, reason); },
  estimateKanbanText(this: any, t: string, body = '') { return this.collaboration.estimateKanbanText(t, body); },
  estimateKanbanTask(this: any, i: string, b?: string) { return this.collaboration.estimateKanbanTask(i, b); },
  decomposeKanbanTask(this: any, i: string, o = {}, b?: string) { return this.collaboration.decomposeKanbanTask(i, o, b); },
  getKanbanTaskLog(this: any, i: string, o = {}) { return this.collaboration.getKanbanTaskLog(i, o); },
  dispatchKanban(this: any, o = {}) { return this.collaboration.dispatchKanban(o); },
  getKanbanModelOptions(this: any) { return this.collaboration.getKanbanModelOptions(); },
  getKanbanConfig(this: any) { return this.collaboration.getKanbanConfig(); },
  getKanbanHomeChannels(this: any, i?: string, b?: string) { return this.collaboration.getKanbanHomeChannels(i, b); },
  subscribeKanbanHome(this: any, i: string, p: string, b?: string) { return this.collaboration.subscribeKanbanHome(i, p, b); },
  unsubscribeKanbanHome(this: any, i: string, p: string, b?: string) { return this.collaboration.unsubscribeKanbanHome(i, p, b); },
  getKanbanStats(this: any, b?: string) { return this.collaboration.getKanbanStats(b); },
  getKanbanAssignees(this: any, b?: string) { return this.collaboration.getKanbanAssignees(b); },
  getKanbanProjects(this: any) { return this.collaboration.getKanbanProjects(); },
  getKanbanBoards(this: any, a = false) { return this.collaboration.getKanbanBoards(a); },
  createKanbanBoard(this: any, p: JsonRecord) { return this.collaboration.createKanbanBoard(p); },
  updateKanbanBoard(this: any, s: string, p: JsonRecord) { return this.collaboration.updateKanbanBoard(s, p); },
  deleteKanbanBoard(this: any, s: string, d = false) { return this.collaboration.deleteKanbanBoard(s, d); },
  exportKanbanBoard(this: any, s: string, o = {}) { return this.collaboration.exportKanbanBoard(s, o); },
  importKanbanBoard(this: any, a: string, s?: string, sw = false) { return this.collaboration.importKanbanBoard(a, s, sw); },
  switchKanbanBoard(this: any, s: string) { return this.collaboration.switchKanbanBoard(s); },
  getKanbanProfiles(this: any) { return this.collaboration.getKanbanProfiles(); },
  updateKanbanProfile(this: any, p: string, d: string) { return this.collaboration.updateKanbanProfile(p, d); },
  describeKanbanProfile(this: any, p: string, o = false) { return this.collaboration.describeKanbanProfile(p, o); },
  getKanbanOrchestration(this: any) { return this.collaboration.getKanbanOrchestration(); },
  setKanbanOrchestration(this: any, p: JsonRecord) { return this.collaboration.setKanbanOrchestration(p); },
  getAchievementScanStatus(this: any) { return this.management.getAchievementScanStatus(); },
  getRecentAchievementUnlocks(this: any) { return this.management.getRecentAchievementUnlocks(); },
  getSessionAchievementBadges(this: any, i: string) { return this.management.getSessionAchievementBadges(i); },
  resetAchievementState(this: any) { return this.management.resetAchievementState(); },
  getAuthProviders(this: any) { return this.management.getAuthProviders(); },
  getAuthMe(this: any) { return this.management.getAuthMe(); },
  getCollaborationRoomMailbox(this: any, i: string, r: string, a = '', l = 100) { return this.collaboration.getCollaborationRoomMailbox(i, r, a, l); },
  sendCollaborationRoomMailboxMessage(this: any, i: string, s: string, r: string, b: JsonRecord, k = '') { return this.collaboration.sendCollaborationRoomMailboxMessage(i, s, r, b, k); },
  getCollaborationRoomDependencies(this: any, i: string) { return this.collaboration.getCollaborationRoomDependencies(i); },
  setCollaborationRoomDependencies(this: any, i: string, n: JsonRecord[]) { return this.collaboration.setCollaborationRoomDependencies(i, n); },
});
}
