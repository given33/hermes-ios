import ExpoModulesCore
import UIKit

struct HermesSwipeActionRecord: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var systemImage: String?
  @Field var tintColor: String?
  @Field var destructive: Bool = false
}

final class HermesSwipeActionsView: ExpoView, UITableViewDataSource, UITableViewDelegate {
  let onAction = EventDispatcher()
  var actions: [HermesSwipeActionRecord] = [] {
    didSet { tableView.reloadData() }
  }
  var fullSwipeEnabled = false

  private let reuseIdentifier = "HermesSwipeActionsCell"
  private let tableView = UITableView(frame: .zero, style: .plain)
  private weak var hostedReactView: UIView?
  private var previousHeight: CGFloat = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear

    tableView.backgroundColor = .clear
    tableView.alwaysBounceHorizontal = false
    tableView.alwaysBounceVertical = false
    tableView.bounces = false
    tableView.contentInset = .zero
    tableView.dataSource = self
    tableView.delegate = self
    tableView.delaysContentTouches = false
    tableView.sectionFooterHeight = 0
    tableView.sectionHeaderHeight = 0
    tableView.separatorStyle = .none
    tableView.showsHorizontalScrollIndicator = false
    tableView.showsVerticalScrollIndicator = false
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: reuseIdentifier)
    addSubview(tableView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    tableView.frame = bounds
    let height = max(1, bounds.height)
    if abs(previousHeight - height) > 0.5 {
      previousHeight = height
      tableView.rowHeight = height
      tableView.reloadData()
    }
    attachHostedViewIfPossible()
  }

  func numberOfSections(in tableView: UITableView) -> Int { 1 }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 1 }

  func tableView(
    _ tableView: UITableView,
    cellForRowAt indexPath: IndexPath
  ) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: reuseIdentifier, for: indexPath)
    cell.backgroundColor = .clear
    cell.contentView.backgroundColor = .clear
    cell.preservesSuperviewLayoutMargins = false
    cell.layoutMargins = .zero
    cell.selectionStyle = .none
    attachHostedView(to: cell)
    return cell
  }

  func tableView(
    _ tableView: UITableView,
    trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath
  ) -> UISwipeActionsConfiguration? {
    guard !actions.isEmpty else { return nil }
    let contextualActions = actions.map { action in
      let style: UIContextualAction.Style = action.destructive ? .destructive : .normal
      let contextual = UIContextualAction(style: style, title: action.title) {
        [weak self] _, _, completion in
        self?.onAction(["id": action.id])
        completion(true)
      }
      contextual.image = action.systemImage.flatMap(UIImage.init(systemName:))
      contextual.backgroundColor = action.tintColor.flatMap(UIColor.hermesHex)
        ?? (action.destructive ? .systemRed : .systemBlue)
      return contextual
    }
    let configuration = UISwipeActionsConfiguration(actions: contextualActions)
    configuration.performsFirstActionWithFullSwipe = fullSwipeEnabled
    return configuration
  }

  private func attachHostedViewIfPossible() {
    guard
      let cell = tableView.cellForRow(at: IndexPath(row: 0, section: 0))
    else { return }
    attachHostedView(to: cell)
  }

  private func attachHostedView(to cell: UITableViewCell) {
    guard let hostedReactView else { return }
    if hostedReactView.superview !== cell.contentView {
      hostedReactView.removeFromSuperview()
      cell.contentView.addSubview(hostedReactView)
    }
    hostedReactView.frame = cell.contentView.bounds
    hostedReactView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  private func mountReactChild(_ child: UIView) {
    hostedReactView = child
    tableView.reloadData()
    setNeedsLayout()
  }

  private func unmountReactChild(_ child: UIView) {
    if hostedReactView === child {
      hostedReactView = nil
    }
    child.removeFromSuperview()
  }

#if RCT_NEW_ARCH_ENABLED
  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    mountReactChild(childComponentView)
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    unmountReactChild(childComponentView)
  }
#else
  override func insertReactSubview(_ subview: UIView!, at atIndex: Int) {
    super.insertReactSubview(subview, at: atIndex)
    mountReactChild(subview)
  }

  override func removeReactSubview(_ subview: UIView!) {
    unmountReactChild(subview)
    super.removeReactSubview(subview)
  }

  override func didUpdateReactSubviews() {
    attachHostedViewIfPossible()
  }
#endif
}

private extension UIColor {
  static func hermesHex(_ value: String) -> UIColor? {
    var hex = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6 || hex.count == 8 else { return nil }
    var raw: UInt64 = 0
    guard Scanner(string: hex).scanHexInt64(&raw) else { return nil }
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
