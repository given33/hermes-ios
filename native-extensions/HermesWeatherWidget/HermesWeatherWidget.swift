import ActivityKit
import SwiftUI
import UIKit
import WidgetKit

struct HermesWeatherActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var body: String
    var expiresAt: Date?
    var severity: String
    var title: String
  }

  let activityID: String
}

private extension Color {
  static func hermesSeverity(_ severity: String) -> Color {
    switch severity.lowercased() {
    case "critical": return .red
    case "warning": return .orange
    default: return .blue
    }
  }
}

struct HermesWeatherLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: HermesWeatherActivityAttributes.self) { context in
      HStack(spacing: 10) {
        Image(systemName: "cloud.rain.fill")
          .foregroundStyle(Color.hermesSeverity(context.state.severity))
        VStack(alignment: .leading, spacing: 2) {
          Text(context.state.title).font(.headline).lineLimit(1)
          Text(context.state.body).font(.caption).lineLimit(2)
        }
        Spacer(minLength: 0)
      }
      .padding()
      .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
      .activitySystemActionForegroundColor(.primary)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "cloud.rain.fill")
            .foregroundStyle(Color.hermesSeverity(context.state.severity))
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.title).font(.headline).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.body).font(.caption).lineLimit(2)
        }
      } compactLeading: {
        Image(systemName: "cloud.rain.fill")
          .foregroundStyle(Color.hermesSeverity(context.state.severity))
      } compactTrailing: {
        Image(systemName: "location.fill")
      } minimal: {
        Image(systemName: "cloud.rain.fill")
          .foregroundStyle(Color.hermesSeverity(context.state.severity))
      }
      .widgetURL(URL(string: "hermes-agent://weather"))
      .keylineTint(Color.hermesSeverity(context.state.severity))
    }
  }
}

@main
struct HermesWeatherWidgetBundle: WidgetBundle {
  var body: some Widget {
    HermesWeatherLiveActivity()
  }
}
