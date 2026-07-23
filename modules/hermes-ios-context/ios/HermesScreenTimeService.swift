import Foundation

#if canImport(FamilyControls)
import DeviceActivity
import FamilyControls
#endif

final class HermesScreenTimeService {
  static let shared = HermesScreenTimeService()
  private let accountGenerationKey = "account-generation"
  private let monitoredIdentifiersKey = "device-activity-monitor-identifiers"
  private let sharedDefaults = UserDefaults(suiteName: "group.app.sunstone1029.fig1171.hermes")

  func capabilities(hasEntitlement: Bool) -> [String: Any] {
    [
      "deviceActivity": hasEntitlement && Self.frameworkAvailable,
      "familyControls": hasEntitlement && Self.frameworkAvailable,
      "status": hasEntitlement ? authorizationStatus : "entitlement-required",
    ]
  }

  func snapshot(hasEntitlement: Bool) -> [String: Any] {
    var result = capabilities(hasEntitlement: hasEntitlement)
    let generation = HermesContextEventQueue.shared.accountGeneration
    let events = (sharedDefaults?.array(forKey: "device-activity-events") as? [[String: Any]] ?? [])
      .filter { Self.generation(of: $0) == generation }
    let storedSummary = sharedDefaults?.dictionary(forKey: "device-activity-summary-latest")
    let summary = storedSummary.flatMap {
      Self.generation(of: $0) == generation ? $0 : nil
    }
    result["events"] = Array(events.suffix(100))
    result["activitySummary"] = summary
    result["consumedEvents"] = consumeExtensionEvents()
    result["observedAt"] = Date().timeIntervalSince1970 * 1000
    return result
  }

  @discardableResult
  func consumeExtensionEvents() -> Int {
    guard let sharedDefaults,
          !HermesContextEventQueue.shared.isCollectionSuspended,
          HermesContextEventQueue.shared.hasCurrentOwner else { return 0 }
    let events = sharedDefaults.array(forKey: "device-activity-events") as? [[String: Any]] ?? []
    let summary = sharedDefaults.dictionary(forKey: "device-activity-summary-latest")
    if events.isEmpty, summary == nil { return 0 }
    let generation = HermesContextEventQueue.shared.accountGeneration
    let currentEvents = events.filter { Self.generation(of: $0) == generation }
    let currentSummary = summary.flatMap {
      Self.generation(of: $0) == generation ? $0 : nil
    }
    let currentPayloads = currentEvents + (currentSummary.map { [$0] } ?? [])
    let batch = currentPayloads.map { payload -> [String: Any] in
      [
        "id": Self.eventID(of: payload),
        "kind": "screen-time",
        "observed_at": payload["observedAt"] ?? Date().timeIntervalSince1970 * 1000,
        "payload": payload,
        "account_generation": generation,
      ]
    }
    let persisted = (try? HermesContextEventQueue.shared.enqueueBatch(batch)) ?? 0
    guard persisted == batch.count else { return 0 }

    // Extensions and the host are separate processes. Remove only the exact
    // records captured above so a callback written while persistence is in
    // progress is not erased by the host.
    let consumedEventIDs = Set(events.map { Self.eventID(of: $0) })
    let latestEvents = sharedDefaults.array(forKey: "device-activity-events") as? [[String: Any]] ?? []
    let remainingEvents = latestEvents.filter { !consumedEventIDs.contains(Self.eventID(of: $0)) }
    if remainingEvents.isEmpty { sharedDefaults.removeObject(forKey: "device-activity-events") }
    else { sharedDefaults.set(remainingEvents, forKey: "device-activity-events") }
    if let summary {
      let capturedID = Self.eventID(of: summary)
      let latestSummary = sharedDefaults.dictionary(forKey: "device-activity-summary-latest")
      if latestSummary.map({ Self.eventID(of: $0) }) == capturedID {
        sharedDefaults.removeObject(forKey: "device-activity-summary-latest")
      }
    }
    return persisted
  }

  func setAccountGeneration(_ generation: Int) {
    sharedDefaults?.set(max(0, generation), forKey: accountGenerationKey)
  }

  func requestAuthorization(hasEntitlement: Bool) async -> String {
    guard hasEntitlement, Self.frameworkAvailable else { return "entitlement-required" }
#if canImport(FamilyControls)
    do {
      try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
      return authorizationStatus
    } catch {
      return "denied"
    }
#else
    return "unavailable"
#endif
  }

  func startMonitoring(hasEntitlement: Bool, identifier: String, startHour: Int, endHour: Int) throws -> String {
    guard hasEntitlement, Self.frameworkAvailable else { throw HermesScreenTimeError.entitlementRequired }
    guard authorizationStatus == "authorized" else { throw HermesScreenTimeError.permissionRequired }
    setAccountGeneration(HermesContextEventQueue.shared.accountGeneration)
#if canImport(DeviceActivity)
    let start = DateComponents(hour: max(0, min(23, startHour)), minute: 0)
    let boundedEnd = max(0, min(24, endHour))
    let end: DateComponents
    if boundedEnd == 24 {
      end = DateComponents(hour: 23, minute: 59, second: 59)
    } else {
      end = DateComponents(hour: boundedEnd, minute: 0)
    }
    let schedule = DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: true)
    try DeviceActivityCenter().startMonitoring(
      DeviceActivityName(identifier), during: schedule
    )
    var identifiers = sharedDefaults?.stringArray(forKey: monitoredIdentifiersKey) ?? []
    if !identifiers.contains(identifier) { identifiers.append(identifier) }
    sharedDefaults?.set(identifiers, forKey: monitoredIdentifiersKey)
    return identifier
#else
    throw HermesScreenTimeError.unavailable
#endif
  }

  func stopMonitoring(identifier: String) {
#if canImport(DeviceActivity)
    DeviceActivityCenter().stopMonitoring([DeviceActivityName(identifier)])
    var identifiers = sharedDefaults?.stringArray(forKey: monitoredIdentifiersKey) ?? []
    identifiers.removeAll { $0 == identifier }
    sharedDefaults?.set(identifiers, forKey: monitoredIdentifiersKey)
#else
    _ = identifier
#endif
  }

  func stopAllMonitoring(accountGeneration: Int? = nil) {
#if canImport(DeviceActivity)
    let identifiers = sharedDefaults?.stringArray(forKey: monitoredIdentifiersKey) ?? []
    if identifiers.isEmpty {
      DeviceActivityCenter().stopMonitoring()
    } else {
      DeviceActivityCenter().stopMonitoring(identifiers.map { DeviceActivityName(rawValue: $0) })
    }
#endif
    if let accountGeneration { setAccountGeneration(accountGeneration) }
    sharedDefaults?.removeObject(forKey: monitoredIdentifiersKey)
    sharedDefaults?.removeObject(forKey: "device-activity-events")
    sharedDefaults?.removeObject(forKey: "device-activity-summary-latest")
  }

  private static func generation(of payload: [String: Any]) -> Int? {
    (payload["accountGeneration"] as? NSNumber)?.intValue
      ?? payload["accountGeneration"] as? Int
  }

  private static func eventID(of payload: [String: Any]) -> String {
    if let value = payload["eventId"] as? String, !value.isEmpty { return value }
    let observedAt = (payload["observedAt"] as? NSNumber)?.doubleValue ?? 0
    let state = payload["state"] as? String ?? "unknown"
    return "legacy-device-activity-\(observedAt)-\(state)"
  }

  static var frameworkAvailable: Bool {
#if canImport(FamilyControls)
    return true
#else
    return false
#endif
  }

  private var authorizationStatus: String {
#if canImport(FamilyControls)
    switch AuthorizationCenter.shared.authorizationStatus {
    case .approved: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
#else
    return "unavailable"
#endif
  }
}

private enum HermesScreenTimeError: LocalizedError {
  case entitlementRequired
  case permissionRequired
  case unavailable

  var errorDescription: String? {
    switch self {
    case .entitlementRequired: return "Family Controls entitlement is required."
    case .permissionRequired: return "Screen Time authorization is required."
    case .unavailable: return "Device Activity is unavailable on this build."
    }
  }
}
