import Foundation
import WatchConnectivity

final class HermesWatchService: NSObject, WCSessionDelegate {
  static let shared = HermesWatchService()

  private let session = WCSession.default
  private let lastMessageAtKey = "app.hermes.watch.lastMessageAt"
  private let resetAtKey = "app.hermes.watch.accountResetAt"
  private let generationKey = "app.hermes.watch.accountGeneration"
  private let serverGenerationKey = "app.hermes.watch.serverAccountGeneration"
  private let accountUUIDKey = "app.hermes.watch.accountUUID"
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
    guard WCSession.isSupported(), let fence = currentFence() else { return false }
    var operation = payload
    if operation["action"] != nil {
      let now = Date().timeIntervalSince1970 * 1000
      operation["controlIssuedAt"] = operation["controlIssuedAt"] ?? now
      operation["observedAt"] = operation["observedAt"] ?? now
    }
    let scopedPayload = fence.envelope(operation)
    if session.isReachable {
      return await withCheckedContinuation { continuation in
        // WCSession can legally invoke both replyHandler and errorHandler
        // for a single sendMessage (the OS may deliver a partial failure
        // after the message was acknowledged), which would resume the
        // continuation twice and trap. Claim the continuation under a
        // small atomic so the second call is a no-op.
        let box = HermesWatchOnceBox()
        session.sendMessage(scopedPayload, replyHandler: { reply in
          guard box.tryClaim() else { return }
          continuation.resume(returning: reply["accepted"] as? Bool ?? true)
        }, errorHandler: { [weak self] _ in
          guard box.tryClaim() else { return }
          guard let self, self.isCurrent(fence) else {
            continuation.resume(returning: false)
            return
          }
          self.session.transferUserInfo(scopedPayload)
          continuation.resume(returning: true)
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
      let applicationContext = session.receivedApplicationContext
      if matchesCurrentFence(applicationContext),
         let contextObservedAt = Self.observedDate(applicationContext["observedAt"]),
         validTimestamp(contextObservedAt) {
        payload["applicationContext"] = applicationContext
      } else {
        payload["applicationContext"] = [String: Any]()
      }
      payload["lastMessageAt"] = lastMessageAt
    } else {
      payload["applicationContext"] = [String: Any]()
      payload["lastMessageAt"] = NSNull()
    }
    return payload
  }

  func resetAccountState(
    ownerScope: String,
    accountGeneration: Int,
    serverAccountGeneration: String
  ) {
    let resetAt = Date().timeIntervalSince1970 * 1000
    let fence = AccountFence(
      accountUUID: HermesCollectorGenerationToken.accountUUID(for: ownerScope),
      serverGeneration: serverAccountGeneration,
      lifecycleEpoch: accountGeneration,
      resetAt: resetAt
    )
    persist(fence)
    UserDefaults.standard.removeObject(forKey: lastMessageAtKey)
    publishApplicationContext(fence.envelope([
      "action": "reset-account-generation",
      "controlIssuedAt": resetAt,
      "observedAt": resetAt,
    ]))
  }

  func activateAccountGeneration(_ token: HermesCollectorGenerationToken) {
    let fence = AccountFence(
      accountUUID: token.accountUUID,
      serverGeneration: token.serverAccountGeneration,
      lifecycleEpoch: token.lifecycleEpoch,
      resetAt: token.startedAtMilliseconds
    )
    persist(fence)
    let issuedAt = Date().timeIntervalSince1970 * 1000
    let handshake = fence.envelope([
      "action": "set-account-generation",
      "controlIssuedAt": issuedAt,
      "observedAt": issuedAt,
    ])
    publishApplicationContext(handshake)
    Task { _ = await send(payload: handshake) }
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    receive(message)
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    receive(message, acknowledgement: replyHandler)
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    receive(userInfo)
  }

  func session(
    _ session: WCSession,
    didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    receive(applicationContext)
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
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

  private func receive(
    _ message: [String: Any],
    acknowledgement: (([String: Any]) -> Void)? = nil
  ) {
    if message["action"] as? String == "request-account-handshake" {
      guard let fence = currentFence() else {
        acknowledgement?(["accepted": false])
        return
      }
      let now = Date().timeIntervalSince1970 * 1000
      let handshake = fence.envelope([
        "accepted": true,
        "action": "set-account-generation",
        "controlIssuedAt": now,
        "observedAt": now,
      ])
      publishApplicationContext(handshake)
      acknowledgement?(handshake)
      return
    }

    guard !HermesContextEventQueue.shared.isCollectionSuspended,
          let token = HermesContextEventQueue.shared.currentCollectorGenerationToken(),
          matches(message, token: token),
          let eventID = normalizedEventID(message["eventID"]),
          let occurredAt = Self.observedDate(message["observedAt"]),
          token.accepts(occurredAt),
          validTimestamp(occurredAt) else {
      acknowledgement?(["accepted": false])
      return
    }

    let sourceDeviceID = String(
      (message["sourceDeviceId"] as? String ?? "apple-watch").prefix(256)
    )
    let events = relayEvents(
      for: message,
      eventID: eventID,
      occurredAt: occurredAt,
      sourceDeviceID: sourceDeviceID,
      token: token
    )
    do {
      let persisted = try HermesContextEventQueue.shared.enqueueBatch(events)
      guard persisted == events.count else {
        acknowledgement?(["accepted": false])
        return
      }
      let persistedAt = Date().timeIntervalSince1970 * 1000
      UserDefaults.standard.set(persistedAt, forKey: lastMessageAtKey)
      onMessage?(message)
      let ack: [String: Any] = [
        "accepted": true,
        "eventID": eventID,
        "persistedAt": persistedAt,
      ]
      if let acknowledgement {
        acknowledgement(ack)
      } else {
        Task { [weak self] in
          _ = await self?.send(payload: [
            "action": "watch-event-ack",
            "accepted": true,
            "eventID": eventID,
            "observedAt": persistedAt,
          ])
        }
      }
    } catch {
      acknowledgement?(["accepted": false])
    }
  }

  private func relayEvents(
    for message: [String: Any],
    eventID: String,
    occurredAt: Date,
    sourceDeviceID: String,
    token: HermesCollectorGenerationToken
  ) -> [[String: Any]] {
    var events = [rawEvent(
      id: "watch:\(eventID)",
      kind: "watch",
      payload: [
        "message": message,
        "receivedAt": Date().timeIntervalSince1970 * 1000,
        "source": "apple-watch",
      ],
      occurredAt: occurredAt,
      sourceDeviceID: sourceDeviceID,
      token: token
    )]

    switch message["kind"] as? String {
    case "watch-location":
      if let event = locationEvent(
        message,
        id: "watch:\(eventID):location",
        occurredAt: occurredAt,
        sourceDeviceID: sourceDeviceID,
        token: token
      ) { events.append(event) }
    case "watch-motion":
      let motion = message["motion"] as? String ?? "unknown"
      events.append(rawEvent(
        id: "watch:\(eventID):motion",
        kind: "motion",
        payload: [
          "activity": motion,
          "confidence": message["confidence"] ?? "unknown",
          "source": "apple-watch",
          "state": motion,
        ],
        occurredAt: occurredAt,
        sourceDeviceID: sourceDeviceID,
        token: token
      ))
    case "watch-context":
      if let location = message["location"] as? [String: Any],
         let event = locationEvent(
           location,
           id: "watch:\(eventID):location",
           occurredAt: occurredAt,
           sourceDeviceID: sourceDeviceID,
           token: token
         ) { events.append(event) }
      if let steps = message["steps"] {
        events.append(rawEvent(
          id: "watch:\(eventID):steps",
          kind: "health-activity",
          payload: ["source": "apple-watch", "steps": steps],
          occurredAt: occurredAt,
          sourceDeviceID: sourceDeviceID,
          token: token
        ))
      }
    case "watch-workout-sample":
      var payload = message["metrics"] as? [String: Any] ?? [:]
      payload["motion"] = message["motion"] ?? "unknown"
      payload["source"] = "apple-watch"
      events.append(rawEvent(
        id: "watch:\(eventID):workout",
        kind: "health-activity",
        payload: payload,
        occurredAt: occurredAt,
        sourceDeviceID: sourceDeviceID,
        token: token
      ))
    default:
      break
    }
    return events
  }

  private func locationEvent(
    _ value: [String: Any],
    id: String,
    occurredAt: Date,
    sourceDeviceID: String,
    token: HermesCollectorGenerationToken
  ) -> [String: Any]? {
    guard value["latitude"] is NSNumber, value["longitude"] is NSNumber else { return nil }
    var payload = value
    payload.removeValue(forKey: "kind")
    payload.removeValue(forKey: "observedAt")
    payload.removeValue(forKey: "sourceDeviceId")
    payload["horizontal_accuracy"] = payload["horizontal_accuracy"] ?? payload["accuracy"]
    payload["motion"] = payload["motion"] ?? "unknown"
    payload["source"] = "apple-watch"
    return rawEvent(
      id: id,
      kind: "location",
      payload: payload,
      occurredAt: occurredAt,
      sourceDeviceID: sourceDeviceID,
      token: token
    )
  }

  private func rawEvent(
    id: String,
    kind: String,
    payload: [String: Any],
    occurredAt: Date,
    sourceDeviceID: String,
    token: HermesCollectorGenerationToken
  ) -> [String: Any] {
    [
      "account_generation": token.serverAccountGeneration,
      "id": String(id.prefix(256)),
      "kind": kind,
      "lifecycle_epoch": token.lifecycleEpoch,
      "payload": payload,
      "source_device_id": sourceDeviceID,
      "timestamp": occurredAt.timeIntervalSince1970 * 1000,
    ]
  }

  private func matches(_ message: [String: Any], token: HermesCollectorGenerationToken) -> Bool {
    guard let resetAt = number(message["accountResetAt"]) else { return false }
    return message["accountUUID"] as? String == token.accountUUID
      && integer(message["accountEpoch"]) == token.lifecycleEpoch
      && integer(message["accountGeneration"]) == token.lifecycleEpoch
      && message["account_generation"] as? String == token.serverAccountGeneration
      && resetAt == token.startedAtMilliseconds
  }

  private func matchesCurrentFence(_ message: [String: Any]) -> Bool {
    guard let fence = currentFence(), let observedAt = Self.observedDate(message["observedAt"]) else {
      return false
    }
    return fence.matches(message) && validTimestamp(observedAt)
  }

  private func validTimestamp(_ date: Date) -> Bool {
    let milliseconds = date.timeIntervalSince1970 * 1000
    let resetAt = UserDefaults.standard.double(forKey: resetAtKey)
    return milliseconds.isFinite
      && milliseconds > resetAt
      && date.timeIntervalSinceNow <= 60
  }

  private func persist(_ fence: AccountFence) {
    let defaults = UserDefaults.standard
    defaults.set(fence.accountUUID, forKey: accountUUIDKey)
    defaults.set(fence.lifecycleEpoch, forKey: generationKey)
    defaults.set(fence.serverGeneration, forKey: serverGenerationKey)
    defaults.set(fence.resetAt, forKey: resetAtKey)
  }

  private func currentFence() -> AccountFence? {
    let defaults = UserDefaults.standard
    let accountUUID = defaults.string(forKey: accountUUIDKey) ?? ""
    let serverGeneration = defaults.string(forKey: serverGenerationKey) ?? ""
    let lifecycleEpoch = defaults.integer(forKey: generationKey)
    let resetAt = defaults.double(forKey: resetAtKey)
    guard !accountUUID.isEmpty, !serverGeneration.isEmpty, lifecycleEpoch > 0,
          resetAt.isFinite, resetAt > 0 else { return nil }
    return AccountFence(
      accountUUID: accountUUID,
      serverGeneration: serverGeneration,
      lifecycleEpoch: lifecycleEpoch,
      resetAt: resetAt
    )
  }

  private func isCurrent(_ fence: AccountFence) -> Bool {
    currentFence() == fence
  }

  private func publishApplicationContext(_ payload: [String: Any]) {
    guard WCSession.isSupported() else { return }
    try? session.updateApplicationContext(payload)
  }

  private func normalizedEventID(_ value: Any?) -> String? {
    guard let raw = value as? String else { return nil }
    let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty, normalized.count <= 128 else { return nil }
    return normalized
  }

  private func integer(_ value: Any?) -> Int? {
    (value as? NSNumber)?.intValue ?? value as? Int
  }

  private func number(_ value: Any?) -> Double? {
    if let number = value as? NSNumber, number.doubleValue.isFinite { return number.doubleValue }
    if let number = value as? Double, number.isFinite { return number }
    return nil
  }

  private static func observedDate(_ value: Any?) -> Date? {
    guard let number = value as? NSNumber else { return nil }
    let timestamp = number.doubleValue
    guard timestamp.isFinite, timestamp > 0 else { return nil }
    return Date(timeIntervalSince1970: timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp)
  }
}

private struct AccountFence: Equatable {
  let accountUUID: String
  let serverGeneration: String
  let lifecycleEpoch: Int
  let resetAt: Double

  func envelope(_ payload: [String: Any]) -> [String: Any] {
    var result = payload
    result["accountUUID"] = accountUUID
    result["accountEpoch"] = lifecycleEpoch
    result["accountGeneration"] = lifecycleEpoch
    result["account_generation"] = serverGeneration
    result["accountResetAt"] = resetAt
    return result
  }

  func matches(_ payload: [String: Any]) -> Bool {
    let epoch = (payload["accountEpoch"] as? NSNumber)?.intValue
      ?? payload["accountEpoch"] as? Int
    let legacyEpoch = (payload["accountGeneration"] as? NSNumber)?.intValue
      ?? payload["accountGeneration"] as? Int
    let payloadResetAt = (payload["accountResetAt"] as? NSNumber)?.doubleValue
      ?? payload["accountResetAt"] as? Double
    return payload["accountUUID"] as? String == accountUUID
      && payload["account_generation"] as? String == serverGeneration
      && epoch == lifecycleEpoch
      && legacyEpoch == lifecycleEpoch
      && payloadResetAt == resetAt
  }
}

/// Single-shot guard used by send-continuations to prevent a double resume
/// when WatchConnectivity delivers both a reply and an error for the same
/// sendMessage (a known race documented in the watchOS 9+ WCSession API).
/// We use this lightweight class instead of a @unchecked Sendable wrapper to
/// avoid an extra global lock and keep the per-call cost negligible.
private final class HermesWatchOnceBox {
  private var claimed = false
  private let lock = NSLock()

  func tryClaim() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if claimed { return false }
    claimed = true
    return true
  }
}
