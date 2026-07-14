import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct HermesAchievementsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool

  var body: some View {
    HermesPage(subtitle: chinese ? "Hermes 使用进度与里程碑" : "Hermes usage progress and milestones") {
      Grid(horizontalSpacing: 12, verticalSpacing: 12) {
        GridRow {
          HermesMetric(title: chinese ? "已完成任务" : "Tasks Completed", value: "128", symbol: "checkmark.seal", tint: appearance.palette.success)
          HermesMetric(title: chinese ? "连续使用" : "Day Streak", value: "14", symbol: "flame", tint: appearance.palette.warning)
        }
      }

      ForEach(Array([
        ("first-agent", chinese ? "第一个 Agent" : "First Agent", chinese ? "创建你的第一个专用 Agent" : "Create your first specialized agent", "person.crop.circle.badge.checkmark", 1.0),
        ("automation", chinese ? "自动化专家" : "Automation Expert", chinese ? "完成 25 次计划任务" : "Complete 25 scheduled tasks", "clock.badge.checkmark", 0.72),
        ("collab", chinese ? "协作网络" : "Collaboration Network", chinese ? "在协作房间完成 10 个任务" : "Complete 10 tasks in collaboration rooms", "person.3", 0.4)
      ].enumerated()), id: \.offset) { _, achievement in
        HermesPanel {
          HStack(spacing: 14) {
            Image(systemName: achievement.3)
              .font(.system(size: 24, weight: .medium))
              .foregroundStyle(appearance.palette.accent)
              .frame(width: 44, height: 44)
              .background(appearance.palette.accent.opacity(0.12))
              .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 7) {
              Text(achievement.1).font(HermesFonts.bodyBold(15))
              Text(achievement.2)
                .font(HermesFonts.body(12))
                .foregroundStyle(appearance.palette.secondary)
              ProgressView(value: achievement.4)
                .tint(appearance.palette.accent)
            }
            Spacer()
            if achievement.4 >= 1 {
              Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(appearance.palette.success)
            }
          }
        }
      }

      ShareLink(item: chinese ? "我在 Hermes Agent 已完成 128 个任务。" : "I completed 128 tasks with Hermes Agent.") {
        Label(chinese ? "分享成就" : "Share Achievements", systemImage: "square.and.arrow.up")
      }
      .buttonStyle(HermesPrimaryButtonStyle())
    }
  }
}

struct HermesCollaborationPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var selectedRoom: String? = "native-ios"
  @State private var draft = ""
  @State private var messages = [
    "Hermes: iOS 迁移任务已开始",
    "Researcher: 已完成 SwiftOpenUI 兼容性核实",
    "Coder: 正在迁移 SwiftUI 根导航"
  ]

  var body: some View {
    HStack(spacing: 0) {
      List(selection: $selectedRoom) {
        Section(chinese ? "协作房间" : "Rooms") {
          Label("native-ios", systemImage: "number").tag("native-ios")
          Label("hermes-core", systemImage: "number").tag("hermes-core")
          Label("release", systemImage: "number").tag("release")
        }
      }
      .frame(minWidth: 180, idealWidth: 220, maxWidth: 260)
      .hermesListStyle()

      Divider()

      VStack(spacing: 0) {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(Array(messages.enumerated()), id: \.offset) { _, message in
              Text(message)
                .font(HermesFonts.body(14))
                .padding(10)
                .background(appearance.palette.surface)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(16)
        }
        Divider()
        HStack(spacing: 8) {
          TextField(chinese ? "发送到协作房间" : "Message the room", text: $draft)
            .font(HermesFonts.body(15))
            .textFieldStyle(.roundedBorder)
            .submitLabel(.send)
            .onSubmit(send)
          Button(action: send) {
            Image(systemName: "arrow.up.circle.fill")
              .font(.system(size: 26))
          }
          .buttonStyle(HermesPressStyle(scale: 0.9, opacity: 0.7))
        }
        .padding(12)
        .background(.ultraThinMaterial)
      }
    }
    .background(appearance.palette.background)
  }

  private func send() {
    let value = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return }
    draft = ""
    withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) {
      messages.append("你: \(value)")
    }
  }
}

struct HermesKanbanCard: Identifiable, Hashable {
  let id: String
  let title: String
  let detail: String
}

struct HermesKanbanPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var columns: [[HermesKanbanCard]] = [
    [
      HermesKanbanCard(id: "audit", title: "Audit native animations", detail: "Check every interaction"),
      HermesKanbanCard(id: "fonts", title: "Verify Hermes fonts", detail: "SwiftUI custom font mapping")
    ],
    [HermesKanbanCard(id: "navigation", title: "SwiftUI NavigationSplitView", detail: "Phone and iPad")],
    [HermesKanbanCard(id: "expo", title: "Expo Go fallback", detail: "Bundle verified")]
  ]

  var body: some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 12) {
        ForEach(columns.indices, id: \.self) { index in
          kanbanColumn(index)
        }
      }
      .padding(16)
    }
    .background(appearance.palette.background)
  }

  private func kanbanColumn(_ index: Int) -> some View {
    let cards = columns[index]

    return VStack(alignment: .leading, spacing: 10) {
      columnHeader(index, count: cards.count)
      ForEach(cards) { card in
        kanbanCard(card, in: index)
      }
      Spacer(minLength: 20)
    }
    .padding(12)
    .frame(width: 280)
    .frame(minHeight: 420, alignment: .top)
    .background(appearance.palette.surface)
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .stroke(appearance.palette.border)
    }
    .dropDestination(for: String.self) { cardIDs, _ in
      handleDrop(cardIDs, into: index)
    }
  }

  private func columnHeader(_ index: Int, count: Int) -> some View {
    HStack {
      Text(columnTitle(index))
        .font(HermesFonts.display(14))
      Spacer()
      Text("\(count)")
        .font(HermesFonts.mono(11))
        .foregroundStyle(appearance.palette.secondary)
    }
  }

  private func kanbanCard(_ card: HermesKanbanCard, in column: Int) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(card.title)
        .font(HermesFonts.bodyBold(14))
      Text(card.detail)
        .font(HermesFonts.body(12))
        .foregroundStyle(appearance.palette.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(appearance.palette.elevated)
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    .draggable(card.id)
    .contextMenu {
      Button {
        move(card, from: column, to: min(columns.count - 1, column + 1))
      } label: {
        Label(chinese ? "向后移动" : "Move Forward", systemImage: "arrow.right")
      }
      Button(role: .destructive) {
        remove(card, from: column)
      } label: {
        Label(chinese ? "删除" : "Delete", systemImage: "trash")
      }
    }
  }

  private func columnTitle(_ index: Int) -> String {
    let english = ["BACKLOG", "IN PROGRESS", "DONE"]
    let chineseTitles = ["待处理", "进行中", "已完成"]
    return chinese ? chineseTitles[index] : english[index]
  }

  private func move(_ card: HermesKanbanCard, from source: Int, to target: Int) {
    guard source != target else { return }
    withAnimation(.spring(response: 0.36, dampingFraction: 0.88)) {
      columns[source].removeAll { $0.id == card.id }
      columns[target].append(card)
    }
  }

  private func remove(_ card: HermesKanbanCard, from column: Int) {
    withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
      columns[column].removeAll { $0.id == card.id }
    }
  }

  private func handleDrop(_ cardIDs: [String], into destination: Int) -> Bool {
    let allCards = columns.flatMap { $0 }
    let droppedCards = cardIDs.compactMap { cardID in
      allCards.first { $0.id == cardID }
    }
    guard !droppedCards.isEmpty else { return false }

    withAnimation(.spring(response: 0.36, dampingFraction: 0.88)) {
      for card in droppedCards {
        for source in columns.indices {
          columns[source].removeAll { $0.id == card.id }
        }
        columns[destination].append(card)
      }
    }
    return true
  }
}

struct HermesProfile: Identifiable, Equatable {
  let id: String
  var name: String
  var model: String
  var detail: String
  var active: Bool
  var soul = "# iOS Native Agent\n\nPreserve Hermes behavior while using native iOS interaction."
  var terminalAccess = true
  var fileAccess = true
  var browserAccess = true
}

struct HermesProfilesPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var profiles = [
    HermesProfile(id: "default", name: "default", model: "claude-sonnet-4", detail: "General Hermes agent", active: true),
    HermesProfile(id: "coder", name: "coder", model: "gpt-5.6-sol", detail: "Repository implementation", active: false),
    HermesProfile(id: "research", name: "researcher", model: "gemini-3-pro", detail: "Technical research", active: false)
  ]
  @State private var addOpen = false
  @State private var newName = ""
  @State private var newDescription = ""
  @State private var newModel = "claude-sonnet-4"
  @State private var deleteTarget: HermesProfile?
  @State private var soulTarget: HermesProfile?

  var body: some View {
    List {
      Section(chinese ? "Agent 配置" : "Agent Profiles") {
        ForEach(profiles) { profile in
          NavigationLink {
            HermesProfileEditor(
              profile: profile,
              chinese: chinese,
              onChange: updateProfile
            )
          } label: {
            HStack(spacing: 12) {
              Image(systemName: profile.active ? "person.crop.circle.fill.badge.checkmark" : "person.crop.circle")
                .foregroundStyle(profile.active ? appearance.palette.success : appearance.palette.accent)
                .font(.system(size: 22))
              VStack(alignment: .leading, spacing: 4) {
                HStack {
                  Text(profile.name).font(HermesFonts.bodyBold(15))
                  if profile.active { HermesStatusPill(text: "DEFAULT") }
                }
                Text("\(profile.model) · \(profile.detail)")
                  .font(HermesFonts.body(11))
                  .foregroundStyle(appearance.palette.secondary)
              }
            }
            .padding(.vertical, 4)
          }
          .swipeActions {
            Button(role: .destructive) {
              deleteTarget = profile
            } label: {
              Label(chinese ? "删除" : "Delete", systemImage: "trash")
            }
            Button {
              for index in profiles.indices { profiles[index].active = false }
              if let index = profiles.firstIndex(where: { $0.id == profile.id }) {
                profiles[index].active = true
              }
            } label: {
              Label(chinese ? "设为当前" : "Set Active", systemImage: "checkmark.circle")
            }
            .tint(appearance.palette.primary)
          }
          .contextMenu {
            Button {
              for index in profiles.indices { profiles[index].active = profiles[index].id == profile.id }
            } label: {
              Label(chinese ? "设为当前" : "Set Active", systemImage: "checkmark.circle")
            }
            Button {
              soulTarget = profile
            } label: {
              Label("SOUL.md", systemImage: "doc.text")
            }
            Button(role: .destructive) { deleteTarget = profile } label: {
              Label(chinese ? "删除配置" : "Delete Profile", systemImage: "trash")
            }
          }
        }
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        Button { addOpen = true } label: {
          Label(chinese ? "新建配置" : "New Profile", systemImage: "plus")
        }
      }
    }
    .sheet(isPresented: $addOpen) {
      NavigationStack {
        Form {
          TextField(chinese ? "名称" : "Name", text: $newName)
          TextField(chinese ? "用途说明" : "Description", text: $newDescription, axis: .vertical)
            .lineLimit(2...5)
          Picker(chinese ? "模型" : "Model", selection: $newModel) {
            Text("claude-sonnet-4").tag("claude-sonnet-4")
            Text("gpt-5.6-sol").tag("gpt-5.6-sol")
            Text("gemini-3-pro").tag("gemini-3-pro")
          }
        }
        .navigationTitle(chinese ? "新建 Agent 配置" : "New Agent Profile")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(chinese ? "取消" : "Cancel") { addOpen = false }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(chinese ? "创建" : "Create") {
              profiles.append(HermesProfile(
                id: UUID().uuidString,
                name: newName.isEmpty ? "agent" : newName,
                model: newModel,
                detail: newDescription,
                active: false
              ))
              newName = ""
              newDescription = ""
              newModel = "claude-sonnet-4"
              addOpen = false
            }
          }
        }
      }
      .presentationDetents([.medium, .large])
    }
    .sheet(item: $soulTarget) { profile in
      NavigationStack {
        HermesProfileEditor(
          profile: profile,
          chinese: chinese,
          onChange: updateProfile
        )
      }
      .presentationDetents([.medium, .large])
      .presentationDragIndicator(.visible)
    }
    .alert(chinese ? "删除配置？" : "Delete profile?", isPresented: Binding(
      get: { deleteTarget != nil },
      set: { if !$0 { deleteTarget = nil } }
    )) {
      Button(chinese ? "删除" : "Delete", role: .destructive) {
        if let deleteTarget { profiles.removeAll { $0.id == deleteTarget.id } }
      }
      Button(chinese ? "取消" : "Cancel", role: .cancel) {}
    } message: {
      Text(chinese ? "这会删除配置、密钥、记忆、会话、技能和计划任务。" : "This removes configuration, keys, memories, sessions, skills, and scheduled jobs.")
    }
  }

  private func updateProfile(_ updated: HermesProfile) {
    if let index = profiles.firstIndex(where: { $0.id == updated.id }) {
      profiles[index] = updated
    }
  }
}

private struct HermesProfileEditor: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  @State var profile: HermesProfile
  let chinese: Bool
  let onChange: (HermesProfile) -> Void

  var body: some View {
    Form {
      Section(chinese ? "基本信息" : "Basics") {
        TextField(chinese ? "名称" : "Name", text: $profile.name)
        TextField(chinese ? "说明" : "Description", text: $profile.detail)
        Picker(chinese ? "模型" : "Model", selection: $profile.model) {
          Text("claude-sonnet-4").tag("claude-sonnet-4")
          Text("gpt-5.6-sol").tag("gpt-5.6-sol")
          Text("gemini-3-pro").tag("gemini-3-pro")
        }
      }
      Section("SOUL.md") {
        TextEditor(text: $profile.soul)
          .font(HermesFonts.mono(12))
          .frame(minHeight: 180)
      }
      Section(chinese ? "能力" : "Capabilities") {
        Toggle(chinese ? "允许终端" : "Terminal access", isOn: $profile.terminalAccess)
        Toggle(chinese ? "允许文件" : "File access", isOn: $profile.fileAccess)
        Toggle(chinese ? "允许浏览器" : "Browser access", isOn: $profile.browserAccess)
      }
    }
    .navigationTitle(profile.name)
    .navigationBarTitleDisplayMode(.inline)
    .tint(appearance.palette.accent)
    .onChange(of: profile) { _, updated in
      onChange(updated)
    }
  }
}

struct HermesConfigPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var defaultModel = "claude-sonnet-4"
  @State private var maxIterations = 50.0
  @State private var streamOutput = true
  @State private var autoCompact = true
  @State private var timezone = "Asia/Shanghai"
  @State private var imported = false
  @State private var importerOpen = false
  @State private var importError = ""

  private var modelOptions: [String] {
    let builtIn = ["claude-sonnet-4", "gpt-5.6-sol", "gemini-3-pro"]
    return builtIn.contains(defaultModel) ? builtIn : [defaultModel] + builtIn
  }

  var body: some View {
    Form {
      Section(chinese ? "通用" : "General") {
        Picker(chinese ? "默认模型" : "Default model", selection: $defaultModel) {
          ForEach(modelOptions, id: \.self) { model in
            Text(model).tag(model)
          }
        }
        TextField(chinese ? "时区" : "Timezone", text: $timezone)
      }
      Section(chinese ? "执行" : "Execution") {
        LabeledContent(chinese ? "最大迭代次数" : "Max iterations", value: "\(Int(maxIterations))")
        Slider(value: $maxIterations, in: 10...100, step: 5)
        Toggle(chinese ? "流式输出" : "Stream output", isOn: $streamOutput)
      }
      Section(chinese ? "记忆" : "Memory") {
        Toggle(chinese ? "自动压缩" : "Automatic compaction", isOn: $autoCompact)
        ProgressView(value: 0.82) {
          Text(chinese ? "压缩阈值" : "Compaction threshold")
        }
      }
      Section(chinese ? "导入与导出" : "Import & Export") {
        Button { importerOpen = true } label: {
          Label(chinese ? "导入配置" : "Import Configuration", systemImage: "square.and.arrow.down")
        }
        ShareLink(item: "default_model: \(defaultModel)\nmax_iterations: \(Int(maxIterations))\ntimezone: \(timezone)") {
          Label(chinese ? "导出配置" : "Export Configuration", systemImage: "square.and.arrow.up")
        }
        if imported {
          Label(chinese ? "配置已导入" : "Configuration imported", systemImage: "checkmark.circle.fill")
            .foregroundStyle(appearance.palette.success)
        }
      }
    }
    .scrollContentBackground(.hidden)
    .background(appearance.palette.background)
    .fileImporter(isPresented: $importerOpen, allowedContentTypes: [.json, .plainText, .data]) { result in
      switch result {
      case let .success(url):
        importConfiguration(from: url)
      case let .failure(error):
        importError = error.localizedDescription
      }
    }
    .alert(chinese ? "无法导入配置" : "Unable to Import Configuration", isPresented: Binding(
      get: { !importError.isEmpty },
      set: { if !$0 { importError = "" } }
    )) {
      Button(chinese ? "好" : "OK", role: .cancel) {}
    } message: {
      Text(importError)
    }
  }

  private func importConfiguration(from url: URL) {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }

    do {
      let data = try Data(contentsOf: url)
      let applied: Bool
      if let rawObject = try? JSONSerialization.jsonObject(with: data),
         let object = rawObject as? [String: Any] {
        applied = applyConfiguration(object)
      } else if let text = String(data: data, encoding: .utf8) {
        var object: [String: Any] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
          let parts = line.split(separator: ":", maxSplits: 1).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
          }
          if parts.count == 2 { object[parts[0]] = parts[1] }
        }
        applied = applyConfiguration(object)
      } else {
        throw CocoaError(.fileReadCorruptFile)
      }
      guard applied else { throw CocoaError(.fileReadCorruptFile) }
      imported = true
      importError = ""
    } catch {
      imported = false
      importError = error.localizedDescription
    }
  }

  private func applyConfiguration(_ object: [String: Any]) -> Bool {
    var applied = false
    if let model = object["default_model"] as? String, !model.isEmpty {
      defaultModel = model
      applied = true
    }
    if let value = object["max_iterations"] as? NSNumber {
      maxIterations = min(100, max(10, value.doubleValue))
      applied = true
    } else if let value = object["max_iterations"] as? String,
              let parsed = Double(value) {
      maxIterations = min(100, max(10, parsed))
      applied = true
    }
    if let nextTimezone = object["timezone"] as? String, !nextTimezone.isEmpty {
      timezone = nextTimezone
      applied = true
    }
    if let value = configurationBool(object["stream_output"]) {
      streamOutput = value
      applied = true
    }
    if let value = configurationBool(object["auto_compact"]) {
      autoCompact = value
      applied = true
    }
    return applied
  }

  private func configurationBool(_ value: Any?) -> Bool? {
    if let value = value as? Bool { return value }
    guard let text = value as? String else { return nil }
    switch text.lowercased() {
    case "true", "yes", "1": return true
    case "false", "no", "0": return false
    default: return nil
    }
  }
}

struct HermesSecret: Identifiable {
  let id: String
  let key: String
  var value: String
}

struct HermesEnvironmentPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var revealed = false
  @State private var addOpen = false
  @State private var newKey = ""
  @State private var newValue = ""
  @State private var secrets = [
    HermesSecret(id: "openrouter", key: "OPENROUTER_API_KEY", value: "sk-or-v1-••••••••••••"),
    HermesSecret(id: "anthropic", key: "ANTHROPIC_API_KEY", value: "sk-ant-••••••••••••"),
    HermesSecret(id: "github", key: "GITHUB_TOKEN", value: "ghp_••••••••••••")
  ]

  var body: some View {
    List {
      Section(chinese ? "服务凭据" : "Service Credentials") {
        ForEach(secrets) { secret in
          HStack(spacing: 12) {
            Image(systemName: "key.fill")
              .foregroundStyle(appearance.palette.accent)
            VStack(alignment: .leading, spacing: 4) {
              Text(secret.key).font(HermesFonts.mono(12))
              Text(revealed ? secret.value.replacingOccurrences(of: "•", with: "x") : secret.value)
                .font(HermesFonts.mono(11))
                .foregroundStyle(appearance.palette.secondary)
            }
            Spacer()
          }
          .swipeActions {
            Button(role: .destructive) {
              secrets.removeAll { $0.id == secret.id }
            } label: {
              Label(chinese ? "清除" : "Clear", systemImage: "trash")
            }
            Button {
              newKey = secret.key
              newValue = ""
              addOpen = true
            } label: {
              Label(chinese ? "替换" : "Replace", systemImage: "arrow.triangle.2.circlepath")
            }
            .tint(appearance.palette.primary)
          }
        }
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .toolbar {
      ToolbarItemGroup(placement: .navigationBarTrailing) {
        Button { revealed.toggle() } label: {
          Label(revealed ? (chinese ? "隐藏" : "Hide") : (chinese ? "显示" : "Reveal"), systemImage: revealed ? "eye.slash" : "eye")
        }
        Button { addOpen = true } label: {
          Label(chinese ? "添加凭据" : "Add Credential", systemImage: "plus")
        }
      }
    }
    .sheet(isPresented: $addOpen) {
      NavigationStack {
        Form {
          TextField(chinese ? "密钥名称" : "Key name", text: $newKey)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
          SecureField(chinese ? "密钥值" : "Secret value", text: $newValue)
            .textContentType(.password)
        }
        .navigationTitle(chinese ? "添加凭据" : "Add Credential")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(chinese ? "取消" : "Cancel") { addOpen = false }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(chinese ? "保存" : "Save") {
              guard !newKey.isEmpty else { return }
              secrets.removeAll { $0.key == newKey }
              secrets.append(HermesSecret(id: UUID().uuidString, key: newKey, value: newValue))
              newKey = ""
              newValue = ""
              addOpen = false
            }
          }
        }
      }
      .presentationDetents([.medium])
    }
  }
}

struct HermesSystemPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var confirmation: String?
  @State private var uptime = 14
  @State private var operationMessage: String?

  var body: some View {
    HermesPage(subtitle: chinese ? "Hermes 网关、任务和资源状态" : "Hermes gateway, task, and resource status") {
      Grid(horizontalSpacing: 12, verticalSpacing: 12) {
        GridRow {
          HermesMetric(title: "CPU", value: "18%", symbol: "cpu", tint: appearance.palette.primary)
          HermesMetric(title: chinese ? "内存" : "Memory", value: "3.4 GB", symbol: "memorychip", tint: appearance.palette.warning)
        }
        GridRow {
          HermesMetric(title: chinese ? "运行时间" : "Uptime", value: "\(uptime)d", symbol: "clock", tint: appearance.palette.success)
          HermesMetric(title: chinese ? "活动任务" : "Active Tasks", value: "2", symbol: "waveform", tint: appearance.palette.accent)
        }
      }

      HermesPanel {
        VStack(alignment: .leading, spacing: 14) {
          HStack {
            Text(chinese ? "网关状态" : "Gateway Status")
              .font(HermesFonts.display(15))
            Spacer()
            HermesStatusPill(text: chinese ? "在线" : "Online")
          }
          ProgressView(value: 0.18) { Text("CPU") }
          ProgressView(value: 0.53) { Text(chinese ? "内存" : "Memory") }
          ProgressView(value: 0.31) { Text(chinese ? "磁盘" : "Disk") }
        }
      }

      HStack(spacing: 10) {
        Button {
          confirmation = "restart"
        } label: {
          Label(chinese ? "重启网关" : "Restart Gateway", systemImage: "arrow.clockwise")
        }
        .buttonStyle(HermesPrimaryButtonStyle())

        Button {
          confirmation = "update"
        } label: {
          Label(chinese ? "更新 Hermes" : "Update Hermes", systemImage: "arrow.down.circle")
        }
        .buttonStyle(.bordered)
        .font(HermesFonts.bodyBold(14))
      }

      if let operationMessage {
        Label(operationMessage, systemImage: "checkmark.circle.fill")
          .font(HermesFonts.body(13))
          .foregroundStyle(appearance.palette.success)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .confirmationDialog(
      confirmation == "restart"
        ? (chinese ? "重启 Hermes 网关？" : "Restart Hermes gateway?")
        : (chinese ? "更新 Hermes？" : "Update Hermes?"),
      isPresented: Binding(
        get: { confirmation != nil },
        set: { if !$0 { confirmation = nil } }
      ),
      titleVisibility: .visible
    ) {
      Button(confirmation == "restart" ? (chinese ? "重启" : "Restart") : (chinese ? "更新" : "Update"), role: .destructive) {
        let action = confirmation ?? ""
        if action == "restart" {
          uptime = 0
          operationMessage = chinese ? "网关重启前端流程已开始" : "Gateway restart frontend flow started"
        } else {
          operationMessage = chinese ? "Hermes 更新前端流程已开始" : "Hermes update frontend flow started"
        }
        confirmation = nil
      }
      Button(chinese ? "取消" : "Cancel", role: .cancel) {}
    }
  }
}

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
        content: chinese ? "Base URL 和 API 密钥保存在系统安全存储中，Face ID 用于快速解锁。" : "The Base URL and API key live in secure system storage, with Face ID for quick unlock."
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
        content: chinese ? "能力通过服务器清单组合，原生导航保持与 WebUI 相同的所有权顺序。" : "Capabilities compose from server manifests while native navigation preserves WebUI ownership order."
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
