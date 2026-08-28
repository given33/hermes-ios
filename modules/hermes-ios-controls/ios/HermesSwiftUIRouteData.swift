import Combine
import Foundation

struct HermesRouteSnapshot: Decodable, Equatable {
  let version: Int
  let route: String?
  let sessions: [HermesSessionSnapshot]
  let sessionContext: HermesSessionContextSnapshot?
  let files: [HermesFileSnapshot]
  let workflows: HermesWorkflowSnapshot
  let approvals: HermesApprovalsSnapshot
  let runtime: HermesRuntimeSnapshot
  let analytics: HermesAnalyticsSnapshot
  let models: [HermesModelSnapshot]
  let modelConfirmation: HermesModelConfirmationSnapshot?
  let detectedModels: [String]
  let operation: HermesRouteOperationSnapshot?
  let logs: [HermesLogSnapshot]
  let cron: [HermesCronJobSnapshot]
  let skills: [HermesSkillSnapshot]
  let integrations: [HermesIntegrationSnapshot]
  let installations: [HermesManagedInstallationSnapshot]
  let pairing: HermesPairingSnapshot
  let achievements: HermesAchievementsSnapshot
  let collaboration: HermesCollaborationSnapshot
  let kanban: [HermesKanbanColumnSnapshot]
  let profiles: [HermesProfileSnapshot]
  let config: HermesConfigSnapshot
  let environment: [HermesEnvironmentSecretSnapshot]
  let system: HermesSystemSnapshot

  init(
    version: Int = hermesRouteSnapshotVersion,
    route: String? = nil,
    sessions: [HermesSessionSnapshot] = [],
    sessionContext: HermesSessionContextSnapshot? = nil,
    files: [HermesFileSnapshot] = [],
    workflows: HermesWorkflowSnapshot = .empty,
    approvals: HermesApprovalsSnapshot = .empty,
    runtime: HermesRuntimeSnapshot = .empty,
    analytics: HermesAnalyticsSnapshot = .empty,
    models: [HermesModelSnapshot] = [],
    modelConfirmation: HermesModelConfirmationSnapshot? = nil,
    detectedModels: [String] = [],
    operation: HermesRouteOperationSnapshot? = nil,
    logs: [HermesLogSnapshot] = [],
    cron: [HermesCronJobSnapshot] = [],
    skills: [HermesSkillSnapshot] = [],
    integrations: [HermesIntegrationSnapshot] = [],
    installations: [HermesManagedInstallationSnapshot] = [],
    pairing: HermesPairingSnapshot = .empty,
    achievements: HermesAchievementsSnapshot = .empty,
    collaboration: HermesCollaborationSnapshot = .empty,
    kanban: [HermesKanbanColumnSnapshot] = [],
    profiles: [HermesProfileSnapshot] = [],
    config: HermesConfigSnapshot = .empty,
    environment: [HermesEnvironmentSecretSnapshot] = [],
    system: HermesSystemSnapshot = .empty
  ) {
    self.version = version
    self.route = route
    self.sessions = sessions
    self.sessionContext = sessionContext
    self.files = files
    self.workflows = workflows
    self.approvals = approvals
    self.runtime = runtime
    self.analytics = analytics
    self.models = models
    self.modelConfirmation = modelConfirmation
    self.detectedModels = detectedModels
    self.operation = operation
    self.logs = logs
    self.cron = cron
    self.skills = skills
    self.integrations = integrations
    self.installations = installations
    self.pairing = pairing
    self.achievements = achievements
    self.collaboration = collaboration
    self.kanban = kanban
    self.profiles = profiles
    self.config = config
    self.environment = environment
    self.system = system
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: HermesRouteSnapshotField.self)
    version = try container.decodeIfPresent(Int.self, forKey: .version)
      ?? hermesRouteSnapshotVersion
    route = try container.decodeIfPresent(String.self, forKey: .route)
    sessions = try container.decodeIfPresent(
      [HermesSessionSnapshot].self,
      forKey: .sessions
    ) ?? []
    sessionContext = try container.decodeIfPresent(
      HermesSessionContextSnapshot.self,
      forKey: .sessionContext
    )
    files = try container.decodeIfPresent(
      [HermesFileSnapshot].self,
      forKey: .files
    ) ?? []
    workflows = try container.decodeIfPresent(
      HermesWorkflowSnapshot.self,
      forKey: .workflows
    ) ?? .empty
    approvals = try container.decodeIfPresent(
      HermesApprovalsSnapshot.self,
      forKey: .approvals
    ) ?? .empty
    runtime = try container.decodeIfPresent(
      HermesRuntimeSnapshot.self,
      forKey: .runtime
    ) ?? .empty
    analytics = try container.decodeIfPresent(
      HermesAnalyticsSnapshot.self,
      forKey: .analytics
    ) ?? .empty
    models = try container.decodeIfPresent(
      [HermesModelSnapshot].self,
      forKey: .models
    ) ?? []
    modelConfirmation = try container.decodeIfPresent(
      HermesModelConfirmationSnapshot.self,
      forKey: .modelConfirmation
    )
    detectedModels = try container.decodeIfPresent(
      [String].self,
      forKey: .detectedModels
    ) ?? []
    operation = try container.decodeIfPresent(
      HermesRouteOperationSnapshot.self,
      forKey: .operation
    )
    logs = try container.decodeIfPresent(
      [HermesLogSnapshot].self,
      forKey: .logs
    ) ?? []
    cron = try container.decodeIfPresent([HermesCronJobSnapshot].self, forKey: .cron) ?? []
    skills = try container.decodeIfPresent([HermesSkillSnapshot].self, forKey: .skills) ?? []
    integrations = try container.decodeIfPresent(
      [HermesIntegrationSnapshot].self,
      forKey: .integrations
    ) ?? []
    installations = try container.decodeIfPresent(
      [HermesManagedInstallationSnapshot].self,
      forKey: .installations
    ) ?? []
    pairing = try container.decodeIfPresent(HermesPairingSnapshot.self, forKey: .pairing) ?? .empty
    achievements = try container.decodeIfPresent(
      HermesAchievementsSnapshot.self,
      forKey: .achievements
    ) ?? .empty
    collaboration = try container.decodeIfPresent(
      HermesCollaborationSnapshot.self,
      forKey: .collaboration
    ) ?? .empty
    kanban = try container.decodeIfPresent([HermesKanbanColumnSnapshot].self, forKey: .kanban) ?? []
    profiles = try container.decodeIfPresent([HermesProfileSnapshot].self, forKey: .profiles) ?? []
    config = try container.decodeIfPresent(HermesConfigSnapshot.self, forKey: .config) ?? .empty
    environment = try container.decodeIfPresent(
      [HermesEnvironmentSecretSnapshot].self,
      forKey: .environment
    ) ?? []
    system = try container.decodeIfPresent(HermesSystemSnapshot.self, forKey: .system) ?? .empty
  }

  static let empty = HermesRouteSnapshot()
}

// The snapshot is immutable after decoding and is transferred from the
// background JSON worker to the main actor as one value.
extension HermesRouteSnapshot: @unchecked Sendable {}

struct HermesRouteOperationSnapshot: Decodable, Equatable {
  let action: String
  let message: String
  let requestId: String?
  let state: String
  let targetId: String?
}

struct HermesManagedInstallationTargetSnapshot: Decodable, Equatable, Identifiable {
  let nodeId: String
  let state: String
  let error: String

  var id: String { nodeId }
}

struct HermesManagedInstallationSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let identifier: String
  let kind: String
  let state: String
  let error: String
  let health: String
  let version: String
  let tools: [String]
  let permissions: [String]
  let lastVerifiedAt: String
  let rollbackAvailable: Bool
  let targets: [HermesManagedInstallationTargetSnapshot]
}

struct HermesSessionSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let title: String
  let model: String
  let date: String
  let running: Bool
  let profile: String?
  let detail: String?
}

struct HermesSessionLineageSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let title: String
  let parentSessionId: String?
  let source: String
  let model: String
  let startedAt: Double?
  let endedAt: Double?
  let messageCount: Int
  let toolCallCount: Int
  let current: Bool
}

struct HermesSessionContextSnapshot: Decodable, Equatable {
  let conversationId: String
  let sessionId: String
  let profile: String
  let model: String
  let activeMessages: Int
  let archivedMessages: Int
  let messageTokens: Int
  let inputTokens: Int
  let outputTokens: Int
  let cacheReadTokens: Int
  let cacheWriteTokens: Int
  let reasoningTokens: Int
  let compressionLineage: [String]
  let compressionCount: Int
  let compressionInProgress: Bool
  let parentCount: Int
  let childCount: Int
  let lineage: [HermesSessionLineageSnapshot]
  let branchableMessages: [HermesSessionBranchableMessageSnapshot]

  init(
    conversationId: String,
    sessionId: String,
    profile: String,
    model: String,
    activeMessages: Int,
    archivedMessages: Int,
    messageTokens: Int,
    inputTokens: Int,
    outputTokens: Int,
    cacheReadTokens: Int,
    cacheWriteTokens: Int,
    reasoningTokens: Int,
    compressionLineage: [String],
    compressionCount: Int,
    compressionInProgress: Bool,
    parentCount: Int,
    childCount: Int,
    lineage: [HermesSessionLineageSnapshot],
    branchableMessages: [HermesSessionBranchableMessageSnapshot] = []
  ) {
    self.conversationId = conversationId
    self.sessionId = sessionId
    self.profile = profile
    self.model = model
    self.activeMessages = activeMessages
    self.archivedMessages = archivedMessages
    self.messageTokens = messageTokens
    self.inputTokens = inputTokens
    self.outputTokens = outputTokens
    self.cacheReadTokens = cacheReadTokens
    self.cacheWriteTokens = cacheWriteTokens
    self.reasoningTokens = reasoningTokens
    self.compressionLineage = compressionLineage
    self.compressionCount = compressionCount
    self.compressionInProgress = compressionInProgress
    self.parentCount = parentCount
    self.childCount = childCount
    self.lineage = lineage
    self.branchableMessages = branchableMessages
  }

  enum CodingKeys: String, CodingKey {
    case conversationId
    case sessionId
    case profile
    case model
    case activeMessages
    case archivedMessages
    case messageTokens
    case inputTokens
    case outputTokens
    case cacheReadTokens
    case cacheWriteTokens
    case reasoningTokens
    case compressionLineage
    case compressionCount
    case compressionInProgress
    case parentCount
    case childCount
    case lineage
    case branchableMessages
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    conversationId = try container.decode(String.self, forKey: .conversationId)
    sessionId = try container.decode(String.self, forKey: .sessionId)
    profile = try container.decode(String.self, forKey: .profile)
    model = try container.decode(String.self, forKey: .model)
    activeMessages = try container.decode(Int.self, forKey: .activeMessages)
    archivedMessages = try container.decode(Int.self, forKey: .archivedMessages)
    messageTokens = try container.decode(Int.self, forKey: .messageTokens)
    inputTokens = try container.decode(Int.self, forKey: .inputTokens)
    outputTokens = try container.decode(Int.self, forKey: .outputTokens)
    cacheReadTokens = try container.decode(Int.self, forKey: .cacheReadTokens)
    cacheWriteTokens = try container.decode(Int.self, forKey: .cacheWriteTokens)
    reasoningTokens = try container.decode(Int.self, forKey: .reasoningTokens)
    compressionLineage = try container.decode([String].self, forKey: .compressionLineage)
    compressionCount = try container.decode(Int.self, forKey: .compressionCount)
    compressionInProgress = try container.decode(Bool.self, forKey: .compressionInProgress)
    parentCount = try container.decode(Int.self, forKey: .parentCount)
    childCount = try container.decode(Int.self, forKey: .childCount)
    lineage = try container.decode([HermesSessionLineageSnapshot].self, forKey: .lineage)
    branchableMessages = try container.decodeIfPresent(
      [HermesSessionBranchableMessageSnapshot].self,
      forKey: .branchableMessages
    ) ?? []
  }
}

struct HermesSessionBranchableMessageSnapshot: Decodable, Equatable, Identifiable {
  let messageId: String
  let role: String
  let runtimeSessionId: String
  let runtimeMessageId: Int

  var id: String { messageId }
}

struct HermesFileSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let name: String
  let detail: String
  let folder: Bool
  let createdAt: Double?
  let dateLabel: String?
  let fileType: String?
  let mimeType: String?
  let size: Double?
  let source: String?
  let status: String?
  let previewText: String?
  let children: [HermesFileSnapshot]?
}

struct HermesWorkflowSummarySnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let name: String
  let detail: String
  let revision: Int
  let state: String
  let updatedAt: Double?
  let activeRunId: String?
}

struct HermesWorkflowNodeSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let runNodeId: String?
  let label: String
  let kind: String
  let state: String
  let detail: String
  let x: Double?
  let y: Double?
  let requiresApproval: Bool
  let approvalPending: Bool
  let revision: Int
}

struct HermesWorkflowEdgeSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let source: String
  let target: String
  let label: String
  let state: String
}

struct HermesWorkflowRunSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let workflowId: String
  let state: String
  let startedAt: Double?
  let completedAt: Double?
  let durationMs: Double?
  let currentNodeId: String?
  let error: String?
  let canCancel: Bool
  let canRetry: Bool
  let revision: Int
}

struct HermesWorkspaceChangeSetSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let runId: String
  let turnId: String
  let summary: String
  let createdAt: Double?
  let fileCount: Int
  let byteCount: Int
  let addedCount: Int
  let modifiedCount: Int
  let deletedCount: Int
  let renamedCount: Int
}

struct HermesWorkspaceAuditSnapshot: Decodable, Equatable, Identifiable {
  var id: String { nodeRunId }
  let nodeRunId: String
  let runId: String
  let state: String
  let reason: String
  let fileCount: Int
  let byteCount: Int
  let changeSetId: String?
  let updatedAt: Double?
  let finalizedAt: Double?
}

struct HermesWorkspaceChangeFileSnapshot: Decodable, Equatable, Identifiable {
  var id: String { path }
  let path: String
  let changeType: String
  let sha256: String
  let byteCount: Int
  let patch: String
}

struct HermesWorkspaceChangeSetDetailSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let runId: String
  let turnId: String
  let summary: String
  let createdAt: Double?
  let files: [HermesWorkspaceChangeFileSnapshot]
}

struct HermesWorkflowSnapshot: Decodable, Equatable {
  let health: HermesWorkflowHealthSnapshot?
  let selectedWorkflowId: String?
  let workflows: [HermesWorkflowSummarySnapshot]
  let nodes: [HermesWorkflowNodeSnapshot]
  let edges: [HermesWorkflowEdgeSnapshot]
  let run: HermesWorkflowRunSnapshot?
  let changeSets: [HermesWorkspaceChangeSetSnapshot]
  let workspaceAudits: [HermesWorkspaceAuditSnapshot]
  let selectedChangeSet: HermesWorkspaceChangeSetDetailSnapshot?

  private enum CodingKeys: String, CodingKey {
    case health
    case selectedWorkflowId
    case workflows
    case nodes
    case edges
    case run
    case changeSets
    case workspaceAudits
    case selectedChangeSet
  }

  init(
    health: HermesWorkflowHealthSnapshot? = nil,
    selectedWorkflowId: String?,
    workflows: [HermesWorkflowSummarySnapshot],
    nodes: [HermesWorkflowNodeSnapshot],
    edges: [HermesWorkflowEdgeSnapshot],
    run: HermesWorkflowRunSnapshot?,
    changeSets: [HermesWorkspaceChangeSetSnapshot] = [],
    workspaceAudits: [HermesWorkspaceAuditSnapshot] = [],
    selectedChangeSet: HermesWorkspaceChangeSetDetailSnapshot? = nil
  ) {
    self.health = health
    self.selectedWorkflowId = selectedWorkflowId
    self.workflows = workflows
    self.nodes = nodes
    self.edges = edges
    self.run = run
    self.changeSets = changeSets
    self.workspaceAudits = workspaceAudits
    self.selectedChangeSet = selectedChangeSet
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    health = try container.decodeIfPresent(HermesWorkflowHealthSnapshot.self, forKey: .health)
    selectedWorkflowId = try container.decodeIfPresent(String.self, forKey: .selectedWorkflowId)
    workflows = try container.decodeIfPresent(
      [HermesWorkflowSummarySnapshot].self,
      forKey: .workflows
    ) ?? []
    nodes = try container.decodeIfPresent([HermesWorkflowNodeSnapshot].self, forKey: .nodes) ?? []
    edges = try container.decodeIfPresent([HermesWorkflowEdgeSnapshot].self, forKey: .edges) ?? []
    run = try container.decodeIfPresent(HermesWorkflowRunSnapshot.self, forKey: .run)
    changeSets = try container.decodeIfPresent(
      [HermesWorkspaceChangeSetSnapshot].self,
      forKey: .changeSets
    ) ?? []
    workspaceAudits = try container.decodeIfPresent(
      [HermesWorkspaceAuditSnapshot].self,
      forKey: .workspaceAudits
    ) ?? []
    selectedChangeSet = try container.decodeIfPresent(
      HermesWorkspaceChangeSetDetailSnapshot.self,
      forKey: .selectedChangeSet
    )
  }

  static let empty = HermesWorkflowSnapshot(
    health: nil,
    selectedWorkflowId: nil,
    workflows: [],
    nodes: [],
    edges: [],
    run: nil
  )
}

struct HermesApprovalItemSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let title: String
  let summary: String
  let subsystem: String
  let action: String
  let origin: String
  let profile: String
  let state: String
  let target: String
  let revision: Int
  let createdAt: Double?
  let expiresAt: Double?
  let diff: String
  let diffAvailable: Bool
  let payloadDigest: String?
}

struct HermesWorkflowHealthSnapshot: Decodable, Equatable {
  let ok: Bool
  let schemaVersion: Int?
  let recoverableRuns: Int?
}

struct HermesApprovalsSnapshot: Decodable, Equatable {
  let selectedId: String?
  let items: [HermesApprovalItemSnapshot]
  let selected: HermesApprovalItemSnapshot?

  static let empty = HermesApprovalsSnapshot(selectedId: nil, items: [], selected: nil)
}

struct HermesRuntimeRunSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let title: String
  let kind: String
  let state: String
  let profile: String
  let detail: String
  let startedAt: Double?
  let completedAt: Double?
  let heartbeatAt: Double?
  let observedAt: Double?
  let durationMs: Double?
  let cancelable: Bool
  let retryable: Bool
  let conversationId: String?
  let workflowId: String?
  let error: String?
  let artifactCount: Int
  let changeSetId: String?
  let cancelUrl: String?
  let retryUrl: String?
}

struct HermesRuntimeSnapshot: Decodable, Equatable {
  let selectedRunId: String?
  let runs: [HermesRuntimeRunSnapshot]
  let selected: HermesRuntimeRunSnapshot?

  static let empty = HermesRuntimeSnapshot(selectedRunId: nil, runs: [], selected: nil)
}

struct HermesAnalyticsSnapshot: Decodable, Equatable {
  let inputTokens: String
  let outputTokens: String
  let monthlyCost: String
  let successRate: String
  let points: [HermesAnalyticsPointSnapshot]

  private enum CodingKeys: String, CodingKey {
    case inputTokens
    case outputTokens
    case monthlyCost
    case successRate
    case points
  }

  init(
    inputTokens: String = "-",
    outputTokens: String = "-",
    monthlyCost: String = "-",
    successRate: String = "-",
    points: [HermesAnalyticsPointSnapshot] = []
  ) {
    self.inputTokens = inputTokens
    self.outputTokens = outputTokens
    self.monthlyCost = monthlyCost
    self.successRate = successRate
    self.points = points
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    inputTokens = try container.decodeIfPresent(String.self, forKey: .inputTokens) ?? "-"
    outputTokens = try container.decodeIfPresent(String.self, forKey: .outputTokens) ?? "-"
    monthlyCost = try container.decodeIfPresent(String.self, forKey: .monthlyCost) ?? "-"
    successRate = try container.decodeIfPresent(String.self, forKey: .successRate) ?? "-"
    points = try container.decodeIfPresent(
      [HermesAnalyticsPointSnapshot].self,
      forKey: .points
    ) ?? []
  }

  static let empty = HermesAnalyticsSnapshot()
}

struct HermesAnalyticsPointSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let label: String
  let input: Double
  let output: Double
}

struct HermesModelSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let model: String
  let provider: String
  let context: String
  let baseUrl: String
  let apiKeyConfigured: Bool
  let apiKeyPreview: String
  let apiMode: String
  let contextLength: Int
  let reasoningEffort: String
  let active: Bool
  let authenticated: Bool?
  let selectable: Bool?
  let warning: String?
  let priceInput: String?
  let priceOutput: String?
  let priceCache: String?
  let free: Bool?
  let freeTier: Bool?
  let supportsFast: Bool?
  let supportsReasoning: Bool?
}

struct HermesModelConfirmationSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let message: String
  let model: String
  let provider: String
}

struct HermesLogSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let level: String
  let message: String
  let time: String
}

struct HermesCronJobSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let name: String
  let schedule: String
  let prompt: String
  let enabled: Bool
  let lastRun: String
}

struct HermesSkillSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let name: String
  let detail: String
  let bundled: Bool
  let enabled: Bool
  let content: String?
  let notes: String?
  let source: String?
}

struct HermesIntegrationSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let name: String
  let detail: String
  let enabled: Bool
  let configuration: String?
  let source: String?
  let canUpdate: Bool?
  let canRemove: Bool?
  let userHidden: Bool?
  let authRequired: Bool?
  let authCommand: String?
  let canTest: Bool?
  let catalogEntry: Bool?
  let catalogNeedsInstall: Bool?
  let catalogRequiredEnv: [String]?
}

struct HermesPairingEntrySnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let platform: String
  let userId: String
  let userName: String
  let detail: String
}

struct HermesPairingSnapshot: Decodable, Equatable {
  let pending: [HermesPairingEntrySnapshot]
  let approved: [HermesPairingEntrySnapshot]

  static let empty = HermesPairingSnapshot(pending: [], approved: [])
}

struct HermesAchievementItemSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let title: String
  let detail: String
  let symbol: String
  let progress: Double
}

struct HermesAchievementsSnapshot: Decodable, Equatable {
  let tasksCompleted: String
  let dayStreak: String
  let shareText: String
  let items: [HermesAchievementItemSnapshot]

  static let empty = HermesAchievementsSnapshot(
    tasksCompleted: "-",
    dayStreak: "-",
    shareText: "",
    items: []
  )
}

struct HermesCollaborationRoomSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let name: String
}

struct HermesCollaborationMessageSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let text: String
}

struct HermesCollaborationSnapshot: Decodable, Equatable {
  let acknowledgedRequestId: String?
  let selectedRoomId: String?
  let availableProfiles: [String]
  let rooms: [HermesCollaborationRoomSnapshot]
  let messages: [HermesCollaborationMessageSnapshot]

  static let empty = HermesCollaborationSnapshot(
    acknowledgedRequestId: nil,
    selectedRoomId: nil,
    availableProfiles: [],
    rooms: [],
    messages: []
  )
}

struct HermesKanbanCardSnapshot: Decodable, Equatable, Identifiable, Hashable {
  let id: String
  let title: String
  let detail: String
}

struct HermesKanbanColumnSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let title: String
  let cards: [HermesKanbanCardSnapshot]
}

struct HermesProfileSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let name: String
  let model: String
  let detail: String
  let active: Bool
  let soul: String
  let terminalAccess: Bool
  let fileAccess: Bool
  let browserAccess: Bool
}

struct HermesConfigSnapshot: Decodable, Equatable {
  let defaultModel: String
  let modelOptions: [String]
  let maxIterations: Double
  let streamOutput: Bool
  let autoCompact: Bool
  let compactionThreshold: Double
  let timezone: String
  let exportText: String

  static let empty = HermesConfigSnapshot(
    defaultModel: "",
    modelOptions: [],
    maxIterations: 50,
    streamOutput: false,
    autoCompact: false,
    compactionThreshold: 0,
    timezone: "",
    exportText: ""
  )
}

struct HermesEnvironmentSecretSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let key: String
  let maskedValue: String
}

struct HermesSystemNodeSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let label: String
  let cpu: Double
  let memory: Double
  let disk: Double
  let memoryLabel: String
  let uptimeLabel: String
  let activeTasks: String
  let gatewayOnline: Bool
  let metricsAvailable: Bool
  let gatewayState: String
  let version: String
  let observedAt: String
  let metricsSource: String
  let recoveryState: String
}

struct HermesSystemSnapshot: Decodable, Equatable {
  let cpu: Double
  let memory: Double
  let disk: Double
  let memoryLabel: String
  let uptimeLabel: String
  let activeTasks: String
  let gatewayOnline: Bool
  let metricsAvailable: Bool
  let nodes: [HermesSystemNodeSnapshot]
  let operationMessage: String?

  static let empty = HermesSystemSnapshot(
    cpu: 0,
    memory: 0,
    disk: 0,
    memoryLabel: "-",
    uptimeLabel: "-",
    activeTasks: "-",
    gatewayOnline: false,
    metricsAvailable: false,
    nodes: [],
    operationMessage: nil
  )
}

enum HermesRouteSnapshotDecoder {
  static func decode(_ dataJson: String) throws -> HermesRouteSnapshot {
    let normalized = dataJson.trimmingCharacters(in: .whitespacesAndNewlines)
    let data = Data((normalized.isEmpty ? "{}" : normalized).utf8)
    let snapshot = try JSONDecoder().decode(HermesRouteSnapshot.self, from: data)
    guard snapshot.version == hermesRouteSnapshotVersion else {
      throw HermesRouteSnapshotError.unsupportedVersion(snapshot.version)
    }
    return snapshot
  }
}

enum HermesRouteSnapshotError: Error, Equatable {
  case unsupportedVersion(Int)
}

final class HermesRouteDataStore: ObservableObject {
  @Published private(set) var snapshot: HermesRouteSnapshot
  @Published private(set) var decodingError: String?

  private var sourceJson: String
  private var decodeGeneration = 0

  init(dataJson: String) {
    sourceJson = ""
    snapshot = .empty
    decodingError = nil
    update(dataJson: dataJson)
  }

  func update(dataJson: String) {
    guard sourceJson != dataJson else { return }
    sourceJson = dataJson
    decodeGeneration += 1
    let generation = decodeGeneration
    let payload = dataJson
    DispatchQueue.global(qos: .userInitiated).async {
      let decoded: HermesRouteSnapshot?
      let failure: String?
      do {
        decoded = try HermesRouteSnapshotDecoder.decode(payload)
        failure = nil
      } catch {
        decoded = nil
        failure = String(describing: error)
      }
      DispatchQueue.main.async { [weak self] in
        guard let self, self.decodeGeneration == generation else { return }
        if let decoded {
          self.snapshot = decoded
          self.decodingError = nil
        } else {
          // Keep the last valid server snapshot visible while RN retries.
          self.decodingError = failure
        }
      }
    }
  }
}

enum HermesRouteActionEncoder {
  static func encode(_ payload: HermesRouteActionPayload) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard
      let data = try? encoder.encode(payload),
      let json = String(data: data, encoding: .utf8)
    else {
      return "{\"route\":\"\(payload.route)\"}"
    }
    return json
  }
}

typealias HermesRouteActionSink = (HermesRouteAction, HermesRouteActionPayload) -> Void
