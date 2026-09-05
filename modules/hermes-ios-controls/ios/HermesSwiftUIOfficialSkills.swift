import Foundation
import SwiftUI

struct HermesSkillHubSourceRows: View {
  let json: String

  private struct Source: Decodable, Identifiable {
    let id: String
    let label: String?
  }
  private struct Catalog: Decodable { let sources: [Source]? }

  var body: some View {
    let catalog = json.data(using: .utf8).flatMap { try? JSONDecoder().decode(Catalog.self, from: $0) }
    ForEach(catalog?.sources ?? []) { source in
      Label(source.label ?? source.id, systemImage: "shippingbox")
        .font(HermesFonts.body(13))
    }
  }
}

private struct HermesOfficialSkill: Decodable, Identifiable {
  let identifier: String
  let name: String
  let description: String
  let category: String
  let installed: Bool
  var id: String { identifier }
}

struct HermesOfficialSkillsSection: View {
  let chinese: Bool
  let onAction: HermesRouteActionSink
  private let skills: [HermesOfficialSkill]
  private let unavailable: Bool
  @State private var query = ""

  init(json: String?, chinese: Bool, onAction: @escaping HermesRouteActionSink) {
    self.chinese = chinese
    self.onAction = onAction
    struct Catalog: Decodable {
      let skills: [HermesOfficialSkill]?
      let unavailable: Bool?
    }
    struct Sources: Decodable { let official: Catalog? }
    let source = json?.data(using: .utf8).flatMap { try? JSONDecoder().decode(Sources.self, from: $0) }
    skills = source?.official?.skills ?? []
    unavailable = source?.official?.unavailable == true || source?.official?.skills == nil
  }

  var body: some View {
    Section(chinese ? "官方可选 Skills" : "Official optional skills") {
      if unavailable {
        Label(chinese ? "官方目录加载失败" : "Official catalog unavailable", systemImage: "exclamationmark.circle")
      } else {
        TextField(chinese ? "筛选官方 Skills" : "Filter official skills", text: $query)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
        let filtered = skills.filter { query.isEmpty || "\($0.name) \($0.description) \($0.category)".localizedCaseInsensitiveContains(query) }
        ForEach(filtered) { skill in
          DisclosureGroup {
            Text(skill.description).font(HermesFonts.body(12)).textSelection(.enabled)
            Text(skill.identifier).font(HermesFonts.mono(11)).textSelection(.enabled)
            Button {
              onAction(.skillHubPreview, HermesRouteActionPayload(route: "skills", value: skill.identifier))
            } label: { Label(chinese ? "预览" : "Preview", systemImage: "doc.text.magnifyingglass") }
            Button {
              onAction(.skillHubScan, HermesRouteActionPayload(route: "skills", value: skill.identifier))
            } label: { Label(chinese ? "扫描" : "Scan", systemImage: "checkmark.shield") }
            if !skill.installed {
              Button {
                onAction(.skillHubInstall, HermesRouteActionPayload(route: "skills", value: skill.identifier))
              } label: { Label(chinese ? "安装" : "Install", systemImage: "arrow.down.circle") }
            }
          } label: {
            VStack(alignment: .leading, spacing: 4) {
              Text(skill.name).font(HermesFonts.bodyBold(13))
              Text(skill.category).font(HermesFonts.body(11)).foregroundStyle(.secondary)
              if skill.installed {
                Label(chinese ? "已安装" : "Installed", systemImage: "checkmark.circle")
                  .font(HermesFonts.body(11)).foregroundStyle(.secondary)
              }
            }
          }
        }
        if filtered.isEmpty {
          Text(chinese ? "没有匹配的 Skills" : "No matching skills").foregroundStyle(.secondary)
        }
      }
    }
  }
}
