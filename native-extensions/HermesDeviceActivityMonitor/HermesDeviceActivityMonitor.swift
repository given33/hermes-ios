import DeviceActivity
import Foundation

final class HermesDeviceActivityMonitor: DeviceActivityMonitor {
  private let suite = UserDefaults(suiteName: "group.app.sunstone1029.fig1171.hermes")
  private let accountGenerationKey = "account-generation"

  override func intervalDidStart(for activity: DeviceActivityName) {
    record(state: "interval-start", activity: activity)
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    record(state: "interval-end", activity: activity)
  }

  override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
    record(state: "threshold", activity: activity, event: event.rawValue)
  }

  private func record(state: String, activity: DeviceActivityName, event: String? = nil) {
    var items = suite?.array(forKey: "device-activity-events") as? [[String: Any]] ?? []
    var payload: [String: Any] = [
      "accountGeneration": suite?.integer(forKey: accountGenerationKey) ?? 0,
      "activity": activity.rawValue,
      "eventId": UUID().uuidString.lowercased(),
      "observedAt": Date().timeIntervalSince1970 * 1000,
      "state": state,
    ]
    payload["event"] = event
    items.append(payload)
    suite?.set(Array(items.suffix(500)), forKey: "device-activity-events")
  }
}
