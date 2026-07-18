import DeviceActivity
import Foundation
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
    suite?.set([
      "accountGeneration": accountGeneration,
      "durationSeconds": max(0, seconds),
      "observedAt": Date().timeIntervalSince1970 * 1000,
      "state": "activity-summary",
    ], forKey: "device-activity-summary-latest")
    return HermesActivitySummary(seconds: seconds)
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
