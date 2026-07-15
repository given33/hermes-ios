import SwiftUI
import UIKit

extension Color {
  static func hermes(_ value: String) -> Color {
    Color(uiColor: UIColor.hermes(value))
  }
}
