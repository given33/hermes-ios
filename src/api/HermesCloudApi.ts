import type { HermesApiClient, HermesRequestOptions } from './HermesApiClient';
import {
  HermesAudioCloudApi,
  type AudioTranscriptionResult,
} from './cloud/audio';
import { HermesConversationsCloudApi } from './cloud/conversations';
import {
  HermesConsoleCloudApi,
  type MobileConsoleCatalog,
  type MobileConsoleCommand,
  type MobileConsoleCompletions,
  type MobileConsoleCompletionSuggestion,
  type MobileConsoleResult,
  type MobileConsoleStatus,
} from './cloud/console';
import {
  createCollaborationRequestId,
  HermesCollaborationCloudApi,
} from './cloud/collaboration';
import { HermesCronCloudApi } from './cloud/cron';
import { HermesFilesCloudApi } from './cloud/files';
import { HermesManagementCloudApi } from './cloud/management';
import {
  HermesExtensionsCloudApi,
  type ManagedInstallationRequest,
} from './cloud/extensions';
import {
  HermesMemoryCloudApi,
  type StudioMemoryContent,
} from './cloud/memory';
import {
  customModelApiKeyAction,
  HermesModelsCloudApi,
  type CustomModelConfiguration,
  type CustomModelConnectionResult,
  type CustomModelDiscoveryResult,
  type ModelAssignmentResult,
  type ModelInfoResult,
  type ModelOptionCapabilities,
  type ModelOptionPricing,
  type ModelOptionProvider,
  type ModelOptionsResult,
  type ModelsResult,
} from './cloud/models';
import type { CloudJsonMethod, HermesCloudTransport, JsonRecord } from './cloud/transport';
import { HermesWorkflowsCloudApi } from './cloud/workflows';
import { HermesSessionsCloudApi } from './cloud/sessions';
import { HermesOperationsCloudApi } from './cloud/operations';
import { loadCloudRoute } from './cloud/routes';
import { installHermesCloudApiSurface } from './HermesCloudApiSurface';
import type {
  AccountFileEntry,
  AccountFilesQuery,
  AccountFilesResponse,
  CollaborationMessage,
  CollaborationProfile,
  ConversationAttachmentUploadContext,
  ConversationCompressionResponse,
  ConversationForkResponse,
  ConversationSessionContext,
  ConversationSessionEntriesResponse,
  ConversationSessionEntry,
  ConversationSessionEntryType,
  ConversationSessionLineageEntry,
  ConversationSessionState,
  HostedTurnEnqueueInput,
  HostedTurnEnqueueResponse,
  ManagedFileEntry,
  ManagedFilesResponse,
  NativeUpload,
  PaginatedSessions,
  RouteDecision,
  SessionSummary,
  SingleConversation,
  ToolOutputArtifactEntry,
  ToolOutputArtifactsResponse,
  WorkflowWorkspaceAuditSummary,
  WorkflowWorkspaceChangeFile,
  WorkflowWorkspaceChangeSetDetail,
  WorkflowWorkspaceChangeSetSummary,
  WorkflowWorkspaceChangesResponse,
} from './cloud/contracts';
export type {
  AccountFileEntry,
  AccountFilesQuery,
  AccountFilesResponse,
  CollaborationMessage,
  CollaborationProfile,
  ConversationAttachmentUploadContext,
  ConversationCompressionResponse,
  ConversationForkResponse,
  ConversationSessionContext,
  ConversationSessionEntriesResponse,
  ConversationSessionEntry,
  ConversationSessionEntryType,
  ConversationSessionLineageEntry,
  ConversationSessionState,
  HostedTurnEnqueueInput,
  HostedTurnEnqueueResponse,
  ManagedFileEntry,
  ManagedFilesResponse,
  NativeUpload,
  PaginatedSessions,
  RouteDecision,
  SessionSummary,
  SingleConversation,
  ToolOutputArtifactEntry,
  ToolOutputArtifactsResponse,
  WorkflowWorkspaceAuditSummary,
  WorkflowWorkspaceChangeFile,
  WorkflowWorkspaceChangeSetDetail,
  WorkflowWorkspaceChangeSetSummary,
  WorkflowWorkspaceChangesResponse,
} from './cloud/contracts';
export type { StudioMemoryContent } from './cloud/memory';
export type { AudioTranscriptionResult } from './cloud/audio';
export type { ClientVoiceConfig, ClientVoiceProvider, ElevenLabsVoice } from './cloud/audio'; export type { ConversationSessionForkResponse, ConversationSessionLineageResponse } from './cloud/contracts';
export type {
  MobileConsoleCatalog,
  MobileConsoleCommand,
  MobileConsoleCompletions,
  MobileConsoleCompletionSuggestion,
  MobileConsoleResult,
  MobileConsoleStatus,
} from './cloud/console';
export {
  customApiMode,
  customModelApiKeyAction,
  customReasoningEffort,
  type CustomModelConfiguration,
  type CustomModelConnectionResult,
  type CustomModelDiscoveryResult,
  type ModelAssignmentResult,
  type ModelInfoResult,
  type ModelOptionCapabilities,
  type ModelOptionPricing,
  type ModelOptionProvider,
  type ModelOptionsResult,
  type ModelsResult,
} from './cloud/models';
export type { JsonRecord } from './cloud/transport';
export {
  officialConversationPlaceholderId,
  parseOfficialConversationPlaceholderId,
} from './conversation-identifiers';
export { mergeUnifiedConversationIndex } from './conversation-index';
export {
  conversationSessionSummary,
  HOSTED_TURN_FRESHNESS_MS,
  RUNTIME_RUN_FRESHNESS_MS,
  runningConversationRecordIsFresh,
} from './conversation-summary';
/**
 * Native facade over the canonical Dashboard and modified Collaboration APIs.
 * It intentionally stores no business data: every read and mutation goes to
 * the one server-side Hermes workspace shared by all signed-in devices.
 */
export class HermesCloudApi {
  // Domain modules (audit finding H8): endpoint bodies migrate out of this
  // file into src/api/cloud/<domain>.ts while the facade keeps the public
  // method names, so no call site changes. The modules receive only the
  // private transport closure below — they cannot be reached except through
  // this facade, and hermes-api-registry.ts stays the sole composition root.
  private readonly audio: HermesAudioCloudApi;
  private readonly cron: HermesCronCloudApi;
  private readonly collaboration: HermesCollaborationCloudApi;
  private readonly conversations: HermesConversationsCloudApi;
  private readonly console: HermesConsoleCloudApi;
  private readonly extensions: HermesExtensionsCloudApi;
  private readonly files: HermesFilesCloudApi;
  private readonly memory: HermesMemoryCloudApi;
  private readonly management: HermesManagementCloudApi;
  private readonly models: HermesModelsCloudApi;
  private readonly sessions: HermesSessionsCloudApi;
  private readonly workflows: HermesWorkflowsCloudApi;
  private readonly operations: HermesOperationsCloudApi;

  constructor(private readonly client: HermesApiClient) {
    const transport: HermesCloudTransport = {
      consumeDownload: <T>(
        path: string,
        consume: (response: Response, signal: AbortSignal) => Promise<T>,
        options?: HermesRequestOptions,
      ) => this.client.consumeDownload(path, consume, options),
      download: (path: string, options?: HermesRequestOptions) =>
        this.client.download(path, options),
      json: <T>(
        path: string,
        method: CloudJsonMethod,
        body: JsonRecord,
        options?: HermesRequestOptions,
      ) => this.json<T>(path, method, body, options),
      openEventStream: (
        path: string,
        options?: HermesRequestOptions,
      ) => this.client.openEventStream(path, options),
      openWebSocket: (path, options) => this.client.openWebSocket(path, options),
      request: <T>(path: string, options?: HermesRequestOptions) =>
        this.request<T>(path, options),
    };
    this.audio = new HermesAudioCloudApi(transport);
    this.cron = new HermesCronCloudApi(transport);
    this.collaboration = new HermesCollaborationCloudApi(transport);
    this.conversations = new HermesConversationsCloudApi(transport);
    this.console = new HermesConsoleCloudApi(transport);
    this.extensions = new HermesExtensionsCloudApi(transport);
    this.files = new HermesFilesCloudApi(transport);
    this.memory = new HermesMemoryCloudApi(transport);
    this.management = new HermesManagementCloudApi(transport);
    this.models = new HermesModelsCloudApi(transport);
    this.sessions = new HermesSessionsCloudApi(transport);
    this.workflows = new HermesWorkflowsCloudApi(transport);
    this.operations = new HermesOperationsCloudApi(transport);
  }

  /**
   * Internal transport shim — deliberately NOT public.
   *
   * While this was public it was an escape hatch that let any caller hand-roll
   * a path and bypass the typed surface entirely, so the "typed API" was not
   * actually a contract anyone had to honour. Nothing outside this class ever
   * used it (verified across `src/`), so closing it costs nothing and stops
   * the facade from being routed around as it grows.
   *
   * Need a new endpoint? Add a named method here (or, as the API is split by
   * domain, in the matching `cloud/<domain>` module) rather than reaching for
   * a raw path at the call site.
   */
  private request<T>(path: string, options?: HermesRequestOptions): Promise<T> {
    return this.client.request<T>(path, options);
  }

  getStudioMemory(profile: string): Promise<StudioMemoryContent> {
    return this.memory.getStudioMemory(profile);
  }

  saveStudioMemory(
    profile: string,
    section: 'memory' | 'soul' | 'user',
    content: string,
  ): Promise<StudioMemoryContent> {
    return this.memory.saveStudioMemory(profile, section, content);
  }
  getStatus() {
    return this.sessions.getStatus();
  }

  transcribeAudio(
    dataUrl: string,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<AudioTranscriptionResult> {
    return this.audio.transcribe(dataUrl, mimeType, signal);
  }

  getMobileConsoleCommands(profile = 'default', signal?: AbortSignal): Promise<MobileConsoleCatalog> {
    return this.console.getCommands(profile, signal);
  }

  getMobileConsoleCompletions(
    line: string,
    profile = 'default',
    signal?: AbortSignal,
  ): Promise<MobileConsoleCompletions> {
    return this.console.complete(line, profile, signal);
  }

  executeMobileConsoleCommand(
    line: string,
    profile = 'default',
    confirmed = false,
  ): Promise<MobileConsoleResult> {
    return this.console.execute(line, profile, confirmed);
  }

  getSessions(limit = 50, offset = 0, profile = 'default') {
    return this.sessions.getSessions(limit, offset, profile);
  }

  async getAllSessions(profile = 'default', pageSize = 100) {
    return this.sessions.getAllSessions(profile, pageSize);
  }

  getProfileSessions(limit = 100, offset = 0) {
    return this.sessions.getProfileSessions(limit, offset);
  }

  async getAllProfileSessions(pageSize = 100) {
    return this.sessions.getAllProfileSessions(pageSize);
  }

  getSession(id: string, profile = 'default') {
    return this.sessions.getSession(id, profile);
  }

  getSessionMessages(id: string, profile = 'default') {
    return this.sessions.getSessionMessages(id, profile);
  }

  renameSession(id: string, title: string, profile = 'default') {
    return this.sessions.renameSession(id, title, profile);
  }

  deleteSession(id: string, profile = 'default') {
    return this.sessions.deleteSession(id, profile);
  }

  listFiles(path = '') {
    return this.files.listFiles(path);
  }

  readFile(path: string) {
    return this.files.readFile(path);
  }

  createDirectory(path: string) {
    return this.files.createDirectory(path);
  }

  deleteFile(path: string, recursive = false) {
    return this.files.deleteFile(path, recursive);
  }

  downloadManagedFile(path: string) {
    return this.files.downloadManagedFile(path);
  }

  async uploadManagedFile(path: string, upload: NativeUpload, overwrite = true) {
    return this.files.uploadManagedFile(path, upload, overwrite);
  }

  getAnalytics(days = 30, profile = 'default') {
    return this.sessions.getAnalytics(days, profile);
  }

  getModels(profile = 'default'): Promise<ModelsResult> {
    return this.models.getModels(profile);
  }

  getModelInfo(profile = 'default') {
    return this.models.getModelInfo(profile);
  }

  getModelOptions(profile = 'default') {
    return this.models.getModelOptions(profile);
  }

  getCustomModel(profile = 'default'): Promise<CustomModelConfiguration> {
    return this.models.getCustomModel(profile);
  }

  saveCustomModel(configuration: CustomModelConfiguration, profile = 'default') {
    return this.models.saveCustomModel(configuration, profile);
  }

  testCustomModel(configuration: CustomModelConfiguration, profile = 'default') {
    return this.models.testCustomModel(configuration, profile);
  }

  async discoverCustomModels(
    baseUrl: string,
    apiKey = '',
    profile = 'default',
    apiMode?: CustomModelConfiguration['apiMode'],
  ): Promise<CustomModelDiscoveryResult> {
    return this.models.discoverCustomModels(baseUrl, apiKey, profile, apiMode);
  }

  async setModel(
    provider: string,
    model: string,
    profile = 'default',
    confirmExpensiveModel = false,
  ): Promise<ModelAssignmentResult> {
    return this.models.setModel(provider, model, profile, confirmExpensiveModel);
  }

  getLogs(lines = 500, level = 'ALL', component = 'all') {
    return this.sessions.getLogs(lines, level, component);
  }

  // Cron scheduling — bodies live in cloud/cron.ts (H8 domain split).
  getCronJobs(profile = 'all') {
    return this.cron.getCronJobs(profile);
  }

  createCronJob(job: JsonRecord, profile = 'default') {
    return this.cron.createCronJob(job, profile);
  }

  updateCronJob(id: string, updates: JsonRecord, profile = 'default') {
    return this.cron.updateCronJob(id, updates, profile);
  }

  setCronJobPaused(id: string, paused: boolean, profile = 'default') {
    return this.cron.setCronJobPaused(id, paused, profile);
  }

  triggerCronJob(id: string, profile = 'default') {
    return this.cron.triggerCronJob(id, profile);
  }

  deleteCronJob(id: string, profile = 'default') {
    return this.cron.deleteCronJob(id, profile);
  }

  // Skills, managed installations, plugins, MCP — bodies live in
  // cloud/extensions.ts (H8 domain split).
  getSkills(profile = 'default') {
    return this.extensions.getSkills(profile);
  }

  bindManagedResourceOwner(owner: string) {
    this.extensions.bindManagedResourceOwner(owner);
  }

  getManagedInstallations(kind = '', profile = 'default', limit = 50) {
    return this.extensions.getManagedInstallations(kind, profile, limit);
  }

  createManagedInstallation(request: ManagedInstallationRequest) {
    return this.extensions.createManagedInstallation(request);
  }

  toggleSkill(name: string, enabled: boolean, profile = 'default') {
    return this.extensions.toggleSkill(name, enabled, profile);
  }

  createSkill(name: string, content: string, category = '', profile = 'default') {
    return this.extensions.createSkill(name, content, category, profile);
  }

  getSkillContent(name: string, profile = 'default') {
    return this.extensions.getSkillContent(name, profile);
  }

  updateSkillContent(name: string, content: string, profile = 'default') {
    return this.extensions.updateSkillContent(name, content, profile);
  }

  getPlugins() {
    return this.extensions.getPlugins();
  }

  setPluginEnabled(name: string, enabled: boolean) {
    return this.extensions.setPluginEnabled(name, enabled);
  }

  rescanPlugins() { return this.extensions.rescanPlugins(); } installPlugin(identifier: string, options: { force?: boolean; enable?: boolean } = {}) { return this.extensions.installPlugin(identifier, options); } updatePlugin(name: string) { return this.extensions.updatePlugin(name); }
  removePlugin(name: string) { return this.extensions.removePlugin(name); } setPluginVisibility(name: string, hidden: boolean) { return this.extensions.setPluginVisibility(name, hidden); } setPluginProviders(input: { memoryProvider?: string; contextEngine?: string }) { return this.extensions.setPluginProviders(input); }
  getMcp(profile = 'default') {
    return this.extensions.getMcp(profile);
  }

  addMcpServer(server: JsonRecord, profile = 'default') {
    return this.extensions.addMcpServer(server, profile);
  }

  setMcpServerEnabled(name: string, enabled: boolean, profile = 'default') {
    return this.extensions.setMcpServerEnabled(name, enabled, profile);
  }

  removeMcpServer(name: string, profile = 'default') { return this.extensions.removeMcpServer(name, profile); }

  testMcpServer(name: string, profile = 'default') { return this.extensions.testMcpServer(name, profile); } installMcpCatalogEntry(name: string, env: Record<string, string> = {}, enable = true, profile = 'default') { return this.extensions.installMcpCatalogEntry(name, env, enable, profile); }

  getPairing() {
    return this.management.getPairing();
  }

  approvePairing(platform: string, code: string) {
    return this.management.approvePairing(platform, code);
  }

  revokePairing(platform: string, userId: string) {
    return this.management.revokePairing(platform, userId);
  }

  clearPendingPairing() {
    return this.management.clearPendingPairing();
  }

  getChannels(profile = 'default') {
    return this.management.getChannels(profile);
  }

  updateChannel(id: string, update: JsonRecord, profile = 'default') {
    return this.management.updateChannel(id, update, profile);
  }
  getWebhooks() {
    return this.management.getWebhooks();
  }

  createWebhook(webhook: JsonRecord) {
    return this.management.createWebhook(webhook);
  }

  setWebhookEnabled(name: string, enabled: boolean) {
    return this.management.setWebhookEnabled(name, enabled);
  }

  deleteWebhook(name: string) {
    return this.management.deleteWebhook(name);
  }

  async getProfiles() {
    return this.management.getProfiles();
  }

  getBots() { return this.management.getBots(); }

  setActiveProfile(name: string) {
    return this.management.setActiveProfile(name);
  }

  createProfile(profile: JsonRecord, bot = false) { return this.management.createProfile(profile, bot); }

  deleteProfile(name: string, bot = false) {
    return this.management.deleteProfile(name, bot);
  }

  getProfileSoul(name: string) {
    return this.management.getProfileSoul(name);
  }

  updateProfileSoul(name: string, content: string) { return this.management.updateProfileSoul(name, content); }
  renameProfile(name: string, newName: string) { return this.management.renameProfile(name, newName); }
  getConfig(profile = 'default') {
    return this.management.getConfig(profile);
  }

  saveConfig(config: JsonRecord, profile = 'default') {
    return this.management.saveConfig(config, profile);
  }

  getEnvironment(profile = 'default') {
    return this.management.getEnvironment(profile);
  }

  setEnvironmentVariable(key: string, value: string, profile = 'default') {
    return this.management.setEnvironmentVariable(key, value, profile);
  }

  deleteEnvironmentVariable(key: string, profile = 'default') {
    return this.management.deleteEnvironmentVariable(key, profile);
  }

  getModelCredentials(profile = 'default') {
    return this.management.getModelCredentials(profile);
  }

  deleteModelCredential(id: string, profile = 'default') {
    return this.management.deleteModelCredential(id, profile);
  }

  getSystem() {
    return this.management.getSystem();
  }

  recoverManagedNodes(nodeId = '') {
    return this.management.recoverManagedNodes(nodeId);
  }

  restartGateway() {
    return this.management.restartGateway();
  }

  updateHermes() {
    return this.management.updateHermes();
  }

  getAchievements() {
    return this.management.getAchievements();
  }

  rescanAchievements() {
    return this.management.rescanAchievements();
  }

  getWorkflows(profile = 'default') {
    return this.workflows.getWorkflows(profile);
  }

  getWorkflowHealth(signal?: AbortSignal) { return this.workflows.getWorkflowHealth(signal); }

  rollbackManagedInstallation(operationId: string, requestId: string) {
    return this.extensions.rollbackManagedInstallation(operationId, requestId);
  }

  openManagedResourceEvents(cursor = 0, signal?: AbortSignal) {
    return this.extensions.openManagedResourceEvents(cursor, signal);
  }

  getManagedResources(cursor = 0, limit = 500, signal?: AbortSignal) {
    return this.extensions.getManagedResources(cursor, limit, signal);
  }

  getWorkflow(id: string, profile = 'default') {
    return this.workflows.getWorkflow(id, profile);
  }

  createWorkflow(input: { name: string; description?: string; spec: JsonRecord; profile?: string }, requestId = newClientRequestId('workflow-create')) { return this.workflows.createWorkflow(input, requestId); } addWorkflowVersion(id: string, input: { expectedRevision: number; spec: JsonRecord; profile?: string }, requestId = newClientRequestId('workflow-version')) { return this.workflows.addWorkflowVersion(id, input, requestId); }
  getWorkflowRuns(profile = 'default') {
    return this.workflows.getWorkflowRuns(profile);
  }

  getWorkflowRun(id: string, profile = 'default') { return this.workflows.getWorkflowRun(id, profile); }

  getWorkflowWorkspaceChanges(runId: string, profile = 'default', limit = 100) {
    return this.workflows.getWorkflowWorkspaceChanges(runId, profile, limit);
  }

  getWorkflowWorkspaceChange(
    runId: string,
    changeSetId: string,
    profile = 'default',
  ) {
    return this.workflows.getWorkflowWorkspaceChange(runId, changeSetId, profile);
  }

  getVoiceConfig(profile = 'default', signal?: AbortSignal) { return this.audio.getVoiceConfig(profile, signal); } listElevenLabsVoices(profile = 'default', signal?: AbortSignal) { return this.audio.listElevenLabsVoices(profile, signal); } speakAudio(text: string, profile = 'default', signal?: AbortSignal) { return this.audio.speak(text, profile, signal); }
  startWorkflow(id: string, profile = 'default', requestId = newClientRequestId('workflow-start')) {
    return this.workflows.startWorkflow(id, profile, requestId);
  }

  cancelWorkflowRun(
    runId: string,
    expectedRevision: number,
    profile = 'default',
    requestId = newClientRequestId('workflow-cancel'),
  ) {
    return this.workflows.cancelWorkflowRun(runId, expectedRevision, profile, requestId);
  }

  retryWorkflowNode(
    runId: string,
    nodeId: string,
    expectedRevision: number,
    profile = 'default',
    requestId = newClientRequestId('workflow-retry'),
  ) {
    return this.workflows.retryWorkflowNode(
      runId,
      nodeId,
      expectedRevision,
      profile,
      requestId,
    );
  }

  approveWorkflowNode(
    runId: string,
    nodeId: string,
    expectedRevision: number,
    profile = 'default',
    requestId = newClientRequestId('workflow-approve'),
  ) {
    return this.workflows.approveWorkflowNode(
      runId,
      nodeId,
      expectedRevision,
      profile,
      requestId,
    );
  }

  getWriteApprovals(profile = 'default') {
    return this.workflows.getWriteApprovals(profile);
  }

  getWriteApproval(id: string, profile = 'default') {
    return this.workflows.getWriteApproval(id, profile);
  }

  /**
   * Decide one staged write.
   *
   * `payloadDigest` must be the `payload_digest` of the approval record this
   * client actually rendered to the user. The server compares it, in constant
   * time, against a digest of the payload it will execute and rejects the
   * decision with 409 if they differ.
   *
   * This closes a confused-deputy gap: the approval list shows `summary`,
   * which the agent chooses freely at stage time and which is stored in a
   * different column from `payload`. Without the digest a manipulated agent
   * could pair an innocuous summary ("remember: buy milk") with a hostile
   * skill payload and harvest a genuine approval. Echoing the digest is what
   * lets the server prove the human approved *these* bytes.
   *
   * Optional only so an older server without the check still works; always
   * pass it. Servers with `HERMES_WRITE_APPROVAL_REQUIRE_DIGEST=1` reject an
   * approval that omits it.
   */
  decideWriteApproval(
    id: string,
    decision: 'approve' | 'reject',
    revision: number,
    requestId = newClientRequestId('write-approval'),
    profile = 'default',
    payloadDigest?: string,
  ) {
    return this.workflows.decideWriteApproval(
      id,
      decision,
      revision,
      requestId,
      profile,
      payloadDigest,
    );
  }

  getRuntimeRuns(profile = 'default') {
    return this.workflows.getRuntimeRuns(profile);
  }

  getRuntimeRun(id: string, profile = 'default') {
    return this.workflows.getRuntimeRun(id, profile);
  }

  cancelRuntimeRun(actionUrl: string, requestId = newClientRequestId('runtime-cancel')) {
    return this.workflows.cancelRuntimeRun(actionUrl, requestId);
  }

  retryRuntimeRun(actionUrl: string, requestId = newClientRequestId('runtime-retry')) {
    return this.workflows.retryRuntimeRun(actionUrl, requestId);
  }

  getKanbanBoard() {
    return this.collaboration.getKanbanBoard();
  }

  createKanbanTask(task: JsonRecord) {
    return this.collaboration.createKanbanTask(task);
  }

  updateKanbanTask(id: string, update: JsonRecord) {
    return this.collaboration.updateKanbanTask(id, update);
  }

  getCollaborationProfiles() {
    return this.collaboration.getCollaborationProfiles();
  }

  getCollaborationRooms() {
    return this.collaboration.getCollaborationRooms();
  }

  createCollaborationRoom(name: string, profiles: string[]) {
    return this.collaboration.createCollaborationRoom(name, profiles);
  }

  deleteCollaborationRoom(id: string) {
    return this.collaboration.deleteCollaborationRoom(id);
  }

  getCollaborationRoom(id: string) {
    return this.collaboration.getCollaborationRoom(id);
  }

  sendCollaborationRoomMessage(
    id: string,
    content: string,
    profiles: string[] = [],
    requestId = createCollaborationRoomRequestId(),
    signal?: AbortSignal,
  ) {
    return this.collaboration.sendCollaborationRoomMessage(
      id,
      content,
      profiles,
      requestId,
      signal,
    );
  }

  routeMessage(
    content: string,
    recentMessages: Array<Pick<CollaborationMessage, 'content' | 'role'>> = [],
    attachments: JsonRecord[] = [],
  ) {
    return this.collaboration.routeMessage(content, recentMessages, attachments);
  }

  getAccountFiles(query: AccountFilesQuery = {}) {
    return this.files.getAccountFiles(query);
  }

  getAllAccountFiles(query: AccountFilesQuery = {}) {
    return this.files.getAllAccountFiles(query);
  }

  getAccountFile(id: string) {
    return this.files.getAccountFile(id);
  }

  deleteAccountFile(id: string) {
    return this.files.deleteAccountFile(id);
  }

  downloadAccountFile(id: string, preview = false) {
    return this.files.downloadAccountFile(id, preview);
  }

  consumeAccountFile<T>(
    id: string,
    preview: boolean,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ) {
    return this.files.consumeAccountFile(id, preview, consume, signal);
  }

  async uploadAccountFile(upload: NativeUpload, uploadId = newClientRequestId('file-upload')) {
    return this.files.uploadAccountFile(upload, uploadId);
  }

  getConversations(signal?: AbortSignal) {
    return this.conversations.getConversations(signal);
  }

  getUnifiedConversations(profile = 'default', signal?: AbortSignal) {
    return this.conversations.getUnifiedConversations(profile, signal);
  }

  getConversation(id: string, signal?: AbortSignal) {
    return this.conversations.getConversation(id, signal);
  }

  getConversationSessionEntries(
    conversationId: string,
    cursor = 0,
    limit = 500,
    signal?: AbortSignal,
  ) {
    return this.conversations.getConversationSessionEntries(
      conversationId,
      cursor,
      limit,
      signal,
    );
  }

  openHostedConversationEvents(
    conversationId: string,
    cursor: number,
    signal: AbortSignal,
    expectedAccountGeneration: string,
    deadlineMs = 5_000,
  ) {
    return this.conversations.openHostedConversationEvents(
      conversationId,
      cursor,
      signal,
      expectedAccountGeneration,
      deadlineMs,
    );
  }

  getConversationSessionState(conversationId: string, profile = '') {
    return this.conversations.getConversationSessionState(conversationId, profile);
  }

  forkSession(sessionId: string, input: { atMessageId: number; expectedTipId: number; idempotencyKey: string; profile?: string; title?: string }) { return this.conversations.forkSession(sessionId, input); } getSessionLineage(sessionId: string, profile = 'default') { return this.conversations.getSessionLineage(sessionId, profile); } getSessionContext(sessionId: string, profile = 'default') { return this.conversations.getSessionContext(sessionId, profile); }
  forkConversationFromMessage(
    conversationId: string,
    messageId: string,
    input: { idempotencyKey: string; profile?: string; title?: string },
  ) {
    return this.conversations.forkConversationFromMessage(conversationId, messageId, input);
  }

  compressConversation(
    conversationId: string,
    input: { focusTopic?: string; idempotencyKey: string; profile?: string },
  ) {
    return this.conversations.compressConversation(conversationId, input);
  }

  createConversation(
    profile = 'default',
    title = '新对话',
    clientId = '',
    signal?: AbortSignal,
  ) {
    return this.conversations.createConversation(profile, title, clientId, signal);
  }

  adoptOfficialConversation(sessionId: string, profile = 'default', title = '') {
    return this.conversations.adoptOfficialConversation(sessionId, profile, title);
  }

  deleteConversation(id: string) {
    return this.conversations.deleteConversation(id);
  }

  renameConversation(id: string, title: string) {
    return this.conversations.renameConversation(id, title);
  }

  recordConversationMessage(id: string, message: CollaborationMessage) {
    return this.conversations.recordConversationMessage(id, message);
  }

  saveRuntimeSession(
    conversationId: string,
    profile: string,
    sessionId: string,
    turnId: string,
    status: 'completed' | 'failed' | 'running',
  ) {
    return this.conversations.saveRuntimeSession(
      conversationId,
      profile,
      sessionId,
      turnId,
      status,
    );
  }

  createHostedTurn(
    conversationId: string,
    input: {
      turnId: string;
      content: string;
      title: string;
      profiles: string[];
      artifactRequired: boolean;
      attachmentIds?: string[];
      attachmentContext?: string;
      deliveryContext?: string;
      mode: RouteDecision['mode'];
      routeMetadata: JsonRecord;
    },
  ) {
    return this.conversations.createHostedTurn(conversationId, input);
  }

  enqueueHostedTurn(
    conversationId: string,
    input: HostedTurnEnqueueInput,
    signal?: AbortSignal,
  ) {
    return this.conversations.enqueueHostedTurn(conversationId, input, signal);
  }

  openHostedConversationEventsWebSocket(conversationId: string, cursor: number, expectedAccountGeneration: string, deadlineMs?: number, signal?: AbortSignal) {
    return this.conversations.openHostedConversationEventsWebSocket(conversationId, cursor, expectedAccountGeneration, deadlineMs, signal);
  }

  cancelHostedTurn(
    conversationId: string,
    turnId: string,
    reason: string,
    requestId = `cancel-${turnId}`,
    signal?: AbortSignal,
  ) {
    return this.conversations.cancelHostedTurn(
      conversationId,
      turnId,
      reason,
      requestId,
      signal,
    );
  }

  interveneHostedTurn(
    conversationId: string,
    turnId: string,
    content: string,
    messageId: string,
    signal?: AbortSignal,
  ) {
    return this.conversations.interveneHostedTurn(
      conversationId,
      turnId,
      content,
      messageId,
      signal,
    );
  }

  async uploadConversationAttachment(
    conversationId: string,
    upload: NativeUpload,
    context: ConversationAttachmentUploadContext,
    signal?: AbortSignal,
  ) {
    return this.conversations.uploadConversationAttachment(
      conversationId,
      upload,
      context,
      signal,
    );
  }

  listHostedSubagents(conversationId: string, turnId: string, signal?: AbortSignal) {
    return this.conversations.listHostedSubagents(conversationId, turnId, signal);
  }

  getHostedTrajectory(
    conversationId: string,
    turnId: string,
    detailLevel: 'summary' | 'full' = 'summary',
    maxRecords = 500,
    signal?: AbortSignal,
  ) {
    return this.conversations.getHostedTrajectory(
      conversationId,
      turnId,
      detailLevel,
      maxRecords,
      signal,
    );
  }

  steerHostedSubagent(
    conversationId: string,
    turnId: string,
    subagentId: string,
    message: string,
    requestId: string,
    signal?: AbortSignal,
  ) {
    return this.conversations.steerHostedSubagent(
      conversationId,
      turnId,
      subagentId,
      message,
      requestId,
      signal,
    );
  }

  stopHostedSubagent(
    conversationId: string,
    turnId: string,
    subagentId: string,
    reason: string,
    requestId: string,
    signal?: AbortSignal,
  ) {
    return this.conversations.stopHostedSubagent(
      conversationId,
      turnId,
      subagentId,
      reason,
      requestId,
      signal,
    );
  }

  consumeConversationAttachment<T>(
    downloadUrl: string,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    deadlineMs?: number,
  ) {
    return this.conversations.consumeConversationAttachment(downloadUrl, consume, signal, deadlineMs);
  }

  async loadRoute(
    routeId: string,
    profile = 'default',
    selectedId = '',
  ): Promise<unknown> {
    return loadCloudRoute(this, routeId, profile, selectedId);
  }

  private json<T>(
    path: string,
    method: 'DELETE' | 'PATCH' | 'POST' | 'PUT',
    body: JsonRecord,
    options: HermesRequestOptions = {},
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method,
      headers: {
        ...headersToObject(options.headers),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
}

function headersToObject(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

function newClientRequestId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  const random = uuid || [0, 1, 2, 3]
    .map(() => Math.random().toString(36).slice(2, 12))
    .join('');
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createCollaborationRoomRequestId(): string {
  return createCollaborationRequestId();
}

export function createWorkflowStartRequestId(): string {
  return newClientRequestId('workflow-start');
}

installHermesCloudApiSurface(HermesCloudApi);
