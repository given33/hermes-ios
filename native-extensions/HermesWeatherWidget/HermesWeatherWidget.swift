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
    var kind: String?
    var taskID: String?
    var status: String?
    var progress: Double?
    var currentTool: String?
    var actionDeepLink: String?
  }

  let activityID: String
}

struct HermesAgentActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var title: String
    var body: String
    var status: String
    var taskID: String?
    var activeSessionID: String?
    var sessionCount: Int
    var sessionsSummary: String?
    var progress: Double?
    var currentTool: String?
    var toolStatus: String?
    var loopIteration: Int?
    var childCompleted: Int
    var childTotal: Int
    var lastMessage: String?
    var privacyMode: Bool
    var ttsEnabled: Bool
    var actionDeepLink: String?
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
      Group {
        if context.state.kind == "agent-task" {
          AgentTaskLockScreenView(context: context)
        } else {
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
        }
      }
      .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
      .activitySystemActionForegroundColor(.primary)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          if context.state.kind == "agent-task" {
            Image(systemName: "bolt.horizontal.circle.fill")
              .foregroundStyle(.blue)
          } else {
            Image(systemName: "cloud.rain.fill")
              .foregroundStyle(Color.hermesSeverity(context.state.severity))
          }
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.title).font(.headline).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          if context.state.kind == "agent-task" {
            AgentTaskExpandedView(context: context)
          } else {
            Text(context.state.body).font(.caption).lineLimit(2)
          }
        }
      } compactLeading: {
        Image(systemName: context.state.kind == "agent-task"
          ? "bolt.horizontal.circle.fill"
          : "cloud.rain.fill")
          .foregroundStyle(context.state.kind == "agent-task"
            ? Color.blue
            : Color.hermesSeverity(context.state.severity))
      } compactTrailing: {
        if context.state.kind == "agent-task", let progress = context.state.progress {
          Text("\(Int(progress * 100))%")
            .font(.caption2.monospacedDigit())
        } else {
          Image(systemName: "location.fill")
        }
      } minimal: {
        Image(systemName: context.state.kind == "agent-task"
          ? "bolt.horizontal.circle.fill"
          : "cloud.rain.fill")
          .foregroundStyle(context.state.kind == "agent-task"
            ? Color.blue
            : Color.hermesSeverity(context.state.severity))
      }
      .widgetURL(activityURL(context.state))
      .keylineTint(context.state.kind == "agent-task"
        ? Color.blue
        : Color.hermesSeverity(context.state.severity))
    }
  }
}

struct HermesAgentLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: HermesAgentActivityAttributes.self) { context in
      AgentActivitySurface(context: context)
        .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
        .activitySystemActionForegroundColor(.primary)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "bolt.horizontal.circle.fill").foregroundStyle(.blue)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.title).font(.headline).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          AgentActivityExpandedSurface(context: context)
        }
      } compactLeading: {
        Image(systemName: "bolt.horizontal.circle.fill").foregroundStyle(.blue)
      } compactTrailing: {
        if let progress = context.state.progress {
          Text("\(Int(progress * 100))%").font(.caption2.monospacedDigit())
        } else {
          Image(systemName: context.state.ttsEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill")
        }
      } minimal: {
        Image(systemName: "bolt.horizontal.circle.fill").foregroundStyle(.blue)
      }
      .widgetURL(agentActivityURL(context.state))
      .keylineTint(.blue)
    }
  }
}

private struct AgentActivitySurface: View {
  let context: ActivityViewContext<HermesAgentActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Image(systemName: "bolt.horizontal.circle.fill").foregroundStyle(.blue)
        VStack(alignment: .leading, spacing: 1) {
          Text(context.state.title).font(.headline).lineLimit(1)
          Text(context.state.status).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 0)
        if context.state.privacyMode {
          Image(systemName: "eye.slash.fill").foregroundStyle(.secondary)
        }
      }
      if let progress = context.state.progress { ProgressView(value: progress) }
      if context.state.sessionCount > 1 {
        Text(context.state.sessionsSummary ?? "\(context.state.sessionCount) sessions")
          .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
      } else if let tool = context.state.currentTool {
        Text(tool).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
      }
      AgentActivityLinks(state: context.state)
    }
    .padding()
  }
}

private struct AgentActivityExpandedSurface: View {
  let context: ActivityViewContext<HermesAgentActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(context.state.privacyMode ? context.state.status : context.state.body)
        .font(.caption).lineLimit(2)
      if let progress = context.state.progress { ProgressView(value: progress) }
      AgentActivityLinks(state: context.state)
    }
  }
}

private struct AgentActivityLinks: View {
  let state: HermesAgentActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 12) {
      if let taskID = state.taskID {
        if state.status == "running" || state.status == "starting" {
          Link(destination: agentTaskURL(taskID: taskID, action: "pause")) { Label("Pause", systemImage: "pause.fill") }
        } else if state.status == "paused" {
          Link(destination: agentTaskURL(taskID: taskID, action: "resume")) { Label("Resume", systemImage: "play.fill") }
        }
        if state.status != "completed", state.status != "cancelled", state.status != "failed" {
          Link(destination: agentTaskURL(taskID: taskID, action: "cancel")) { Label("Cancel", systemImage: "xmark") }
        }
        if state.status == "failed" {
          Link(destination: agentTaskURL(taskID: taskID, action: "retry")) { Label("Retry", systemImage: "arrow.clockwise") }
        }
        Link(destination: agentTaskURL(taskID: taskID, action: "speak-toggle")) {
          Label(state.ttsEnabled ? "Mute" : "Speak", systemImage: state.ttsEnabled ? "speaker.slash.fill" : "speaker.wave.2.fill")
        }
        Link(destination: agentTaskURL(taskID: taskID, action: "open")) { Label("Open", systemImage: "arrow.up.forward") }
      }
    }
    .font(.caption2)
  }
}

private func agentActivityURL(_ state: HermesAgentActivityAttributes.ContentState) -> URL? {
  if let deepLink = state.actionDeepLink, let url = URL(string: deepLink) { return url }
  if let taskID = state.taskID { return agentTaskURL(taskID: taskID, action: "open") }
  return URL(string: "hermes-agent://chat")
}

private func agentTaskURL(taskID: String, action: String) -> URL {
  var allowedCharacters = CharacterSet.urlPathAllowed
  allowedCharacters.remove(charactersIn: "/\\")
  var components = URLComponents()
  components.scheme = "hermes-agent"
  components.host = "task"
  components.path = "/\(taskID.addingPercentEncoding(withAllowedCharacters: allowedCharacters) ?? "")"
  components.queryItems = [URLQueryItem(name: "action", value: action)]
  return components.url ?? URL(string: "hermes-agent://chat")!
}

private struct AgentTaskLockScreenView: View {
  let context: ActivityViewContext<HermesWeatherActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Image(systemName: "bolt.horizontal.circle.fill").foregroundStyle(.blue)
        VStack(alignment: .leading, spacing: 1) {
          Text(context.state.title).font(.headline).lineLimit(1)
          Text(context.state.status ?? context.state.body).font(.caption).lineLimit(1)
        }
        Spacer(minLength: 0)
      }
      if let progress = context.state.progress {
        ProgressView(value: progress)
      }
      if let tool = context.state.currentTool {
        Text(tool).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
      }
      AgentTaskLinks(state: context.state)
    }
    .padding()
  }
}

private struct AgentTaskExpandedView: View {
  let context: ActivityViewContext<HermesWeatherActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Text(context.state.status ?? context.state.body).font(.caption).lineLimit(1)
        Spacer(minLength: 0)
      }
      if let progress = context.state.progress {
        ProgressView(value: progress)
      }
      AgentTaskLinks(state: context.state)
    }
  }
}

private struct AgentTaskLinks: View {
  let state: HermesWeatherActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 12) {
      if let taskID = state.taskID {
        if state.status == "running" || state.status == "starting" {
          Link(destination: taskURL(taskID: taskID, action: "pause")) {
            Label("Pause", systemImage: "pause.fill")
          }
        } else if state.status == "paused" {
          Link(destination: taskURL(taskID: taskID, action: "resume")) {
            Label("Resume", systemImage: "play.fill")
          }
        }
        if state.status != "completed", state.status != "cancelled", state.status != "failed" {
          Link(destination: taskURL(taskID: taskID, action: "cancel")) {
            Label("Cancel", systemImage: "xmark")
          }
        }
        if state.status == "failed" {
          Link(destination: taskURL(taskID: taskID, action: "retry")) {
            Label("Retry", systemImage: "arrow.clockwise")
          }
        } else {
          Link(destination: taskURL(taskID: taskID, action: "open")) {
            Label("Open", systemImage: "arrow.up.forward")
          }
        }
      }
    }
    .font(.caption2)
  }
}

private func activityURL(_ state: HermesWeatherActivityAttributes.ContentState) -> URL? {
  if let deepLink = state.actionDeepLink, let url = URL(string: deepLink) {
    return url
  }
  if state.kind == "agent-task", let taskID = state.taskID {
    return taskURL(taskID: taskID, action: "open")
  }
  return URL(string: "hermes-agent://weather")
}

private func taskURL(taskID: String, action: String?) -> URL {
  var allowedCharacters = CharacterSet.urlPathAllowed
  allowedCharacters.remove(charactersIn: "/\\")
  var components = URLComponents()
  components.scheme = "hermes-agent"
  components.host = "task"
  components.path = "/\(taskID.addingPercentEncoding(withAllowedCharacters: allowedCharacters) ?? "")"
  if let action {
    components.queryItems = [URLQueryItem(name: "action", value: action)]
  }
  return components.url ?? URL(string: "hermes-agent://task")!
}

@main
struct HermesWeatherWidgetBundle: WidgetBundle {
  var body: some Widget {
    HermesWeatherLiveActivity()
    HermesAgentLiveActivity()
  }
}
