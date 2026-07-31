import CryptoKit
import FileProvider
import Foundation
import UniformTypeIdentifiers

private let hermesFileProviderGroup = "group.app.sunstone1029.fig1171.hermes"
private let hermesFileProviderOwnerKey = "hermes-file-provider-owner-v1"

final class HermesFileProviderItem: NSObject, NSFileProviderItem {
  private let url: URL
  private let parent: NSFileProviderItemIdentifier
  private let root: URL

  init(url: URL, parent: NSFileProviderItemIdentifier, root: URL) {
    self.url = url
    self.parent = parent
    self.root = root
    super.init()
  }

  var itemIdentifier: NSFileProviderItemIdentifier {
    let relative = url.path.replacingOccurrences(of: root.path, with: "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return relative.isEmpty ? .rootContainer : NSFileProviderItemIdentifier(relative)
  }
  var parentItemIdentifier: NSFileProviderItemIdentifier { parent }
  var filename: String { url.lastPathComponent }
  var contentType: UTType {
    var directory: ObjCBool = false
    FileManager.default.fileExists(atPath: url.path, isDirectory: &directory)
    return directory.boolValue ? .folder : (UTType(filenameExtension: url.pathExtension) ?? .data)
  }
  var capabilities: NSFileProviderItemCapabilities {
    let id = itemIdentifier.rawValue
    if id == "memory" || id == "skills" || id.hasPrefix("memory/") || id.hasPrefix("skills/") {
      var value: NSFileProviderItemCapabilities = [.allowsReading]
      if contentType == .folder { value.insert(.allowsContentEnumerating) }
      return value
    }
    if id == "uploads" || id == "workspace" {
      return [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems]
    }
    return [.allowsReading, .allowsWriting, .allowsRenaming, .allowsReparenting, .allowsDeleting]
  }
  var itemVersion: NSFileProviderItemVersion {
    let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date.distantPast
    let data = String(date.timeIntervalSince1970).data(using: .utf8) ?? Data()
    return NSFileProviderItemVersion(contentVersion: data, metadataVersion: data)
  }
  var documentSize: NSNumber? {
    guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
          let size = values.fileSize else { return nil }
    return NSNumber(value: size)
  }
  var contentModificationDate: Date? {
    guard let values = try? url.resourceValues(forKeys: [.contentModificationDateKey]),
          let value = values.contentModificationDate else { return nil }
    return value
  }
  var creationDate: Date? {
    guard let values = try? url.resourceValues(forKeys: [.creationDateKey]),
          let value = values.creationDate else { return nil }
    return value
  }
}

final class HermesFileProviderEnumerator: NSObject, NSFileProviderEnumerator {
  private let container: NSFileProviderItemIdentifier
  private let root: URL
  private let recursive: Bool

  init(container: NSFileProviderItemIdentifier, root: URL, recursive: Bool = false) {
    self.container = container
    self.root = root
    self.recursive = recursive
  }

  func invalidate() {}

  func enumerateItems(for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage) {
    observer.didEnumerate(items())
    observer.finishEnumerating(upTo: nil)
  }

  func enumerateChanges(for observer: NSFileProviderChangeObserver, from syncAnchor: NSFileProviderSyncAnchor) {
    let current = anchor()
    if syncAnchor != current { observer.didUpdate(items()) }
    observer.finishEnumeratingChanges(upTo: current, moreComing: false)
  }

  func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
    completionHandler(anchor())
  }

  private func directory() -> URL {
    guard container != .rootContainer,
          !container.rawValue.contains(".."),
          !container.rawValue.contains("\\"),
          !container.rawValue.contains(":"),
          !container.rawValue.hasPrefix("/") else { return root }
    let candidate = root.appendingPathComponent(container.rawValue).standardizedFileURL
    return candidate.path.hasPrefix(root.standardizedFileURL.path + "/") ? candidate : root
  }

  private func items() -> [HermesFileProviderItem] {
    let directory = directory()
    guard let entries = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey], options: [.skipsHiddenFiles]) else { return [] }
    let visible = entries.filter { !Self.hidden($0.lastPathComponent) }
    if recursive { return visible.flatMap { flatten($0) } }
    return visible.map { HermesFileProviderItem(url: $0, parent: container, root: root) }
  }

  private func flatten(_ url: URL) -> [HermesFileProviderItem] {
    let relative = url.path.replacingOccurrences(of: root.path, with: "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let parentPath = (relative as NSString).deletingLastPathComponent
    let parent = parentPath.isEmpty ? NSFileProviderItemIdentifier.rootContainer : NSFileProviderItemIdentifier(parentPath)
    var output = [HermesFileProviderItem(url: url, parent: parent, root: root)]
    if (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
       let children = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) {
      output += children.filter { !Self.hidden($0.lastPathComponent) }.flatMap(flatten)
    }
    return output
  }

  private func anchor() -> NSFileProviderSyncAnchor {
    var digest = UInt64(0)
    for item in items() {
      digest = digest &* 31 &+ UInt64(item.itemIdentifier.rawValue.utf8.reduce(0, { $0 &+ UInt64($1) }))
      digest = digest &+ UInt64((item.contentModificationDate ?? .distantPast).timeIntervalSince1970 * 1000)
    }
    var bytes = digest
    return NSFileProviderSyncAnchor(Data(bytes: &bytes, count: MemoryLayout<UInt64>.size))
  }

  private static func hidden(_ name: String) -> Bool {
    name.hasPrefix(".") || name == "NSFileProviderTrashContainerItemIdentifier"
  }
}

final class HermesFileProvider: NSObject, NSFileProviderReplicatedExtension {
  let domain: NSFileProviderDomain
  private static let folders = ["uploads", "workspace", "memory", "skills"]

  static var root: URL {
    let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: hermesFileProviderGroup) ?? FileManager.default.temporaryDirectory
    let root = container
      .appendingPathComponent("HermesFiles", isDirectory: true)
      .appendingPathComponent(ownerComponent(), isDirectory: true)
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    folders.forEach { try? FileManager.default.createDirectory(at: root.appendingPathComponent($0, isDirectory: true), withIntermediateDirectories: true) }
    return root
  }

  private static func ownerComponent() -> String {
    let owner = (UserDefaults(suiteName: hermesFileProviderGroup)?.string(forKey: hermesFileProviderOwnerKey) ?? "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !owner.isEmpty else { return "anonymous" }
    return SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  required init(domain: NSFileProviderDomain) {
    self.domain = domain
    super.init()
    _ = Self.root
  }

  func invalidate() {}

  func item(for identifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest, completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) -> Progress {
    if identifier == .rootContainer { completionHandler(HermesFileProviderItem(url: Self.root, parent: .rootContainer, root: Self.root), nil); return Progress() }
    guard let url = safeURL(identifier.rawValue), FileManager.default.fileExists(atPath: url.path) else { completionHandler(nil, NSFileProviderError(.noSuchItem)); return Progress() }
    let parent = (identifier.rawValue as NSString).deletingLastPathComponent
    completionHandler(HermesFileProviderItem(url: url, parent: parent.isEmpty ? .rootContainer : NSFileProviderItemIdentifier(parent), root: Self.root), nil)
    return Progress()
  }

  func enumerator(for containerItemIdentifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest) throws -> NSFileProviderEnumerator {
    HermesFileProviderEnumerator(container: containerItemIdentifier, root: Self.root, recursive: containerItemIdentifier == .workingSet)
  }

  func fetchContents(for itemIdentifier: NSFileProviderItemIdentifier, version requestedVersion: NSFileProviderItemVersion?, request: NSFileProviderRequest, completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void) -> Progress {
    guard let source = safeURL(itemIdentifier.rawValue), FileManager.default.fileExists(atPath: source.path) else { completionHandler(nil, nil, NSFileProviderError(.noSuchItem)); return Progress() }
    let destination = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent(source.lastPathComponent)
    do {
      try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
      try FileManager.default.copyItem(at: source, to: destination)
      let relativeParent = (itemIdentifier.rawValue as NSString).deletingLastPathComponent
      let parent = relativeParent.isEmpty ? NSFileProviderItemIdentifier.rootContainer : NSFileProviderItemIdentifier(relativeParent)
      completionHandler(destination, HermesFileProviderItem(url: source, parent: parent, root: Self.root), nil)
    } catch { completionHandler(nil, nil, error) }
    return Progress()
  }

  func createItem(basedOn itemTemplate: NSFileProviderItem, fields: NSFileProviderItemFields, contents url: URL?, options: NSFileProviderCreateItemOptions = [], request: NSFileProviderRequest, completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
    guard writable(itemTemplate.parentItemIdentifier.rawValue), let parent = safeURL(itemTemplate.parentItemIdentifier.rawValue), safeName(itemTemplate.filename) else { completionHandler(nil, [], false, NSFileProviderError(.noSuchItem)); return Progress() }
    let destination = parent.appendingPathComponent(itemTemplate.filename)
    do {
      if itemTemplate.contentType == .folder { try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true) }
      else if let url { try FileManager.default.copyItem(at: url, to: destination) }
      completionHandler(HermesFileProviderItem(url: destination, parent: itemTemplate.parentItemIdentifier, root: Self.root), [], false, nil)
      signal(itemTemplate.parentItemIdentifier)
    } catch { completionHandler(nil, [], false, error) }
    return Progress()
  }

  func modifyItem(_ item: NSFileProviderItem, baseVersion version: NSFileProviderItemVersion, changedFields: NSFileProviderItemFields, contents newContents: URL?, options: NSFileProviderModifyItemOptions = [], request: NSFileProviderRequest, completionHandler: @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void) -> Progress {
    guard writable(item.itemIdentifier.rawValue), let source = safeURL(item.itemIdentifier.rawValue) else { completionHandler(nil, [], false, NSFileProviderError(.noSuchItem)); return Progress() }
    let oldParent = item.parentItemIdentifier
    do {
      var destination = source
      if changedFields.contains(.filename) || changedFields.contains(.parentItemIdentifier) {
        guard safeName(item.filename), writable(item.parentItemIdentifier.rawValue), let parent = safeURL(item.parentItemIdentifier.rawValue) else { throw NSFileProviderError(.noSuchItem) }
        destination = parent.appendingPathComponent(item.filename)
        if source != destination { try FileManager.default.moveItem(at: source, to: destination) }
      }
      if changedFields.contains(.contents), let newContents {
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.copyItem(at: newContents, to: destination)
      }
      completionHandler(HermesFileProviderItem(url: destination, parent: item.parentItemIdentifier, root: Self.root), [], false, nil)
      // A move invalidates both enumerators. Without the old-parent signal,
      // Files can keep rendering a stale entry until the user manually
      // refreshes the provider.
      signal(oldParent)
      let newParentPath = (destination.path.replacingOccurrences(of: Self.root.path, with: "").trimmingCharacters(in: CharacterSet(charactersIn: "/")) as NSString).deletingLastPathComponent
      let newParent = newParentPath.isEmpty ? NSFileProviderItemIdentifier.rootContainer : NSFileProviderItemIdentifier(newParentPath)
      if newParent.rawValue != oldParent.rawValue { signal(newParent) }
    } catch { completionHandler(nil, [], false, error) }
    return Progress()
  }

  func deleteItem(identifier: NSFileProviderItemIdentifier, baseVersion version: NSFileProviderItemVersion, options: NSFileProviderDeleteItemOptions = [], request: NSFileProviderRequest, completionHandler: @escaping (Error?) -> Void) -> Progress {
    guard writable(identifier.rawValue), identifier.rawValue != "uploads", identifier.rawValue != "workspace",
          let url = safeURL(identifier.rawValue) else { completionHandler(NSFileProviderError(.noSuchItem)); return Progress() }
    do { try FileManager.default.removeItem(at: url); completionHandler(nil); signal(NSFileProviderItemIdentifier((identifier.rawValue as NSString).deletingLastPathComponent)) }
    catch { completionHandler(error) }
    return Progress()
  }

  private func safeURL(_ relative: String) -> URL? {
    let normalized = relative.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard !normalized.isEmpty, !normalized.contains(".."), !normalized.contains("\\"), !normalized.contains(":"), normalized.split(separator: "/").allSatisfy({ !$0.isEmpty }) else { return nil }
    let url = Self.root.appendingPathComponent(normalized)
    let rootPath = Self.root.resolvingSymlinksInPath().path
    let resolvedPath = url.resolvingSymlinksInPath().path
    guard resolvedPath.hasPrefix(rootPath + "/") else { return nil }
    return url
  }

  private func safeName(_ name: String) -> Bool {
    !name.isEmpty && name.count <= 255 && !name.contains("/") && !name.contains("\\") && name != "." && name != ".."
  }

  private func writable(_ id: String) -> Bool {
    let top = id.split(separator: "/").first.map(String.init) ?? ""
    return top == "uploads" || top == "workspace"
  }

  private func signal(_ identifier: NSFileProviderItemIdentifier) {
    NSFileProviderManager(for: domain)?.signalEnumerator(for: identifier) { _ in }
  }
}
