import Combine
import Foundation

let hermesRouteSnapshotVersion = 1

struct HermesRouteSnapshot: Decodable, Equatable {
  let version: Int
  let route: String?
  let sessions: [HermesSessionSnapshot]
  let files: [HermesFileSnapshot]
  let analytics: HermesAnalyticsSnapshot
  let models: [HermesModelSnapshot]
  let detectedModels: [String]
  let logs: [HermesLogSnapshot]
  let cron: [HermesCronJobSnapshot]
  let skills: [HermesSkillSnapshot]
  let integrations: [HermesIntegrationSnapshot]
  let pairing: HermesPairingSnapshot
  let achievements: HermesAchievementsSnapshot
  let collaboration: HermesCollaborationSnapshot
  let kanban: [HermesKanbanColumnSnapshot]
  let profiles: [HermesProfileSnapshot]
  let config: HermesConfigSnapshot
  let environment: [HermesEnvironmentSecretSnapshot]
  let system: HermesSystemSnapshot

  private enum CodingKeys: String, CodingKey {
    case version
    case route
    case sessions
    case files
    case analytics
    case models
    case detectedModels
    case logs
    case cron
    case skills
    case integrations
    case pairing
    case achievements
    case collaboration
    case kanban
    case profiles
    case config
    case environment
    case system
  }

  init(
    version: Int = hermesRouteSnapshotVersion,
    route: String? = nil,
    sessions: [HermesSessionSnapshot] = [],
    files: [HermesFileSnapshot] = [],
    analytics: HermesAnalyticsSnapshot = .empty,
    models: [HermesModelSnapshot] = [],
    detectedModels: [String] = [],
    logs: [HermesLogSnapshot] = [],
    cron: [HermesCronJobSnapshot] = [],
    skills: [HermesSkillSnapshot] = [],
    integrations: [HermesIntegrationSnapshot] = [],
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
    self.files = files
    self.analytics = analytics
    self.models = models
    self.detectedModels = detectedModels
    self.logs = logs
    self.cron = cron
    self.skills = skills
    self.integrations = integrations
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
    let container = try decoder.container(keyedBy: CodingKeys.self)
    version = try container.decodeIfPresent(Int.self, forKey: .version)
      ?? hermesRouteSnapshotVersion
    route = try container.decodeIfPresent(String.self, forKey: .route)
    sessions = try container.decodeIfPresent(
      [HermesSessionSnapshot].self,
      forKey: .sessions
    ) ?? []
    files = try container.decodeIfPresent(
      [HermesFileSnapshot].self,
      forKey: .files
    ) ?? []
    analytics = try container.decodeIfPresent(
      HermesAnalyticsSnapshot.self,
      forKey: .analytics
    ) ?? .empty
    models = try container.decodeIfPresent(
      [HermesModelSnapshot].self,
      forKey: .models
    ) ?? []
    detectedModels = try container.decodeIfPresent(
      [String].self,
      forKey: .detectedModels
    ) ?? []
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

struct HermesSessionSnapshot: Decodable, Equatable, Identifiable {
  let id: String
  let title: String
  let model: String
  let date: String
  let running: Bool
  let profile: String?
  let detail: String?
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

  init(dataJson: String) {
    sourceJson = dataJson
    do {
      snapshot = try HermesRouteSnapshotDecoder.decode(dataJson)
      decodingError = nil
    } catch {
      snapshot = .empty
      decodingError = String(describing: error)
    }
  }

  func update(dataJson: String) {
    guard sourceJson != dataJson else { return }
    sourceJson = dataJson
    do {
      snapshot = try HermesRouteSnapshotDecoder.decode(dataJson)
      decodingError = nil
    } catch {
      // Keep the last valid server snapshot visible while RN retries the update.
      decodingError = String(describing: error)
    }
  }
}

enum HermesRouteAction: String, CaseIterable {
  case refresh = "route.refresh"
  case sessionSelect = "session.select"
  case sessionOpen = "session.open"
  case sessionDelete = "session.delete"
  case sessionRename = "session.rename"
  case fileSelect = "file.select"
  case fileDelete = "file.delete"
  case fileDownload = "file.download"
  case fileShare = "file.share"
  case fileImport = "file.import"
  case folderCreate = "folder.create"
  case modelSelect = "model.select"
  case modelDiscover = "model.discover"
  case modelSave = "model.save"
  case modelTest = "model.test"
  case logsFilter = "logs.filter"
  case cronCreate = "cron.create"
  case cronToggle = "cron.toggle"
  case cronRun = "cron.run"
  case cronDelete = "cron.delete"
  case skillToggle = "skill.toggle"
  case skillSelect = "skill.select"
  case skillView = "skill.view"
  case skillUpdate = "skill.update"
  case integrationCreate = "integration.create"
  case integrationUpdate = "integration.update"
  case integrationToggle = "integration.toggle"
  case integrationDelete = "integration.delete"
  case pairingApprove = "pairing.approve"
  case pairingRevoke = "pairing.revoke"
  case pairingClearPending = "pairing.clear-pending"
  case achievementsRescan = "achievements.rescan"
  case profileCreate = "profile.create"
  case profileUpdate = "profile.update"
  case profileActivate = "profile.activate"
  case profileDelete = "profile.delete"
  case configUpdate = "config.update"
  case configImport = "config.import"
  case environmentDelete = "environment.delete"
  case systemRestart = "system.restart"
  case systemRecover = "system.recover"
  case systemUpdate = "system.update"
  case kanbanCreate = "kanban.create"
  case kanbanUpdate = "kanban.update"
  case kanbanMove = "kanban.move"
  case kanbanDelete = "kanban.delete"
  case collaborationSelect = "collaboration.select"
  case collaborationCreate = "collaboration.create"
  case collaborationDelete = "collaboration.delete"
  case collaborationSend = "collaboration.send"
}

struct HermesRouteActionPayload: Encodable, Equatable {
  let route: String
  let id: String?
  let name: String?
  let value: String?
  let detail: String?
  let targetId: String?
  let enabled: Bool?
  let position: Int?
  let requestId: String?
  let fields: [String: String]?
  let uris: [String]?

  init(
    route: String,
    id: String? = nil,
    name: String? = nil,
    value: String? = nil,
    detail: String? = nil,
    targetId: String? = nil,
    enabled: Bool? = nil,
    position: Int? = nil,
    requestId: String? = nil,
    fields: [String: String]? = nil,
    uris: [String]? = nil
  ) {
    self.route = route
    self.id = id
    self.name = name
    self.value = value
    self.detail = detail
    self.targetId = targetId
    self.enabled = enabled
    self.position = position
    self.requestId = requestId
    self.fields = fields
    self.uris = uris
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
