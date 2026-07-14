import SwiftUI

struct HermesCronJob: Identifiable {
  let id: String
  var name: String
  var schedule: String
  var prompt: String
  var enabled: Bool
  var lastRun: String
}

struct HermesCronPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var addOpen = false
  @State private var newName = ""
  @State private var newPrompt = ""
  @State private var newTime = Date()
  @State private var newEnabled = true
  @State private var jobs = [
    HermesCronJob(id: "summary", name: "Daily summary", schedule: "0 9 * * *", prompt: "Summarize active sessions and completed tasks.", enabled: true, lastRun: "2h ago"),
    HermesCronJob(id: "backup", name: "Workspace backup", schedule: "0 */6 * * *", prompt: "Create a workspace backup and report the result.", enabled: true, lastRun: "4h ago"),
    HermesCronJob(id: "audit", name: "Security audit", schedule: "0 3 * * 1", prompt: "Audit credentials and configuration changes.", enabled: false, lastRun: "6d ago")
  ]

  var body: some View {
    List {
      Section(chinese ? "计划任务" : "Scheduled Jobs") {
        ForEach($jobs) { $job in
          HStack(spacing: 12) {
            Image(systemName: "clock.arrow.circlepath")
              .foregroundStyle(job.enabled ? appearance.palette.accent : appearance.palette.tertiary)
              .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
              Text(job.name).font(HermesFonts.bodyBold(15))
              Text("\(job.schedule) · \(job.lastRun)")
                .font(HermesFonts.mono(10))
                .foregroundStyle(appearance.palette.secondary)
              Text(job.prompt)
                .font(HermesFonts.body(11))
                .foregroundStyle(appearance.palette.tertiary)
                .lineLimit(2)
            }
            Spacer()
            Toggle("", isOn: $job.enabled)
              .labelsHidden()
          }
          .padding(.vertical, 4)
          .swipeActions {
            Button(role: .destructive) {
              jobs.removeAll { $0.id == job.id }
            } label: {
              Label(chinese ? "删除" : "Delete", systemImage: "trash")
            }
            Button {
              job.lastRun = chinese ? "刚刚" : "just now"
            } label: {
              Label(chinese ? "立即运行" : "Run Now", systemImage: "play.fill")
            }
            .tint(appearance.palette.primary)
          }
        }
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        Button {
          addOpen = true
        } label: {
          Label(chinese ? "新建任务" : "New Job", systemImage: "plus")
        }
      }
    }
    .sheet(isPresented: $addOpen) {
      NavigationStack {
        Form {
          Section(chinese ? "任务" : "Job") {
            TextField(chinese ? "任务名称" : "Job name", text: $newName)
            DatePicker(
              chinese ? "运行时间" : "Run time",
              selection: $newTime,
              displayedComponents: .hourAndMinute
            )
            Toggle(chinese ? "启用" : "Enabled", isOn: $newEnabled)
          }
          Section(chinese ? "提示词" : "Prompt") {
            TextField(
              chinese ? "每次运行时让 Agent 做什么？" : "What should the agent do each time?",
              text: $newPrompt,
              axis: .vertical
            )
            .lineLimit(3...6)
          }
        }
        .navigationTitle(chinese ? "新建定时任务" : "New Cron Job")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(chinese ? "取消" : "Cancel") { addOpen = false }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(chinese ? "添加" : "Add") {
              let formatter = DateFormatter()
              formatter.dateFormat = "HH:mm"
              jobs.insert(HermesCronJob(
                id: UUID().uuidString,
                name: newName.isEmpty ? (chinese ? "新任务" : "New job") : newName,
                schedule: formatter.string(from: newTime),
                prompt: newPrompt.isEmpty
                  ? (chinese ? "执行计划任务" : "Run the scheduled task")
                  : newPrompt,
                enabled: newEnabled,
                lastRun: chinese ? "从未" : "never"
              ), at: 0)
              newName = ""
              newPrompt = ""
              addOpen = false
            }
          }
        }
      }
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
    }
  }
}

struct HermesSkill: Identifiable {
  let id: String
  let name: String
  let detail: String
  let bundled: Bool
  var enabled: Bool
}

struct HermesSkillsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var search = ""
  @State private var filter = "ALL"
  @State private var selectedSkill: HermesSkill?
  @State private var sourceSkill: HermesSkill?
  @State private var skillNotes: [String: String] = [:]
  @State private var skillSources: [String: String] = [:]
  @State private var skills = [
    HermesSkill(id: "browser", name: "Browser", detail: "Search and inspect web content", bundled: true, enabled: true),
    HermesSkill(id: "terminal", name: "Terminal", detail: "Execute commands and inspect workspaces", bundled: true, enabled: true),
    HermesSkill(id: "github", name: "GitHub", detail: "Issues, pull requests, and releases", bundled: false, enabled: true),
    HermesSkill(id: "notes", name: "Notes", detail: "Capture structured project notes", bundled: false, enabled: false)
  ]

  private var filtered: [HermesSkill] {
    skills.filter { skill in
      let matchesSearch = search.isEmpty || skill.name.localizedCaseInsensitiveContains(search)
      let matchesFilter = filter == "ALL"
        || (filter == "ENABLED" && skill.enabled)
        || (filter == "BUNDLED" && skill.bundled)
      return matchesSearch && matchesFilter
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      Picker(chinese ? "技能筛选" : "Skill filter", selection: $filter) {
        Text(chinese ? "全部" : "All").tag("ALL")
        Text(chinese ? "已启用" : "Enabled").tag("ENABLED")
        Text(chinese ? "内置" : "Bundled").tag("BUNDLED")
      }
      .pickerStyle(.segmented)
      .padding(12)

      List {
        ForEach(filtered) { skill in
          HStack(spacing: 12) {
            Image(systemName: skill.bundled ? "shippingbox.fill" : "shippingbox")
              .foregroundStyle(appearance.palette.accent)
              .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
              HStack {
                Text(skill.name).font(HermesFonts.bodyBold(15))
                if skill.bundled {
                  HermesStatusPill(text: chinese ? "内置" : "Bundled", color: appearance.palette.accent)
                }
              }
              Text(skill.detail)
                .font(HermesFonts.body(12))
                .foregroundStyle(appearance.palette.secondary)
            }
            Spacer()
            Toggle("", isOn: Binding(
              get: { skills.first { $0.id == skill.id }?.enabled ?? false },
              set: { value in
                if let index = skills.firstIndex(where: { $0.id == skill.id }) {
                  skills[index].enabled = value
                }
              }
            ))
            .labelsHidden()
          }
          .padding(.vertical, 4)
            .contextMenu {
              Button {
                selectedSkill = skill
              } label: {
              Label(chinese ? "编辑技能" : "Edit Skill", systemImage: "pencil")
            }
              Button {
                sourceSkill = skill
              } label: {
              Label(chinese ? "查看源文件" : "View Source", systemImage: "doc.text.magnifyingglass")
            }
          }
        }
      }
      .hermesListStyle()
    }
    .background(appearance.palette.background)
    .searchable(text: $search, prompt: chinese ? "搜索技能" : "Search skills")
    .sheet(item: $selectedSkill) { skill in
      HermesSkillSheet(
        skill: skill,
        chinese: chinese,
        showsSource: false,
        notes: skillTextBinding(for: skill, source: false)
      )
    }
    .sheet(item: $sourceSkill) { skill in
      HermesSkillSheet(
        skill: skill,
        chinese: chinese,
        showsSource: true,
        notes: skillTextBinding(for: skill, source: true)
      )
    }
  }

  private func skillTextBinding(for skill: HermesSkill, source: Bool) -> Binding<String> {
    Binding(
      get: {
        if source {
          return skillSources[skill.id] ?? "# \(skill.name)\n\n\(skill.detail)\n"
        }
        return skillNotes[skill.id] ?? ""
      },
      set: { value in
        if source {
          skillSources[skill.id] = value
        } else {
          skillNotes[skill.id] = value
        }
      }
    )
  }
}

private struct HermesSkillSheet: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let skill: HermesSkill
  let chinese: Bool
  let showsSource: Bool
  @Binding var notes: String

  var body: some View {
    NavigationStack {
      Form {
        Section(chinese ? "技能信息" : "Skill Information") {
          LabeledContent(chinese ? "名称" : "Name", value: skill.name)
          Text(skill.detail)
            .font(HermesFonts.body(14))
          LabeledContent(chinese ? "状态" : "Status") {
            HermesStatusPill(text: skill.enabled ? (chinese ? "已启用" : "Enabled") : (chinese ? "已停用" : "Disabled"))
          }
        }
        if showsSource {
          Section("SKILL.md") {
            TextEditor(text: $notes)
              .font(HermesFonts.mono(12))
              .frame(minHeight: 220)
          }
        } else {
          Section(chinese ? "前端配置" : "Frontend Configuration") {
            TextField(chinese ? "备注" : "Notes", text: $notes, axis: .vertical)
              .lineLimit(2...5)
          }
        }
      }
      .navigationTitle(showsSource ? "SKILL.md" : (chinese ? "编辑技能" : "Edit Skill"))
      .navigationBarTitleDisplayMode(.inline)
      .tint(appearance.palette.accent)
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }
}

enum HermesIntegrationKind {
  case plugins
  case mcp
  case channels
  case webhooks

  func title(_ chinese: Bool) -> String {
    switch self {
    case .plugins: return chinese ? "插件" : "Plugins"
    case .mcp: return "MCP"
    case .channels: return chinese ? "消息渠道" : "Channels"
    case .webhooks: return chinese ? "网络钩子" : "Webhooks"
    }
  }

  var symbol: String {
    switch self {
    case .plugins: return "puzzlepiece.extension"
    case .mcp: return "point.3.connected.trianglepath.dotted"
    case .channels: return "dot.radiowaves.left.and.right"
    case .webhooks: return "arrow.triangle.branch"
    }
  }
}

struct HermesIntegrationItem: Identifiable {
  let id: String
  var name: String
  var detail: String
  var enabled: Bool
}

struct HermesIntegrationPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let kind: HermesIntegrationKind
  let chinese: Bool
  @State private var addOpen = false
  @State private var name = ""
  @State private var endpoint = ""
  @State private var editTarget: HermesIntegrationItem?
  @State private var items: [HermesIntegrationItem]

  init(kind: HermesIntegrationKind, chinese: Bool) {
    self.kind = kind
    self.chinese = chinese
    let seed: [HermesIntegrationItem]
    switch kind {
    case .plugins:
      seed = [
        HermesIntegrationItem(id: "collaboration", name: "Collaboration", detail: "Multi-agent rooms", enabled: true),
        HermesIntegrationItem(id: "achievements", name: "Hermes Achievements", detail: "Progress and milestones", enabled: true),
        HermesIntegrationItem(id: "kanban", name: "Kanban", detail: "Task board", enabled: true)
      ]
    case .mcp:
      seed = [
        HermesIntegrationItem(id: "filesystem", name: "filesystem", detail: "stdio · npx server-filesystem", enabled: true),
        HermesIntegrationItem(id: "memory", name: "memory", detail: "http · localhost:3100", enabled: true)
      ]
    case .channels:
      seed = [
        HermesIntegrationItem(id: "telegram", name: "Telegram", detail: "@hermes_native_bot", enabled: true),
        HermesIntegrationItem(id: "discord", name: "Discord", detail: "Not configured", enabled: false)
      ]
    case .webhooks:
      seed = [
        HermesIntegrationItem(id: "github", name: "github-push", detail: "push, pull_request", enabled: true),
        HermesIntegrationItem(id: "deploy", name: "deployment", detail: "release", enabled: false)
      ]
    }
    self._items = State(initialValue: seed)
  }

  var body: some View {
    List {
      Section(kind.title(chinese)) {
        ForEach($items) { $item in
          HStack(spacing: 12) {
            Image(systemName: kind.symbol)
              .foregroundStyle(item.enabled ? appearance.palette.accent : appearance.palette.tertiary)
              .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
              Text(item.name).font(HermesFonts.bodyBold(15))
              Text(item.detail)
                .font(HermesFonts.mono(10))
                .foregroundStyle(appearance.palette.secondary)
            }
            Spacer()
            Toggle("", isOn: $item.enabled).labelsHidden()
          }
          .padding(.vertical, 4)
          .swipeActions {
            Button(role: .destructive) {
              items.removeAll { $0.id == item.id }
            } label: {
              Label(chinese ? "删除" : "Delete", systemImage: "trash")
            }
            Button {
              editTarget = item
              name = item.name
              endpoint = item.detail
              addOpen = true
            } label: {
              Label(chinese ? "编辑" : "Edit", systemImage: "pencil")
            }
            .tint(appearance.palette.primary)
          }
        }
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        Button {
          editTarget = nil
          name = ""
          endpoint = ""
          addOpen = true
        } label: {
          Label(chinese ? "添加" : "Add", systemImage: "plus")
        }
      }
    }
    .sheet(isPresented: $addOpen) {
      NavigationStack {
        Form {
          TextField(chinese ? "名称" : "Name", text: $name)
          TextField(kind == .mcp ? "https://example.com/mcp" : (chinese ? "配置" : "Configuration"), text: $endpoint)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
        .navigationTitle("\(editTarget == nil ? (chinese ? "添加" : "Add") : (chinese ? "编辑" : "Edit")) \(kind.title(chinese))")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(chinese ? "取消" : "Cancel") {
              editTarget = nil
              addOpen = false
            }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(editTarget == nil ? (chinese ? "添加" : "Add") : (chinese ? "保存" : "Save")) {
              let nextName = name.isEmpty ? "new-item" : name
              let nextDetail = endpoint.isEmpty ? (chinese ? "待配置" : "Not configured") : endpoint
              if let editTarget,
                 let index = items.firstIndex(where: { $0.id == editTarget.id }) {
                items[index].name = nextName
                items[index].detail = nextDetail
              } else {
                items.append(HermesIntegrationItem(
                  id: UUID().uuidString,
                  name: nextName,
                  detail: nextDetail,
                  enabled: true
                ))
              }
              name = ""
              endpoint = ""
              editTarget = nil
              addOpen = false
            }
          }
        }
      }
      .presentationDetents([.medium])
      .presentationDragIndicator(.visible)
    }
  }
}

struct HermesPairingPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var code = "HERMES-7K3P-9Q2M"
  @State private var copied = false

  var body: some View {
    HermesPage(subtitle: chinese ? "将其他设备安全连接到当前 Hermes 网关" : "Securely connect another device to this Hermes gateway") {
      HermesPanel {
        VStack(spacing: 18) {
          Image(systemName: "qrcode")
            .font(.system(size: 128, weight: .ultraLight))
            .foregroundStyle(appearance.palette.foreground)
            .padding(18)
            .background(.white)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

          Text(code)
            .font(HermesFonts.mono(18))
            .textSelection(.enabled)

          Button {
            copied = true
            withAnimation(.spring(response: 0.3, dampingFraction: 0.84)) {
              code = "HERMES-\(Int.random(in: 1000...9999))-\(Int.random(in: 1000...9999))"
            }
          } label: {
            Label(copied ? (chinese ? "已刷新" : "Refreshed") : (chinese ? "刷新配对码" : "Refresh Code"), systemImage: "arrow.clockwise")
          }
          .buttonStyle(HermesPrimaryButtonStyle())
        }
        .frame(maxWidth: .infinity)
      }

      Text(chinese ? "配对码仅短时间有效。新设备仍需要服务器授权。" : "Pairing codes expire quickly. New devices still require server authorization.")
        .font(HermesFonts.body(13))
        .foregroundStyle(appearance.palette.secondary)
    }
  }
}
