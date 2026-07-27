import CryptoKit
import DeviceActivity
import Foundation
import Security
import SwiftUI

extension DeviceActivityReport.Context {
  static let hermesSummary = Self("Hermes Summary")
}

struct HermesActivitySummary: Codable, Hashable {
  let seconds: Double
}

struct HermesActivitySummaryView: View {
  let summary: HermesActivitySummary

  var body: some View {
    Text(Self.durationText(summary.seconds))
      .font(.headline)
      .padding()
  }

  private static func durationText(_ seconds: Double) -> String {
    let minutes = max(0, Int((seconds / 60).rounded()))
    return minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m"
  }
}

struct HermesActivityReportScene: DeviceActivityReportScene {
  private let suite = UserDefaults(suiteName: "group.app.sunstone1029.fig1171.hermes")
  private let accountGenerationKey = "account-generation"
  let context: DeviceActivityReport.Context = .hermesSummary
  let content: (HermesActivitySummary) -> HermesActivitySummaryView

  func makeConfiguration(
    representing data: DeviceActivityResults<DeviceActivityData>
  ) async -> HermesActivitySummary {
    let accountGeneration = suite?.integer(forKey: accountGenerationKey) ?? 0
    var seconds = 0.0
    for await item in data {
      for await segment in item.activitySegments {
        seconds += segment.totalActivityDuration
      }
    }
    // Shared-suite plists are cleartext on disk, so only the sealed envelope
    // may be persisted. Without the host-provisioned key the summary stays
    // on-screen only.
    if let sealed = HermesScreenTimeCrypto.seal([
      "accountGeneration": accountGeneration,
      "durationSeconds": max(0, seconds),
      "eventId": UUID().uuidString.lowercased(),
      "observedAt": Date().timeIntervalSince1970 * 1000,
      "state": "activity-summary",
    ]) {
      suite?.set(sealed, forKey: "device-activity-summary-latest")
    }
    return HermesActivitySummary(seconds: seconds)
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

@main
struct HermesDeviceActivityReport: DeviceActivityReportExtension {
  var body: some DeviceActivityReportScene {
    HermesActivityReportScene { summary in
      HermesActivitySummaryView(summary: summary)
    }
  }
}
