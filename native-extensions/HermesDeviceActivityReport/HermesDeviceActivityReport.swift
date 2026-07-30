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
  let context: DeviceActivityReport.Context = .hermesSummary
  let content: (HermesActivitySummary) -> HermesActivitySummaryView

  func makeConfiguration(
    representing data: DeviceActivityResults<DeviceActivityData>
  ) async -> HermesActivitySummary {
    let generation = HermesScreenTimeSpool.captureGeneration()
    var seconds = 0.0
    for await item in data {
      for await segment in item.activitySegments {
        seconds += segment.totalActivityDuration
      }
    }
    if let generation {
      _ = HermesScreenTimeSpool.append([
        "durationSeconds": max(0, seconds),
        "eventId": UUID().uuidString.lowercased(),
        "observedAt": Date().timeIntervalSince1970 * 1000,
        "state": "activity-summary",
      ], generation: generation)
    }
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
