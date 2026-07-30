import DeviceActivity
import Foundation

final class HermesDeviceActivityMonitor: DeviceActivityMonitor {
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
    guard let generation = HermesScreenTimeSpool.captureGeneration() else { return }
    var payload: [String: Any] = [
      "activity": activity.rawValue,
      "eventId": UUID().uuidString.lowercased(),
      "observedAt": Date().timeIntervalSince1970 * 1000,
      "state": state,
    ]
    payload["event"] = event
    _ = HermesScreenTimeSpool.append(payload, generation: generation)
  }
}
