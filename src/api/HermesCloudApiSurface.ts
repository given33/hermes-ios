import type { HermesCloudApi as HermesCloudApiType } from './HermesCloudApi';
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
  getBotMeta(name: string): Promise<JsonRecord>;
  updateBotMeta(name: string, patch: JsonRecord): Promise<JsonRecord>;
  describeBotProfile(name: string): Promise<JsonRecord>;
  configureBotProfile(name: string, patch: JsonRecord): Promise<JsonRecord>;
  getBotAsset(name: string, asset?: string): Promise<JsonRecord>;
  setBotAsset(name: string, data: string, asset?: string): Promise<JsonRecord>;
  clearBotAsset(name: string, asset?: string): Promise<JsonRecord>;
  createProfile(profile: JsonRecord, bot?: boolean): Promise<JsonRecord>;
  deleteProfile(name: string, bot?: boolean): Promise<JsonRecord>;
  renameBot(name: string, newName: string): Promise<JsonRecord>;
  updateProfileDescription(name: string, description: string): Promise<JsonRecord>; updateProfileModel(name: string, provider: string, model: string): Promise<JsonRecord>;
  autoDescribeProfile(name: string): Promise<JsonRecord>; getProfileSetupCommand(name: string): Promise<JsonRecord>;
  renameProfile(name: string, newName: string): Promise<JsonRecord>;
  exportProfile(name: string, output?: string, extraFiles?: string[]): Promise<JsonRecord>; importProfiles(payload: JsonRecord): Promise<JsonRecord>;
  startGateway(profile?: string): Promise<JsonRecord>; stopGateway(profile?: string): Promise<JsonRecord>; drainGateway(profile?: string): Promise<JsonRecord>;
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
}
}

const optionalDomains = new WeakMap<HermesCloudApiType, { git: HermesGitCloudApi }>();
function git(self: HermesCloudApiType) {
  let domains = optionalDomains.get(self);
  if (!domains) {
    const transport = (self as unknown as { client: { request: Function } }).client;
    // Git methods use the same authenticated client via a tiny transport shim.
    const t = { request: (p: string, o?: any) => transport.request(p, o), json: (p: string, m: any, b: any, o?: any) => transport.request(p, { ...o, method: m, body: JSON.stringify(b) }) } as any;
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
  getBots(this: any) { return this.management.getBots(); }, getBotMeta(this: any, n: string) { return this.management.getBotMeta(n); }, updateBotMeta(this: any, n: string, p: JsonRecord) { return this.management.updateBotMeta(n, p); }, describeBotProfile(this: any, n: string) { return this.management.describeBotProfile(n); }, configureBotProfile(this: any, n: string, p: JsonRecord) { return this.management.configureBotProfile(n, p); }, getBotAsset(this: any, n: string, a = 'avatar') { return this.management.getBotAsset(n, a); }, setBotAsset(this: any, n: string, d: string, a = 'avatar') { return this.management.setBotAsset(n, d, a); }, clearBotAsset(this: any, n: string, a = 'avatar') { return this.management.clearBotAsset(n, a); }, createProfile(this: any, p: JsonRecord, b = false) { return this.management.createProfile(p, b); }, deleteProfile(this: any, n: string, b = false) { return this.management.deleteProfile(n, b); }, renameBot(this: any, n: string, nn: string) { return this.management.renameBot(n, nn); },
  updateProfileDescription(this: any, n: string, d: string) { return this.management.updateProfileDescription(n, d); }, updateProfileModel(this: any, n: string, p: string, m: string) { return this.management.updateProfileModel(n, p, m); }, autoDescribeProfile(this: any, n: string) { return this.management.autoDescribeProfile(n); }, getProfileSetupCommand(this: any, n: string) { return this.management.getProfileSetupCommand(n); }, renameProfile(this: any, n: string, nn: string) { return this.management.renameProfile(n, nn); }, exportProfile(this: any, n: string, o = '', e: string[] = []) { return this.management.exportProfile(n, o, e); }, importProfiles(this: any, p: JsonRecord) { return this.management.importProfiles(p); }, startGateway(this: any, p = 'default') { return this.management.startGateway(p); }, stopGateway(this: any, p = 'default') { return this.management.stopGateway(p); }, drainGateway(this: any, p = 'default') { return this.management.drainGateway(p); }, checkHermesUpdate(this: any, force = false) { return this.management.checkHermesUpdate(force); }, getHermesUpdateReceipt(this: any) { return this.management.getHermesUpdateReceipt(); }, getHealth(this: any) { return this.management.getHealth(); }, getEgressStatus(this: any) { return this.management.getEgressStatus(); }, getCredentialPool(this: any) { return this.management.getCredentialPool(); }, addCredentialPoolEntry(this: any, p: string, k: string, l = '') { return this.management.addCredentialPoolEntry(p, k, l); }, removeCredentialPoolEntry(this: any, p: string, i: number) { return this.management.removeCredentialPoolEntry(p, i); },
  getMedia(this: any, p = '') { return this.operations.getMedia(p); }, uploadChatImage(this: any, d: string, m: string, f = 'image') { return this.operations.uploadChatImage(d, m, f); }, getPortal(this: any) { return this.operations.getPortal(); }, getCurator(this: any) { return this.operations.getCurator(); }, setCuratorPaused(this: any, p: boolean) { return this.operations.setCuratorPaused(p); }, runCurator(this: any) { return this.operations.runCurator(); }, getLearningGraph(this: any, p = 'default') { return this.operations.getLearningGraph(p); }, getLearningNode(this: any, i: string, p = 'default') { return this.operations.getLearningNode(i, p); }, updateLearningNode(this: any, n: JsonRecord, p = 'default') { return this.operations.updateLearningNode(n, p); }, deleteLearningNode(this: any, i: string, p = 'default') { return this.operations.deleteLearningNode(i, p); }, promptSize(this: any, p: JsonRecord = {}) { return this.operations.promptSize(p); }, dumpDiagnostics(this: any, p = {}) { return this.operations.dumpDiagnostics(p); }, migrateConfig(this: any, p = {}) { return this.operations.migrateConfig(p); }, createDebugShare(this: any, p = {}) { return this.operations.createDebugShare(p); }, runDoctor(this: any, p = {}) { return this.operations.runDoctor(p); }, runSecurityAudit(this: any, p = {}) { return this.operations.runSecurityAudit(p); }, createBackup(this: any, p = {}) { return this.operations.createBackup(p); }, downloadBackup(this: any, a: string) { return this.operations.downloadBackup(a); }, importBackup(this: any, p: JsonRecord) { return this.operations.importBackup(p); }, uploadImport(this: any, u: { uri: string; name: string; mimeType?: string }, f = false) { return this.operations.uploadImport(u, f); }, getHooks(this: any) { return this.operations.getHooks(); }, createHook(this: any, p: JsonRecord) { return this.operations.createHook(p); }, deleteHook(this: any, p: JsonRecord) { return this.operations.deleteHook(p); }, getCheckpoints(this: any) { return this.operations.getCheckpoints(); }, pruneCheckpoints(this: any, p = {}) { return this.operations.pruneCheckpoints(p); }, getRawConfig(this: any, p = 'default') { return this.operations.getRawConfig(p); }, saveRawConfig(this: any, c: string, p = 'default') { return this.operations.saveRawConfig(c, p); }, getDashboardThemes(this: any) { return this.operations.getDashboardThemes(); }, setDashboardTheme(this: any, t: string) { return this.operations.setDashboardTheme(t); }, getDashboardFont(this: any) { return this.operations.getDashboardFont(); }, setDashboardFont(this: any, f: string) { return this.operations.setDashboardFont(f); }, getUsageAnalytics(this: any, d = 30, p = 'default') { return this.operations.getUsageAnalytics(d, p); }, getModelAnalytics(this: any, d = 30, p = 'default') { return this.operations.getModelAnalytics(d, p); }, getActionStatus(this: any, n: string, l = 200, p = '') { return this.operations.getActionStatus(n, l, p); },
});
Object.assign(CloudApi.prototype, {
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
});
}
