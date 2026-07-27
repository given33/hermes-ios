import CryptoKit
import Foundation
import Security

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
    let events = decodedRecords(forKey: "device-activity-events")
      .map(\.payload)
      .filter { Self.generation(of: $0) == generation }
    let summary = decodedSummaryRecord().flatMap {
      Self.generation(of: $0.payload) == generation ? $0.payload : nil
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
    let events = decodedRecords(forKey: "device-activity-events")
    let summary = decodedSummaryRecord()
    if events.isEmpty, summary == nil { return 0 }
    let generation = HermesContextEventQueue.shared.accountGeneration
    let currentPayloads = (events + (summary.map { [$0] } ?? []))
      .map(\.payload)
      .filter { Self.generation(of: $0) == generation }
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
    // progress is not erased by the host. Entries that no longer decode
    // (foreign shapes or torn envelopes) are dropped with the consumed batch.
    let consumedIdentities = Set(events.map(\.identity))
    let latestEvents = sharedDefaults.array(forKey: "device-activity-events") ?? []
    let remainingEvents = latestEvents.filter { raw in
      guard let record = decodeRecord(raw) else { return false }
      return !consumedIdentities.contains(record.identity)
    }
    if remainingEvents.isEmpty { sharedDefaults.removeObject(forKey: "device-activity-events") }
    else { sharedDefaults.set(remainingEvents, forKey: "device-activity-events") }
    if let summary {
      let latestSummary = decodedSummaryRecord()
      if latestSummary?.identity == summary.identity {
        sharedDefaults.removeObject(forKey: "device-activity-summary-latest")
      }
    }
    return persisted
  }

  // Extension payloads arrive as AES.GCM envelopes; bare dictionaries written
  // by extension builds that predate the encrypted handoff drain once here.
  // The identity is what exact-consumed removal compares, so it must be
  // stable across re-reads of the shared suite.
  private func decodeRecord(_ raw: Any) -> HermesScreenTimeRecord? {
    if let sealed = raw as? String {
      guard let payload = HermesScreenTimeCrypto.open(sealed) else { return nil }
      return HermesScreenTimeRecord(identity: sealed, payload: payload)
    }
    if let payload = raw as? [String: Any] {
      return HermesScreenTimeRecord(identity: Self.eventID(of: payload), payload: payload)
    }
    return nil
  }

  private func decodedRecords(forKey key: String) -> [HermesScreenTimeRecord] {
    (sharedDefaults?.array(forKey: key) ?? []).compactMap { decodeRecord($0) }
  }

  private func decodedSummaryRecord() -> HermesScreenTimeRecord? {
    guard let raw = sharedDefaults?.object(forKey: "device-activity-summary-latest") else { return nil }
    return decodeRecord(raw)
  }

  func setAccountGeneration(_ generation: Int) {
    // Extensions can only seal envelopes once the shared key exists, and they
    // never create it themselves; provision it on every path that can arm a
    // monitoring schedule.
    HermesScreenTimeCrypto.provisionKey()
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

private struct HermesScreenTimeRecord {
  let identity: String
  let payload: [String: Any]
}

// Opening half of the Screen Time handoff crypto. Shared App Group UserDefaults
// are cleartext plists on disk, so the DeviceActivity extensions seal their
// payloads with a key the host provisions in the shared Keychain access group.
// Each extension target compiles a matching sealing-only copy of this helper
// (the config plugin builds one source file per target), so the service, the
// account, and the associated data below must stay in sync with those copies.
private enum HermesScreenTimeCrypto {
  private static let associatedData = Data("hermes-screen-time-v1".utf8)
  private static let keychainLock = NSLock()

  static func open(_ sealed: String) -> [String: Any]? {
    guard let key = sharedKey(create: false),
          let combined = Data(base64Encoded: sealed),
          let box = try? AES.GCM.SealedBox(combined: combined),
          let clear = try? AES.GCM.open(box, using: key, authenticating: associatedData) else {
      return nil
    }
    return (try? JSONSerialization.jsonObject(with: clear)) as? [String: Any]
  }

  static func provisionKey() {
    _ = sharedKey(create: true)
  }

  private static func sharedKey(create: Bool) -> SymmetricKey? {
    keychainLock.lock()
    defer { keychainLock.unlock() }
    let selector: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "app.hermes.screen-time",
      kSecAttrAccount as String: "shared-activity-key-v1",
      kSecAttrAccessGroup as String: "group.app.sunstone1029.fig1171.hermes",
    ]
    var query = selector
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    query[kSecReturnData as String] = true
    var result: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
       let data = result as? Data, data.count == 32 {
      return SymmetricKey(data: data)
    }
    guard create else { return nil }
    var keyData = Data(count: 32)
    let generated = keyData.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, 32, buffer.baseAddress!)
    }
    guard generated == errSecSuccess else { return nil }
    var insert = selector
    insert[kSecValueData as String] = keyData
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let inserted = SecItemAdd(insert as CFDictionary, nil)
    if inserted == errSecSuccess { return SymmetricKey(data: keyData) }
    // Lost a provisioning race against another call; adopt the winner's key.
    if inserted == errSecDuplicateItem,
       SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
       let data = result as? Data, data.count == 32 {
      return SymmetricKey(data: data)
    }
    return nil
  }
}
