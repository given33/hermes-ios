import ExpoModulesCore
import SwiftUI

final class HermesLiveBlurProps: ExpoSwiftUI.ViewProps {
  @Field var blurRadius = 8.0
}

struct HermesLiveBlurView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesLiveBlurProps

  var body: some View {
    Rectangle()
      .fill(.regularMaterial)
      .opacity(min(1, max(0.2, props.blurRadius / 24)))
      .allowsHitTesting(false)
  }
}
