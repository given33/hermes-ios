import UIKit

extension UIColor {
  static func hermes(_ value: String) -> UIColor {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalized.lowercased() == "transparent" { return .clear }
    if
      (normalized.lowercased().hasPrefix("rgb(") || normalized.lowercased().hasPrefix("rgba(")),
      let open = normalized.firstIndex(of: "("),
      let close = normalized.lastIndex(of: ")")
    {
      let components = normalized[normalized.index(after: open)..<close]
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      if components.count >= 3 {
        return UIColor(
          red: CGFloat(Double(components[0]) ?? 0) / 255,
          green: CGFloat(Double(components[1]) ?? 0) / 255,
          blue: CGFloat(Double(components[2]) ?? 0) / 255,
          alpha: components.count > 3 ? CGFloat(Double(components[3]) ?? 1) : 1
        )
      }
    }
    var hex = normalized
    if hex.hasPrefix("#") { hex.removeFirst() }
    if hex.count == 3 {
      hex = hex.map { "\($0)\($0)" }.joined()
    }
    var raw: UInt64 = 0
    guard (hex.count == 6 || hex.count == 8), Scanner(string: hex).scanHexInt64(&raw) else {
      return .clear
    }
    if hex.count == 6 {
      return UIColor(
        red: CGFloat((raw >> 16) & 0xff) / 255,
        green: CGFloat((raw >> 8) & 0xff) / 255,
        blue: CGFloat(raw & 0xff) / 255,
        alpha: 1
      )
    }
    return UIColor(
      red: CGFloat((raw >> 24) & 0xff) / 255,
      green: CGFloat((raw >> 16) & 0xff) / 255,
      blue: CGFloat((raw >> 8) & 0xff) / 255,
      alpha: CGFloat(raw & 0xff) / 255
    )
  }
}
