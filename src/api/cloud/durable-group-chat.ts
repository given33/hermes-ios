import type { HermesCloudTransport } from './transport';

const DURABLE_GROUP_CHAT = '/api/plugins/collaboration/mobile/group-chat';

export interface DurableGroupChatMember {
  member_id: string;
  profile: string;
  handle: string;
  display_name?: string;
  gateway_id?: string;
  device?: string;
  target?: DurableGroupChatMemberTarget;
}

export interface DurableGroupChatMemberTarget {
  kind: 'local' | 'peer';
  profile?: string;
  peer_id?: string;
  installation_id?: string;
  capability_digest?: string;
}

export interface CreateDurableGroupChatMember {
  memberId: string;
  profile: string;
  handle: string;
  displayName?: string;
  gatewayId?: string;
}

/** A gateway/device advertised by the mobile durable Group Chat catalog. */
export interface DurableGroupChatGateway {
  gateway_id: string;
  kind?: 'gateway' | 'peer_gateway';
  label?: string;
  device?: string;
  installation_id?: string;
  profiles: string[];
  profiles_declared?: boolean;
  configured?: boolean;
  room_member_supported?: boolean;
  room_link_ready?: boolean;
  reason?: string;
  online?: boolean;
}

/** A managed connector that can execute work but cannot host a RoomLink. */
export interface DurableGroupChatExecutionNode {
  node_id: string;
  label: string;
  kind: 'connector_only';
  room_member_supported: false;
  reason: string;
}

export interface DurableGroupChatGatewayCatalog {
  gateways: DurableGroupChatGateway[];
  execution_nodes: DurableGroupChatExecutionNode[];
  local_gateway_id?: string;
  credentials?: 'server-managed';
  room_link_protocol_version?: number;
}

export interface DurableGroupChatRoom {
  room_id: string;
  name: string;
  members: DurableGroupChatMember[];
  authority_gateway_id: string;
  authority_epoch: number;
  latest_seq: number;
  revision: number;
  created_at: number;
  updated_at: number;
  disbanded_at?: number;
}

export interface DurableGroupChatEvent {
  room_id: string;
  seq: number;
  event_id: string;
  kind: string;
  actor: Record<string, string>;
  authority_epoch: number | null;
  payload: Record<string, unknown>;
  created_at: number;
  idempotent: boolean;
}

export interface DurableGroupChatEventPage {
  events: DurableGroupChatEvent[];
  cursor: number;
  latest_seq: number;
  has_more: boolean;
  authority: {
    gateway_id: string;
    epoch: number;
  };
}

export interface DurableGroupChatDriverStatus {
  running: boolean;
  working?: boolean;
  blocked?: boolean;
  counts?: Record<string, number>;
  pending_actions?: Array<Record<string, unknown>>;
}

export interface DurableGroupChatRoomState {
  room: DurableGroupChatRoom;
  driver_status: DurableGroupChatDriverStatus;
}

export interface DurableGroupChatCapabilities {
  protocol_version: number;
  driver: DurableGroupChatDriverStatus;
  features: string[];
  credentials: 'server-managed';
}

export interface CreateDurableGroupChatInput {
  idempotencyKey: string;
  name: string;
  members: CreateDurableGroupChatMember[];
}

/** Typed owner-mobile bridge for the official durable Group Chat protocol. */
export class HermesDurableGroupChatCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getCapabilities(signal?: AbortSignal) {
    return this.transport.request<DurableGroupChatCapabilities>(
      `${DURABLE_GROUP_CHAT}/capabilities`,
      { signal },
    );
  }

  listRooms(signal?: AbortSignal) {
    return this.transport.request<{ rooms: DurableGroupChatRoom[] }>(
      `${DURABLE_GROUP_CHAT}/rooms`,
      { signal },
    );
  }

  listGateways(signal?: AbortSignal) {
    return this.transport.request<DurableGroupChatGatewayCatalog>(
      `${DURABLE_GROUP_CHAT}/gateways`,
      { signal },
    );
  }

  createRoom(input: CreateDurableGroupChatInput) {
    return this.transport.json<{ room: DurableGroupChatRoom }>(
      `${DURABLE_GROUP_CHAT}/rooms`,
      'POST',
      {
        idempotency_key: input.idempotencyKey,
        name: input.name,
        members: input.members.map((member) => ({
          member_id: member.memberId,
          profile: member.profile,
          handle: member.handle,
          ...(member.displayName ? { display_name: member.displayName } : {}),
          ...(member.gatewayId ? { gateway_id: member.gatewayId } : {}),
        })),
      },
    );
  }

  getRoom(roomId: string, signal?: AbortSignal) {
    return this.transport.request<DurableGroupChatRoomState>(
      `${DURABLE_GROUP_CHAT}/rooms/${encodeURIComponent(roomId)}`,
      { signal },
    );
  }

  listEvents(
    roomId: string,
    options: { sinceSeq?: number; limit?: number; signal?: AbortSignal } = {},
  ) {
    return this.transport.request<DurableGroupChatEventPage>(
      `${DURABLE_GROUP_CHAT}/rooms/${encodeURIComponent(roomId)}/events`,
      {
        signal: options.signal,
        query: {
          since_seq: Math.max(0, Math.floor(options.sinceSeq ?? 0)),
          limit: Math.max(1, Math.min(500, Math.floor(options.limit ?? 100))),
        },
      },
    );
  }

  sendMessage(
    roomId: string,
    input: { idempotencyKey: string; text: string; threadId: string },
  ) {
    return this.transport.json<{ event: DurableGroupChatEvent; accepted: boolean; driver_started: boolean }>(
      `${DURABLE_GROUP_CHAT}/rooms/${encodeURIComponent(roomId)}/messages`,
      'POST',
      {
        idempotency_key: input.idempotencyKey,
        text: input.text,
        thread_id: input.threadId,
      },
    );
  }

  renameRoom(roomId: string, input: { idempotencyKey: string; name: string }) {
    return this.transport.json<{ room: DurableGroupChatRoom }>(
      `${DURABLE_GROUP_CHAT}/rooms/${encodeURIComponent(roomId)}/rename`,
      'POST',
      { idempotency_key: input.idempotencyKey, name: input.name },
    );
  }

  stopRoom(roomId: string, idempotencyKey: string) {
    return this.transport.json<{ cancelled: number }>(
      `${DURABLE_GROUP_CHAT}/rooms/${encodeURIComponent(roomId)}/stop`,
      'POST',
      { idempotency_key: idempotencyKey },
    );
  }

  deleteRoom(roomId: string) {
    return this.transport.request<{ room_id: string; disbanded: boolean }>(
      `${DURABLE_GROUP_CHAT}/rooms/${encodeURIComponent(roomId)}`,
      { method: 'DELETE' },
    );
  }

  retryTask(roomId: string, taskId: string) {
    return this.transport.json<{ task: Record<string, unknown> }>(
      `${DURABLE_GROUP_CHAT}/rooms/${encodeURIComponent(roomId)}/tasks/retry`,
      'POST',
      { task_id: taskId },
    );
  }

  approveTask(
    roomId: string,
    input: {
      memberId: string;
      taskId: string;
      executionGeneration: number;
      requestId: string;
      choice: 'once' | 'deny';
    },
  ) {
    return this.transport.json<{ approved: boolean; result: Record<string, unknown> }>(
      `${DURABLE_GROUP_CHAT}/rooms/${encodeURIComponent(roomId)}/tasks/approval`,
      'POST',
      {
        member_id: input.memberId,
        task_id: input.taskId,
        execution_generation: input.executionGeneration,
        request_id: input.requestId,
        choice: input.choice,
      },
    );
  }
}
