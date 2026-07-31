import Foundation

#if canImport(ActivityKit)
import ActivityKit

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

  private init() {
    for activity in Activity<HermesWeatherActivityAttributes>.activities {
      activities[activity.attributes.activityID] = activity
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
      return ["action": "ended", "id": id]
    }
    let taskID = normalizedString(payload["taskId"] ?? payload["task_id"])
    let kind = normalizedString(payload["kind"] ?? payload["type"])
      ?? (taskID == nil ? "weather" : "agent-task")
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
