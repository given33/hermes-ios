import DeviceActivity
import ExpoModulesCore
import SwiftUI

extension DeviceActivityReport.Context {
  static let hermesSummary = Self("Hermes Summary")
}

final class HermesScreenTimeReportView: ExpoView {
  private var host: UIHostingController<HermesScreenTimeReportContent>?
  var refreshToken = 0 {
    didSet { render() }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    isUserInteractionEnabled = false
    render()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    host?.view.frame = bounds
  }

  private func render() {
    let content = HermesScreenTimeReportContent(refreshToken: refreshToken)
    if let host {
      host.rootView = content
      host.view.frame = bounds
      return
    }
    let controller = UIHostingController(rootView: content)
    controller.view.backgroundColor = .clear
    controller.view.isUserInteractionEnabled = false
    controller.view.frame = bounds
    addSubview(controller.view)
    host = controller
  }
}

private struct HermesScreenTimeReportContent: View {
  let refreshToken: Int

  private var filter: DeviceActivityFilter {
    let calendar = Calendar.autoupdatingCurrent
    let start = calendar.startOfDay(for: Date())
    let end = calendar.date(byAdding: .day, value: 1, to: start) ?? Date()
    return DeviceActivityFilter(segment: .daily(during: DateInterval(start: start, end: end)))
  }

  var body: some View {
    DeviceActivityReport(.hermesSummary, filter: filter)
      .id(refreshToken)
      .accessibilityHidden(true)
  }
}
