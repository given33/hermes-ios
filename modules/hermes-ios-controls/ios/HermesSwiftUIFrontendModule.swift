import ExpoModulesCore
import SwiftUI

public final class HermesSwiftUIFrontendModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSwiftUIFrontend")
    View(HermesSwiftUIFrontendView.self)
  }
}

final class HermesSwiftUIFrontendProps: ExpoSwiftUI.ViewProps {
  @Field var attachmentIds: [String] = []
  @Field var attachmentNames: [String] = []
  @Field var errorMessage = ""
  @Field var locale = "zh"
  var onAction = EventDispatcher()
}

struct HermesSwiftUIFrontendView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HermesSwiftUIFrontendProps

  var body: some View {
    HermesFrontendRoot(
      attachmentIds: props.attachmentIds,
      attachmentNames: props.attachmentNames,
      errorMessage: props.errorMessage,
      locale: props.locale,
      onAction: { action, payload in
        props.onAction([
          "action": action,
          "payload": payload ?? ""
        ])
      }
    )
  }
}

enum HermesRoute: String, CaseIterable, Identifiable, Hashable {
  case chat
  case sessions
  case files
  case analytics
  case models
  case logs
  case cron
  case skills
  case plugins
  case mcp
  case pairing
  case channels
  case webhooks
  case achievements
  case collaboration
  case kanban
  case profiles
  case config
  case env
  case system
  case docs

  var id: String { rawValue }

  var symbol: String {
    switch self {
    case .chat: return "message.fill"
    case .sessions: return "bubble.left.and.bubble.right"
    case .files: return "folder"
    case .analytics: return "chart.bar.xaxis"
    case .models: return "cpu"
    case .logs: return "doc.text.magnifyingglass"
    case .cron: return "clock.arrow.circlepath"
    case .skills: return "shippingbox"
    case .plugins: return "puzzlepiece.extension"
    case .mcp: return "network"
    case .pairing: return "lock.shield"
    case .channels: return "dot.radiowaves.left.and.right"
    case .webhooks: return "arrow.triangle.branch"
    case .achievements: return "trophy"
    case .collaboration: return "person.3"
    case .kanban: return "rectangle.3.group"
    case .profiles: return "person.2"
    case .config: return "slider.horizontal.3"
    case .env: return "key"
    case .system: return "gauge"
    case .docs: return "book.closed"
    }
  }

  func title(_ chinese: Bool) -> String {
    if !chinese { return rawValue.capitalized }
    switch self {
    case .chat: return "单聊"
    case .sessions: return "会话"
    case .files: return "文件"
    case .analytics: return "分析"
    case .models: return "模型"
    case .logs: return "日志"
    case .cron: return "定时任务"
    case .skills: return "技能"
    case .plugins: return "插件管理"
    case .mcp: return "MCP"
    case .pairing: return "设备配对"
    case .channels: return "消息渠道"
    case .webhooks: return "网络钩子"
    case .achievements: return "成就"
    case .collaboration: return "协作"
    case .kanban: return "看板"
    case .profiles: return "多 Agent 配置"
    case .config: return "配置"
    case .env: return "密钥"
    case .system: return "系统监控"
    case .docs: return "文档"
    }
  }

  var group: Int {
    switch self {
    case .chat, .sessions, .files, .analytics, .models, .logs: return 0
    case .cron, .skills, .plugins, .mcp, .pairing, .channels, .webhooks: return 1
    case .achievements, .collaboration, .kanban: return 2
    case .profiles, .config, .env, .system, .docs: return 3
    }
  }
}

struct HermesFrontendRoot: View {
  let attachmentIds: [String]
  let attachmentNames: [String]
  let errorMessage: String
  let locale: String
  let onAction: (String, String?) -> Void

  @StateObject private var appearance = HermesAppearanceModel()
  @State private var selectedRoute: HermesRoute? = .chat
  @State private var appearanceOpen = false
  @State private var profileOpen = false
  @State private var columnVisibility: NavigationSplitViewVisibility = .automatic

  private var chinese: Bool { locale == "zh" }

  var body: some View {
    NavigationSplitView(columnVisibility: $columnVisibility) {
      HermesSidebar(selection: $selectedRoute, chinese: chinese)
        .navigationTitle("Hermes Agent")
    } detail: {
      NavigationStack {
        HermesRouteContent(
          attachmentIds: attachmentIds,
          attachmentNames: attachmentNames,
          route: selectedRoute ?? .chat,
          chinese: chinese,
          onAction: onAction
        )
        .navigationTitle((selectedRoute ?? .chat).title(chinese))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItemGroup(placement: .navigationBarTrailing) {
            Button {
              withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
                appearanceOpen = true
              }
            } label: {
              Label(chinese ? "外观" : "Appearance", systemImage: "circle.lefthalf.filled")
            }

            Button {
              profileOpen = true
            } label: {
              Label(chinese ? "配置" : "Profile", systemImage: "person.crop.circle")
            }
          }
        }
      }
    }
    .navigationSplitViewStyle(.balanced)
    .tint(appearance.palette.accent)
    .background(appearance.palette.background)
    .preferredColorScheme(appearance.theme.colorScheme)
    .environmentObject(appearance)
    .sheet(isPresented: $appearanceOpen) {
      HermesAppearanceSheet(chinese: chinese)
        .environmentObject(appearance)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
    .sheet(isPresented: $profileOpen) {
      HermesProfileSheet(chinese: chinese)
        .environmentObject(appearance)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
    .alert(chinese ? "无法完成操作" : "Unable to Complete Action", isPresented: Binding(
      get: { !errorMessage.isEmpty },
      set: { if !$0 { onAction("dismiss-error", nil) } }
    )) {
      Button(chinese ? "好" : "OK", role: .cancel) {}
    } message: {
      Text(errorMessage)
    }
  }
}

private struct HermesSidebar: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  @Binding var selection: HermesRoute?
  let chinese: Bool

  var body: some View {
    List(selection: $selection) {
      ForEach(0..<4, id: \.self) { group in
        Section(sectionTitle(group)) {
          ForEach(HermesRoute.allCases.filter { $0.group == group }) { route in
            NavigationLink(value: route) {
              Label(route.title(chinese), systemImage: route.symbol)
                .font(HermesFonts.body(15))
            }
              .tag(route)
          }
        }
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .safeAreaInset(edge: .bottom) {
      HStack(spacing: 10) {
        Circle()
          .fill(appearance.palette.success)
          .frame(width: 8, height: 8)
          .shadow(color: appearance.palette.success, radius: 5)
        VStack(alignment: .leading, spacing: 2) {
          Text(chinese ? "网关在线" : "Gateway online")
            .font(HermesFonts.bodyBold(13))
          Text(chinese ? "v0.9.3 · 2 个会话" : "v0.9.3 · 2 sessions")
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
        }
        Spacer()
      }
      .padding(14)
      .background(.ultraThinMaterial)
    }
  }

  private func sectionTitle(_ group: Int) -> String {
    if !chinese {
      return ["Workspace", "Automation", "Extensions", "Administration"][group]
    }
    return ["工作区", "自动化", "扩展", "管理"][group]
  }
}

private struct HermesAppearanceSheet: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool

  var body: some View {
    NavigationStack {
      Form {
        Section(chinese ? "主题" : "Theme") {
          Picker(chinese ? "主题" : "Theme", selection: $appearance.theme) {
            Text("NOUS").tag(HermesThemeChoice.nous)
            Text(chinese ? "系统浅色" : "System Light").tag(HermesThemeChoice.light)
          }
          .pickerStyle(.segmented)
        }
        Section(chinese ? "布局" : "Layout") {
          Toggle(chinese ? "紧凑密度" : "Compact density", isOn: $appearance.compactDensity)
        }
        Section(chinese ? "字体" : "Typography") {
          Text("HERMES AGENT")
            .font(HermesFonts.display(18))
          Text(chinese ? "界面正文使用 Hermes 原始字体。" : "Interface copy uses the original Hermes fonts.")
            .font(HermesFonts.body(15))
          Text("terminal / tool output")
            .font(HermesFonts.mono(13))
        }
      }
      .navigationTitle(chinese ? "外观" : "Appearance")
    }
    .preferredColorScheme(appearance.theme.colorScheme)
  }
}

private struct HermesProfileSheet: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var notice = ""

  var body: some View {
    NavigationStack {
      List {
        Label("default", systemImage: "checkmark.circle.fill")
        Button {
          notice = chinese ? "可在侧边栏的“多 Agent 配置”中管理" : "Use Agent Profiles in the sidebar to manage profiles"
        } label: {
          Label(chinese ? "管理配置" : "Manage profiles", systemImage: "person.2")
        }
        Button {
          notice = chinese ? "当前界面语言为中文" : "The current interface language is English"
        } label: {
          Label(chinese ? "切换语言" : "Switch language", systemImage: "globe")
        }
      }
      .hermesListStyle()
      .navigationTitle(chinese ? "当前配置" : "Current Profile")
      .alert(chinese ? "配置" : "Profile", isPresented: Binding(
        get: { !notice.isEmpty },
        set: { if !$0 { notice = "" } }
      )) {
        Button(chinese ? "好" : "OK", role: .cancel) {}
      } message: {
        Text(notice)
      }
    }
    .tint(appearance.palette.accent)
  }
}
