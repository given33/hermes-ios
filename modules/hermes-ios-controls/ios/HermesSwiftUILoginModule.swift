import ExpoModulesCore
import SwiftUI

public final class HermesSwiftUILoginModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSwiftUILogin")
    View(HermesSwiftUILoginView.self)
  }
}

final class HermesSwiftUILoginProps: ExpoSwiftUI.ViewProps {
  @Field var baseUrl = ""
  @Field var busy = false
  @Field var errorMessage = ""
  @Field var loading = false
  @Field var locked = false
  @Field var locale = "zh"

  var onLogout = EventDispatcher()
  var onProvision = EventDispatcher()
  var onUnlock = EventDispatcher()
}

struct HermesSwiftUILoginView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HermesSwiftUILoginProps

  var body: some View {
    HermesSwiftUILoginScreen(props: props)
  }
}

private struct HermesSwiftUILoginScreen: View {
  @ObservedObject var props: HermesSwiftUILoginProps
  @StateObject private var appearance = HermesAppearanceModel()
  @State private var baseUrl: String
  @State private var apiKey = ""
  @State private var appeared = false
  @State private var hapticTrigger = 0
  @FocusState private var focusedField: Field?

  private enum Field {
    case baseUrl
    case apiKey
  }

  init(props: HermesSwiftUILoginProps) {
    self.props = props
    self._baseUrl = State(initialValue: props.baseUrl)
  }

  private var chinese: Bool { props.locale == "zh" }
  private var canSubmit: Bool {
    !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !props.busy
  }

  var body: some View {
    ZStack {
      HermesDitherBackground()

      ScrollView {
        VStack(spacing: 28) {
          brand
          loginCard
          footer
        }
        .frame(maxWidth: 416)
        .padding(.horizontal, 20)
        .padding(.vertical, 54)
        .frame(maxWidth: .infinity, minHeight: 720)
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 8)
      }
      .scrollDismissesKeyboard(.interactively)
    }
    .environmentObject(appearance)
    .preferredColorScheme(appearance.theme.colorScheme)
    .hermesImpact(trigger: hapticTrigger)
    .onAppear {
      withAnimation(.easeOut(duration: 0.6)) {
        appeared = true
      }
    }
    .onChange(of: props.baseUrl) { _, next in
      if focusedField != .baseUrl { baseUrl = next }
    }
  }

  private var brand: some View {
    HStack(spacing: 10) {
      Text("NOUS")
      Circle()
        .fill(appearance.palette.accent)
        .frame(width: 5, height: 5)
        .shadow(color: appearance.palette.accent, radius: 7)
      Text("RESEARCH")
    }
    .font(HermesFonts.display(17))
    .foregroundStyle(appearance.palette.foreground)
    .tracking(5.3)
  }

  private var loginCard: some View {
    VStack(alignment: .leading, spacing: 18) {
      VStack(alignment: .leading, spacing: 8) {
        Text(chinese ? "登录" : "LOGIN")
          .font(HermesFonts.display(30))
          .foregroundStyle(appearance.palette.foreground)
        Text(subtitle)
          .font(HermesFonts.body(15))
          .foregroundStyle(appearance.palette.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      Divider().overlay(appearance.palette.border)

      if props.loading {
        HStack(spacing: 12) {
          ProgressView().tint(appearance.palette.accent)
          Text(chinese ? "正在准备" : "Preparing")
            .font(HermesFonts.bodyBold(14))
        }
        .frame(maxWidth: .infinity, minHeight: 80)
      } else if props.locked {
        lockedForm
      } else {
        credentialForm
      }
    }
    .padding(24)
    .background(appearance.palette.surface.opacity(0.96))
    .overlay {
      Rectangle().stroke(appearance.palette.border, lineWidth: 1)
    }
    .shadow(color: .black.opacity(0.6), radius: 30, y: 24)
  }

  private var subtitle: String {
    if props.loading {
      return chinese ? "正在读取 Hermes 安全连接。" : "Reading the secure Hermes connection."
    }
    if props.locked { return props.baseUrl }
    return chinese
      ? "登录后继续使用 Hermes Agent 管理面板。"
      : "Sign in to continue to the Hermes Agent dashboard."
  }

  private var lockedForm: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(chinese ? "使用 FACE ID 登录" : "SIGN IN WITH FACE ID")
        .font(HermesFonts.condensed(13))
        .foregroundStyle(appearance.palette.secondary)

      errorMessage

      Button {
        hapticTrigger += 1
        props.onUnlock()
      } label: {
        HStack {
          if props.busy { ProgressView().tint(appearance.palette.background) }
          Image(systemName: "faceid")
          Text(props.busy ? (chinese ? "正在验证" : "Verifying") : (chinese ? "使用 Face ID 登录" : "Sign in with Face ID"))
          Spacer()
        }
      }
      .buttonStyle(HermesPrimaryButtonStyle())
      .disabled(props.busy)

      Button {
        props.onLogout()
      } label: {
        Text(chinese ? "更换连接" : "Change Connection")
          .font(HermesFonts.bodyBold(14))
          .frame(maxWidth: .infinity, minHeight: 44)
      }
      .buttonStyle(.bordered)
      .tint(appearance.palette.accent)
      .disabled(props.busy)
    }
  }

  private var credentialForm: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(chinese ? "使用 API 密钥登录" : "SIGN IN WITH API KEY")
        .font(HermesFonts.condensed(13))
        .foregroundStyle(appearance.palette.secondary)

      VStack(alignment: .leading, spacing: 5) {
        Text("BASE URL")
          .font(HermesFonts.condensed(12))
          .foregroundStyle(appearance.palette.secondary)
        TextField("https://8.138.40.16", text: $baseUrl)
          .font(HermesFonts.body(15))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          .textContentType(.URL)
          .submitLabel(.next)
          .focused($focusedField, equals: .baseUrl)
          .onSubmit { focusedField = .apiKey }
          .hermesLoginField(focused: focusedField == .baseUrl, palette: appearance.palette)
      }

      VStack(alignment: .leading, spacing: 5) {
        Text(chinese ? "API 密钥" : "API KEY")
          .font(HermesFonts.condensed(12))
          .foregroundStyle(appearance.palette.secondary)
        SecureField(chinese ? "输入 API 密钥" : "Enter API key", text: $apiKey)
          .font(HermesFonts.body(15))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .textContentType(.password)
          .submitLabel(.done)
          .focused($focusedField, equals: .apiKey)
          .onSubmit(submit)
          .hermesLoginField(focused: focusedField == .apiKey, palette: appearance.palette)
      }

      errorMessage

      Button(action: submit) {
        HStack {
          if props.busy { ProgressView().tint(appearance.palette.background) }
          Text(props.busy ? (chinese ? "正在连接" : "Connecting") : (chinese ? "登录" : "Sign In"))
          Spacer()
          Image(systemName: "arrow.right")
        }
      }
      .buttonStyle(HermesPrimaryButtonStyle())
      .disabled(!canSubmit)
      .opacity(canSubmit ? 1 : 0.42)
    }
  }

  @ViewBuilder
  private var errorMessage: some View {
    if !props.errorMessage.isEmpty {
      Label(props.errorMessage, systemImage: "exclamationmark.triangle")
        .font(HermesFonts.body(13))
        .foregroundStyle(appearance.palette.destructive)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var footer: some View {
    HStack(spacing: 8) {
      Rectangle().fill(appearance.palette.border).frame(width: 26, height: 1)
      Text(chinese ? "公网访问 · 需要身份验证" : "PUBLIC NETWORK · AUTHENTICATION REQUIRED")
        .font(HermesFonts.condensed(11))
        .foregroundStyle(appearance.palette.tertiary)
      Rectangle().fill(appearance.palette.border).frame(width: 26, height: 1)
    }
  }

  private func submit() {
    guard canSubmit else { return }
    hapticTrigger += 1
    props.onProvision([
      "baseUrl": baseUrl.trimmingCharacters(in: .whitespacesAndNewlines),
      "apiKey": apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    ])
  }
}

private extension View {
  func hermesLoginField(focused: Bool, palette: HermesPalette) -> some View {
    self
      .padding(.horizontal, 13)
      .padding(.vertical, 12)
      .background(palette.background)
      .overlay {
        Rectangle()
          .stroke(focused ? palette.accent : palette.border, lineWidth: focused ? 2 : 1)
          .animation(.easeOut(duration: 0.16), value: focused)
      }
  }
}
