import ExpoModulesCore
import SwiftUI

struct HermesLiquidGlassView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesLiquidGlassProps
  @GestureState private var pressed = false

  var body: some View {
    let shape = RoundedRectangle(
      cornerRadius: props.glassCornerRadius,
      style: .continuous
    )
    ZStack {
      shape
        .fill(.ultraThinMaterial)
      shape
        .fill(Color.hermesGlass(props.tintColor))
      shape
        .stroke(
          LinearGradient(
            colors: [
              .white.opacity(0.34),
              .white.opacity(0.08),
              .white.opacity(0.01)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          ),
          lineWidth: 0.75
        )
      Children()
    }
    .clipShape(shape)
    .shadow(color: .black.opacity(0.16), radius: 10, y: 5)
    .scaleEffect(pressed ? 0.985 : 1)
    .opacity(pressed ? 0.96 : 1)
    .animation(
      .spring(response: 0.3, dampingFraction: 0.86),
      value: pressed
    )
    .simultaneousGesture(
      DragGesture(minimumDistance: 0)
        .updating($pressed) { _, state, _ in
          if props.interactive { state = true }
        }
    )
  }
}

private extension Color {
  static func hermesGlass(_ value: String) -> Color {
    var hex = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6 || hex.count == 8 else { return .clear }
    var raw: UInt64 = 0
    guard Scanner(string: hex).scanHexInt64(&raw) else { return .clear }
    if hex.count == 6 {
      return Color(
        red: Double((raw >> 16) & 0xff) / 255,
        green: Double((raw >> 8) & 0xff) / 255,
        blue: Double(raw & 0xff) / 255
      )
    }
    return Color(
      red: Double((raw >> 24) & 0xff) / 255,
      green: Double((raw >> 16) & 0xff) / 255,
      blue: Double((raw >> 8) & 0xff) / 255,
      opacity: Double(raw & 0xff) / 255
    )
  }
}
