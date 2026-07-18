import Foundation

#if canImport(ActivityKit)
import ActivityKit

struct HermesWeatherActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var body: String
    var expiresAt: Date?
    var severity: String
    var title: String
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
    let content = HermesWeatherActivityAttributes.ContentState(
      body: payload["body"] as? String ?? "",
      expiresAt: (payload["expiresAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) },
      severity: payload["severity"] as? String ?? "info",
      title: payload["title"] as? String ?? "Hermes"
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
