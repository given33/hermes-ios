import type {
  CollaborationMessage,
  CollaborationProfile,
  RouteDecision,
} from '../HermesCloudApi';
import type { HermesCloudTransport, JsonRecord } from './transport';

const COLLABORATION = '/api/plugins/collaboration';
const KANBAN = '/api/plugins/kanban';

export function createCollaborationRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  const random = uuid || [0, 1, 2, 3]
    .map(() => Math.random().toString(36).slice(2, 12))
    .join('');
  return `room-request-${Date.now().toString(36)}-${random}`;
}

/** Kanban and explicit collaboration-room APIs. */
export class HermesCollaborationCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  private kanbanQuery(board?: string, extra: Record<string, string | number | boolean | undefined> = {}) {
    return { ...extra, ...(board ? { board } : {}) };
  }

  getKanbanBoard(options: {
    board?: string;
    tenant?: string;
    includeArchived?: boolean;
    workflowTemplateId?: string;
    currentStepKey?: string;
  } = {}) {
    return this.transport.request<JsonRecord>(`${KANBAN}/board`, {
      query: this.kanbanQuery(options.board, {
        tenant: options.tenant,
        include_archived: options.includeArchived,
        workflow_template_id: options.workflowTemplateId,
        current_step_key: options.currentStepKey,
      }),
    });
  }

  /** Stream durable Kanban task events through the authenticated WebSocket
   * ticket seam. The server pins board selection at handshake and returns
   * `{ events, cursor }` batches so callers can resume without polling. */
  openKanbanEventsWebSocket(
    cursor = 0,
    board = '',
    deadlineMs = 5_000,
    signal?: AbortSignal,
  ) {
    return this.transport.openWebSocket(`${KANBAN}/events`, {
      query: {
        since: Math.max(0, Math.floor(cursor)),
        ...(board.trim() ? { board: board.trim() } : {}),
      },
      signal,
      connectTimeoutMs: deadlineMs,
    });
  }

  getKanbanTask(id: string, options: { board?: string; runStateType?: 'status' | 'outcome'; runStateName?: string } = {}) {
    return this.transport.request<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(id)}`, {
      query: this.kanbanQuery(options.board, {
        run_state_type: options.runStateType,
        run_state_name: options.runStateName,
      }),
    });
  }

  createKanbanTask(task: JsonRecord, board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks`, 'POST', task, {
      query: this.kanbanQuery(board),
    });
  }

  updateKanbanTask(id: string, update: JsonRecord, board?: string) {
    return this.transport.json<JsonRecord>(
      `${KANBAN}/tasks/${encodeURIComponent(id)}`,
      'PATCH',
      update,
      { query: this.kanbanQuery(board) },
    );
  }

  deleteKanbanTask(id: string, board?: string) {
    return this.transport.request<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      query: this.kanbanQuery(board),
    });
  }

  listKanbanTaskAttachments(taskId: string, board?: string) {
    return this.transport.request<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/attachments`, {
      query: this.kanbanQuery(board),
    });
  }

  uploadKanbanTaskAttachment(taskId: string, file: Blob, filename: string, uploadedBy?: string, board?: string) {
    const form = new FormData();
    form.append('file', file, filename);
    if (uploadedBy) form.append('uploaded_by', uploadedBy);
    return this.transport.request<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/attachments`, {
      method: 'POST',
      body: form,
      query: this.kanbanQuery(board),
    });
  }

  downloadKanbanAttachment(id: number | string, board?: string) {
    return this.transport.download(`${KANBAN}/attachments/${encodeURIComponent(String(id))}`, {
      query: this.kanbanQuery(board),
    });
  }

  deleteKanbanAttachment(id: number | string, board?: string) {
    return this.transport.request<JsonRecord>(`${KANBAN}/attachments/${encodeURIComponent(String(id))}`, {
      method: 'DELETE',
      query: this.kanbanQuery(board),
    });
  }

  addKanbanComment(taskId: string, body: string, author?: string, board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/comments`, 'POST', {
      body,
      ...(author ? { author } : {}),
    }, { query: this.kanbanQuery(board) });
  }

  linkKanbanTasks(parentId: string, childId: string, board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/links`, 'POST', {
      parent_id: parentId,
      child_id: childId,
    }, { query: this.kanbanQuery(board) });
  }

  unlinkKanbanTasks(parentId: string, childId: string, board?: string) {
    return this.transport.request<JsonRecord>(`${KANBAN}/links`, {
      method: 'DELETE',
      query: this.kanbanQuery(board, { parent_id: parentId, child_id: childId }),
    });
  }

  bulkUpdateKanbanTasks(ids: string[], update: JsonRecord, board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks/bulk`, 'POST', {
      ids,
      ...update,
    }, { query: this.kanbanQuery(board) });
  }

  getKanbanDiagnostics(options: { board?: string; severity?: string } = {}) {
    return this.transport.request<JsonRecord>(`${KANBAN}/diagnostics`, {
      query: this.kanbanQuery(options.board, { severity: options.severity }),
    });
  }

  getKanbanActiveWorkers(board?: string) {
    return this.transport.request<JsonRecord>(`${KANBAN}/workers/active`, { query: this.kanbanQuery(board) });
  }

  getKanbanRun(id: number | string, board?: string) {
    return this.transport.request<JsonRecord>(`${KANBAN}/runs/${encodeURIComponent(String(id))}`, { query: this.kanbanQuery(board) });
  }

  inspectKanbanRun(id: number | string, board?: string) {
    return this.transport.request<JsonRecord>(`${KANBAN}/runs/${encodeURIComponent(String(id))}/inspect`, { query: this.kanbanQuery(board) });
  }

  terminateKanbanRun(id: number | string, reason = '', board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/runs/${encodeURIComponent(String(id))}/terminate`, 'POST', { reason }, { query: this.kanbanQuery(board) });
  }

  reclaimKanbanTask(taskId: string, reason = '', board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/reclaim`, 'POST', { reason }, { query: this.kanbanQuery(board) });
  }

  specifyKanbanTask(taskId: string, options: { author?: string } = {}, board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/specify`, 'POST', options, { query: this.kanbanQuery(board) });
  }

  reassignKanbanTask(taskId: string, profile: string, reclaim = false, board?: string, reason = '') {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/reassign`, 'POST', { profile, reclaim_first: reclaim, ...(reason ? { reason } : {}) }, { query: this.kanbanQuery(board) });
  }

  estimateKanbanText(title: string, body = '') {
    return this.transport.json<JsonRecord>(`${KANBAN}/estimate`, 'POST', { title, body });
  }

  estimateKanbanTask(taskId: string, board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/estimate`, 'POST', {}, { query: this.kanbanQuery(board) });
  }

  decomposeKanbanTask(taskId: string, options: { author?: string } = {}, board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/decompose`, 'POST', options, { query: this.kanbanQuery(board) });
  }

  getKanbanTaskLog(taskId: string, options: { board?: string; tail?: number } = {}) {
    return this.transport.request<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/log`, { query: this.kanbanQuery(options.board, { tail: options.tail }) });
  }

  dispatchKanban(options: { board?: string; dryRun?: boolean; max?: number } = {}) {
    return this.transport.json<JsonRecord>(`${KANBAN}/dispatch`, 'POST', {}, { query: this.kanbanQuery(options.board, { dry_run: options.dryRun, max: options.max }) });
  }

  getKanbanModelOptions() { return this.transport.request<JsonRecord>(`${KANBAN}/model-options`); }
  getKanbanConfig() { return this.transport.request<JsonRecord>(`${KANBAN}/config`); }
  getKanbanHomeChannels(taskId?: string, board?: string) {
    return this.transport.request<JsonRecord>(`${KANBAN}/home-channels`, { query: this.kanbanQuery(board, { task_id: taskId }) });
  }
  subscribeKanbanHome(taskId: string, platform: string, board?: string) {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/home-subscribe/${encodeURIComponent(platform)}`, 'POST', {}, { query: this.kanbanQuery(board) });
  }
  unsubscribeKanbanHome(taskId: string, platform: string, board?: string) {
    return this.transport.request<JsonRecord>(`${KANBAN}/tasks/${encodeURIComponent(taskId)}/home-subscribe/${encodeURIComponent(platform)}`, { method: 'DELETE', query: this.kanbanQuery(board) });
  }
  getKanbanStats(board?: string) { return this.transport.request<JsonRecord>(`${KANBAN}/stats`, { query: this.kanbanQuery(board) }); }
  getKanbanAssignees(board?: string) { return this.transport.request<JsonRecord>(`${KANBAN}/assignees`, { query: this.kanbanQuery(board) }); }
  getKanbanProjects() { return this.transport.request<JsonRecord>(`${KANBAN}/projects`); }
  getKanbanBoards(includeArchived = false) { return this.transport.request<JsonRecord>(`${KANBAN}/boards`, { query: { include_archived: includeArchived } }); }
  createKanbanBoard(payload: JsonRecord) { return this.transport.json<JsonRecord>(`${KANBAN}/boards`, 'POST', payload); }
  updateKanbanBoard(slug: string, payload: JsonRecord) { return this.transport.json<JsonRecord>(`${KANBAN}/boards/${encodeURIComponent(slug)}`, 'PATCH', payload); }
  deleteKanbanBoard(slug: string, hardDelete = false) { return this.transport.request<JsonRecord>(`${KANBAN}/boards/${encodeURIComponent(slug)}`, { method: 'DELETE', query: { delete: hardDelete } }); }
  exportKanbanBoard(slug: string, options: { output?: string; attachments?: boolean; logs?: boolean } = {}) { return this.transport.json<JsonRecord>(`${KANBAN}/boards/${encodeURIComponent(slug)}/export`, 'POST', { output: options.output || '', attachments: options.attachments ?? true, logs: options.logs ?? false }); }
  importKanbanBoard(archive: string, slug?: string, switchBoard = false) { return this.transport.json<JsonRecord>(`${KANBAN}/boards/import`, 'POST', { archive, ...(slug ? { slug } : {}), switch: switchBoard }); }
  switchKanbanBoard(slug: string) { return this.transport.json<JsonRecord>(`${KANBAN}/boards/${encodeURIComponent(slug)}/switch`, 'POST', {}); }
  getKanbanProfiles() { return this.transport.request<JsonRecord>(`${KANBAN}/profiles`); }
  updateKanbanProfile(profile: string, description: string) { return this.transport.json<JsonRecord>(`${KANBAN}/profiles/${encodeURIComponent(profile)}`, 'PATCH', { description }); }
  describeKanbanProfile(profile: string, overwrite = false) { return this.transport.json<JsonRecord>(`${KANBAN}/profiles/${encodeURIComponent(profile)}/describe-auto`, 'POST', { overwrite }); }
  getKanbanOrchestration() { return this.transport.request<JsonRecord>(`${KANBAN}/orchestration`); }
  setKanbanOrchestration(payload: JsonRecord) { return this.transport.json<JsonRecord>(`${KANBAN}/orchestration`, 'PUT', payload); }

  getCollaborationProfiles() {
    return this.transport.request<{ profiles: CollaborationProfile[] }>(
      `${COLLABORATION}/profiles`,
    );
  }

  getCollaborationRooms() {
    return this.transport.request<{ rooms: JsonRecord[] }>(`${COLLABORATION}/rooms`);
  }

  createCollaborationRoom(name: string, profiles: string[]) {
    return this.transport.json<{ room: JsonRecord }>(`${COLLABORATION}/rooms`, 'POST', {
      name,
      profiles,
    });
  }

  deleteCollaborationRoom(id: string) {
    return this.transport.request<{ ok: boolean }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  getCollaborationRoom(id: string) {
    return this.transport.request<{ room: JsonRecord }>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}`,
    );
  }

  getCollaborationRoomMailbox(id: string, recipientId: string, afterId = '', limit = 100) {
    return this.transport.request<JsonRecord>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}/mailbox`,
      { query: { recipient_id: recipientId, ...(afterId ? { after_id: afterId } : {}), limit } },
    );
  }

  sendCollaborationRoomMailboxMessage(
    id: string,
    senderId: string,
    recipientId: string,
    body: JsonRecord,
    idempotencyKey = '',
  ) {
    return this.transport.json<JsonRecord>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}/mailbox`,
      'POST',
      {
        sender_id: senderId,
        recipient_id: recipientId,
        body,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      },
    );
  }

  getCollaborationRoomDependencies(id: string) {
    return this.transport.request<JsonRecord>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}/dependencies`,
    );
  }

  setCollaborationRoomDependencies(id: string, nodes: JsonRecord[]) {
    return this.transport.json<JsonRecord>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}/dependencies`,
      'PUT',
      { nodes },
    );
  }

  sendCollaborationRoomMessage(
    id: string,
    content: string,
    profiles: string[] = [],
    requestId = createCollaborationRequestId(),
    signal?: AbortSignal,
  ) {
    const stableRequestId = requestId.trim() || createCollaborationRequestId();
    const turnSuffix = stableRequestId.startsWith('room-request-')
      ? stableRequestId.slice('room-request-'.length)
      : stableRequestId;
    return this.transport.json<JsonRecord>(
      `${COLLABORATION}/rooms/${encodeURIComponent(id)}/messages`,
      'POST',
      {
        content,
        profiles,
        request_id: stableRequestId,
        turn_id: `room-turn-${turnSuffix}`,
      },
      { signal },
    );
  }

  routeMessage(
    content: string,
    recentMessages: Array<Pick<CollaborationMessage, 'content' | 'role'>> = [],
    attachments: JsonRecord[] = [],
  ) {
    return this.transport.json<RouteDecision>(`${COLLABORATION}/route`, 'POST', {
      attachments,
      content,
      mode: 'auto',
      recent_messages: recentMessages,
    });
  }
}
