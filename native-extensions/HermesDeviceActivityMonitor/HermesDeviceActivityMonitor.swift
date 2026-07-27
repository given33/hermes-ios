import CryptoKit
import DeviceActivity
import Foundation
import Security

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
    var payload: [String: Any] = [
      "accountGeneration": suite?.integer(forKey: accountGenerationKey) ?? 0,
      "activity": activity.rawValue,
      "eventId": UUID().uuidString.lowercased(),
      "observedAt": Date().timeIntervalSince1970 * 1000,
      "state": state,
    ]
    payload["event"] = event
    // Shared-suite plists are cleartext on disk, so only the sealed envelope
    // may be persisted. Without the host-provisioned key the callback drops.
    guard let sealed = HermesScreenTimeCrypto.seal(payload) else { return }
    var items = suite?.array(forKey: "device-activity-events") ?? []
    items.append(sealed)
    suite?.set(Array(items.suffix(500)), forKey: "device-activity-events")
  }
}

// Sealing half of the Screen Time handoff crypto (the host module holds the
// opening half). The key lives in the shared Keychain access group; the host
// provisions it before monitoring starts and this extension never creates it.
private enum HermesScreenTimeCrypto {
  private static let associatedData = Data("hermes-screen-time-v1".utf8)

  static func seal(_ payload: [String: Any]) -> String? {
    guard let key = sharedKey(),
          let clear = try? JSONSerialization.data(withJSONObject: payload),
          let sealed = try? AES.GCM.seal(clear, using: key, authenticating: associatedData),
          let combined = sealed.combined else { return nil }
    return combined.base64EncodedString()
  }

  private static func sharedKey() -> SymmetricKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "app.hermes.screen-time",
      kSecAttrAccount as String: "shared-activity-key-v1",
      kSecAttrAccessGroup as String: "group.app.sunstone1029.fig1171.hermes",
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: true,
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data, data.count == 32 else { return nil }
    return SymmetricKey(data: data)
  }
}
