import SwiftUI

extension Color {
  static func hermes(_ value: String) -> Color {
    let source = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if source.lowercased().hasPrefix("rgb") {
      let values = source
        .replacingOccurrences(of: "rgba", with: "", options: .caseInsensitive)
        .replacingOccurrences(of: "rgb", with: "", options: .caseInsensitive)
        .trimmingCharacters(in: CharacterSet(charactersIn: "()"))
        .split(separator: ",")
        .compactMap { Double($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
      guard values.count == 3 || values.count == 4 else { return .clear }
      return Color(
        red: min(255, max(0, values[0])) / 255,
        green: min(255, max(0, values[1])) / 255,
        blue: min(255, max(0, values[2])) / 255,
        opacity: values.count == 4 ? min(1, max(0, values[3])) : 1
      )
    }

    var hex = source
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
