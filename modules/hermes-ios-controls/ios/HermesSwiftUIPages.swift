import Charts
import Foundation
import SwiftUI
import UniformTypeIdentifiers

struct HermesRouteContent: View {
  let attachmentIds: [String]
  let attachmentNames: [String]
  let data: HermesRouteSnapshot
  let route: HermesRoute
  let chinese: Bool
  let renderDeferredContent: Bool
  let onAction: HermesRouteActionSink

  var body: some View {
    switch route {
    case .chat:
      // Chat deliberately stays in the existing React Native/Hermes surface.
      // This native route host is used only for destinations opened from the sidebar.
      EmptyView()
    case .sessions:
      HermesSessionsPage(
        chinese: chinese,
        sessions: data.sessions,
        onAction: onAction
      )
    case .files:
      HermesFilesPage(
        chinese: chinese,
        files: data.files,
        onAction: onAction
      )
    case .analytics:
      HermesAnalyticsPage(
        analytics: data.analytics,
        chinese: chinese,
        renderChart: renderDeferredContent,
        onAction: onAction
      )
    case .models:
      HermesModelsPage(
        chinese: chinese,
        models: data.models,
        onAction: onAction
      )
    case .logs:
      HermesLogsPage(
        chinese: chinese,
        logs: data.logs,
        onAction: onAction
      )
    case .cron:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .skills:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .plugins:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .mcp:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .pairing:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .channels:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .webhooks:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .achievements:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .collaboration:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .kanban:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .profiles:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .config:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .env:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .system:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .docs:
      HermesDocsPage(chinese: chinese)
    }
  }
}

private enum HermesRemoteEditor: String, Identifiable {
  case cron
  case mcp
  case webhooks
  case pairing
  case profiles
  case soul
  case environment
  case config

  var id: String { rawValue }
}

private struct HermesRemoteRoutePage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let route: HermesRoute
  let data: HermesRouteSnapshot
  let chinese: Bool
  let onAction: HermesRouteActionSink
  @State private var collaborationDraft = ""
  @State private var editor: HermesRemoteEditor?
  @State private var editorName = ""
  @State private var editorValue = ""
  @State private var editorDetail = ""

  var body: some View {
    routeBody
      .toolbar {
        if let editorKind {
          ToolbarItem(placement: .navigationBarTrailing) {
            Button {
              prepareEditor(editorKind)
            } label: {
              Image(systemName: editorKind == .config ? "square.and.pencil" : "plus")
            }
            .accessibilityLabel(chinese ? "新增或编辑" : "Add or edit")
          }
        }
      }
      .sheet(item: $editor) { kind in
        HermesRemoteEditorSheet(
          kind: kind,
          chinese: chinese,
          name: $editorName,
          value: $editorValue,
          detail: $editorDetail,
          onCancel: { editor = nil },
          onSave: { saveEditor(kind) }
        )
        .environmentObject(appearance)
      }
  }

  @ViewBuilder private var routeBody: some View {
    switch route {
    case .cron:
      List(data.cron) { job in
        HermesRemoteRow(icon: job.enabled ? "clock.arrow.circlepath" : "pause.circle", title: job.name, detail: "\(job.schedule) · \(job.lastRun)", tint: job.enabled ? appearance.palette.accent : appearance.palette.tertiary) {
          Button {
            onAction(.cronToggle, HermesRouteActionPayload(route: "cron", id: job.id, enabled: !job.enabled))
          } label: {
            Image(systemName: job.enabled ? "pause.fill" : "play.fill")
          }
          .buttonStyle(.borderless)
        }
        .swipeActions {
          Button {
            onAction(.cronRun, HermesRouteActionPayload(route: "cron", id: job.id))
          } label: { Label(chinese ? "立即运行" : "Run now", systemImage: "play.fill") }
          Button(role: .destructive) {
            onAction(.cronDelete, HermesRouteActionPayload(route: "cron", id: job.id))
          } label: { Label(chinese ? "删除" : "Delete", systemImage: "trash") }
        }
      }
      .hermesListStyle()
      .refreshable { onAction(.refresh, HermesRouteActionPayload(route: "cron")) }
    case .skills:
      List(data.skills) { skill in
        HermesRemoteRow(icon: skill.bundled ? "shippingbox.fill" : "shippingbox", title: skill.name, detail: skill.detail, tint: appearance.palette.accent) {
          Toggle("", isOn: Binding(
            get: { skill.enabled },
            set: { onAction(.skillToggle, HermesRouteActionPayload(route: "skills", id: skill.id, enabled: $0)) }
          )).labelsHidden()
        }
        .contextMenu {
          Button { onAction(.skillView, HermesRouteActionPayload(route: "skills", id: skill.id)) } label: {
            Label(chinese ? "查看 SKILL.md" : "View SKILL.md", systemImage: "doc.text")
          }
        }
      }
      .hermesListStyle()
      .refreshable { onAction(.refresh, HermesRouteActionPayload(route: "skills")) }
    case .plugins, .mcp, .channels, .webhooks:
      List(data.integrations) { item in
        HermesRemoteRow(icon: route == .plugins ? "puzzlepiece.extension" : route == .mcp ? "point.3.connected.trianglepath.dotted" : route == .channels ? "dot.radiowaves.left.and.right" : "arrow.triangle.branch", title: item.name, detail: item.detail, tint: item.enabled ? appearance.palette.accent : appearance.palette.tertiary) {
          Toggle("", isOn: Binding(
            get: { item.enabled },
            set: { onAction(.integrationToggle, HermesRouteActionPayload(route: route.rawValue, id: item.id, enabled: $0)) }
          )).labelsHidden()
        }
        .swipeActions {
          if route == .mcp || route == .webhooks {
            Button(role: .destructive) {
              onAction(.integrationDelete, HermesRouteActionPayload(route: route.rawValue, id: item.id))
            } label: { Label(chinese ? "删除" : "Delete", systemImage: "trash") }
          }
        }
      }
      .hermesListStyle()
      .refreshable { onAction(.refresh, HermesRouteActionPayload(route: route.rawValue)) }
    case .pairing:
      List {
        Section(chinese ? "待批准" : "Pending") {
          if data.pairing.pending.isEmpty {
            Text(chinese ? "暂无待批准的用户" : "No pending users")
              .foregroundStyle(appearance.palette.secondary)
          }
          ForEach(data.pairing.pending) { item in
            HermesRemoteRow(
              icon: "person.badge.clock",
              title: item.platform,
              detail: item.detail,
              tint: appearance.palette.warning
            ) { EmptyView() }
          }
          if !data.pairing.pending.isEmpty {
            Button(role: .destructive) {
              onAction(.pairingClearPending, HermesRouteActionPayload(route: "pairing"))
            } label: {
              Label(chinese ? "清空待批准请求" : "Clear pending requests", systemImage: "trash")
            }
          }
        }
        Section(chinese ? "已批准" : "Approved") {
          if data.pairing.approved.isEmpty {
            Text(chinese ? "暂无已批准的用户" : "No approved users")
              .foregroundStyle(appearance.palette.secondary)
          }
          ForEach(data.pairing.approved) { item in
            HermesRemoteRow(
              icon: "person.crop.circle.badge.checkmark",
              title: item.platform,
              detail: item.detail,
              tint: appearance.palette.success
            ) { EmptyView() }
            .swipeActions {
              Button(role: .destructive) {
                onAction(
                  .pairingRevoke,
                  HermesRouteActionPayload(
                    route: "pairing",
                    id: item.platform,
                    value: item.userId
                  )
                )
              } label: { Label(chinese ? "撤销" : "Revoke", systemImage: "person.crop.circle.badge.minus") }
            }
          }
        }
      }
      .hermesListStyle()
      .refreshable { onAction(.refresh, HermesRouteActionPayload(route: "pairing")) }
    case .achievements:
      HermesPage(subtitle: chinese ? "Hermes 使用进度与里程碑" : "Hermes usage progress and milestones") {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
          GridRow {
            HermesMetric(title: chinese ? "已完成任务" : "Tasks completed", value: data.achievements.tasksCompleted, symbol: "checkmark.seal", tint: appearance.palette.success)
            HermesMetric(title: chinese ? "连续使用" : "Day streak", value: data.achievements.dayStreak, symbol: "flame", tint: appearance.palette.warning)
          }
        }
        ForEach(data.achievements.items) { item in
          HermesPanel {
            VStack(alignment: .leading, spacing: 8) {
              Label(item.title, systemImage: item.symbol).font(HermesFonts.bodyBold(15))
              Text(item.detail).font(HermesFonts.body(12)).foregroundStyle(appearance.palette.secondary)
              ProgressView(value: item.progress).tint(appearance.palette.accent)
            }
          }
        }
        if !data.achievements.shareText.isEmpty {
          ShareLink(item: data.achievements.shareText) {
            Label(chinese ? "分享成就" : "Share achievements", systemImage: "square.and.arrow.up")
          }.buttonStyle(HermesPrimaryButtonStyle())
        }
      }
    case .collaboration:
      VStack(spacing: 0) {
        List(data.collaboration.rooms) { room in
          Button {
            onAction(.collaborationSelect, HermesRouteActionPayload(route: "collaboration", id: room.id))
          } label: {
            Label(room.name, systemImage: room.id == data.collaboration.selectedRoomId ? "checkmark.circle.fill" : "number")
          }
          .buttonStyle(.plain)
        }
        .frame(maxHeight: 180)
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 8) {
            ForEach(data.collaboration.messages) { message in
              Text(message.text).font(HermesFonts.body(14)).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(appearance.palette.surface).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
          }.padding(14)
        }
        HStack {
          TextField(chinese ? "发送消息" : "Message", text: $collaborationDraft)
            .textFieldStyle(.roundedBorder)
          Button {
            let text = collaborationDraft.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return }
            collaborationDraft = ""
            onAction(.collaborationSend, HermesRouteActionPayload(route: "collaboration", id: data.collaboration.selectedRoomId, value: text))
          } label: { Image(systemName: "arrow.up.circle.fill") }
        }.padding(12).background(.ultraThinMaterial)
      }
      .background(appearance.palette.background)
    case .kanban:
      ScrollView(.horizontal) {
        HStack(alignment: .top, spacing: 12) {
          ForEach(data.kanban) { column in
            VStack(alignment: .leading, spacing: 8) {
              Text(column.title).font(HermesFonts.display(14))
              ForEach(column.cards) { card in
                HermesPanel {
                  VStack(alignment: .leading, spacing: 5) {
                    Text(card.title).font(HermesFonts.bodyBold(14))
                    Text(card.detail).font(HermesFonts.body(12)).foregroundStyle(appearance.palette.secondary)
                  }
                }
                .contextMenu {
                  Button(role: .destructive) { onAction(.kanbanDelete, HermesRouteActionPayload(route: "kanban", id: card.id)) } label: { Label(chinese ? "归档" : "Archive", systemImage: "archivebox") }
                }
              }
            }.frame(width: 250, alignment: .topLeading)
          }
        }.padding(14)
      }.background(appearance.palette.background)
    case .profiles:
      List(data.profiles) { profile in
        HermesRemoteRow(icon: profile.active ? "person.crop.circle.fill" : "person.crop.circle", title: profile.name, detail: "\(profile.model) · \(profile.detail)", tint: profile.active ? appearance.palette.success : appearance.palette.secondary) {
          if !profile.active {
            Button { onAction(.profileActivate, HermesRouteActionPayload(route: "profiles", id: profile.id)) } label: { Image(systemName: "checkmark") }.buttonStyle(.borderless)
          }
        }
        .contextMenu {
          Button {
            editorName = profile.id
            editorDetail = profile.soul
            editor = .soul
          } label: { Label(chinese ? "编辑 SOUL.md" : "Edit SOUL.md", systemImage: "doc.text") }
          if !profile.active { Button(role: .destructive) { onAction(.profileDelete, HermesRouteActionPayload(route: "profiles", id: profile.id)) } label: { Label(chinese ? "删除 Profile" : "Delete Profile", systemImage: "trash") } }
        }
      }.hermesListStyle().refreshable { onAction(.refresh, HermesRouteActionPayload(route: "profiles")) }
    case .config:
      Form {
        Section(chinese ? "通用" : "General") {
          LabeledContent(chinese ? "默认模型" : "Default model", value: data.config.defaultModel)
          LabeledContent(chinese ? "时区" : "Timezone", value: data.config.timezone)
        }
        Section(chinese ? "执行" : "Execution") {
          LabeledContent(chinese ? "最大迭代" : "Max iterations", value: String(Int(data.config.maxIterations)))
          Toggle(chinese ? "流式输出" : "Stream output", isOn: .constant(data.config.streamOutput))
          Toggle(chinese ? "自动压缩" : "Automatic compaction", isOn: .constant(data.config.autoCompact))
        }
        Section(chinese ? "导出" : "Export") { ShareLink(item: data.config.exportText) { Label(chinese ? "分享配置" : "Share configuration", systemImage: "square.and.arrow.up") } }
      }.scrollContentBackground(.hidden).background(appearance.palette.background)
    case .env:
      List(data.environment) { secret in
        HermesRemoteRow(icon: "key.fill", title: secret.key, detail: secret.maskedValue, tint: appearance.palette.accent) {
          Button(role: .destructive) { onAction(.environmentDelete, HermesRouteActionPayload(route: "env", id: secret.id)) } label: { Image(systemName: "trash") }.buttonStyle(.borderless)
        }
      }.hermesListStyle().refreshable { onAction(.refresh, HermesRouteActionPayload(route: "env")) }
    case .system:
      HermesPage(subtitle: chinese ? "Hermes 网关、任务和资源状态" : "Hermes gateway, task, and resource status") {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
          GridRow {
            HermesMetric(title: "CPU", value: String(format: "%.0f%%", data.system.cpu), symbol: "cpu", tint: appearance.palette.primary)
            HermesMetric(title: chinese ? "内存" : "Memory", value: data.system.memoryLabel, symbol: "memorychip", tint: appearance.palette.warning)
          }
          GridRow {
            HermesMetric(title: chinese ? "运行时间" : "Uptime", value: data.system.uptimeLabel, symbol: "clock", tint: appearance.palette.success)
            HermesMetric(title: chinese ? "活动任务" : "Active tasks", value: data.system.activeTasks, symbol: "waveform", tint: appearance.palette.accent)
          }
        }
        HermesPanel {
          HStack { Text(chinese ? "网关状态" : "Gateway status").font(HermesFonts.display(15)); Spacer(); HermesStatusPill(text: data.system.gatewayOnline ? (chinese ? "在线" : "Online") : (chinese ? "离线" : "Offline"), color: data.system.gatewayOnline ? appearance.palette.success : appearance.palette.destructive) }
        }
        HStack {
          Button { onAction(.systemRestart, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "重启网关" : "Restart gateway", systemImage: "arrow.clockwise") }.buttonStyle(HermesPrimaryButtonStyle())
          Button { onAction(.systemUpdate, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "更新 Hermes" : "Update Hermes", systemImage: "arrow.down.circle") }.buttonStyle(.bordered)
        }
      }.refreshable { onAction(.refresh, HermesRouteActionPayload(route: "system")) }
    default:
      EmptyView()
    }
  }

  private var editorKind: HermesRemoteEditor? {
    switch route {
    case .cron: return .cron
    case .mcp: return .mcp
    case .webhooks: return .webhooks
    case .pairing: return .pairing
    case .profiles: return .profiles
    case .env: return .environment
    case .config: return .config
    default: return nil
    }
  }

  private func prepareEditor(_ kind: HermesRemoteEditor) {
    editorName = ""
    editorValue = ""
    editorDetail = ""
    if kind == .config { editorDetail = data.config.exportText }
    editor = kind
  }

  private func saveEditor(_ kind: HermesRemoteEditor) {
    let name = editorName.trimmingCharacters(in: .whitespacesAndNewlines)
    let value = editorValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let detail = editorDetail.trimmingCharacters(in: .whitespacesAndNewlines)
    switch kind {
    case .cron:
      guard !name.isEmpty, !detail.isEmpty else { return }
      onAction(.cronCreate, HermesRouteActionPayload(route: "cron", name: name, detail: detail, enabled: true, fields: ["schedule": value.isEmpty ? "0 * * * *" : value]))
    case .mcp:
      guard !name.isEmpty, !value.isEmpty else { return }
      onAction(.integrationCreate, HermesRouteActionPayload(route: "mcp", name: name, fields: ["url": value]))
    case .webhooks:
      guard !name.isEmpty else { return }
      onAction(.integrationCreate, HermesRouteActionPayload(route: "webhooks", name: name, fields: ["description": detail]))
    case .pairing:
      guard !name.isEmpty, !value.isEmpty else { return }
      onAction(.pairingApprove, HermesRouteActionPayload(route: "pairing", id: name, value: value))
    case .profiles:
      guard !name.isEmpty else { return }
      onAction(.profileCreate, HermesRouteActionPayload(route: "profiles", name: name, fields: ["description": detail, "model": value]))
    case .soul:
      guard !name.isEmpty else { return }
      onAction(.profileUpdate, HermesRouteActionPayload(route: "profiles", id: name, detail: editorDetail))
    case .environment:
      guard !name.isEmpty else { return }
      onAction(.environmentUpsert, HermesRouteActionPayload(route: "env", id: name, value: editorValue))
    case .config:
      guard !detail.isEmpty else { return }
      onAction(.configUpdate, HermesRouteActionPayload(route: "config", value: detail))
    }
    editor = nil
  }
}

private struct HermesRemoteEditorSheet: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let kind: HermesRemoteEditor
  let chinese: Bool
  @Binding var name: String
  @Binding var value: String
  @Binding var detail: String
  let onCancel: () -> Void
  let onSave: () -> Void

  var body: some View {
    NavigationStack {
      Form {
        if kind == .config || kind == .soul {
          Section(kind == .soul ? "SOUL.md" : "config.json") {
            TextEditor(text: $detail)
              .font(HermesFonts.mono(12))
              .frame(minHeight: 320)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
        } else {
          TextField(nameLabel, text: $name)
            .textInputAutocapitalization(kind == .environment ? .characters : .never)
            .autocorrectionDisabled()
          if kind == .cron || kind == .mcp || kind == .pairing || kind == .profiles || kind == .environment {
            Group {
              if kind == .environment {
                SecureField(valueLabel, text: $value)
              } else {
                TextField(valueLabel, text: $value)
                  .textInputAutocapitalization(.never)
                  .autocorrectionDisabled()
              }
            }
          }
          if kind == .cron || kind == .webhooks || kind == .profiles {
            TextField(detailLabel, text: $detail, axis: .vertical)
              .lineLimit(3...8)
          }
        }
      }
      .scrollContentBackground(.hidden)
      .background(appearance.palette.background)
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(chinese ? "取消" : "Cancel", action: onCancel)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(chinese ? "保存" : "Save", action: onSave)
        }
      }
    }
    .presentationDetents(kind == .config || kind == .soul ? [.large] : [.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var title: String {
    if !chinese {
      if kind == .config { return "Edit Configuration" }
      if kind == .soul { return "Edit SOUL.md" }
      return "Add \(kind.rawValue.capitalized)"
    }
    switch kind {
    case .cron: return "新建定时任务"
    case .mcp: return "添加 MCP 服务器"
    case .webhooks: return "添加 Webhook"
    case .pairing: return "批准配对用户"
    case .profiles: return "新建 Profile"
    case .soul: return "编辑 SOUL.md"
    case .environment: return "添加或替换密钥"
    case .config: return "编辑配置"
    }
  }

  private var nameLabel: String {
    if kind == .pairing { return chinese ? "平台" : "Platform" }
    return chinese ? "名称" : "Name"
  }
  private var valueLabel: String {
    if !chinese { return kind == .cron ? "Schedule" : kind == .mcp ? "Server URL" : kind == .pairing ? "Pairing code" : kind == .profiles ? "Model" : "Secret value" }
    switch kind {
    case .cron: return "计划表达式"
    case .mcp: return "服务器 URL"
    case .pairing: return "配对码"
    case .profiles: return "模型"
    default: return "密钥值"
    }
  }
  private var detailLabel: String {
    chinese ? (kind == .cron ? "任务提示词" : "说明") : (kind == .cron ? "Prompt" : "Description")
  }
}

private struct HermesRemoteRow<Trailing: View>: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let icon: String
  let title: String
  let detail: String
  let tint: Color
  @ViewBuilder let trailing: () -> Trailing

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon).foregroundStyle(tint).frame(width: 26)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(HermesFonts.bodyBold(15))
        if !detail.isEmpty { Text(detail).font(HermesFonts.mono(10)).foregroundStyle(appearance.palette.secondary) }
      }
      Spacer()
      trailing()
    }.padding(.vertical, 4)
  }
}

private struct HermesSessionsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let sessions: [HermesSessionSnapshot]
  let onAction: HermesRouteActionSink
  @State private var search = ""
  @State private var renameTarget: HermesSessionSnapshot?
  @State private var renameText = ""

  private var filtered: [HermesSessionSnapshot] {
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
          .simultaneousGesture(TapGesture().onEnded {
            onAction(
              .sessionSelect,
              HermesRouteActionPayload(route: "sessions", id: session.id)
            )
          })
          .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
              onAction(
                .sessionDelete,
                HermesRouteActionPayload(route: "sessions", id: session.id)
              )
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
              onAction(
                .sessionDelete,
                HermesRouteActionPayload(route: "sessions", id: session.id)
              )
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
      onAction(.refresh, HermesRouteActionPayload(route: "sessions"))
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
              onAction(
                .sessionRename,
                HermesRouteActionPayload(
                  route: "sessions",
                  id: target.id,
                  name: renameText
                )
              )
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
  let session: HermesSessionSnapshot
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
          Text(session.detail ?? "")
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

private struct HermesFilesPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let files: [HermesFileSnapshot]
  let onAction: HermesRouteActionSink
  @State private var search = ""
  @State private var importerOpen = false
  @State private var folderSheetOpen = false
  @State private var newFolder = ""
  @State private var selectedFile: HermesFileSnapshot?

  private var filtered: [HermesFileSnapshot] {
    search.isEmpty ? files : files.filter { $0.name.localizedCaseInsensitiveContains(search) }
  }

  var body: some View {
    List {
      Section("~/.hermes") {
        ForEach(filtered) { file in
          Button {
            selectedFile = file
            onAction(
              .fileSelect,
              HermesRouteActionPayload(route: "files", id: file.id)
            )
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
              onAction(
                .fileDelete,
                HermesRouteActionPayload(route: "files", id: file.id)
              )
            } label: {
              Label(chinese ? "删除" : "Delete", systemImage: "trash")
            }
            ShareLink(item: file.name) {
              Label(chinese ? "分享" : "Share", systemImage: "square.and.arrow.up")
            }
            .tint(appearance.palette.primary)
            if !file.folder {
              Button {
                onAction(
                  .fileDownload,
                  HermesRouteActionPayload(
                    route: "files",
                    id: file.id,
                    name: file.name
                  )
                )
              } label: {
                Label(chinese ? "下载" : "Download", systemImage: "arrow.down.circle")
              }
              .tint(appearance.palette.accent)
            }
          }
        }
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .searchable(text: $search, prompt: chinese ? "搜索文件" : "Search files")
    .refreshable {
      onAction(.refresh, HermesRouteActionPayload(route: "files"))
    }
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
        onAction(
          .fileImport,
          HermesRouteActionPayload(
            route: "files",
            uris: urls.map(\.absoluteString)
          )
        )
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
              onAction(
                .folderCreate,
                HermesRouteActionPayload(route: "files", name: newFolder)
              )
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
    .onChange(of: files) { next in
      guard let selectedFile else { return }
      self.selectedFile = next.first { $0.id == selectedFile.id }
    }
  }
}

private struct HermesFilePreview: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  @Environment(\.dismiss) private var dismiss
  let file: HermesFileSnapshot
  let chinese: Bool

  var body: some View {
    NavigationStack {
      Group {
        if file.folder {
          List {
            ForEach(file.children ?? []) { child in
              Label(
                child.name,
                systemImage: child.folder ? "folder.fill" : "doc.text"
              )
            }
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
    file.previewText ?? ""
  }
}

private struct HermesAnalyticsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let analytics: HermesAnalyticsSnapshot
  let chinese: Bool
  let renderChart: Bool
  let onAction: HermesRouteActionSink

  private var points: [HermesAnalyticsPointSnapshot] { analytics.points }

  var body: some View {
    HermesPage(subtitle: chinese ? "令牌使用、费用和模型活动" : "Token usage, cost, and model activity") {
      Grid(horizontalSpacing: 12, verticalSpacing: 12) {
        GridRow {
          HermesMetric(title: chinese ? "输入令牌" : "Input Tokens", value: analytics.inputTokens, symbol: "arrow.down.circle")
          HermesMetric(title: chinese ? "输出令牌" : "Output Tokens", value: analytics.outputTokens, symbol: "arrow.up.circle", tint: appearance.palette.primary)
        }
        GridRow {
          HermesMetric(title: chinese ? "本月费用" : "Monthly Cost", value: analytics.monthlyCost, symbol: "dollarsign.circle", tint: appearance.palette.warning)
          HermesMetric(title: chinese ? "成功率" : "Success Rate", value: analytics.successRate, symbol: "checkmark.seal", tint: appearance.palette.success)
        }
      }

      HermesPanel {
        VStack(alignment: .leading, spacing: 14) {
          Text(chinese ? "最近 7 天" : "Last 7 Days")
            .font(HermesFonts.display(15))
          if renderChart {
            Chart(points) { point in
              LineMark(x: .value("Day", point.label), y: .value("Input", point.input))
                .foregroundStyle(appearance.palette.accent)
                .interpolationMethod(.catmullRom)
              AreaMark(x: .value("Day", point.label), y: .value("Input", point.input))
                .foregroundStyle(appearance.palette.accent.opacity(0.12))
                .interpolationMethod(.catmullRom)
              LineMark(x: .value("Day", point.label), y: .value("Output", point.output))
                .foregroundStyle(appearance.palette.primary)
                .interpolationMethod(.catmullRom)
            }
            .chartLegend(.hidden)
            .frame(height: 240)
          } else {
            Color.clear
              .frame(height: 240)
              .accessibilityHidden(true)
          }
        }
      }
    }
    .refreshable {
      onAction(.refresh, HermesRouteActionPayload(route: "analytics"))
    }
  }
}

private struct HermesModelsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let models: [HermesModelSnapshot]
  let onAction: HermesRouteActionSink
  @State private var replacement: HermesModelSnapshot?

  var body: some View {
    List {
      Section(chinese ? "可用模型" : "Available Models") {
        ForEach(models) { model in
          Button {
            replacement = model
          } label: {
            HStack(spacing: 12) {
              Image(systemName: "cpu")
                .foregroundStyle(model.active ? appearance.palette.success : appearance.palette.secondary)
              VStack(alignment: .leading, spacing: 3) {
                Text(model.id).font(HermesFonts.mono(14))
                Text("\(model.provider) · \(model.context)")
                  .font(HermesFonts.body(12))
                  .foregroundStyle(appearance.palette.secondary)
              }
              Spacer()
              if model.active {
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
    .refreshable {
      onAction(.refresh, HermesRouteActionPayload(route: "models"))
    }
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
          onAction(
            .modelSelect,
            HermesRouteActionPayload(route: "models", id: replacement.id)
          )
          self.replacement = nil
        }
      }
      Button(chinese ? "取消" : "Cancel", role: .cancel) {}
    }
  }
}

private struct HermesLogsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let logs: [HermesLogSnapshot]
  let onAction: HermesRouteActionSink
  @State private var level = "ALL"
  @State private var search = ""

  private var filteredLogs: [HermesLogSnapshot] {
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
        TimelineView(.periodic(from: .now, by: 1)) { _ in
          HermesFrameRateLogRow(
            chinese: chinese,
            snapshot: HermesFrameRateController.shared.snapshot()
          )
        }
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
      .refreshable {
        onAction(.refresh, HermesRouteActionPayload(route: "logs"))
      }
    }
    .background(appearance.palette.background)
    .searchable(text: $search, prompt: chinese ? "搜索日志" : "Search logs")
    .onChange(of: level) { next in
      onAction(
        .logsFilter,
        HermesRouteActionPayload(route: "logs", value: next)
      )
    }
  }
}

private struct HermesFrameRateLogRow: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let snapshot: HermesFrameRateSnapshot

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Text("LIVE")
        .font(HermesFonts.mono(10))
        .foregroundStyle(appearance.palette.tertiary)
      Text("FPS")
        .font(HermesFonts.mono(10))
        .foregroundStyle(
          snapshot.measuredCallbacksPerSecond >= 110
            ? appearance.palette.success
            : appearance.palette.warning
        )
        .frame(width: 38, alignment: .leading)
      Text(message)
        .font(HermesFonts.mono(12))
        .textSelection(.enabled)
    }
    .padding(.vertical, 3)
  }

  private var message: String {
    let measured = String(format: "%.1f", snapshot.measuredCallbacksPerSecond)
    let power = snapshot.lowPowerMode ? (chinese ? "低电量开启" : "Low Power On") : (chinese ? "低电量关闭" : "Low Power Off")
    return "max=\(snapshot.screenMaximumFramesPerSecond) requested=\(snapshot.requestedFramesPerSecond) measured=\(measured) \(power) thermal=\(snapshot.thermalState)"
  }
}
