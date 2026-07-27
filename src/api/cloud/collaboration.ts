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

  getKanbanBoard() {
    return this.transport.request<JsonRecord>(`${KANBAN}/board`);
  }

  createKanbanTask(task: JsonRecord) {
    return this.transport.json<JsonRecord>(`${KANBAN}/tasks`, 'POST', task);
  }

  updateKanbanTask(id: string, update: JsonRecord) {
    return this.transport.json<JsonRecord>(
      `${KANBAN}/tasks/${encodeURIComponent(id)}`,
      'PATCH',
      update,
    );
  }

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
