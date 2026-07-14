import ExpoModulesCore
import QuickLook
import SwiftUI

public final class HermesQuickLookModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesQuickLook")
    View(HermesQuickLookView.self)
  }
}

final class HermesQuickLookProps: ExpoSwiftUI.ViewProps {
  @Field var uri: String?
  @Field var requestId = 0
}

struct HermesQuickLookView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesQuickLookProps
  @State private var previewURL: URL?

  var body: some View {
    Color.clear
      .frame(width: 1, height: 1)
      .quickLookPreview($previewURL)
      .onChange(of: props.requestId) { _ in
        presentCurrentURL()
      }
  }

  private func presentCurrentURL() {
    guard
      let value = props.uri,
      let url = URL(string: value),
      url.isFileURL,
      FileManager.default.fileExists(atPath: url.path)
    else {
      previewURL = nil
      return
    }
    previewURL = url
  }
}
