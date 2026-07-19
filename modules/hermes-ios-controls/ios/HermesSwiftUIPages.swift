import Charts
import Foundation
import SwiftUI
import UIKit
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
    case .smartWeather:
      EmptyView()
    case .models:
      HermesModelsPage(
        chinese: chinese,
        detectedModels: data.detectedModels,
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
    case .account:
      EmptyView()
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
  case collaboration
  case cron
  case mcp
  case webhooks
  case pairing
  case profiles
  case soul
  case skill
  case kanban
  case channel
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
  @State private var collaborationPendingRequestId = ""
  @State private var collaborationPendingRoomId = ""
  @State private var collaborationPendingText = ""
  @State private var editor: HermesRemoteEditor?
  @State private var editorID = ""
  @State private var editorName = ""
  @State private var editorValue = ""
  @State private var editorDetail = ""
  @State private var importingConfiguration = false
  @State private var requestedSkillID = ""

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
          kanbanColumns: data.kanban,
          onCancel: { editor = nil },
          onSave: { saveEditor(kind) }
        )
        .environmentObject(appearance)
      }
      .onChange(of: data.skills) { _, skills in
        guard !requestedSkillID.isEmpty,
              let skill = skills.first(where: { $0.id == requestedSkillID }),
              let content = skill.content else { return }
        editorID = skill.id
        editorName = skill.name
        editorValue = ""
        editorDetail = content
        requestedSkillID = ""
        editor = .skill
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
          Button {
            requestedSkillID = skill.id
            onAction(.skillSelect, HermesRouteActionPayload(route: "skills", id: skill.id))
          } label: {
            Label(chinese ? "编辑 SKILL.md" : "Edit SKILL.md", systemImage: "square.and.pencil")
          }
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
        .contextMenu {
          if route == .channels {
            Button {
              editorID = item.id
              editorName = item.name
              editorValue = ""
              editorDetail = item.configuration ?? "{}"
              editor = .channel
            } label: {
              Label(chinese ? "编辑渠道配置" : "Edit channel configuration", systemImage: "gearshape")
            }
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
        Button {
          onAction(.achievementsRescan, HermesRouteActionPayload(route: "achievements"))
        } label: {
          Label(chinese ? "重新扫描成就" : "Rescan achievements", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
      }
    case .collaboration:
      VStack(spacing: 0) {
        if data.collaboration.rooms.isEmpty {
          ContentUnavailableView(
            chinese ? "暂无协作房间" : "No collaboration rooms",
            systemImage: "person.3",
            description: Text(chinese ? "点击右上角添加真实 Hermes 协作房间。" : "Add a Hermes collaboration room from the toolbar.")
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          List(data.collaboration.rooms) { room in
            Button {
              onAction(.collaborationSelect, HermesRouteActionPayload(route: "collaboration", id: room.id))
            } label: {
              Label(room.name, systemImage: room.id == data.collaboration.selectedRoomId ? "checkmark.circle.fill" : "number")
            }
            .buttonStyle(.plain)
            .swipeActions {
              Button(role: .destructive) {
                onAction(
                  .collaborationDelete,
                  HermesRouteActionPayload(route: "collaboration", id: room.id)
                )
              } label: {
                Label(chinese ? "删除" : "Delete", systemImage: "trash")
              }
            }
          }
          .scrollContentBackground(.hidden)
          .frame(maxHeight: 180)
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
              ForEach(data.collaboration.messages) { message in
                Text(message.text).font(HermesFonts.body(14)).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(appearance.palette.surface).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
              }
            }
            .padding(14)
          }
          HStack {
            TextField(chinese ? "发送消息" : "Message", text: $collaborationDraft)
              .textFieldStyle(.roundedBorder)
              .submitLabel(.send)
              .onSubmit { dismissHermesKeyboard() }
            Button {
              let text = collaborationDraft.trimmingCharacters(in: .whitespacesAndNewlines)
              let roomId = data.collaboration.selectedRoomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
              guard !text.isEmpty, !roomId.isEmpty else { return }
              dismissHermesKeyboard()
              let requestId: String
              if collaborationPendingRoomId == roomId,
                 collaborationPendingText == text,
                 !collaborationPendingRequestId.isEmpty {
                requestId = collaborationPendingRequestId
              } else {
                requestId = "room-request-\(UUID().uuidString.lowercased())"
                collaborationPendingRequestId = requestId
                collaborationPendingRoomId = roomId
                collaborationPendingText = text
              }
              onAction(
                .collaborationSend,
                HermesRouteActionPayload(
                  route: "collaboration",
                  id: roomId,
                  value: text,
                  requestId: requestId
                )
              )
            } label: { Image(systemName: "arrow.up.circle.fill") }
          }.padding(12).background(.ultraThinMaterial)
        }
      }
      .background(appearance.palette.background)
      .onChange(of: collaborationDraft) { next in
        let normalized = next.trimmingCharacters(in: .whitespacesAndNewlines)
        if !collaborationPendingRequestId.isEmpty && normalized != collaborationPendingText {
          collaborationPendingRequestId = ""
          collaborationPendingRoomId = ""
          collaborationPendingText = ""
        }
      }
      .onChange(of: data.collaboration.acknowledgedRequestId) { acknowledged in
        guard acknowledged == collaborationPendingRequestId else { return }
        collaborationDraft = ""
        collaborationPendingRequestId = ""
        collaborationPendingRoomId = ""
        collaborationPendingText = ""
      }
    case .kanban:
      Group {
        if data.kanban.isEmpty {
          ContentUnavailableView(
            chinese ? "暂无看板任务" : "No Kanban tasks",
            systemImage: "rectangle.3.group",
            description: Text(chinese ? "点击右上角创建真实 Hermes 看板任务。" : "Create a Hermes Kanban task from the toolbar.")
          )
        } else {
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
                  Button {
                    editorID = card.id
                    editorName = card.title
                    editorValue = column.id
                    editorDetail = card.detail
                    editor = .kanban
                  } label: {
                    Label(chinese ? "编辑任务" : "Edit task", systemImage: "square.and.pencil")
                  }
                  Menu {
                    ForEach(data.kanban.filter { $0.id != column.id }) { target in
                      Button(target.title) {
                        onAction(
                          .kanbanMove,
                          HermesRouteActionPayload(route: "kanban", id: card.id, targetId: target.id)
                        )
                      }
                    }
                  } label: {
                    Label(chinese ? "移动到" : "Move to", systemImage: "arrow.right.circle")
                  }
                  Button(role: .destructive) { onAction(.kanbanDelete, HermesRouteActionPayload(route: "kanban", id: card.id)) } label: { Label(chinese ? "归档" : "Archive", systemImage: "archivebox") }
                }
              }
              }.frame(width: 250, alignment: .topLeading)
            }
            .padding(14)
          }
        }
      }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(appearance.palette.background)
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
          Toggle(chinese ? "流式输出" : "Stream output", isOn: Binding(
            get: { data.config.streamOutput },
            set: { updateConfigValue("stream_output", value: $0) }
          ))
          Toggle(chinese ? "自动压缩" : "Automatic compaction", isOn: Binding(
            get: { data.config.autoCompact },
            set: { updateConfigValue("auto_compact", value: $0) }
          ))
        }
        Section(chinese ? "导入与导出" : "Import and export") {
          Button {
            importingConfiguration = true
          } label: {
            Label(chinese ? "导入配置" : "Import configuration", systemImage: "square.and.arrow.down")
          }
          ShareLink(item: data.config.exportText) {
            Label(chinese ? "分享配置" : "Share configuration", systemImage: "square.and.arrow.up")
          }
        }
      }.scrollContentBackground(.hidden).background(appearance.palette.background)
        .fileImporter(
          isPresented: $importingConfiguration,
          allowedContentTypes: [.json, .plainText],
          allowsMultipleSelection: false
        ) { result in
          guard case let .success(urls) = result, let url = urls.first else { return }
          let accessed = url.startAccessingSecurityScopedResource()
          defer { if accessed { url.stopAccessingSecurityScopedResource() } }
          guard let content = try? String(contentsOf: url, encoding: .utf8) else { return }
          onAction(.configImport, HermesRouteActionPayload(route: "config", value: content))
        }
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
        ForEach(data.system.nodes) { node in
          HermesPanel {
            VStack(alignment: .leading, spacing: 12) {
              HStack(spacing: 8) {
                Circle()
                  .fill(node.gatewayOnline ? appearance.palette.success : appearance.palette.destructive)
                  .frame(width: 9, height: 9)
                Text(node.label)
                  .font(HermesFonts.display(15))
                Spacer()
                HermesStatusPill(
                  text: node.gatewayOnline ? (chinese ? "网关在线" : "Online") : (chinese ? "网关离线" : "Offline"),
                  color: node.gatewayOnline ? appearance.palette.success : appearance.palette.destructive
                )
              }
              if !node.version.isEmpty {
                Text("Hermes \(node.version)")
                  .font(HermesFonts.mono(11))
                  .foregroundStyle(appearance.palette.secondary)
              }
              Grid(horizontalSpacing: 12, verticalSpacing: 8) {
                GridRow {
                  LabeledContent("CPU", value: String(format: "%.0f%%", node.cpu))
                  LabeledContent(chinese ? "内存" : "Memory", value: String(format: "%.0f%%", node.memory))
                }
                GridRow {
                  LabeledContent(chinese ? "磁盘" : "Disk", value: String(format: "%.0f%%", node.disk))
                  LabeledContent(chinese ? "活动任务" : "Tasks", value: node.activeTasks)
                }
              }
              .font(HermesFonts.body(12))
              Text(chinese
                ? "采集：\(node.metricsSource) · \(node.observedAt)"
                : "Source: \(node.metricsSource) · \(node.observedAt)")
                .font(HermesFonts.mono(9))
                .foregroundStyle(appearance.palette.tertiary)
            }
          }
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
    case .kanban: return .kanban
    case .collaboration: return .collaboration
    case .config: return .config
    default: return nil
    }
  }

  private func prepareEditor(_ kind: HermesRemoteEditor) {
    editorID = ""
    editorName = ""
    editorValue = kind == .kanban
      ? (data.kanban.first?.id ?? "")
      : kind == .collaboration
        ? data.collaboration.availableProfiles.joined(separator: ", ")
        : ""
    editorDetail = ""
    if kind == .config { editorDetail = data.config.exportText }
    editor = kind
  }

  private func saveEditor(_ kind: HermesRemoteEditor) {
    dismissHermesKeyboard()
    let name = editorName.trimmingCharacters(in: .whitespacesAndNewlines)
    let value = editorValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let detail = editorDetail.trimmingCharacters(in: .whitespacesAndNewlines)
    switch kind {
    case .collaboration:
      let profiles = value.split(separator: ",").map {
        String($0).trimmingCharacters(in: .whitespaces)
      }.filter { !$0.isEmpty }
      guard !name.isEmpty, !profiles.isEmpty else { return }
      onAction(.collaborationCreate, HermesRouteActionPayload(route: "collaboration", name: name, fields: ["profiles": profiles.joined(separator: ",")]))
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
    case .skill:
      guard !editorID.isEmpty else { return }
      onAction(.skillUpdate, HermesRouteActionPayload(route: "skills", id: editorID, detail: editorDetail))
    case .kanban:
      guard !name.isEmpty else { return }
      if editorID.isEmpty {
        onAction(.kanbanCreate, HermesRouteActionPayload(route: "kanban", name: name, detail: detail, targetId: value))
      } else {
        onAction(.kanbanUpdate, HermesRouteActionPayload(route: "kanban", id: editorID, name: name, detail: detail, targetId: value))
      }
    case .channel:
      guard !editorID.isEmpty, !detail.isEmpty else { return }
      onAction(.integrationUpdate, HermesRouteActionPayload(route: "channels", id: editorID, value: detail))
    case .config:
      guard !detail.isEmpty else { return }
      onAction(.configUpdate, HermesRouteActionPayload(route: "config", value: detail))
    }
    editor = nil
  }

  private func updateConfigValue(_ key: String, value: Any) {
    guard let data = self.data.config.exportText.data(using: .utf8),
          var config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    config[key] = value
    guard let updated = try? JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]),
          let json = String(data: updated, encoding: .utf8) else { return }
    onAction(.configUpdate, HermesRouteActionPayload(route: "config", value: json))
  }
}

private struct HermesRemoteEditorSheet: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let kind: HermesRemoteEditor
  let chinese: Bool
  @Binding var name: String
  @Binding var value: String
  @Binding var detail: String
  let kanbanColumns: [HermesKanbanColumnSnapshot]
  let onCancel: () -> Void
  let onSave: () -> Void

  var body: some View {
    NavigationStack {
      Form {
        if kind == .config || kind == .soul || kind == .skill || kind == .channel {
          Section(kind == .soul ? "SOUL.md" : kind == .skill ? "SKILL.md" : kind == .channel ? (chinese ? "渠道配置 JSON" : "Channel configuration JSON") : "config.json") {
            TextEditor(text: $detail)
              .font(HermesFonts.mono(12))
              .frame(minHeight: 320)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
        } else {
          TextField(nameLabel, text: $name)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          if kind == .collaboration || kind == .cron || kind == .mcp || kind == .pairing || kind == .profiles || kind == .kanban {
            Group {
              if kind == .kanban {
                Picker(chinese ? "状态" : "Status", selection: $value) {
                  ForEach(kanbanColumns) { column in
                    Text(column.title).tag(column.id)
                  }
                }
              } else {
                TextField(valueLabel, text: $value)
                  .textInputAutocapitalization(.never)
                  .autocorrectionDisabled()
              }
            }
          }
          if kind == .cron || kind == .webhooks || kind == .profiles || kind == .kanban {
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
          Button(chinese ? "取消" : "Cancel") {
            dismissHermesKeyboard()
            onCancel()
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(chinese ? "保存" : "Save") {
            dismissHermesKeyboard()
            onSave()
          }
        }
      }
    }
    .presentationDetents(kind == .config || kind == .soul || kind == .skill || kind == .channel ? [.large] : [.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var title: String {
    if !chinese {
      if kind == .config { return "Edit Configuration" }
      if kind == .soul { return "Edit SOUL.md" }
      if kind == .skill { return "Edit SKILL.md" }
      if kind == .kanban { return name.isEmpty ? "New Task" : "Edit Task" }
      if kind == .channel { return "Edit Channel Configuration" }
      return "Add \(kind.rawValue.capitalized)"
    }
    switch kind {
    case .collaboration: return "新建协作房间"
    case .cron: return "新建定时任务"
    case .mcp: return "添加 MCP 服务器"
    case .webhooks: return "添加 Webhook"
    case .pairing: return "批准配对用户"
    case .profiles: return "新建 Profile"
    case .soul: return "编辑 SOUL.md"
    case .skill: return "编辑 SKILL.md"
    case .kanban: return name.isEmpty ? "新建任务" : "编辑任务"
    case .channel: return "编辑渠道配置"
    case .config: return "编辑配置"
    }
  }

  private var nameLabel: String {
    if kind == .collaboration { return chinese ? "房间名称" : "Room name" }
    if kind == .pairing { return chinese ? "平台" : "Platform" }
    if kind == .kanban { return chinese ? "标题" : "Title" }
    return chinese ? "名称" : "Name"
  }
  private var valueLabel: String {
    if !chinese { return kind == .collaboration ? "Profiles, separated by commas" : kind == .cron ? "Schedule" : kind == .mcp ? "Server URL" : kind == .pairing ? "Pairing code" : kind == .profiles ? "Model" : "Secret value" }
    switch kind {
    case .collaboration: return "Profile（用逗号分隔）"
    case .cron: return "计划表达式"
    case .mcp: return "服务器 URL"
    case .pairing: return "配对码"
    case .profiles: return "模型"
    case .kanban: return "状态"
    default: return "密钥值"
    }
  }
  private var detailLabel: String {
    chinese ? (kind == .cron ? "任务提示词" : kind == .kanban ? "任务内容" : "说明") : (kind == .cron ? "Prompt" : kind == .kanban ? "Task details" : "Description")
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
          Button {
            onAction(
              .sessionOpen,
              HermesRouteActionPayload(
                route: "sessions",
                id: session.id,
                fields: session.profile.map { ["profile": $0] }
              )
            )
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
          .buttonStyle(.plain)
          .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
              onAction(
                .sessionDelete,
                HermesRouteActionPayload(
                  route: "sessions",
                  id: session.id,
                  fields: session.profile.map { ["profile": $0] }
                )
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
                HermesRouteActionPayload(
                  route: "sessions",
                  id: session.id,
                  fields: session.profile.map { ["profile": $0] }
                )
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
            .submitLabel(.done)
            .onSubmit { dismissHermesKeyboard() }
        }
        .navigationTitle(chinese ? "重命名会话" : "Rename Session")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(chinese ? "取消" : "Cancel") {
              dismissHermesKeyboard()
              renameTarget = nil
            }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(chinese ? "保存" : "Save") {
              dismissHermesKeyboard()
              onAction(
                .sessionRename,
                HermesRouteActionPayload(
                  route: "sessions",
                  id: target.id,
                  name: renameText,
                  fields: target.profile.map { ["profile": $0] }
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

private enum HermesFileSourceFilter: String, CaseIterable, Identifiable {
  case all
  case model
  case user

  var id: String { rawValue }
}

private struct HermesFileSection: Identifiable {
  let id: String
  let files: [HermesFileSnapshot]
  let timestamp: Double
}

private enum HermesFileImportStaging {
  private static let directoryName = "HermesFileImports"
  private static let maximumAge: TimeInterval = 24 * 60 * 60

  static func stage(_ sourceURLs: [URL]) -> [URL] {
    cleanupExpiredBatches()
    guard !sourceURLs.isEmpty, let root = stagingRoot() else { return [] }

    let batch = root.appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
    do {
      try FileManager.default.createDirectory(
        at: batch,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
    } catch {
      return []
    }

    let staged = sourceURLs.compactMap { stage($0, in: batch) }
    if staged.isEmpty { try? FileManager.default.removeItem(at: batch) }
    scheduleCleanup()
    return staged
  }

  private static func stage(_ sourceURL: URL, in batch: URL) -> URL? {
    let hasSecurityScope = sourceURL.startAccessingSecurityScopedResource()
    defer {
      if hasSecurityScope { sourceURL.stopAccessingSecurityScopedResource() }
    }

    let requestedName = sourceURL.lastPathComponent
    let fileName = requestedName.isEmpty || requestedName == "." || requestedName == ".."
      ? "attachment"
      : requestedName
    let destination = uniqueDestination(named: fileName, in: batch)
    var coordinationError: NSError?
    var copyError: Error?
    var copied = false
    NSFileCoordinator().coordinate(
      readingItemAt: sourceURL,
      options: [],
      error: &coordinationError
    ) { readableURL in
      do {
        try FileManager.default.copyItem(at: readableURL, to: destination)
        copied = true
      } catch {
        copyError = error
      }
    }
    guard coordinationError == nil, copyError == nil, copied else {
      try? FileManager.default.removeItem(at: destination)
      return nil
    }
    return destination
  }

  private static func stagingRoot() -> URL? {
    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      return nil
    }
    let root = caches.appendingPathComponent(directoryName, isDirectory: true)
    do {
      try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
      return root
    } catch {
      return nil
    }
  }

  private static func uniqueDestination(named name: String, in batch: URL) -> URL {
    let initial = batch.appendingPathComponent(name, isDirectory: false)
    guard FileManager.default.fileExists(atPath: initial.path) else { return initial }
    let source = initial.deletingPathExtension().lastPathComponent
    let extensionName = initial.pathExtension
    let uniqueName = extensionName.isEmpty
      ? "\(source)-\(UUID().uuidString.lowercased())"
      : "\(source)-\(UUID().uuidString.lowercased()).\(extensionName)"
    return batch.appendingPathComponent(uniqueName, isDirectory: false)
  }

  private static func cleanupExpiredBatches(now: Date = Date()) {
    guard let root = stagingRoot(),
          let batches = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey, .creationDateKey],
            options: [.skipsHiddenFiles]
          ) else { return }
    for batch in batches {
      let values = try? batch.resourceValues(forKeys: [.contentModificationDateKey, .creationDateKey])
      let timestamp = values?.contentModificationDate ?? values?.creationDate ?? .distantPast
      if now.timeIntervalSince(timestamp) >= maximumAge {
        try? FileManager.default.removeItem(at: batch)
      }
    }
  }

  private static func scheduleCleanup() {
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + maximumAge) {
      cleanupExpiredBatches()
    }
  }
}

private struct HermesFilesPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let files: [HermesFileSnapshot]
  let onAction: HermesRouteActionSink
  @State private var search = ""
  @State private var importerOpen = false
  @State private var filterByDate = false
  @State private var selectedDate = Date()
  @State private var sourceFilter = HermesFileSourceFilter.all

  private var filtered: [HermesFileSnapshot] {
    files.filter { file in
      let matchesSearch = search.isEmpty
        || file.name.localizedCaseInsensitiveContains(search)
        || file.detail.localizedCaseInsensitiveContains(search)
      let matchesSource = switch sourceFilter {
      case .all: true
      case .model: file.source == "model_output"
      case .user: file.source == "user_upload"
      }
      let matchesDate: Bool
      if filterByDate, let timestamp = file.createdAt {
        matchesDate = Calendar.current.isDate(
          Date(timeIntervalSince1970: timestamp / 1000),
          inSameDayAs: selectedDate
        )
      } else {
        matchesDate = !filterByDate
      }
      return matchesSearch && matchesSource && matchesDate
    }
  }

  private var sections: [HermesFileSection] {
    Dictionary(grouping: filtered) { $0.dateLabel ?? (chinese ? "未知日期" : "Unknown Date") }
      .map { label, entries in
        HermesFileSection(
          id: label,
          files: entries.sorted { ($0.createdAt ?? 0) > ($1.createdAt ?? 0) },
          timestamp: entries.map { $0.createdAt ?? 0 }.max() ?? 0
        )
      }
      .sorted { $0.timestamp > $1.timestamp }
  }

  var body: some View {
    List {
      if sections.isEmpty {
        ContentUnavailableView(
          LocalizedStringKey(
            search.isEmpty
              ? (chinese ? "暂无云端文件" : "No Cloud Files")
              : (chinese ? "没有匹配的文件" : "No Matching Files")
          ),
          systemImage: search.isEmpty ? "icloud" : "doc.text.magnifyingglass"
        )
      }
      ForEach(sections) { section in
        Section(section.id) {
          ForEach(section.files) { file in
          Button {
            guard file.status == "available" else { return }
            onAction(
              .fileDownload,
              HermesRouteActionPayload(route: "files", id: file.id, name: file.name)
            )
          } label: {
            HStack(spacing: 12) {
              Image(systemName: symbol(for: file))
                .foregroundStyle(file.source == "model_output" ? appearance.palette.accent : appearance.palette.primary)
                .frame(width: 26)
              VStack(alignment: .leading, spacing: 3) {
                Text(file.name).font(HermesFonts.bodyBold(15))
                Text(file.detail)
                  .font(HermesFonts.body(11))
                  .foregroundStyle(appearance.palette.secondary)
                Label(
                  file.source == "model_output"
                    ? (chinese ? "Hermes 生成" : "Generated by Hermes")
                    : (chinese ? "用户上传" : "Uploaded by User"),
                  systemImage: file.source == "model_output" ? "sparkles" : "person.crop.circle"
                )
                .font(HermesFonts.body(10))
                .foregroundStyle(appearance.palette.secondary)
              }
              Spacer()
              if file.status == "uploading" {
                ProgressView().controlSize(.small)
              } else if file.status == "failed" {
                Image(systemName: "exclamationmark.circle.fill")
                  .foregroundStyle(appearance.palette.destructive)
              } else {
                Image(systemName: "chevron.right")
                  .font(.caption.weight(.semibold))
                  .foregroundStyle(appearance.palette.secondary.opacity(0.6))
              }
            }
            .contentShape(Rectangle())
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
            if file.status == "available" {
              Button {
                onAction(
                  .fileShare,
                  HermesRouteActionPayload(route: "files", id: file.id, name: file.name)
                )
              } label: {
                Label(chinese ? "分享" : "Share", systemImage: "square.and.arrow.up")
              }
              .tint(appearance.palette.primary)
            }
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
        Menu {
          Picker(chinese ? "来源" : "Source", selection: $sourceFilter) {
            Text(chinese ? "全部" : "All").tag(HermesFileSourceFilter.all)
            Text(chinese ? "用户上传" : "User Uploads").tag(HermesFileSourceFilter.user)
            Text(chinese ? "模型生成" : "Model Outputs").tag(HermesFileSourceFilter.model)
          }
          Toggle(chinese ? "按日期筛选" : "Filter by Date", isOn: $filterByDate)
          if filterByDate {
            DatePicker(
              chinese ? "日期" : "Date",
              selection: $selectedDate,
              displayedComponents: .date
            )
          }
        } label: {
          Label(chinese ? "筛选" : "Filter", systemImage: "line.3.horizontal.decrease.circle")
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
        let stagedURLs = HermesFileImportStaging.stage(urls)
        guard !stagedURLs.isEmpty else { return }
        onAction(
          .fileImport,
          HermesRouteActionPayload(
            route: "files",
            fields: ["stagedImport": "true"],
            uris: stagedURLs.map(\.absoluteString)
          )
        )
      }
    }
  }

  private func symbol(for file: HermesFileSnapshot) -> String {
    switch file.fileType {
    case "image": "photo"
    case "video": "film"
    case "audio": "waveform"
    case "archive": "archivebox"
    case "code": "chevron.left.forwardslash.chevron.right"
    case "document": "doc.text"
    default: "doc"
    }
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
  let detectedModels: [String]
  let models: [HermesModelSnapshot]
  let onAction: HermesRouteActionSink
  @State private var apiKey = ""
  @State private var apiMode = "chat_completions"
  @State private var baseUrl = ""
  @State private var contextLength = "131072"
  @State private var modelName = ""
  @State private var reasoningEffort = "none"

  private var configuration: HermesModelSnapshot? {
    models.first { $0.provider == "custom" && !$0.baseUrl.isEmpty }
  }
  private var fields: [String: String] {
    [
      "apiKey": apiKey,
      "apiMode": apiMode,
      "baseUrl": baseUrl,
      "contextLength": contextLength,
      "model": modelName,
      "reasoningEffort": reasoningEffort
    ]
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        HermesPanel {
          VStack(alignment: .leading, spacing: 12) {
            Label(chinese ? "可用模型" : "Available models", systemImage: "square.stack.3d.up")
              .font(HermesFonts.display(17))

            if models.isEmpty {
              Text(chinese ? "当前没有可选择的模型" : "No models are available")
                .font(HermesFonts.body(13))
                .foregroundStyle(appearance.palette.secondary)
            } else {
              LazyVStack(spacing: 0) {
                ForEach(models) { model in
                  Button {
                    if !model.active {
                      onAction(
                        .modelSelect,
                        HermesRouteActionPayload(route: "models", id: model.id)
                      )
                    }
                  } label: {
                    HStack(spacing: 12) {
                      Image(systemName: model.active ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(
                          model.active ? appearance.palette.success : appearance.palette.secondary
                        )
                        .frame(width: 24, height: 24)

                      VStack(alignment: .leading, spacing: 3) {
                        Text(model.model)
                          .font(HermesFonts.bodyBold(14))
                          .foregroundStyle(appearance.palette.text)
                          .lineLimit(2)
                        HStack(spacing: 8) {
                          Text(model.provider)
                          if !model.context.isEmpty {
                            Text(model.context)
                          }
                        }
                        .font(HermesFonts.body(11))
                        .foregroundStyle(appearance.palette.secondary)
                      }

                      Spacer(minLength: 8)
                    }
                    .contentShape(Rectangle())
                    .padding(.vertical, 11)
                  }
                  .buttonStyle(.plain)
                  .accessibilityIdentifier("hermes-model-\(model.provider)-\(model.model)")

                  if model.id != models.last?.id {
                    Divider()
                  }
                }
              }
            }
          }
        }

        HermesPanel {
          VStack(alignment: .leading, spacing: 14) {
            Label(chinese ? "自定义模型" : "Custom model", systemImage: "cpu")
              .font(HermesFonts.display(17))

            modelField("Base URL", text: $baseUrl, keyboard: .URL)
            modelField(chinese ? "API 密钥（可选）" : "API key (optional)", text: $apiKey, secure: true)
            if apiKey.isEmpty, let configuration, configuration.apiKeyConfigured {
              Text(chinese
                ? "已保存密钥 \(configuration.apiKeyPreview)。留空将继续使用已保存密钥。"
                : "Saved key \(configuration.apiKeyPreview). Leave blank to keep it.")
                .font(HermesFonts.body(11))
                .foregroundStyle(appearance.palette.secondary)
            }
            Button {
              onAction(
                .modelDiscover,
                HermesRouteActionPayload(
                  route: "models",
                  fields: ["apiKey": apiKey, "baseUrl": baseUrl]
                )
              )
            } label: {
              Label(chinese ? "检测可用模型" : "Detect models", systemImage: "magnifyingglass")
            }
            .buttonStyle(.bordered)
            .disabled(baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("hermes-detect-models")

            if detectedModels.isEmpty {
              modelField(chinese ? "模型名称" : "Model", text: $modelName)
            } else {
              VStack(alignment: .leading, spacing: 6) {
                Text(chinese ? "可用模型" : "Available model")
                  .font(HermesFonts.bodyBold(12))
                  .foregroundStyle(appearance.palette.secondary)
                Picker(chinese ? "可用模型" : "Available model", selection: $modelName) {
                  ForEach(detectedModels, id: \.self) { model in
                    Text(model).tag(model)
                  }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 8)
                .background(appearance.palette.surface)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                  RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(appearance.palette.border, lineWidth: 1)
                }
              }
            }

            VStack(alignment: .leading, spacing: 6) {
              Text(chinese ? "接口协议" : "API protocol")
                .font(HermesFonts.bodyBold(12))
                .foregroundStyle(appearance.palette.secondary)
              Picker(chinese ? "接口协议" : "API protocol", selection: $apiMode) {
                Text("OpenAI Chat Completions").tag("chat_completions")
                Text("Anthropic Messages").tag("anthropic_messages")
                Text("OpenAI Responses").tag("codex_responses")
              }
              .pickerStyle(.menu)
            }

            modelField(
              chinese ? "上下文长度" : "Context length",
              text: $contextLength,
              keyboard: .numberPad
            )

            VStack(alignment: .leading, spacing: 6) {
              Text(chinese ? "推理强度" : "Reasoning effort")
                .font(HermesFonts.bodyBold(12))
                .foregroundStyle(appearance.palette.secondary)
              Picker(chinese ? "推理强度" : "Reasoning effort", selection: $reasoningEffort) {
                ForEach(
                  ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
                  id: \.self
                ) { effort in
                  Text(reasoningLabel(effort)).tag(effort)
                }
              }
              .pickerStyle(.menu)
            }

            HStack(spacing: 10) {
              Button {
                onAction(
                  .modelTest,
                  HermesRouteActionPayload(route: "models", fields: fields)
                )
              } label: {
                Label(
                  chinese ? "测试连接" : "Test connection",
                  systemImage: "bolt.horizontal.circle"
                )
              }
              .buttonStyle(.bordered)
              .disabled(!isValid)

              Button {
                onAction(
                  .modelSave,
                  HermesRouteActionPayload(route: "models", fields: fields)
                )
              } label: {
                Label(chinese ? "保存" : "Save", systemImage: "checkmark")
              }
              .buttonStyle(.borderedProminent)
              .tint(appearance.palette.accent)
              .disabled(!isValid)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
          }
        }
      }
      .padding(14)
    }
    .background(appearance.palette.background)
    .refreshable {
      onAction(.refresh, HermesRouteActionPayload(route: "models"))
    }
    .onAppear { apply(configuration) }
    .onChange(of: configuration) { _, next in apply(next) }
    .onChange(of: detectedModels) { _, next in
      if let first = next.first, !next.contains(modelName) { modelName = first }
    }
  }

  private var isValid: Bool {
    !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !modelName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && (Int(contextLength) ?? 0) > 0
  }

  @ViewBuilder private func modelField(
    _ title: String,
    text: Binding<String>,
    secure: Bool = false,
    keyboard: UIKeyboardType = .default
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(HermesFonts.bodyBold(12))
        .foregroundStyle(appearance.palette.secondary)
      Group {
        if secure {
          SecureField(title, text: text)
            .textContentType(.password)
        } else {
          TextField(title, text: text)
        }
      }
      .keyboardType(keyboard)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .padding(.horizontal, 12)
      .frame(minHeight: 44)
      .background(appearance.palette.surface)
      .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .stroke(appearance.palette.border, lineWidth: 1)
      }
    }
  }

  private func apply(_ value: HermesModelSnapshot?) {
    guard let value else { return }
    apiKey = ""
    apiMode = value.apiMode
    baseUrl = value.baseUrl
    contextLength = String(value.contextLength > 0 ? value.contextLength : 131072)
    modelName = value.model
    reasoningEffort = value.reasoningEffort
  }

  private func reasoningLabel(_ value: String) -> String {
    guard chinese else { return value.capitalized }
    switch value {
    case "none": return "关闭"
    case "minimal": return "极低"
    case "low": return "低"
    case "medium": return "中"
    case "high": return "高"
    case "xhigh": return "很高"
    case "max": return "最大"
    case "ultra": return "超高"
    default: return value
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
