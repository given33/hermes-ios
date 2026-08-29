import ExpoModulesCore
import Foundation
import SwiftUI
import UIKit

public final class HermesSwiftUIPartialFrontendModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSwiftUIPartialFrontend")
    View(HermesSwiftUIRouteView.self)
    View(HermesSwiftUIModelToolsView.self)
    View(HermesSwiftUIFrostedSurfaceView.self)
  }
}

enum HermesRoute: String, Hashable {
  case chat
  case sessions
  case memory
  case files
  case git
  case analytics
  case smartWeather = "smart-weather"
  case browser
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
  case workflows
  case approvals
  case runtimeCenter = "runtime-center"
  case profiles
  case bots
  case config
  case account
  case env
  case system
  case docs

  var path: String { "/\(rawValue)" }
  func title(_ chinese: Bool) -> String {
    if !chinese { return rawValue.capitalized }
    switch self {
    case .chat: return "聊天"
    case .sessions: return "会话"
    case .memory: return "记忆"
    case .files: return "文件"
    case .git: return "Git 工作区"
    case .analytics: return "分析"
    case .smartWeather: return "智能天气"
    case .browser: return "浏览器"
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
    case .workflows: return "工作流"
    case .approvals: return "审批中心"
    case .runtimeCenter: return "运行中心"
    case .profiles: return "多 Agent 配置"
    case .bots: return "机器人"
    case .config: return "配置"
    case .account: return "账户"
    case .env: return "密钥"
    case .system: return "系统监控"
    case .docs: return "文档"
    }
  }

  static func resolve(routeId: String, path: String, pluginName: String) -> HermesRoute {
    if let direct = HermesRoute(rawValue: routeId) { return direct }
    switch pluginName {
    case "hermes-achievements": return .achievements
    case "collaboration": return .collaboration
    case "kanban": return .kanban
    case "workflows": return .workflows
    default: break
    }
    if path == "/profiles/new" { return .profiles }
    // The desktop shell exposes a few overlay/legacy paths that intentionally
    // share an existing mobile surface.  Deep links can enter through the
    // native bridge without passing through the TypeScript shell resolver, so
    // keep the alias table here as well.  This prevents a valid desktop link
    // from silently rendering the chat fallback on a signed iOS build.
    let normalized = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let aliases: [String: String] = [
      "agents": "agent-hub",
      "artifacts": "files",
      "command-center": "sessions",
      "messaging": "channels",
      "settings": "config",
      "starmap": "skills",
    ]
    return HermesRoute(rawValue: aliases[normalized] ?? normalized) ?? .chat
  }
}

private let hermesDrawerAnimation = Animation.interactiveSpring(
  response: 0.34,
  dampingFraction: 0.88,
  blendDuration: 0.08
)

private let hermesReducedMotionFade = Animation.easeOut(duration: 0.12)

func dismissHermesKeyboard() {
  UIApplication.shared.sendAction(
    #selector(UIResponder.resignFirstResponder),
    to: nil,
    from: nil,
    for: nil
  )
}

protocol HermesThemeProviding: AnyObject {
  var themeAccentColor: String { get }
  var themeBackgroundColor: String { get }
  var themeBorderColor: String { get }
  var themeColorScheme: String { get }
  var themeDestructiveColor: String { get }
  var themeElevatedColor: String { get }
  var themeForegroundColor: String { get }
  var themePrimaryColor: String { get }
  var themeSecondaryColor: String { get }
  var themeSuccessColor: String { get }
  var themeSurfaceColor: String { get }
  var themeTertiaryColor: String { get }
  var themeWarningColor: String { get }
}

extension HermesThemeProviding {
  var themeSignature: String {
    [
      themeAccentColor,
      themeBackgroundColor,
      themeBorderColor,
      themeColorScheme,
      themeDestructiveColor,
      themeElevatedColor,
      themeForegroundColor,
      themePrimaryColor,
      themeSecondaryColor,
      themeSuccessColor,
      themeSurfaceColor,
      themeTertiaryColor,
      themeWarningColor,
    ].joined(separator: "|")
  }

  var resolvedPalette: HermesPalette {
    HermesPalette(
      background: .hermes(themeBackgroundColor),
      surface: .hermes(themeSurfaceColor),
      elevated: .hermes(themeElevatedColor),
      foreground: .hermes(themeForegroundColor),
      secondary: .hermes(themeSecondaryColor),
      tertiary: .hermes(themeTertiaryColor),
      border: .hermes(themeBorderColor),
      accent: .hermes(themeAccentColor),
      primary: .hermes(themePrimaryColor),
      success: .hermes(themeSuccessColor),
      warning: .hermes(themeWarningColor),
      destructive: .hermes(themeDestructiveColor)
    )
  }

  var resolvedColorScheme: ColorScheme {
    themeColorScheme == "light" ? .light : .dark
  }

  func applyTheme(to appearance: HermesAppearanceModel) {
    appearance.apply(palette: resolvedPalette, colorScheme: resolvedColorScheme)
  }
}

final class HermesSwiftUIRouteProps: ExpoSwiftUI.ViewProps, HermesThemeProviding {
  @Field var dataJson = "{}"
  @Field var locale = "zh"
  @Field var path = "/chat"
  @Field var pluginName = ""
  @Field var routeId = "chat"
  @Field var showsNavigationButton = true
  @Field var themeAccentColor = "#ffe6cb"
  @Field var themeBackgroundColor = "#041c1c"
  @Field var themeBorderColor = "#ffe6cb26"
  @Field var themeColorScheme = "dark"
  @Field var themeDestructiveColor = "#fb2c36"
  @Field var themeElevatedColor = "#0e2524"
  @Field var themeForegroundColor = "#ffe6cb"
  @Field var themePrimaryColor = "#ffe6cb"
  @Field var themeSecondaryColor = "#ffe6cbcc"
  @Field var themeSuccessColor = "#4ade80"
  @Field var themeSurfaceColor = "#0e2524"
  @Field var themeTertiaryColor = "#ffe6cba6"
  @Field var themeWarningColor = "#ffbd38"
  var onAction = EventDispatcher()
  var onOpenNavigation = EventDispatcher()
  var onReady = EventDispatcher()
}

struct HermesSwiftUIRouteView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HermesSwiftUIRouteProps
  @StateObject private var appearance: HermesAppearanceModel
  @StateObject private var routeData: HermesRouteDataStore
  @State private var preparedAnalyticsPath: String? = nil

  init(props: HermesSwiftUIRouteProps) {
    Self.configureNavigationBarAppearance()
    _props = ObservedObject(wrappedValue: props)
    _appearance = StateObject(wrappedValue: HermesAppearanceModel(
      appearanceSignatureProvider: { [weak props] in props?.themeSignature ?? "" },
      paletteProvider: { [weak props] in props?.resolvedPalette ?? .nous },
      colorSchemeProvider: { [weak props] in props?.resolvedColorScheme ?? .dark }
    ))
    _routeData = StateObject(wrappedValue: HermesRouteDataStore(dataJson: props.dataJson))
  }

  private static func configureNavigationBarAppearance() {
    let navigationBar = UINavigationBar.appearance()
    navigationBar.shadowImage = UIImage()
    var standard = navigationBar.standardAppearance
    standard.shadowColor = .clear
    standard.shadowImage = UIImage()
    navigationBar.standardAppearance = standard
    var scrollEdge = navigationBar.scrollEdgeAppearance ?? standard
    scrollEdge.shadowColor = .clear
    scrollEdge.shadowImage = UIImage()
    navigationBar.scrollEdgeAppearance = scrollEdge
    var compact = navigationBar.compactAppearance ?? standard
    compact.shadowColor = .clear
    compact.shadowImage = UIImage()
    navigationBar.compactAppearance = compact
    if #available(iOS 15.0, *) {
      var compactScrollEdge = navigationBar.compactScrollEdgeAppearance ?? compact
      compactScrollEdge.shadowColor = .clear
      compactScrollEdge.shadowImage = UIImage()
      navigationBar.compactScrollEdgeAppearance = compactScrollEdge
    }
  }

  private var chinese: Bool { props.locale == "zh" }
  private var route: HermesRoute {
    HermesRoute.resolve(routeId: props.routeId, path: props.path, pluginName: props.pluginName)
  }

  private var routeContentReady: Bool {
    route != .analytics || preparedAnalyticsPath == props.path
  }

  var body: some View {
    NavigationStack {
      HermesRouteContent(
        attachmentIds: [],
        attachmentNames: [],
        data: routeData.snapshot,
        route: route,
        chinese: chinese,
        renderDeferredContent: routeContentReady,
        onAction: { action, payload in
          props.onAction([
            "action": action.rawValue,
            "payload": HermesRouteActionEncoder.encode(payload),
          ])
        }
      )
      .navigationTitle(route.title(chinese))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        if props.showsNavigationButton {
          ToolbarItem(placement: .navigationBarLeading) {
            Button {
              dismissHermesKeyboard()
              props.onOpenNavigation([:])
            } label: {
              Image(systemName: "chevron.backward")
            }
            .accessibilityLabel(chinese ? "返回侧边栏" : "Back to sidebar")
          }
        }
        if route == .system {
          ToolbarItem(placement: .navigationBarTrailing) {
            Button {
              props.onAction([
                "action": HermesRouteAction.refresh.rawValue,
                "payload": HermesRouteActionEncoder.encode(
                  HermesRouteActionPayload(route: "system")
                ),
              ])
            } label: {
              Image(systemName: "arrow.clockwise")
            }
            .accessibilityLabel(chinese ? "刷新系统状态" : "Refresh system status")
          }
        }
      }
      .toolbarBackground(appearance.palette.background, for: .navigationBar)
      .toolbarBackground(.visible, for: .navigationBar)
    }
    .tint(appearance.palette.accent)
    .background(appearance.palette.background.ignoresSafeArea())
    .scrollDismissesKeyboard(.interactively)
    .background {
      HermesRouteReadinessProbe(
        enabled: routeContentReady,
        path: props.path,
        onReady: { path in props.onReady(["path": path]) }
      )
    }
    .onAppear { prepareDeferredContent() }
    .onDisappear { dismissHermesKeyboard() }
    .onChange(of: props.dataJson) { next in routeData.update(dataJson: next) }
    .onChange(of: props.path) { _ in
      dismissHermesKeyboard()
      prepareDeferredContent()
    }
    .preferredColorScheme(appearance.colorScheme)
    .environmentObject(appearance)
  }

  private func prepareDeferredContent() {
    guard route == .analytics else {
      preparedAnalyticsPath = nil
      return
    }
    let path = props.path
    preparedAnalyticsPath = nil
    DispatchQueue.main.async {
      guard props.path == path, route == .analytics else { return }
      preparedAnalyticsPath = path
    }
  }
}

private struct HermesRouteReadinessProbe: UIViewRepresentable {
  let enabled: Bool
  let path: String
  let onReady: (String) -> Void

  func makeUIView(context: Context) -> HermesRouteReadinessView {
    HermesRouteReadinessView()
  }

  func updateUIView(_ view: HermesRouteReadinessView, context: Context) {
    view.configure(enabled: enabled, path: path, onReady: onReady)
  }
}

private final class HermesRouteReadinessView: UIView {
  private var activationGeneration = 0
  private var enabled = false
  private var lastReportedGeneration: Int?
  private var onReady: ((String) -> Void)?
  private var path = ""
  private var pendingGeneration: Int?

  func configure(
    enabled: Bool,
    path: String,
    onReady: @escaping (String) -> Void
  ) {
    let startsNewActivation = self.path != path || (!self.enabled && enabled)
    if startsNewActivation {
      activationGeneration += 1
      pendingGeneration = nil
    }
    self.enabled = enabled
    self.path = path
    self.onReady = onReady
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard
      enabled,
      window != nil,
      bounds.width > 0,
      bounds.height > 0,
      lastReportedGeneration != activationGeneration,
      pendingGeneration != activationGeneration
    else { return }

    let readyGeneration = activationGeneration
    let readyPath = path
    pendingGeneration = readyGeneration
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard
        enabled,
        window != nil,
        activationGeneration == readyGeneration,
        path == readyPath
      else {
        if pendingGeneration == readyGeneration { pendingGeneration = nil }
        return
      }
      pendingGeneration = nil
      lastReportedGeneration = readyGeneration
      onReady?(readyPath)
    }
  }
}

final class HermesSwiftUIModelToolsProps: ExpoSwiftUI.ViewProps, HermesThemeProviding {
  @Field var locale = "zh"
  @Field var model = "claude-sonnet-4"
  @Field var open = false
  @Field var reasoning = "medium"
  @Field var toolsEnabled = true
  @Field var themeAccentColor = "#ffe6cb"
  @Field var themeBackgroundColor = "#041c1c"
  @Field var themeBorderColor = "#ffe6cb26"
  @Field var themeColorScheme = "dark"
  @Field var themeDestructiveColor = "#fb2c36"
  @Field var themeElevatedColor = "#0e2524"
  @Field var themeForegroundColor = "#ffe6cb"
  @Field var themePrimaryColor = "#ffe6cb"
  @Field var themeSecondaryColor = "#ffe6cbcc"
  @Field var themeSuccessColor = "#4ade80"
  @Field var themeSurfaceColor = "#0e2524"
  @Field var themeTertiaryColor = "#ffe6cba6"
  @Field var themeWarningColor = "#ffbd38"
  var onModelChange = EventDispatcher()
  var onNewConversation = EventDispatcher()
  var onReasoningChange = EventDispatcher()
  var onRequestClose = EventDispatcher()
  var onToolsChange = EventDispatcher()
}

struct HermesSwiftUIModelToolsView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
  @ObservedObject var props: HermesSwiftUIModelToolsProps
  @StateObject private var appearance = HermesAppearanceModel()
  @State private var presented = false
  @State private var selectedModel = "claude-sonnet-4"
  @State private var selectedReasoning = "medium"
  @State private var selectedToolsEnabled = true

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
                close()
                DispatchQueue.main.async { props.onNewConversation([:]) }
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
        .offset(x: accessibilityReduceMotion ? 0 : (presented ? 0 : panelWidth))
        .opacity(accessibilityReduceMotion ? (presented ? 1 : 0) : 1)
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
      selectedModel = props.model
      selectedReasoning = props.reasoning
      selectedToolsEnabled = props.toolsEnabled
      presented = false
      if props.open {
        DispatchQueue.main.async {
          withAnimation(drawerAnimation) { presented = true }
        }
      }
    }
    .onChange(of: props.open) { next in
      withAnimation(drawerAnimation) { presented = next }
    }
    .onChange(of: props.model) { selectedModel = $0 }
    .onChange(of: props.reasoning) { selectedReasoning = $0 }
    .onChange(of: props.toolsEnabled) { selectedToolsEnabled = $0 }
    .onAppear { props.applyTheme(to: appearance) }
    .onChange(of: props.themeSignature) { _ in props.applyTheme(to: appearance) }
    .preferredColorScheme(appearance.colorScheme)
    .environmentObject(appearance)
  }

  private var modelBinding: Binding<String> {
    Binding(
      get: { selectedModel },
      set: {
        selectedModel = $0
        props.onModelChange(["model": $0])
      }
    )
  }

  private var toolsBinding: Binding<Bool> {
    Binding(
      get: { selectedToolsEnabled },
      set: {
        selectedToolsEnabled = $0
        props.onToolsChange(["enabled": $0])
      }
    )
  }

  private var reasoningBinding: Binding<String> {
    Binding(
      get: { selectedReasoning },
      set: {
        selectedReasoning = $0
        props.onReasoningChange(["reasoning": $0])
      }
    )
  }

  private func close() {
    withAnimation(drawerAnimation) { presented = false }
    let closeDelay = accessibilityReduceMotion ? 0.12 : 0.27
    DispatchQueue.main.asyncAfter(deadline: .now() + closeDelay) {
      props.onRequestClose([:])
    }
  }

  private var drawerAnimation: Animation {
    accessibilityReduceMotion ? hermesReducedMotionFade : hermesDrawerAnimation
  }
}

final class HermesSwiftUIFrostedSurfaceProps: ExpoSwiftUI.ViewProps {
  @Field var colorScheme = "dark"
  @Field var cornerRadius = 22.0
  @Field var tintColor = "#ffffff"
}

struct HermesSwiftUIFrostedSurfaceView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
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
        .fill(Color.hermes(props.tintColor).opacity(0.14))
    }
    .clipShape(shape)
    .overlay {
      shape.stroke(.white.opacity(0.18), lineWidth: 0.65)
    }
    .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
    .preferredColorScheme(props.colorScheme == "light" ? .light : .dark)
  }
}
