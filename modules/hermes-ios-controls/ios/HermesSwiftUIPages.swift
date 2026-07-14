import Charts
import SwiftUI
import UniformTypeIdentifiers

struct HermesRouteContent: View {
  let attachmentIds: [String]
  let attachmentNames: [String]
  let route: HermesRoute
  let chinese: Bool
  let onAction: (String, String?) -> Void

  var body: some View {
    switch route {
    case .chat:
      HermesChatPage(
        attachmentIds: attachmentIds,
        attachmentNames: attachmentNames,
        chinese: chinese,
        onAction: onAction
      )
    case .sessions:
      HermesSessionsPage(chinese: chinese)
    case .files:
      HermesFilesPage(chinese: chinese)
    case .analytics:
      HermesAnalyticsPage(chinese: chinese)
    case .models:
      HermesModelsPage(chinese: chinese)
    case .logs:
      HermesLogsPage(chinese: chinese)
    case .cron:
      HermesCronPage(chinese: chinese)
    case .skills:
      HermesSkillsPage(chinese: chinese)
    case .plugins:
      HermesIntegrationPage(kind: .plugins, chinese: chinese)
    case .mcp:
      HermesIntegrationPage(kind: .mcp, chinese: chinese)
    case .pairing:
      HermesPairingPage(chinese: chinese)
    case .channels:
      HermesIntegrationPage(kind: .channels, chinese: chinese)
    case .webhooks:
      HermesIntegrationPage(kind: .webhooks, chinese: chinese)
    case .achievements:
      HermesAchievementsPage(chinese: chinese)
    case .collaboration:
      HermesCollaborationPage(chinese: chinese)
    case .kanban:
      HermesKanbanPage(chinese: chinese)
    case .profiles:
      HermesProfilesPage(chinese: chinese)
    case .config:
      HermesConfigPage(chinese: chinese)
    case .env:
      HermesEnvironmentPage(chinese: chinese)
    case .system:
      HermesSystemPage(chinese: chinese)
    case .docs:
      HermesDocsPage(chinese: chinese)
    }
  }
}

private struct HermesSession: Identifiable, Equatable {
  let id: String
  let title: String
  let model: String
  let date: String
  let running: Bool
}

private struct HermesSessionsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var search = ""
  @State private var sessions = [
    HermesSession(id: "ios-native", title: "iOS 原生化迁移", model: "claude-sonnet-4", date: "刚刚", running: true),
    HermesSession(id: "config", title: "检查 Hermes 配置", model: "gpt-5.6-sol", date: "18 分钟前", running: false),
    HermesSession(id: "gateway", title: "更新网关", model: "claude-sonnet-4", date: "昨天", running: false)
  ]
  @State private var renameTarget: HermesSession?
  @State private var renameText = ""

  private var filtered: [HermesSession] {
    guard !search.isEmpty else { return sessions }
    return sessions.filter { $0.title.localizedCaseInsensitiveContains(search) }
  }

  var body: some View {
    List {
      Section {
        ForEach(filtered) { session in
          NavigationLink {
            HermesSessionDetail(session: session, chinese: chinese)
          } label: {
            HStack(spacing: 12) {
              Image(systemName: session.running ? "waveform" : "bubble.left")
                .foregroundStyle(session.running ? appearance.palette.success : appearance.palette.secondary)
                .frame(width: 26)
              VStack(alignment: .leading, spacing: 4) {
                Text(session.title)
                  .font(HermesFonts.bodyBold(15))
                Text("\(session.model) · \(session.date)")
                  .font(HermesFonts.mono(10))
                  .foregroundStyle(appearance.palette.secondary)
              }
              Spacer()
              if session.running {
                HermesStatusPill(text: chinese ? "运行中" : "Running")
              }
            }
            .padding(.vertical, 4)
          }
          .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
              withAnimation(.spring(response: 0.34, dampingFraction: 0.88)) {
                sessions.removeAll { $0.id == session.id }
              }
            } label: {
              Label(chinese ? "删除" : "Delete", systemImage: "trash")
            }
            Button {
              renameText = session.title
              renameTarget = session
            } label: {
              Label(chinese ? "重命名" : "Rename", systemImage: "pencil")
            }
            .tint(appearance.palette.accent)
          }
          .contextMenu {
            Button {
              renameText = session.title
              renameTarget = session
            } label: {
              Label(chinese ? "重命名" : "Rename", systemImage: "pencil")
            }
            Button(role: .destructive) {
              sessions.removeAll { $0.id == session.id }
            } label: {
              Label(chinese ? "删除会话" : "Delete Session", systemImage: "trash")
            }
          }
        }
      } header: {
        Text(chinese ? "最近会话" : "Recent Sessions")
          .font(HermesFonts.condensed(12))
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .searchable(text: $search, prompt: chinese ? "搜索会话" : "Search sessions")
    .refreshable {
      try? await Task.sleep(nanoseconds: 350_000_000)
    }
    .sheet(item: $renameTarget) { target in
      NavigationStack {
        Form {
          TextField(chinese ? "会话名称" : "Session name", text: $renameText)
        }
        .navigationTitle(chinese ? "重命名会话" : "Rename Session")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(chinese ? "取消" : "Cancel") { renameTarget = nil }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(chinese ? "保存" : "Save") {
              if let index = sessions.firstIndex(of: target) {
                let old = sessions[index]
                sessions[index] = HermesSession(
                  id: old.id,
                  title: renameText,
                  model: old.model,
                  date: old.date,
                  running: old.running
                )
              }
              renameTarget = nil
            }
          }
        }
      }
      .presentationDetents([.medium])
    }
  }
}

private struct HermesSessionDetail: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let session: HermesSession
  let chinese: Bool

  var body: some View {
    HermesPage(subtitle: session.model) {
      HermesPanel {
        VStack(alignment: .leading, spacing: 12) {
          Label(chinese ? "完整过程" : "Complete Process", systemImage: "list.bullet.rectangle")
            .font(HermesFonts.display(15))
          Text(chinese ? "任务状态、工具调用、输出和最终结果由服务器持续保存。" : "Task state, tool calls, output, and final results remain on the server.")
            .font(HermesFonts.body(15))
            .foregroundStyle(appearance.palette.secondary)
          Text("git status --short\nM modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift")
            .font(HermesFonts.mono(12))
            .textSelection(.enabled)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(appearance.palette.background)
        }
      }
    }
    .navigationTitle(session.title)
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct HermesFileEntry: Identifiable, Equatable {
  let id: String
  let name: String
  let detail: String
  let folder: Bool
}

private struct HermesFilesPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var search = ""
  @State private var importerOpen = false
  @State private var folderSheetOpen = false
  @State private var newFolder = ""
  @State private var selectedFile: HermesFileEntry?
  @State private var files = [
    HermesFileEntry(id: "workspace", name: "workspace", detail: "12 items", folder: true),
    HermesFileEntry(id: "soul", name: "SOUL.md", detail: "3.2 KB", folder: false),
    HermesFileEntry(id: "config", name: "config.yaml", detail: "1.8 KB", folder: false),
    HermesFileEntry(id: "report", name: "native-audit.md", detail: "8.4 KB", folder: false)
  ]

  private var filtered: [HermesFileEntry] {
    search.isEmpty ? files : files.filter { $0.name.localizedCaseInsensitiveContains(search) }
  }

  var body: some View {
    List {
      Section("~/.hermes") {
        ForEach(filtered) { file in
          Button {
            selectedFile = file
          } label: {
            HStack(spacing: 12) {
              Image(systemName: file.folder ? "folder.fill" : "doc.text")
                .foregroundStyle(file.folder ? appearance.palette.accent : appearance.palette.secondary)
                .frame(width: 26)
              VStack(alignment: .leading, spacing: 3) {
                Text(file.name).font(HermesFonts.bodyBold(15))
                Text(file.detail)
                  .font(HermesFonts.mono(10))
                  .foregroundStyle(appearance.palette.secondary)
              }
              Spacer()
            }
          }
          .buttonStyle(.plain)
          .swipeActions {
            Button(role: .destructive) {
              files.removeAll { $0.id == file.id }
            } label: {
              Label(chinese ? "删除" : "Delete", systemImage: "trash")
            }
            ShareLink(item: file.name) {
              Label(chinese ? "分享" : "Share", systemImage: "square.and.arrow.up")
            }
            .tint(appearance.palette.primary)
          }
        }
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .searchable(text: $search, prompt: chinese ? "搜索文件" : "Search files")
    .toolbar {
      ToolbarItemGroup(placement: .navigationBarTrailing) {
        Button {
          folderSheetOpen = true
        } label: {
          Label(chinese ? "新建文件夹" : "New folder", systemImage: "folder.badge.plus")
        }
        Button {
          importerOpen = true
        } label: {
          Label(chinese ? "导入文件" : "Import file", systemImage: "square.and.arrow.down")
        }
      }
    }
    .fileImporter(isPresented: $importerOpen, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
      if case let .success(urls) = result {
        for url in urls {
          files.append(HermesFileEntry(
            id: url.absoluteString,
            name: url.lastPathComponent,
            detail: chinese ? "已导入" : "Imported",
            folder: false
          ))
        }
      }
    }
    .sheet(isPresented: $folderSheetOpen) {
      NavigationStack {
        Form {
          TextField(chinese ? "文件夹名称" : "Folder name", text: $newFolder)
        }
        .navigationTitle(chinese ? "新建文件夹" : "New Folder")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(chinese ? "取消" : "Cancel") { folderSheetOpen = false }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(chinese ? "创建" : "Create") {
              guard !newFolder.isEmpty else { return }
              files.insert(HermesFileEntry(
                id: UUID().uuidString,
                name: newFolder,
                detail: "0 items",
                folder: true
              ), at: 0)
              newFolder = ""
              folderSheetOpen = false
            }
          }
        }
      }
      .presentationDetents([.medium])
    }
    .sheet(item: $selectedFile) { file in
      HermesFilePreview(file: file, chinese: chinese)
        .environmentObject(appearance)
    }
  }
}

private struct HermesFilePreview: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  @Environment(\.dismiss) private var dismiss
  let file: HermesFileEntry
  let chinese: Bool

  var body: some View {
    NavigationStack {
      Group {
        if file.folder {
          List {
            Label("SOUL.md", systemImage: "doc.text")
            Label("config.yaml", systemImage: "doc.text")
            Label("sessions", systemImage: "folder.fill")
          }
          .hermesListStyle()
        } else {
          ScrollView {
            Text(previewContent)
              .font(HermesFonts.mono(13))
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .topLeading)
              .padding(18)
          }
        }
      }
      .background(appearance.palette.background)
      .navigationTitle(file.name)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(chinese ? "完成" : "Done") { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var previewContent: String {
    if file.name == "SOUL.md" {
      return "# Hermes Agent\n\nNative SwiftUI frontend preview."
    }
    if file.name.hasSuffix(".yaml") {
      return "default_model: claude-sonnet-4\nmax_iterations: 50\ntimezone: Asia/Shanghai"
    }
    return chinese ? "文件内容将在后端接入后从 Hermes 服务器加载。" : "File content will load from the Hermes server after backend integration."
  }
}

private struct HermesAnalyticsPoint: Identifiable {
  let id = UUID()
  let day: String
  let input: Double
  let output: Double
}

private struct HermesAnalyticsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  private let points = [
    HermesAnalyticsPoint(day: "Mon", input: 18, output: 9),
    HermesAnalyticsPoint(day: "Tue", input: 26, output: 14),
    HermesAnalyticsPoint(day: "Wed", input: 21, output: 18),
    HermesAnalyticsPoint(day: "Thu", input: 39, output: 24),
    HermesAnalyticsPoint(day: "Fri", input: 34, output: 30),
    HermesAnalyticsPoint(day: "Sat", input: 52, output: 31),
    HermesAnalyticsPoint(day: "Sun", input: 47, output: 36)
  ]

  var body: some View {
    HermesPage(subtitle: chinese ? "令牌使用、费用和模型活动" : "Token usage, cost, and model activity") {
      Grid(horizontalSpacing: 12, verticalSpacing: 12) {
        GridRow {
          HermesMetric(title: chinese ? "输入令牌" : "Input Tokens", value: "1.28M", symbol: "arrow.down.circle")
          HermesMetric(title: chinese ? "输出令牌" : "Output Tokens", value: "684K", symbol: "arrow.up.circle", tint: appearance.palette.primary)
        }
        GridRow {
          HermesMetric(title: chinese ? "本月费用" : "Monthly Cost", value: "$42.18", symbol: "dollarsign.circle", tint: appearance.palette.warning)
          HermesMetric(title: chinese ? "成功率" : "Success Rate", value: "98.7%", symbol: "checkmark.seal", tint: appearance.palette.success)
        }
      }

      HermesPanel {
        VStack(alignment: .leading, spacing: 14) {
          Text(chinese ? "最近 7 天" : "Last 7 Days")
            .font(HermesFonts.display(15))
          Chart(points) { point in
            LineMark(x: .value("Day", point.day), y: .value("Input", point.input))
              .foregroundStyle(appearance.palette.accent)
              .interpolationMethod(.catmullRom)
            AreaMark(x: .value("Day", point.day), y: .value("Input", point.input))
              .foregroundStyle(appearance.palette.accent.opacity(0.12))
              .interpolationMethod(.catmullRom)
            LineMark(x: .value("Day", point.day), y: .value("Output", point.output))
              .foregroundStyle(appearance.palette.primary)
              .interpolationMethod(.catmullRom)
          }
          .chartLegend(.hidden)
          .frame(height: 240)
        }
      }
    }
  }
}

private struct HermesModel: Identifiable, Equatable {
  let id: String
  let provider: String
  let context: String
}

private struct HermesModelsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var active = "claude-sonnet-4"
  @State private var replacement: HermesModel?
  private let models = [
    HermesModel(id: "claude-sonnet-4", provider: "Anthropic", context: "200K context"),
    HermesModel(id: "gpt-5.6-sol", provider: "OpenAI", context: "256K context"),
    HermesModel(id: "gemini-3-pro", provider: "Google", context: "1M context")
  ]

  var body: some View {
    List {
      Section(chinese ? "可用模型" : "Available Models") {
        ForEach(models) { model in
          Button {
            replacement = model
          } label: {
            HStack(spacing: 12) {
              Image(systemName: "cpu")
                .foregroundStyle(model.id == active ? appearance.palette.success : appearance.palette.secondary)
              VStack(alignment: .leading, spacing: 3) {
                Text(model.id).font(HermesFonts.mono(14))
                Text("\(model.provider) · \(model.context)")
                  .font(HermesFonts.body(12))
                  .foregroundStyle(appearance.palette.secondary)
              }
              Spacer()
              if model.id == active {
                HermesStatusPill(text: chinese ? "当前" : "Active")
              } else {
                Image(systemName: "chevron.right")
                  .foregroundStyle(appearance.palette.tertiary)
              }
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .confirmationDialog(
      chinese ? "替换当前模型？" : "Replace active model?",
      isPresented: Binding(
        get: { replacement != nil },
        set: { if !$0 { replacement = nil } }
      ),
      titleVisibility: .visible
    ) {
      if let replacement {
        Button(chinese ? "设为当前模型" : "Set Active") {
          withAnimation(.spring(response: 0.34, dampingFraction: 0.86)) {
            active = replacement.id
          }
        }
      }
      Button(chinese ? "取消" : "Cancel", role: .cancel) {}
    }
  }
}

private struct HermesLogEntry: Identifiable {
  let id: String
  let level: String
  let message: String
  let time: String
}

private struct HermesLogsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  @State private var level = "ALL"
  @State private var search = ""
  private let logs = [
    HermesLogEntry(id: "gateway", level: "INFO", message: "Gateway started on :8080", time: "12:41:08"),
    HermesLogEntry(id: "socket", level: "INFO", message: "WebSocket client connected", time: "12:41:15"),
    HermesLogEntry(id: "retry", level: "WARN", message: "Model retry after rate limit", time: "12:42:02"),
    HermesLogEntry(id: "complete", level: "INFO", message: "Task completed in 8.4 s", time: "12:42:11")
  ]

  private var filteredLogs: [HermesLogEntry] {
    logs.filter { entry in
      let matchesLevel = level == "ALL" || entry.level == level
      let matchesSearch = search.isEmpty
        || entry.level.localizedCaseInsensitiveContains(search)
        || entry.message.localizedCaseInsensitiveContains(search)
        || entry.time.localizedCaseInsensitiveContains(search)
      return matchesLevel && matchesSearch
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      Picker(chinese ? "日志级别" : "Log level", selection: $level) {
        ForEach(["ALL", "INFO", "WARN", "ERROR"], id: \.self) { Text($0).tag($0) }
      }
      .pickerStyle(.segmented)
      .padding(12)

      List {
        ForEach(filteredLogs) { log in
          HStack(alignment: .top, spacing: 10) {
            Text(log.time)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.tertiary)
            Text(log.level)
              .font(HermesFonts.mono(10))
              .foregroundStyle(log.level == "WARN" ? appearance.palette.warning : appearance.palette.success)
              .frame(width: 38, alignment: .leading)
            Text(log.message)
              .font(HermesFonts.mono(12))
              .textSelection(.enabled)
          }
          .padding(.vertical, 3)
        }
      }
      .hermesListStyle()
    }
    .background(appearance.palette.background)
    .searchable(text: $search, prompt: chinese ? "搜索日志" : "Search logs")
  }
}
