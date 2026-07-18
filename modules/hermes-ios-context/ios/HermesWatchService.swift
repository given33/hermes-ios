import Foundation
import WatchConnectivity

final class HermesWatchService: NSObject, WCSessionDelegate {
  static let shared = HermesWatchService()

  private let session = WCSession.default
  private let lastMessageAtKey = "app.hermes.watch.lastMessageAt"
  private let resetAtKey = "app.hermes.watch.accountResetAt"
  private let generationKey = "app.hermes.watch.accountGeneration"
  var onMessage: (([String: Any]) -> Void)?

  private override init() {
    super.init()
    guard WCSession.isSupported() else { return }
    session.delegate = self
    session.activate()
  }

  var capabilities: [String: Any] {
    [
      "activationState": session.activationState.rawValue,
      "isPaired": session.isPaired,
      "isWatchAppInstalled": session.isWatchAppInstalled,
      "isReachable": session.isReachable,
      "supported": WCSession.isSupported(),
    ]
  }

  func send(payload: [String: Any]) async -> Bool {
    guard WCSession.isSupported() else { return false }
    var scopedPayload = payload
    if scopedPayload["accountGeneration"] == nil {
      scopedPayload["accountGeneration"] = UserDefaults.standard.integer(forKey: generationKey)
    }
    if session.isReachable {
      return await withCheckedContinuation { continuation in
        session.sendMessage(scopedPayload, replyHandler: { _ in
          continuation.resume(returning: true)
        }, errorHandler: { _ in
          continuation.resume(returning: false)
        })
      }
    }
    session.transferUserInfo(scopedPayload)
    return true
  }

  func contextSnapshot() -> [String: Any] {
    var payload = capabilities
    let resetAt = UserDefaults.standard.double(forKey: resetAtKey)
    let lastMessageAt = UserDefaults.standard.double(forKey: lastMessageAtKey)
    if lastMessageAt > resetAt {
      payload["applicationContext"] = session.receivedApplicationContext
      payload["lastMessageAt"] = lastMessageAt
    } else {
      payload["applicationContext"] = [String: Any]()
      payload["lastMessageAt"] = NSNull()
    }
    return payload
  }

  func resetAccountState(accountGeneration: Int) {
    UserDefaults.standard.set(Date().timeIntervalSince1970 * 1000, forKey: resetAtKey)
    UserDefaults.standard.set(accountGeneration, forKey: generationKey)
    UserDefaults.standard.removeObject(forKey: lastMessageAtKey)
  }

  func activateAccountGeneration(_ generation: Int) {
    UserDefaults.standard.set(generation, forKey: generationKey)
    Task {
      _ = await send(payload: ["action": "set-account-generation"])
    }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    receive(message)
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    receive(userInfo)
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    HermesContextEventQueue.shared.enqueue(type: "watch", payload: [
      "activationState": activationState.rawValue,
      "error": hermesNullable(error?.localizedDescription),
      "isPaired": session.isPaired,
      "isReachable": session.isReachable,
      "status": error == nil ? "activated" : "failed",
    ])
  }

  func sessionDidBecomeInactive(_ session: WCSession) {
    HermesContextEventQueue.shared.enqueue(type: "watch", payload: [
      "activationState": session.activationState.rawValue,
      "status": "inactive",
    ])
  }

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  private func receive(_ message: [String: Any]) {
    guard !HermesContextEventQueue.shared.isCollectionSuspended else { return }
    let defaults = UserDefaults.standard
    let generation = (message["accountGeneration"] as? NSNumber)?.intValue
      ?? message["accountGeneration"] as? Int
    guard generation == defaults.integer(forKey: generationKey),
          let occurredAt = Self.observedDate(message["observedAt"]),
          occurredAt.timeIntervalSince1970 * 1000 > defaults.double(forKey: resetAtKey) else {
      return
    }
    defaults.set(Date().timeIntervalSince1970 * 1000, forKey: lastMessageAtKey)
    let sourceDeviceID = String(
      (message["sourceDeviceId"] as? String ?? "apple-watch").prefix(256)
    )
    HermesContextEventQueue.shared.enqueue(
      type: "watch",
      payload: [
        "message": message,
        "receivedAt": Date().timeIntervalSince1970 * 1000,
        "source": "apple-watch",
      ],
      occurredAt: occurredAt,
      sourceDeviceID: sourceDeviceID
    ) { [weak self] in self?.onMessage?(message) }

    switch message["kind"] as? String {
    case "watch-location":
      enqueueLocation(message, occurredAt: occurredAt, sourceDeviceID: sourceDeviceID)
    case "watch-motion":
      let motion = message["motion"] as? String ?? "unknown"
      HermesContextEventQueue.shared.enqueue(
        type: "motion",
        payload: [
          "activity": motion,
          "confidence": message["confidence"] ?? "unknown",
          "source": "apple-watch",
          "state": motion,
        ],
        occurredAt: occurredAt,
        sourceDeviceID: sourceDeviceID
      )
    case "watch-context":
      if let location = message["location"] as? [String: Any] {
        enqueueLocation(location, occurredAt: occurredAt, sourceDeviceID: sourceDeviceID)
      }
      if let steps = message["steps"] {
        HermesContextEventQueue.shared.enqueue(
          type: "health-activity",
          payload: ["source": "apple-watch", "steps": steps],
          occurredAt: occurredAt,
          sourceDeviceID: sourceDeviceID
        )
      }
    case "watch-workout-sample":
      var payload = message["metrics"] as? [String: Any] ?? [:]
      payload["motion"] = message["motion"] ?? "unknown"
      payload["source"] = "apple-watch"
      HermesContextEventQueue.shared.enqueue(
        type: "health-activity",
        payload: payload,
        occurredAt: occurredAt,
        sourceDeviceID: sourceDeviceID
      )
    default:
      break
    }
  }

  private func enqueueLocation(
    _ value: [String: Any],
    occurredAt: Date,
    sourceDeviceID: String
  ) {
    guard value["latitude"] is NSNumber, value["longitude"] is NSNumber else { return }
    var payload = value
    payload.removeValue(forKey: "kind")
    payload.removeValue(forKey: "observedAt")
    payload.removeValue(forKey: "sourceDeviceId")
    payload["horizontal_accuracy"] = payload["horizontal_accuracy"] ?? payload["accuracy"]
    payload["motion"] = payload["motion"] ?? "unknown"
    payload["source"] = "apple-watch"
    HermesContextEventQueue.shared.enqueue(
      type: "location",
      payload: payload,
      occurredAt: occurredAt,
      sourceDeviceID: sourceDeviceID
    )
  }

  private static func observedDate(_ value: Any?) -> Date? {
    guard let number = value as? NSNumber else { return nil }
    let timestamp = number.doubleValue
    guard timestamp.isFinite, timestamp > 0 else { return nil }
    return Date(timeIntervalSince1970: timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp)
  }
}
