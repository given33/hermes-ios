import SwiftUI

struct HermesPalette {
  let background: Color
  let surface: Color
  let elevated: Color
  let foreground: Color
  let secondary: Color
  let tertiary: Color
  let border: Color
  let accent: Color
  let primary: Color
  let success: Color
  let warning: Color
  let destructive: Color

  static let nous = HermesPalette(
    background: Color.hermes("#0e0e0e"),
    surface: Color.hermes("#1d1207"),
    elevated: Color.hermes("#28190b"),
    foreground: .white,
    secondary: .white.opacity(0.68),
    tertiary: .white.opacity(0.43),
    border: Color.hermes("#ffac02").opacity(0.23),
    accent: Color.hermes("#ffac02"),
    primary: Color.hermes("#0d7164"),
    success: Color.hermes("#20a879"),
    warning: Color.hermes("#f4b740"),
    destructive: Color.hermes("#ff6b6b")
  )

  static let light = HermesPalette(
    background: Color.hermes("#f7f7f4"),
    surface: .white,
    elevated: Color.hermes("#efefeb"),
    foreground: Color.hermes("#151515"),
    secondary: Color.hermes("#4c4c4c"),
    tertiary: Color.hermes("#777777"),
    border: Color.black.opacity(0.14),
    accent: Color.hermes("#c26b00"),
    primary: Color.hermes("#0d7164"),
    success: Color.hermes("#14855f"),
    warning: Color.hermes("#ad6900"),
    destructive: Color.hermes("#c93636")
  )
}

private struct HermesResolvedAppearance {
  let colorScheme: ColorScheme
  let palette: HermesPalette
}

enum HermesThemeChoice: String, CaseIterable, Identifiable {
  case nous
  case light

  var id: String { rawValue }
  var palette: HermesPalette { self == .nous ? .nous : .light }
  var colorScheme: ColorScheme { self == .nous ? .dark : .light }
}

final class HermesAppearanceModel: ObservableObject {
  private static let themeKey = "hermes.native.theme"
  private static let compactDensityKey = "hermes.native.compact-density"
  private let appearanceSignatureProvider: (() -> String)?
  private let paletteProvider: (() -> HermesPalette)?
  private let colorSchemeProvider: (() -> ColorScheme)?
  private var cachedProviderSignature: String?
  private var cachedProviderPalette: HermesPalette?
  private var cachedProviderColorScheme: ColorScheme?

  @Published var theme: HermesThemeChoice {
    didSet { UserDefaults.standard.set(theme.rawValue, forKey: Self.themeKey) }
  }
  @Published var compactDensity: Bool {
    didSet { UserDefaults.standard.set(compactDensity, forKey: Self.compactDensityKey) }
  }
  @Published private var resolvedAppearance: HermesResolvedAppearance?

  init(
    appearanceSignatureProvider: (() -> String)? = nil,
    paletteProvider: (() -> HermesPalette)? = nil,
    colorSchemeProvider: (() -> ColorScheme)? = nil
  ) {
    self.appearanceSignatureProvider = appearanceSignatureProvider
    self.paletteProvider = paletteProvider
    self.colorSchemeProvider = colorSchemeProvider
    let storedTheme = UserDefaults.standard.string(forKey: Self.themeKey)
    self.theme = storedTheme.flatMap(HermesThemeChoice.init(rawValue:)) ?? .nous
    self.compactDensity = UserDefaults.standard.bool(forKey: Self.compactDensityKey)
    self.resolvedAppearance = nil
  }

  var palette: HermesPalette {
    refreshProviderCache()
    return cachedProviderPalette ?? resolvedAppearance?.palette ?? theme.palette
  }

  var colorScheme: ColorScheme {
    refreshProviderCache()
    return cachedProviderColorScheme ?? resolvedAppearance?.colorScheme ?? theme.colorScheme
  }

  func apply(palette: HermesPalette, colorScheme: ColorScheme) {
    resolvedAppearance = HermesResolvedAppearance(
      colorScheme: colorScheme,
      palette: palette
    )
  }

  private func refreshProviderCache() {
    guard let paletteProvider, let colorSchemeProvider else { return }
    let signature = appearanceSignatureProvider?() ?? ""
    guard signature != cachedProviderSignature else { return }
    cachedProviderSignature = signature
    cachedProviderPalette = paletteProvider()
    cachedProviderColorScheme = colorSchemeProvider()
  }
}

enum HermesFonts {
  static func display(_ size: CGFloat) -> Font {
    .custom("RulesExpanded-Bold", size: size)
  }

  static func condensed(_ size: CGFloat) -> Font {
    .custom("RulesCompressed-Medium", size: size)
  }

  static func body(_ size: CGFloat) -> Font {
    .custom("Collapse-Regular", size: size)
  }

  static func bodyBold(_ size: CGFloat) -> Font {
    .custom("Collapse-Bold", size: size)
  }

  static func editorial(_ size: CGFloat) -> Font {
    .custom("Mondwest-Regular", size: size)
  }

  static func mono(_ size: CGFloat) -> Font {
    .custom("JetBrainsMono-Regular", size: size)
  }
}

struct HermesPressStyle: ButtonStyle {
  var scale = 0.97
  var opacity = 0.86

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? scale : 1)
      .opacity(configuration.isPressed ? opacity : 1)
      .animation(
        .spring(response: 0.28, dampingFraction: 0.82),
        value: configuration.isPressed
      )
  }
}

struct HermesPrimaryButtonStyle: ButtonStyle {
  @EnvironmentObject private var appearance: HermesAppearanceModel

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(HermesFonts.bodyBold(15))
      .foregroundStyle(appearance.palette.background)
      .frame(minHeight: 44)
      .padding(.horizontal, 16)
      .background(appearance.palette.accent)
      .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      .shadow(
        color: appearance.palette.accent.opacity(configuration.isPressed ? 0.08 : 0.22),
        radius: configuration.isPressed ? 4 : 10,
        y: configuration.isPressed ? 1 : 4
      )
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .brightness(configuration.isPressed ? -0.07 : 0)
      .animation(
        .spring(response: 0.28, dampingFraction: 0.82),
        value: configuration.isPressed
      )
  }
}

struct HermesPanel<Content: View>: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  @ViewBuilder let content: Content

  var body: some View {
    content
      .padding(16)
      .background(appearance.palette.surface)
      .overlay {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .stroke(appearance.palette.border, lineWidth: 1)
      }
      .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
  }
}

struct HermesStatusPill: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let text: String
  var color: Color? = nil

  var body: some View {
    Text(text.uppercased())
      .font(HermesFonts.condensed(11))
      .foregroundStyle(color ?? appearance.palette.success)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background((color ?? appearance.palette.success).opacity(0.12))
      .clipShape(Capsule())
      .overlay {
        Capsule().stroke((color ?? appearance.palette.success).opacity(0.3))
      }
  }
}

struct HermesDitherBackground: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel

  var body: some View {
    ZStack {
      appearance.palette.background

      TimelineView(.animation(minimumInterval: 1.0 / 120.0)) { timeline in
        Canvas(colorMode: .linear, rendersAsynchronously: true) { context, size in
          let seconds = timeline.date.timeIntervalSinceReferenceDate
          let drift = CGFloat((sin(seconds * 0.34) + 1) * 0.5)
          let radius = max(size.width, size.height) * 0.7
          context.fill(
            Path(ellipseIn: CGRect(
              x: size.width * (0.58 + drift * 0.04) - radius,
              y: -radius * 0.68,
              width: radius * 2,
              height: radius * 2
            )),
            with: .radialGradient(
              Gradient(colors: [appearance.palette.accent.opacity(0.11), .clear]),
              center: CGPoint(x: size.width * 0.68, y: 0),
              startRadius: 0,
              endRadius: radius
            )
          )
        }
      }

      Canvas(colorMode: .linear, rendersAsynchronously: true) { context, size in
        let dotColor = appearance.palette.foreground.opacity(0.035)
        for x in stride(from: CGFloat(0), through: size.width, by: 4) {
          for y in stride(from: CGFloat(0), through: size.height, by: 4) {
            let checker = Int(x / 4 + y / 4) % 2 == 0
            if checker {
              var dotPath = Path()
              dotPath.addRect(CGRect(x: x, y: y, width: 1.2, height: 1.2))
              context.fill(
                dotPath,
                with: .color(dotColor)
              )
            }
          }
        }
      }
    }
    .ignoresSafeArea()
    .allowsHitTesting(false)
  }
}

struct HermesPage<Content: View>: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let subtitle: String?
  @ViewBuilder let content: Content

  init(subtitle: String? = nil, @ViewBuilder content: () -> Content) {
    self.subtitle = subtitle
    self.content = content()
  }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: appearance.compactDensity ? 10 : 16) {
        if let subtitle {
          Text(subtitle)
            .font(HermesFonts.body(15))
            .foregroundStyle(appearance.palette.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        content
      }
      .frame(maxWidth: 960, alignment: .leading)
      .padding(appearance.compactDensity ? 14 : 20)
      .frame(maxWidth: .infinity, alignment: .topLeading)
    }
    .scrollDismissesKeyboard(.interactively)
    .scrollIndicators(.automatic)
    .background(appearance.palette.background)
  }
}

struct HermesMetric: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let title: String
  let value: String
  let symbol: String
  var tint: Color? = nil

  var body: some View {
    HermesPanel {
      VStack(alignment: .leading, spacing: 10) {
        HStack {
          Text(title.uppercased())
            .font(HermesFonts.condensed(12))
            .foregroundStyle(appearance.palette.secondary)
          Spacer()
          Image(systemName: symbol)
            .foregroundStyle(tint ?? appearance.palette.accent)
        }
        Text(value)
          .font(HermesFonts.mono(24))
          .foregroundStyle(tint ?? appearance.palette.foreground)
          .animation(.spring(response: 0.32, dampingFraction: 0.86), value: value)
      }
    }
  }
}

private struct HermesImpactFeedbackModifier: ViewModifier {
  let trigger: Int

  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content.sensoryFeedback(.impact(weight: .light), trigger: trigger)
    } else {
      content
    }
  }
}

extension View {
  func hermesListStyle() -> some View {
    self
      .scrollContentBackground(.hidden)
      .listStyle(.insetGrouped)
  }

  func hermesImpact(trigger: Int) -> some View {
    modifier(HermesImpactFeedbackModifier(trigger: trigger))
  }
}
