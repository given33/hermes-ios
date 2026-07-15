import ExpoModulesCore
import SwiftUI

public final class HermesSwiftUIPartialFrontendModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSwiftUIPartialFrontend")
    View(HermesSwiftUISidebarView.self)
    View(HermesSwiftUIRouteView.self)
    View(HermesSwiftUIModelToolsView.self)
    View(HermesSwiftUIFrostedSurfaceView.self)
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
  var path: String { "/\(rawValue)" }

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
    case .system: return "gauge.with.dots.needle.67percent"
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

  static func resolve(routeId: String, path: String, pluginName: String) -> HermesRoute {
    if let direct = HermesRoute(rawValue: routeId) { return direct }
    switch pluginName {
    case "hermes-achievements": return .achievements
    case "collaboration": return .collaboration
    case "kanban": return .kanban
    default: break
    }
    if path == "/profiles/new" { return .profiles }
    return HermesRoute(rawValue: path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) ?? .sessions
  }
}

private let hermesDrawerAnimation = Animation.interactiveSpring(
  response: 0.34,
  dampingFraction: 0.88,
  blendDuration: 0.08
)

final class HermesSwiftUISidebarProps: ExpoSwiftUI.ViewProps {
  @Field var activePath = "/chat"
  @Field var locale = "zh"
  @Field var open = false
  @Field var presentation = "drawer"
  var onNavigate = EventDispatcher()
  var onRequestClose = EventDispatcher()
}

struct HermesSwiftUISidebarView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesSwiftUISidebarProps
  @StateObject private var appearance = HermesAppearanceModel()
  @State private var presented = false
  @GestureState private var dragX: CGFloat = 0
  @State private var feedbackTrigger = 0

  private var chinese: Bool { props.locale == "zh" }
  private var isDrawer: Bool { props.presentation == "drawer" }

  var body: some View {
    GeometryReader { proxy in
      let drawerWidth = isDrawer ? proxy.size.width : min(360, proxy.size.width)
      HermesSidebarContent(
        activePath: props.activePath,
        chinese: chinese,
        onClose: isDrawer ? closeDrawer : nil,
        onNavigate: select
      )
      .environmentObject(appearance)
      .frame(width: drawerWidth)
      .frame(maxHeight: .infinity, alignment: .leading)
      .background(appearance.palette.background)
      .offset(x: isDrawer ? drawerOffset(width: drawerWidth) : 0)
      .shadow(
        color: .black.opacity(isDrawer && presented ? 0.22 : 0),
        radius: 18,
        x: 10
      )
      .contentShape(Rectangle())
      .gesture(isDrawer ? closeGesture(width: drawerWidth) : nil)
    }
    .background(Color.clear)
    .clipped()
    .onAppear {
      presented = isDrawer ? false : true
      if isDrawer && props.open {
        DispatchQueue.main.async {
          withAnimation(hermesDrawerAnimation) { presented = true }
        }
      }
    }
    .onChange(of: props.open) { next in
      guard isDrawer else { return }
      withAnimation(hermesDrawerAnimation) { presented = next }
    }
    .preferredColorScheme(appearance.theme.colorScheme)
    .hermesImpact(trigger: feedbackTrigger)
  }

  private func drawerOffset(width: CGFloat) -> CGFloat {
    let base = presented ? 0 : -width
    return min(0, max(-width, base + min(0, dragX)))
  }

  private func closeGesture(width: CGFloat) -> some Gesture {
    DragGesture(minimumDistance: 8, coordinateSpace: .local)
      .updating($dragX) { value, state, _ in
        state = min(0, value.translation.width)
      }
      .onEnded { value in
        let projected = value.translation.width + value.predictedEndTranslation.width * 0.34
        if projected < -width * 0.22 {
          closeDrawer()
        } else {
          withAnimation(hermesDrawerAnimation) { presented = true }
        }
      }
  }

  private func select(_ route: HermesRoute) {
    feedbackTrigger += 1
    props.onNavigate(["path": route.path])
    if isDrawer { closeDrawer() }
  }

  private func closeDrawer() {
    withAnimation(hermesDrawerAnimation) { presented = false }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.27) {
      props.onRequestClose([:])
    }
  }
}

private struct HermesSidebarContent: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let activePath: String
  let chinese: Bool
  let onClose: (() -> Void)?
  let onNavigate: (HermesRoute) -> Void

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 28) {
        HStack(alignment: .center) {
          Text("Hermes Agent")
            .font(HermesFonts.display(31))
            .foregroundStyle(appearance.palette.foreground)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
          Spacer(minLength: 12)
          if let onClose {
            Button(action: onClose) {
              Image(systemName: "xmark")
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 38, height: 38)
                .background(.thinMaterial, in: Circle())
            }
            .buttonStyle(HermesPressStyle(scale: 0.92, opacity: 0.8))
            .accessibilityLabel(chinese ? "关闭侧边栏" : "Close sidebar")
          }
        }

        ForEach(0..<4, id: \.self) { group in
          VStack(alignment: .leading, spacing: 10) {
            Text(sectionTitle(group))
              .font(HermesFonts.body(14))
              .foregroundStyle(appearance.palette.secondary)
              .padding(.horizontal, 18)

            VStack(spacing: 0) {
              let routes = HermesRoute.allCases.filter { $0.group == group }
              ForEach(Array(routes.enumerated()), id: \.element.id) { index, route in
                Button {
                  onNavigate(route)
                } label: {
                  HStack(spacing: 16) {
                    Image(systemName: route.symbol)
                      .font(.system(size: 20, weight: .medium))
                      .foregroundStyle(appearance.palette.accent)
                      .frame(width: 28)
                    Text(route.title(chinese))
                      .font(HermesFonts.body(17))
                      .foregroundStyle(appearance.palette.foreground)
                    Spacer()
                    Image(systemName: "chevron.right")
                      .font(.system(size: 14, weight: .semibold))
                      .foregroundStyle(appearance.palette.tertiary)
                  }
                  .padding(.horizontal, 18)
                  .frame(minHeight: 58)
                  .contentShape(Rectangle())
                  .background(
                    activePath == route.path
                      ? appearance.palette.accent.opacity(0.10)
                      : Color.clear
                  )
                }
                .buttonStyle(HermesPressStyle(scale: 0.985, opacity: 0.82))

                if index < routes.count - 1 {
                  Divider()
                    .overlay(appearance.palette.border)
                    .padding(.leading, 62)
                }
              }
            }
            .background(appearance.palette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
              RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(appearance.palette.border, lineWidth: 0.6)
            }
          }
        }
      }
      .padding(.horizontal, 18)
      .padding(.top, 30)
      .padding(.bottom, 112)
    }
    .scrollDismissesKeyboard(.interactively)
    .safeAreaInset(edge: .bottom, spacing: 0) {
      HStack(spacing: 11) {
        Circle()
          .fill(appearance.palette.success)
          .frame(width: 9, height: 9)
          .shadow(color: appearance.palette.success, radius: 5)
        VStack(alignment: .leading, spacing: 2) {
          Text(chinese ? "网关在线" : "Gateway online")
            .font(HermesFonts.bodyBold(14))
          Text(chinese ? "v0.9.3 · 2 个会话" : "v0.9.3 · 2 sessions")
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
        }
        Spacer()
      }
      .padding(.horizontal, 24)
      .padding(.vertical, 15)
      .background(.ultraThinMaterial)
      .overlay(alignment: .top) {
        Divider().overlay(appearance.palette.border)
      }
    }
    .background(appearance.palette.background)
  }

  private func sectionTitle(_ group: Int) -> String {
    if !chinese {
      return ["Workspace", "Automation", "Extensions", "Administration"][group]
    }
    return ["工作区", "自动化", "扩展", "管理"][group]
  }
}

final class HermesSwiftUIRouteProps: ExpoSwiftUI.ViewProps {
  @Field var locale = "zh"
  @Field var path = "/sessions"
  @Field var pluginName = ""
  @Field var routeId = "sessions"
  var onAction = EventDispatcher()
  var onOpenNavigation = EventDispatcher()
}

struct HermesSwiftUIRouteView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesSwiftUIRouteProps
  @StateObject private var appearance = HermesAppearanceModel()

  private var chinese: Bool { props.locale == "zh" }
  private var route: HermesRoute {
    HermesRoute.resolve(routeId: props.routeId, path: props.path, pluginName: props.pluginName)
  }

  var body: some View {
    NavigationStack {
      HermesRouteContent(
        attachmentIds: [],
        attachmentNames: [],
        route: route,
        chinese: chinese,
        onAction: { action, payload in
          props.onAction(["action": action, "payload": payload ?? ""])
        }
      )
      .navigationTitle(route.title(chinese))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button {
            props.onOpenNavigation([:])
          } label: {
            Image(systemName: "line.3.horizontal")
          }
          .accessibilityLabel(chinese ? "打开侧边栏" : "Open sidebar")
        }
      }
    }
    .tint(appearance.palette.accent)
    .background(appearance.palette.background)
    .preferredColorScheme(appearance.theme.colorScheme)
    .environmentObject(appearance)
  }
}

final class HermesSwiftUIModelToolsProps: ExpoSwiftUI.ViewProps {
  @Field var locale = "zh"
  @Field var model = "claude-sonnet-4"
  @Field var open = false
  @Field var reasoning = "medium"
  @Field var toolsEnabled = true
  var onModelChange = EventDispatcher()
  var onNewConversation = EventDispatcher()
  var onReasoningChange = EventDispatcher()
  var onRequestClose = EventDispatcher()
  var onToolsChange = EventDispatcher()
}

struct HermesSwiftUIModelToolsView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesSwiftUIModelToolsProps
  @StateObject private var appearance = HermesAppearanceModel()
  @State private var presented = false

  private var chinese: Bool { props.locale == "zh" }

  var body: some View {
    GeometryReader { proxy in
      let panelWidth = min(330, proxy.size.width * 0.88)
      ZStack(alignment: .trailing) {
        Color.black
          .opacity(presented ? 0.52 : 0)
          .ignoresSafeArea()
          .onTapGesture(perform: close)

        NavigationStack {
          Form {
            Section {
              Button {
                props.onNewConversation([:])
                close()
              } label: {
                Label(chinese ? "新建会话" : "New conversation", systemImage: "square.and.pencil")
              }
            }

            Section(chinese ? "模型" : "Model") {
              Picker(chinese ? "当前模型" : "Current model", selection: modelBinding) {
                Text("claude-sonnet-4").tag("claude-sonnet-4")
                Text("gpt-5.6-sol").tag("gpt-5.6-sol")
              }
              .pickerStyle(.menu)
            }

            Section(chinese ? "工具" : "Tools") {
              Toggle(isOn: toolsBinding) {
                Label(chinese ? "工具事件流" : "Tool event stream", systemImage: "hammer")
              }
              Text(chinese ? "在单聊中显示完整工具调用与执行结果。" : "Show complete tool calls and results in chat.")
                .font(HermesFonts.body(13))
                .foregroundStyle(appearance.palette.secondary)
            }

            Section(chinese ? "推理强度" : "Reasoning effort") {
              Picker(chinese ? "推理强度" : "Reasoning effort", selection: reasoningBinding) {
                Text(chinese ? "低" : "Low").tag("low")
                Text(chinese ? "中" : "Medium").tag("medium")
                Text(chinese ? "高" : "High").tag("high")
              }
              .pickerStyle(.segmented)
            }
          }
          .scrollContentBackground(.hidden)
          .background(appearance.palette.background)
          .navigationTitle(chinese ? "模型与工具" : "Models & tools")
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .confirmationAction) {
              Button(chinese ? "完成" : "Done", action: close)
            }
          }
        }
        .frame(width: panelWidth)
        .background(appearance.palette.background)
        .offset(x: presented ? 0 : panelWidth)
        .shadow(color: .black.opacity(presented ? 0.32 : 0), radius: 22, x: -8)
        .gesture(
          DragGesture(minimumDistance: 8)
            .onEnded { value in
              if value.predictedEndTranslation.width > panelWidth * 0.20 { close() }
            }
        )
      }
    }
    .onAppear {
      presented = false
      if props.open {
        DispatchQueue.main.async {
          withAnimation(hermesDrawerAnimation) { presented = true }
        }
      }
    }
    .onChange(of: props.open) { next in
      withAnimation(hermesDrawerAnimation) { presented = next }
    }
    .preferredColorScheme(appearance.theme.colorScheme)
    .environmentObject(appearance)
  }

  private var modelBinding: Binding<String> {
    Binding(
      get: { props.model },
      set: { props.onModelChange(["model": $0]) }
    )
  }

  private var toolsBinding: Binding<Bool> {
    Binding(
      get: { props.toolsEnabled },
      set: { props.onToolsChange(["enabled": $0]) }
    )
  }

  private var reasoningBinding: Binding<String> {
    Binding(
      get: { props.reasoning },
      set: { props.onReasoningChange(["reasoning": $0]) }
    )
  }

  private func close() {
    withAnimation(hermesDrawerAnimation) { presented = false }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.27) {
      props.onRequestClose([:])
    }
  }
}

final class HermesSwiftUIFrostedSurfaceProps: ExpoSwiftUI.ViewProps {
  @Field var cornerRadius = 22.0
  @Field var tintColor = "#ffffff"
}

struct HermesSwiftUIFrostedSurfaceView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesSwiftUIFrostedSurfaceProps

  var body: some View {
    let shape = RoundedRectangle(
      cornerRadius: CGFloat(max(0, props.cornerRadius)),
      style: .continuous
    )
    ZStack {
      shape
        .fill(.regularMaterial)
      shape
        .fill(Color.hermes(props.tintColor).opacity(0.035))
      Children()
    }
    .clipShape(shape)
    .overlay {
      shape.stroke(.white.opacity(0.18), lineWidth: 0.65)
    }
    .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
  }
}
