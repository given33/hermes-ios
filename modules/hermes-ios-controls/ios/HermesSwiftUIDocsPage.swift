import SwiftUI

private struct HermesDocEntry: Identifiable {
  let id: String
  let section: String
  let title: String
  let content: String
}

struct HermesDocsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var search = ""

  private var documents: [HermesDocEntry] {
    [
      HermesDocEntry(
        id: "overview",
        section: chinese ? "开始使用" : "Getting Started",
        title: chinese ? "Hermes Agent 概览" : "Hermes Agent Overview",
        content: chinese ? "Hermes 是可扩展的自主 Agent。原生 iOS 前端使用相同的信息结构和服务器能力。" : "Hermes is an extensible autonomous agent. The native iOS frontend uses the same information structure and server capabilities."
      ),
      HermesDocEntry(
        id: "auth",
        section: chinese ? "开始使用" : "Getting Started",
        title: chinese ? "连接与认证" : "Connection and Authentication",
        content: chinese ? "连接凭据保存在系统安全存储中；首次登录后会自动恢复会话。" : "Connection credentials live in secure system storage; the session restores automatically after the first login."
      ),
      HermesDocEntry(
        id: "tasks",
        section: chinese ? "功能" : "Features",
        title: chinese ? "会话与任务" : "Sessions and Tasks",
        content: chinese ? "任务由服务器继续执行。重新打开 App 后恢复完整过程和结果。" : "Tasks continue on the server. Reopening the app restores the complete process and result."
      ),
      HermesDocEntry(
        id: "extensions",
        section: chinese ? "功能" : "Features",
        title: chinese ? "技能、插件与 MCP" : "Skills, Plugins, and MCP",
        content: chinese ? "能力通过服务器清单组合，所有设备数据仍受 iOS 系统权限控制。" : "Capabilities compose from server manifests while device data remains protected by iOS system permissions."
      )
    ]
  }

  private var filteredDocuments: [HermesDocEntry] {
    guard !search.isEmpty else { return documents }
    return documents.filter {
      $0.title.localizedCaseInsensitiveContains(search)
        || $0.content.localizedCaseInsensitiveContains(search)
        || $0.section.localizedCaseInsensitiveContains(search)
    }
  }

  var body: some View {
    List {
      ForEach([chinese ? "开始使用" : "Getting Started", chinese ? "功能" : "Features"], id: \.self) { section in
        let entries = filteredDocuments.filter { $0.section == section }
        if !entries.isEmpty {
          Section(section) {
            ForEach(entries) { document in
              HermesDocDisclosure(title: document.title, content: document.content)
            }
          }
        }
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .searchable(text: $search, prompt: chinese ? "搜索文档" : "Search documentation")
  }
}

private struct HermesDocDisclosure: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let title: String
  let content: String
  @State private var expanded = false

  var body: some View {
    DisclosureGroup(isExpanded: $expanded) {
      Text(content)
        .font(HermesFonts.body(14))
        .foregroundStyle(appearance.palette.secondary)
        .padding(.vertical, 8)
        .textSelection(.enabled)
    } label: {
      Text(title).font(HermesFonts.bodyBold(15))
    }
    .animation(.spring(response: 0.34, dampingFraction: 0.88), value: expanded)
  }
}
