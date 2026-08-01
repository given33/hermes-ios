import CryptoKit
import Foundation
import WebKit

enum HermesBrowserServiceError: LocalizedError {
  case invalidInput(String)
  case unavailable(String)
  case navigationFailed(String)
  case javascriptFailed(String)

  var errorDescription: String? {
    switch self {
    case .invalidInput(let field): return "\(field) is invalid."
    case .unavailable(let capability): return "\(capability) is unavailable."
    case .navigationFailed(let reason): return "Browser navigation failed: \(reason)"
    case .javascriptFailed(let reason): return "Browser JavaScript failed: \(reason)"
    }
  }
}

/// A small, session-safe WKWebView runtime for agent actions.
///
/// The service intentionally keeps browser state in-process and keyed by tab
/// id. It is not a general-purpose embedded browser: every operation is
/// bounded, validates its input, and returns serializable metadata so the
/// durable iOS command relay can retry without serializing WKWebView objects.
@MainActor
final class HermesBrowserService: NSObject, WKNavigationDelegate, WKUIDelegate {
  static let shared = HermesBrowserService()

  private struct Tab {
    let id: Int
    let webView: WKWebView
    let ownerKey: String
    var createdAt: Date
    var lastUsedAt: Date
  }

  private let processPool = WKProcessPool()
  private var tabs: [Int: Tab] = [:]
  private var nextTabID = 0
  private var navigationWaiters: [ObjectIdentifier: CheckedContinuation<Void, Error>] = [:]
  private var navigationTimeouts: [ObjectIdentifier: Task<Void, Never>] = [:]
  private let maxTabsPerOwner = 4
  private let maxTotalTabs = 16
  private let maxTextBytes = 200_000
  private let maxScriptBytes = 200_000
  private let maxFetchBytes = 10 * 1024 * 1024

  private override init() {
    super.init()
  }

  nonisolated static func capabilities() -> [String: Any] {
    [
      "available": true,
      "actions": [
        "navigate", "screenshot", "click", "type", "get_text", "scroll",
        "get_page_info", "execute_js", "find_elements", "hover", "get_readable",
        "set_user_agent", "set_viewport", "get_backbone", "fetch", "new_tab",
        "close_tab", "list_tabs", "get_cookies", "set_cookies",
        "scroll_and_collect", "wait_for_dom_stable",
      ],
      "maxTabs": 4,
      "maxTotalTabs": 16,
      "maxScriptBytes": 200_000,
      "maxFetchBytes": 10 * 1024 * 1024,
    ]
  }

  func execute(
    ownerScope: String,
    action: String,
    payload: [String: Any],
    includeBase64: Bool = false
  ) async throws -> [String: Any] {
    let owner = ownerScope.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !owner.isEmpty, owner.count <= 256 else {
      throw HermesBrowserServiceError.invalidInput("ownerScope")
    }
    let normalizedAction = action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard Self.actions.contains(normalizedAction) else {
      throw HermesBrowserServiceError.invalidInput("action")
    }

    switch normalizedAction {
    case "navigate":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let url = try validatedURL(payload["url"])
      try await load(url: url, in: tab.webView)
      touch(tabID: tab.id)
      return try await pageInfo(tab: tab)
    case "screenshot":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let image = try await snapshot(tab: tab)
      return try persistScreenshot(image, ownerScope: owner, includeBase64: includeBase64, tabID: tab.id)
    case "get_text":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      return ["text": try await boundedText(evaluate(tab.webView, script: "document.body ? document.body.innerText : (document.documentElement ? document.documentElement.innerText : '')")), "url": tab.webView.url?.absoluteString ?? "", "tabID": tab.id]
    case "get_readable":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let script = """
      (() => { const root = document.body || document.documentElement; if (!root) return ''; const clone = root.cloneNode(true); clone.querySelectorAll('script,style,noscript,template,svg').forEach(e => e.remove()); return clone.innerText || clone.textContent || ''; })()
      """
      return ["text": try await boundedText(evaluate(tab.webView, script: script)), "url": tab.webView.url?.absoluteString ?? "", "tabID": tab.id]
    case "get_page_info":
      return try await pageInfo(tab: tab(for: payload, ownerKey: ownerKey(owner)))
    case "execute_js":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let script = try requiredString(payload["script"], field: "script", max: maxScriptBytes)
      let value = try await evaluate(tab.webView, script: script)
      return ["value": Self.serializable(value), "url": tab.webView.url?.absoluteString ?? "", "tabID": tab.id]
    case "click":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let selector = try requiredString(payload["selector"], field: "selector", max: 2_000)
      let script = """
      (() => { const el = document.querySelector(\(Self.jsString(selector))); if (!el) return false; el.scrollIntoView({block:'center',inline:'center'}); el.click(); return true; })()
      """
      guard try await boolResult(evaluate(tab.webView, script: script)) else { throw HermesBrowserServiceError.unavailable("selector") }
      return ["clicked": true, "selector": selector, "tabID": tab.id]
    case "type":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let selector = try requiredString(payload["selector"], field: "selector", max: 2_000)
      let text = try requiredString(payload["text"], field: "text", max: 20_000)
      let script = """
      (() => { const el = document.querySelector(\(Self.jsString(selector))); if (!el) return false; el.focus(); const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set; if (setter) setter.call(el, \(Self.jsString(text))); else el.value = \(Self.jsString(text)); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()
      """
      guard try await boolResult(evaluate(tab.webView, script: script)) else { throw HermesBrowserServiceError.unavailable("selector") }
      return ["typed": true, "selector": selector, "length": text.count, "tabID": tab.id]
    case "hover":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let selector = try requiredString(payload["selector"], field: "selector", max: 2_000)
      let script = """
      (() => { const el = document.querySelector(\(Self.jsString(selector))); if (!el) return false; ['pointerover','mouseover','mouseenter'].forEach(t => el.dispatchEvent(new MouseEvent(t,{bubbles:true,view:window}))); return true; })()
      """
      guard try await boolResult(evaluate(tab.webView, script: script)) else { throw HermesBrowserServiceError.unavailable("selector") }
      return ["hovered": true, "selector": selector, "tabID": tab.id]
    case "find_elements":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let selector = try requiredString(payload["selector"], field: "selector", max: 2_000)
      let limit = min(max(Self.intValue(payload["limit"]) ?? 50, 1), 100)
      let script = """
      (() => Array.from(document.querySelectorAll(\(Self.jsString(selector))).slice(0,\(limit)).map((el,i) => ({index:i,tag:el.tagName.toLowerCase(),text:(el.innerText||el.textContent||'').trim().slice(0,500),aria:el.getAttribute('aria-label'),href:el.href||null})))()
      """
      return ["elements": Self.serializableArray(try await evaluate(tab.webView, script: script)), "selector": selector, "tabID": tab.id]
    case "scroll":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let direction = (payload["direction"] as? String)?.lowercased() == "up" ? -1 : 1
      let amount = min(max(Self.intValue(payload["amount"]) ?? 600, 1), 10_000)
      _ = try await evaluate(tab.webView, script: "window.scrollBy({top:\(direction * amount),left:0,behavior:'instant'}); true")
      return ["scrolled": true, "direction": direction < 0 ? "up" : "down", "amount": amount, "tabID": tab.id]
    case "scroll_and_collect":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      return try await scrollAndCollect(tab: tab, payload: payload)
    case "get_backbone":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let depth = min(max(Self.intValue(payload["max_depth"]) ?? 3, 1), 8)
      let script = """
      (() => { const out=[]; const walk=(el,d) => { if (!el || d>\(depth) || out.length>=200) return; const r=el.getBoundingClientRect(); const text=(el.innerText||el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,160); if (text || el.tagName==='A' || el.tagName==='BUTTON' || el.tagName==='INPUT') out.push({depth:d,tag:el.tagName.toLowerCase(),text,role:el.getAttribute('role'),href:el.href||null,rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}}); Array.from(el.children).slice(0,80).forEach(c=>walk(c,d+1)); }; walk(document.body,0); return out; })()
      """
      return ["nodes": Self.serializableArray(try await evaluate(tab.webView, script: script)), "tabID": tab.id]
    case "set_user_agent":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let ua = try requiredString(payload["user_agent"] ?? payload["userAgent"], field: "user_agent", max: 1_000)
      tab.webView.customUserAgent = ua
      return ["userAgent": ua, "tabID": tab.id]
    case "set_viewport":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let width = min(max(Self.intValue(payload["width"] ?? payload["viewport_width"]) ?? 390, 100), 2_000)
      let height = min(max(Self.intValue(payload["height"] ?? payload["viewport_height"]) ?? 844, 100), 2_000)
      tab.webView.frame = CGRect(x: 0, y: 0, width: width, height: height)
      return ["width": width, "height": height, "tabID": tab.id]
    case "fetch":
      return try await fetch(ownerScope: owner, payload: payload)
    case "new_tab":
      let tab = try createTab(ownerKey: ownerKey(owner))
      if payload["url"] != nil { try await load(url: validatedURL(payload["url"]), in: tab.webView) }
      return ["tabID": tab.id, "url": tab.webView.url?.absoluteString ?? "", "tabs": tabSummaries(ownerKey: ownerKey(owner))]
    case "close_tab":
      let id = try requiredInt(payload["tab_id"] ?? payload["tabID"], field: "tab_id")
      guard let tab = tabs[id], tab.ownerKey == ownerKey(owner) else { throw HermesBrowserServiceError.unavailable("tab") }
      tabs.removeValue(forKey: id)
      return ["closed": true, "tabID": id, "tabs": tabSummaries(ownerKey: ownerKey(owner))]
    case "list_tabs":
      return ["tabs": tabSummaries(ownerKey: ownerKey(owner))]
    case "get_cookies":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      return ["cookies": try await cookies(for: tab.webView), "tabID": tab.id]
    case "set_cookies":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      guard let raw = payload["cookies"] as? [[String: Any]], !raw.isEmpty, raw.count <= 100 else { throw HermesBrowserServiceError.invalidInput("cookies") }
      let count = try await setCookies(raw, for: tab.webView)
      return ["written": count, "tabID": tab.id]
    case "wait_for_dom_stable":
      let tab = try tab(for: payload, ownerKey: ownerKey(owner))
      let timeout = min(max(Self.intValue(payload["timeout"]) ?? 5, 1), 10)
      let stable = try await waitForStableDOM(tab: tab, timeout: timeout)
      return ["stable": stable, "tabID": tab.id]
    default:
      throw HermesBrowserServiceError.invalidInput("action")
    }
  }

  static let actions: Set<String> = [
    "navigate", "screenshot", "click", "type", "get_text", "scroll", "get_page_info",
    "execute_js", "find_elements", "hover", "get_readable", "set_user_agent", "set_viewport",
    "get_backbone", "fetch", "new_tab", "close_tab", "list_tabs", "get_cookies", "set_cookies",
    "scroll_and_collect", "wait_for_dom_stable",
  ]

  private func createTab(ownerKey: String) throws -> Tab {
    guard tabs.count < maxTotalTabs else { throw HermesBrowserServiceError.unavailable("max-total-tabs") }
    guard tabs.values.filter({ $0.ownerKey == ownerKey }).count < maxTabsPerOwner else {
      throw HermesBrowserServiceError.unavailable("max-tabs")
    }
    let configuration = WKWebViewConfiguration()
    configuration.processPool = processPool
    // Keep cookies and website data isolated from the user's normal Safari
    // store. Tabs are additionally checked against their owner scope below.
    configuration.websiteDataStore = .nonPersistent()
    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: configuration)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.isHidden = true
    let now = Date()
    let tab = Tab(id: nextTabID, webView: webView, ownerKey: ownerKey, createdAt: now, lastUsedAt: now)
    nextTabID += 1
    tabs[tab.id] = tab
    return tab
  }

  private func tab(for payload: [String: Any], ownerKey: String) throws -> Tab {
    if let raw = payload["tab_id"] ?? payload["tabID"], let id = Self.intValue(raw), let tab = tabs[id] {
      guard tab.ownerKey == ownerKey else { throw HermesBrowserServiceError.unavailable("tab") }
      touch(tabID: id)
      return tab
    }
    if let existing = tabs.values.filter({ $0.ownerKey == ownerKey }).sorted(by: { $0.lastUsedAt > $1.lastUsedAt }).first {
      touch(tabID: existing.id)
      return existing
    }
    return try createTab(ownerKey: ownerKey)
  }

  private func ownerKey(_ ownerScope: String) -> String {
    SHA256.hash(data: Data(ownerScope.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func touch(tabID: Int) {
    guard var tab = tabs[tabID] else { return }
    tab.lastUsedAt = Date()
    tabs[tabID] = tab
  }

  private func validatedURL(_ raw: Any?) throws -> URL {
    guard let value = raw as? String, value.count <= 4_096, let url = URL(string: value),
          let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
          url.host != nil else { throw HermesBrowserServiceError.invalidInput("url") }
    return url
  }

  private func requiredString(_ raw: Any?, field: String, max: Int) throws -> String {
    guard let value = raw as? String else { throw HermesBrowserServiceError.invalidInput(field) }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= max else { throw HermesBrowserServiceError.invalidInput(field) }
    return trimmed
  }

  private func requiredInt(_ raw: Any?, field: String) throws -> Int {
    guard let value = Self.intValue(raw) else { throw HermesBrowserServiceError.invalidInput(field) }
    return value
  }

  private static func intValue(_ raw: Any?) -> Int? {
    if let value = raw as? Int { return value }
    if let value = raw as? NSNumber { return value.intValue }
    if let value = raw as? String { return Int(value) }
    return nil
  }

  private func load(url: URL, in webView: WKWebView) async throws {
    let key = ObjectIdentifier(webView)
    if let timeout = navigationTimeouts.removeValue(forKey: key) { timeout.cancel() }
    if let waiter = navigationWaiters.removeValue(forKey: key) {
      waiter.resume(throwing: HermesBrowserServiceError.navigationFailed("superseded"))
    }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      navigationWaiters[key] = continuation
      navigationTimeouts[key] = Task { [weak self, weak webView] in
        try? await Task.sleep(nanoseconds: 30_000_000_000)
        guard !Task.isCancelled else { return }
        await MainActor.run {
          guard let self, let webView, let waiter = self.navigationWaiters.removeValue(forKey: ObjectIdentifier(webView)) else { return }
          self.navigationTimeouts.removeValue(forKey: ObjectIdentifier(webView))?.cancel()
          waiter.resume(throwing: HermesBrowserServiceError.navigationFailed("timed out after 30s"))
        }
      }
      webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
    }
  }

  private func evaluate(_ webView: WKWebView, script: String) async throws -> Any? {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any?, Error>) in
      webView.evaluateJavaScript(script) { value, error in
        if let error { continuation.resume(throwing: HermesBrowserServiceError.javascriptFailed(error.localizedDescription)) }
        else { continuation.resume(returning: value) }
      }
    }
  }

  private func pageInfo(tab: Tab) async throws -> [String: Any] {
    let data = try await evaluate(tab.webView, script: "({title:document.title||'',url:location.href,readyState:document.readyState,viewport:{width:innerWidth,height:innerHeight,scrollX:scrollX,scrollY:scrollY,scrollHeight:document.documentElement?document.documentElement.scrollHeight:0}})")
    return ["page": Self.serializable(data), "tabID": tab.id]
  }

  private func boolResult(_ value: Any?) -> Bool {
    if let bool = value as? Bool { return bool }
    if let number = value as? NSNumber { return number.boolValue }
    return false
  }

  private func boundedText(_ value: Any?) throws -> String {
    let text = (value as? String) ?? String(describing: value ?? "")
    guard text.utf8.count <= maxTextBytes else { return String(decoding: text.utf8.prefix(maxTextBytes), as: UTF8.self) }
    return text
  }

  private func snapshot(tab: Tab) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
      let configuration = WKSnapshotConfiguration()
      tab.webView.takeSnapshot(with: configuration) { image, error in
        if let error { continuation.resume(throwing: error); return }
        guard let image, let data = image.jpegData(compressionQuality: 0.8) else {
          continuation.resume(throwing: HermesBrowserServiceError.unavailable("screenshot")); return
        }
        continuation.resume(returning: data)
      }
    }
  }

  private func persistScreenshot(_ data: Data, ownerScope: String, includeBase64: Bool, tabID: Int) throws -> [String: Any] {
    let digest = SHA256.hash(data: Data(ownerScope.utf8)).map { String(format: "%02x", $0) }.joined()
    let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("HermesBrowser", isDirectory: true)
      .appendingPathComponent(digest, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let name = "screenshot-\(Int(Date().timeIntervalSince1970 * 1000))-\(tabID).jpg"
    let destination = root.appendingPathComponent(name)
    try data.write(to: destination, options: .atomic)
    var result: [String: Any] = ["saved": true, "path": destination.path, "bytes": data.count, "tabID": tabID]
    if includeBase64 { result["base64"] = data.base64EncodedString() }
    return result
  }

  private func fetch(ownerScope: String, payload: [String: Any]) async throws -> [String: Any] {
    let url = try validatedURL(payload["url"])
    var request = URLRequest(url: url, timeoutInterval: 30)
    request.httpMethod = (payload["method"] as? String)?.uppercased() ?? "GET"
    guard ["GET", "HEAD"].contains(request.httpMethod ?? "GET") else { throw HermesBrowserServiceError.invalidInput("method") }
    let (bytes, response) = try await URLSession.shared.bytes(for: request)
    if response.expectedContentLength > Int64(maxFetchBytes) {
      throw HermesBrowserServiceError.unavailable("fetch-size-limit")
    }
    var data = Data()
    if response.expectedContentLength > 0 {
      data.reserveCapacity(min(maxFetchBytes, Int(response.expectedContentLength)))
    }
    for try await byte in bytes {
      data.append(byte)
      if data.count > maxFetchBytes {
        throw HermesBrowserServiceError.unavailable("fetch-size-limit")
      }
    }
    let digest = SHA256.hash(data: Data(ownerScope.utf8)).map { String(format: "%02x", $0) }.joined()
    let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("HermesBrowser", isDirectory: true).appendingPathComponent(digest, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let filename = (url.lastPathComponent.isEmpty ? "response" : url.lastPathComponent).replacingOccurrences(of: "/", with: "_").prefix(120)
    let destination = root.appendingPathComponent(String(filename))
    try data.write(to: destination, options: .atomic)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    return ["url": url.absoluteString, "status": status, "bytes": data.count, "path": destination.path]
  }

  private func cookies(for webView: WKWebView) async throws -> [[String: Any]] {
    try await withCheckedThrowingContinuation { continuation in
      webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
        continuation.resume(returning: cookies.map(Self.cookieDictionary))
      }
    }
  }

  private func setCookies(_ raw: [[String: Any]], for webView: WKWebView) async throws -> Int {
    let store = webView.configuration.websiteDataStore.httpCookieStore
    var written = 0
    for item in raw {
      guard let name = item["name"] as? String, !name.isEmpty,
            let value = item["value"] as? String,
            let url = webView.url else { throw HermesBrowserServiceError.invalidInput("cookies") }
      let properties = Self.cookieProperties(item, name: name, value: value, url: url)
      guard let cookie = HTTPCookie(properties: properties) else { throw HermesBrowserServiceError.invalidInput("cookies") }
      try await withCheckedThrowingContinuation { continuation in
        store.setCookie(cookie) { continuation.resume() }
      }
      written += 1
    }
    return written
  }

  private static func cookieProperties(_ item: [String: Any], name: String, value: String, url: URL) -> [HTTPCookiePropertyKey: Any] {
    var result: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .path: (item["path"] as? String) ?? "/", .domain: (item["domain"] as? String) ?? (url.host ?? "")]
    if let secure = item["secure"] as? Bool, secure { result[.secure] = "TRUE" }
    if let expires = item["expires"] as? NSNumber { result[.expires] = Date(timeIntervalSince1970: expires.doubleValue) }
    return result
  }

  private static func cookieDictionary(_ cookie: HTTPCookie) -> [String: Any] {
    ["name": cookie.name, "value": cookie.value, "domain": cookie.domain, "path": cookie.path, "secure": cookie.isSecure, "expires": cookie.expiresDate?.timeIntervalSince1970 as Any]
  }

  private func scrollAndCollect(tab: Tab, payload: [String: Any]) async throws -> [String: Any] {
    let count = min(max(Self.intValue(payload["scroll_count"]) ?? 3, 1), 20)
    let amount = min(max(Self.intValue(payload["amount"]) ?? 700, 1), 10_000)
    let selector: String?
    if payload["item_selector"] == nil {
      selector = nil
    } else {
      selector = try requiredString(payload["item_selector"], field: "item_selector", max: 2_000)
    }
    var values: [String] = []
    for _ in 0..<count {
      let script = selector.map { value in "Array.from(document.querySelectorAll(\(Self.jsString(value)))).map(e => (e.innerText||e.textContent||'').trim()).filter(Boolean).slice(0,100)" } ?? "[(document.body?document.body.innerText:'').slice(0,\(maxTextBytes))]"
      values.append(contentsOf: Self.serializableArray(try await evaluate(tab.webView, script: script)).compactMap { $0 as? String })
      _ = try await evaluate(tab.webView, script: "window.scrollBy({top:\(amount),behavior:'instant'}); true")
      try await Task.sleep(nanoseconds: 120_000_000)
    }
    var seen = Set<String>()
    let unique = values.filter { !$0.isEmpty && seen.insert($0).inserted }
    return ["items": Array(unique.prefix(200)), "count": min(unique.count, 200), "tabID": tab.id]
  }

  private func waitForStableDOM(tab: Tab, timeout: Int) async throws -> Bool {
    var previous = ""
    var stable = 0
    let deadline = Date().addingTimeInterval(TimeInterval(timeout))
    while Date() < deadline {
      let value = try await evaluate(tab.webView, script: "(document.body ? document.body.innerText : '').slice(0,\(maxTextBytes))")
      let current = String(describing: value ?? "")
      if current == previous { stable += 1 } else { stable = 0; previous = current }
      if stable >= 2 { return true }
      try await Task.sleep(nanoseconds: 250_000_000)
    }
    return false
  }

  private func tabSummaries(ownerKey: String) -> [[String: Any]] {
    tabs.values.filter { $0.ownerKey == ownerKey }.sorted { $0.id < $1.id }.map { tab in
      ["tabID": tab.id, "url": tab.webView.url?.absoluteString ?? "", "title": tab.webView.title ?? "", "createdAt": tab.createdAt.timeIntervalSince1970 * 1000]
    }
  }

  nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    Task { @MainActor in
      let key = ObjectIdentifier(webView)
      self.navigationTimeouts.removeValue(forKey: key)?.cancel()
      if let waiter = self.navigationWaiters.removeValue(forKey: key) { waiter.resume() }
    }
  }

  nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    Task { @MainActor in
      let key = ObjectIdentifier(webView)
      self.navigationTimeouts.removeValue(forKey: key)?.cancel()
      if let waiter = self.navigationWaiters.removeValue(forKey: key) { waiter.resume(throwing: HermesBrowserServiceError.navigationFailed(error.localizedDescription)) }
    }
  }

  nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    Task { @MainActor in
      let key = ObjectIdentifier(webView)
      self.navigationTimeouts.removeValue(forKey: key)?.cancel()
      if let waiter = self.navigationWaiters.removeValue(forKey: key) { waiter.resume(throwing: HermesBrowserServiceError.navigationFailed(error.localizedDescription)) }
    }
  }

  nonisolated func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    Task { @MainActor in
      let sourceOwner = self.tabs.values.first(where: { $0.webView === navigationAction.sourceFrame.webView })?.ownerKey ?? "popup"
      guard let tab = try? self.createTab(ownerKey: sourceOwner) else { return }
      tab.webView.load(navigationAction.request)
    }
    return nil
  }

  private static func jsString(_ value: String) -> String {
    let data = try? JSONSerialization.data(withJSONObject: value)
    return data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
  }

  private static func serializable(_ value: Any?) -> Any {
    if let value = value as? [Any] { return value.map { serializable($0) } }
    if let value = value as? [String: Any] { return value.mapValues { serializable($0) } }
    if value is NSNull { return NSNull() }
    if let value { return value }
    return NSNull()
  }

  private static func serializableArray(_ value: Any?) -> [Any] {
    if let array = value as? [Any] { return array.map { serializable($0) } }
    return []
  }
}
