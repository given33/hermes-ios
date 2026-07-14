import SwiftUI

extension Color {
  static func hermes(_ value: String) -> Color {
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
