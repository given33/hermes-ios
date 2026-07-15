import ExpoModulesCore
import SwiftUI

struct HermesSwipeActionRecord: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var systemImage: String?
  @Field var tintColor: String?
  @Field var destructive = false
}

final class HermesSwipeActionsProps: ExpoSwiftUI.ViewProps {
  @Field var actions: [HermesSwipeActionRecord] = []
  @Field var fullSwipeEnabled = false
  var onAction = EventDispatcher()
}

struct HermesSwipeActionsView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HermesSwipeActionsProps

  var body: some View {
    List {
      Children()
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .swipeActions(
          edge: .trailing,
          allowsFullSwipe: props.fullSwipeEnabled
        ) {
          ForEach(props.actions.indices, id: \.self) { index in
            let action = props.actions[index]
            if action.destructive {
              SwiftUI.Button(role: .destructive) {
                props.onAction(["id": action.id])
              } label: {
                actionLabel(action)
              }
              .tint(action.tintColor.flatMap(Color.hermesHex) ?? .red)
            } else {
              SwiftUI.Button {
                props.onAction(["id": action.id])
              } label: {
                actionLabel(action)
              }
              .tint(action.tintColor.flatMap(Color.hermesHex) ?? .blue)
            }
          }
        }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .background(Color.clear)
    .environment(\.defaultMinListRowHeight, 1)
  }

  @ViewBuilder
  private func actionLabel(_ action: HermesSwipeActionRecord) -> some View {
    if let systemImage = action.systemImage {
      Label(action.title, systemImage: systemImage)
    } else {
      Text(action.title)
    }
  }
}

private extension Color {
  static func hermesHex(_ value: String) -> Color? {
    var hex = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6 || hex.count == 8 else { return nil }
    var raw: UInt64 = 0
    guard Scanner(string: hex).scanHexInt64(&raw) else { return nil }
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
