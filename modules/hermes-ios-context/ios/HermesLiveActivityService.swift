import Foundation

#if canImport(ActivityKit)
import ActivityKit

struct HermesAgentActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var title: String
    var body: String
    var status: String
    var taskID: String?
    var activeSessionID: String?
    var sessionCount: Int
    var sessionsSummary: String?
    var progress: Double?
    var currentTool: String?
    var toolStatus: String?
    var loopIteration: Int?
    var childCompleted: Int
    var childTotal: Int
    var lastMessage: String?
    var privacyMode: Bool
    var ttsEnabled: Bool
    var actionDeepLink: String?
  }

  let activityID: String
}

struct HermesWeatherActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var body: String
    var expiresAt: Date?
    var severity: String
    var title: String
    // Optional fields keep activities created by older builds decodable while
    // allowing the same ActivityKit surface to represent an agent task.
    var kind: String?
    var taskID: String?
    var status: String?
    var progress: Double?
    var currentTool: String?
    var actionDeepLink: String?
  }

  let activityID: String
}

final class HermesLiveActivityService {
  static let shared = HermesLiveActivityService()
  static let isAvailable = true
  private var activities: [String: Activity<HermesWeatherActivityAttributes>] = [:]
  private var agentActivities: [String: Activity<HermesAgentActivityAttributes>] = [:]

  private init() {
    for activity in Activity<HermesWeatherActivityAttributes>.activities {
      activities[activity.attributes.activityID] = activity
    }
    for activity in Activity<HermesAgentActivityAttributes>.activities {
      agentActivities[activity.attributes.activityID] = activity
    }
  }

  func update(payload: [String: Any]) async throws -> [String: Any] {
    let id = (payload["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
      ?? UUID().uuidString.lowercased()
    let action = (payload["action"] as? String ?? "update").lowercased()
    if action == "end" {
      if let activity = activities.removeValue(forKey: id) {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      if let activity = agentActivities.removeValue(forKey: id) {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      return ["action": "ended", "id": id]
    }
    let taskID = normalizedString(payload["taskId"] ?? payload["task_id"])
    let kind = normalizedString(payload["kind"] ?? payload["type"])
      ?? (taskID == nil ? "weather" : "agent-task")
    if kind == "agent-task" || taskID != nil || payload["sessions"] != nil {
      return try await updateAgent(payload: payload, id: id, taskID: taskID)
    }
    let content = HermesWeatherActivityAttributes.ContentState(
      body: payload["body"] as? String ?? "",
      expiresAt: dateValue(payload["expiresAt"] ?? payload["expires_at"]),
      severity: payload["severity"] as? String ?? "info",
      title: payload["title"] as? String ?? "Hermes",
      kind: kind,
      taskID: taskID,
      status: normalizedString(payload["status"])?.lowercased(),
      progress: progressValue(payload["progress"]),
      currentTool: normalizedString(payload["currentTool"] ?? payload["current_tool"]),
      actionDeepLink: safeTaskDeepLink(
        payload["actionDeepLink"] ?? payload["action_deep_link"],
        taskID: taskID
      )
    )
    if let activity = activities[id] {
      await activity.update(ActivityContent(state: content, staleDate: content.expiresAt))
      return ["action": "updated", "id": id]
    }
    let activity = try Activity.request(
      attributes: HermesWeatherActivityAttributes(activityID: id),
      content: ActivityContent(state: content, staleDate: content.expiresAt),
      pushType: nil
    )
    activities[id] = activity
    return ["action": "started", "id": id]
  }

  private func updateAgent(
    payload: [String: Any],
    id: String,
    taskID: String?
  ) async throws -> [String: Any] {
    let privacyMode = payload["privacyMode"] as? Bool ?? payload["privacy_mode"] as? Bool ?? false
    let sessions = (payload["sessions"] as? [[String: Any]] ?? []).prefix(12)
    let sessionCount = max(1, payload["sessionCount"] as? Int ?? payload["session_count"] as? Int ?? sessions.count)
    let status = normalizedString(payload["status"])?.lowercased() ?? "running"
    let title = privacyMode ? "Hermes task" : (normalizedString(payload["title"]) ?? "Hermes task")
    let body = privacyMode ? "Task in progress" : (normalizedString(payload["body"]) ?? "")
    let currentTool = privacyMode ? nil : normalizedString(payload["currentTool"] ?? payload["current_tool"])
    let lastMessage = privacyMode ? nil : normalizedString(payload["lastMessage"] ?? payload["last_message"])
    let sessionSuffix = sessionCount == 1 ? "" : "s"
    let sessionsSummary = privacyMode
      ? "\(sessionCount) active session\(sessionSuffix)"
      : sessionSummary(sessions)
    let staleDate: Date? = status == "completed" || status == "cancelled" || status == "failed"
      ? Date().addingTimeInterval(30)
      : dateValue(payload["expiresAt"] ?? payload["expires_at"])
    let state = HermesAgentActivityAttributes.ContentState(
      title: String(title.prefix(160)),
      body: String(body.prefix(512)),
      status: String(status.prefix(64)),
      taskID: taskID,
      activeSessionID: normalizedString(payload["activeSessionID"] ?? payload["active_session_id"]),
      sessionCount: min(max(sessionCount, 1), 50),
      sessionsSummary: sessionsSummary,
      progress: progressValue(payload["progress"]),
      currentTool: currentTool,
      toolStatus: privacyMode ? nil : normalizedString(payload["toolStatus"] ?? payload["tool_status"]),
      loopIteration: boundedInt(payload["loopIteration"] ?? payload["loop_iteration"], maximum: 100_000),
      childCompleted: boundedInt(payload["childCompleted"] ?? payload["child_completed"], maximum: 10_000) ?? 0,
      childTotal: boundedInt(payload["childTotal"] ?? payload["child_total"], maximum: 10_000) ?? 0,
      lastMessage: lastMessage,
      privacyMode: privacyMode,
      ttsEnabled: payload["ttsEnabled"] as? Bool ?? payload["tts_enabled"] as? Bool ?? false,
      actionDeepLink: safeTaskDeepLink(payload["actionDeepLink"] ?? payload["action_deep_link"], taskID: taskID)
    )
    if let activity = agentActivities[id] {
      await activity.update(ActivityContent(state: state, staleDate: staleDate))
      return ["action": "updated", "id": id, "kind": "agent-task", "privacyMode": privacyMode]
    }
    let activity = try Activity.request(
      attributes: HermesAgentActivityAttributes(activityID: id),
      content: ActivityContent(state: state, staleDate: staleDate),
      pushType: nil
    )
    agentActivities[id] = activity
    return ["action": "started", "id": id, "kind": "agent-task", "privacyMode": privacyMode]
  }

  private func sessionSummary(_ sessions: ArraySlice<[String: Any]>) -> String? {
    guard !sessions.isEmpty else { return nil }
    let labels = sessions.compactMap { session -> String? in
      let title = normalizedString(session["title"] ?? session["name"])
      let status = normalizedString(session["status"])?.lowercased()
      guard let title else { return status }
      return status.map { "\(title): \($0)" } ?? title
    }
    return labels.isEmpty ? "\(sessions.count) sessions" : String(labels.joined(separator: " | ").prefix(512))
  }

  private func normalizedString(_ value: Any?) -> String? {
    guard let value = value as? String else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.isEmpty ? nil : String(normalized.prefix(512))
  }

  private func dateValue(_ value: Any?) -> Date? {
    guard let number = value as? NSNumber else { return nil }
    let raw = number.doubleValue
    guard raw.isFinite, raw > 0 else { return nil }
    return Date(timeIntervalSince1970: raw > 10_000_000_000 ? raw / 1000 : raw)
  }

  private func progressValue(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber else { return nil }
    let progress = number.doubleValue
    guard progress.isFinite else { return nil }
    return min(max(progress, 0), 1)
  }

  private func boundedInt(_ value: Any?, maximum: Int) -> Int? {
    guard let number = value as? NSNumber else { return nil }
    return min(max(number.intValue, 0), maximum)
  }

  private func safeTaskDeepLink(_ value: Any?, taskID: String?) -> String? {
    guard let raw = normalizedString(value), let components = URLComponents(string: raw),
          components.scheme == "hermes-agent", components.host == "task",
          components.user == nil, components.password == nil,
          components.path.split(separator: "/").count == 1 else {
      return taskID.flatMap { taskURL(taskID: $0, action: nil)?.absoluteString }
    }
    return raw
  }

  private func taskURL(taskID: String, action: String?) -> URL? {
    guard !taskID.contains("/"), !taskID.contains("\\"),
          let encoded = taskID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
          !encoded.isEmpty else { return nil }
    var components = URLComponents()
    components.scheme = "hermes-agent"
    components.host = "task"
    components.path = "/\(encoded)"
    if let action, !action.isEmpty {
      components.queryItems = [URLQueryItem(name: "action", value: action)]
    }
    return components.url
  }

  func endAll() async {
    let active = Array(activities.values)
    activities.removeAll()
    for activity in active {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
    let activeAgents = Array(agentActivities.values)
    agentActivities.removeAll()
    for activity in activeAgents {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
#else

final class HermesLiveActivityService {
  static let shared = HermesLiveActivityService()
  static let isAvailable = false

  func update(payload: [String: Any]) async throws -> [String: Any] {
    _ = payload
    throw HermesLiveActivityError.unavailable
  }

  func endAll() async {}
}

private enum HermesLiveActivityError: LocalizedError {
  case unavailable
  var errorDescription: String? { "Live Activities are unavailable on this build." }
}
#endif
