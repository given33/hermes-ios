import { HermesApiError } from '../../api/HermesApiClient';
import {
  parseOfficialConversationPlaceholderId,
  type CollaborationMessage,
  type SingleConversation,
} from '../../api/HermesCloudApi';
import type { OptimisticConversationLedgerItem } from '../../api/conversation-local-store';
import type { HermesChatViewMessage as ChatMessage } from '../../api/chat-view-model';
import type { HermesChatActivity, HermesChatAttachment } from '../../api/chat-view-types';
import { isTerminalStatus } from '../../api/chat-view-timing';

export function chatMessageToCollaborationMessage(message: ChatMessage): CollaborationMessage {
  return {
    completed_at: message.completedAt,
    content: message.content,
    created_at: message.createdAt,
    id: message.id,
    meta: {
      client_optimistic: true,
      ...(message.optimisticConfirmedAt
        ? { optimistic_confirmed_at: message.optimisticConfirmedAt }
        : {}),
      ...(message.roleStage ? { role_stage: message.roleStage } : {}),
      ...(message.runtimeTurnId ? { runtime_turn_id: message.runtimeTurnId } : {}),
    },
    model: message.model,
    name: message.name,
    profile: message.profile,
    provider: message.provider,
    role: message.role,
    role_label: message.roleLabel,
    sender_id: message.senderId,
    sender_role: message.avatarRole,
    started_at: message.startedAt,
    status: message.status,
    updated_at: message.updatedAt,
  };
}

export function sameOptimisticMessages(
  left: readonly ChatMessage[],
  right: readonly ChatMessage[],
): boolean {
  return left.length === right.length && left.every((message, index) => {
    const other = right[index];
    return Boolean(other)
      && message.id === other.id
      && message.content === other.content
      && message.status === other.status
      && message.optimisticConfirmedAt === other.optimisticConfirmedAt
      && message.updatedAt === other.updatedAt;
  });
}

export function sameChatMessages(
  left: readonly ChatMessage[],
  right: readonly ChatMessage[],
): boolean {
  if (left.length !== right.length) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function liveMessageMergeKey(message: ChatMessage): string {
  if (!message.runtimeTurnId || !message.roleStage) return '';
  return `${message.runtimeTurnId}\u0000${message.roleStage}\u0000${message.profile || ''}`;
}

function mergeSnapshotMessage(
  persisted: ChatMessage,
  live: ChatMessage,
): ChatMessage {
  // Live activities win on shared ids (fresher tool/status updates);
  // persisted-only activities fill the gaps, which is exactly what keeps
  // awaiting/supervisor/rework cards alive across a snapshot replacement.
  const persistedActivities = new Map(
    (persisted.activities || []).filter(({ id }) => id).map((activity) => [activity.id, activity]),
  );
  const liveIds = new Set((live.activities || []).map(({ id }) => id).filter(Boolean));
  const activities = [
    ...(live.activities || []).map((activity) => {
      const durable = activity.id ? persistedActivities.get(activity.id) : undefined;
      return durable ? mergeSnapshotActivity(durable, activity) : activity;
    }),
    ...(persisted.activities || []).filter(
      (activity) => !activity.id || !liveIds.has(activity.id),
    ),
  ];
  const persistedIsTerminal = isTerminalStatus(persisted.status || '');
  const persistedWithReasoning = persisted as ChatMessage & { reasoning?: string };
  const liveWithReasoning = live as ChatMessage & { reasoning?: string };
  const merged: ChatMessage = {
    ...persisted,
    ...live,
    // Keep the persisted id: the React message key stays stable, so the
    // live→durable handoff does not remount the message and replay its
    // entering animation (visual flicker + open/manualPin state resets).
    id: persisted.id,
    content: richerText(persisted.content, live.content, persistedIsTerminal),
    activities,
    attachments: mergeSnapshotAttachments(persisted.attachments, live.attachments),
  };
  const reasoning = richerOptionalText(
    persistedWithReasoning.reasoning,
    liveWithReasoning.reasoning,
  );
  if (reasoning !== undefined) {
    (merged as ChatMessage & { reasoning?: string }).reasoning = reasoning;
  }
  if (!persistedIsTerminal) return merged;
  return {
    ...merged,
    completedAt: persisted.completedAt,
    durationMs: persisted.durationMs,
    status: persisted.status,
    timingLabel: persisted.timingLabel,
    updatedAt: persisted.updatedAt,
  };
}

function mergeSnapshotActivity(
  persisted: HermesChatActivity,
  live: HermesChatActivity,
): HermesChatActivity {
  const merged = {
    ...persisted,
    ...live,
    detail: richerOptionalText(persisted.detail, live.detail),
    input: richerOptionalText(persisted.input, live.input),
    output: richerOptionalText(persisted.output, live.output),
    preview: richerText(persisted.preview, live.preview, isTerminalStatus(persisted.status)),
  };
  if (!isTerminalStatus(persisted.status)) return merged;
  return {
    ...merged,
    completedAt: persisted.completedAt,
    duration: persisted.duration,
    durationMs: persisted.durationMs,
    error: persisted.error,
    status: persisted.status,
  };
}

function mergeSnapshotAttachments(
  persisted: readonly HermesChatAttachment[] | undefined,
  live: readonly HermesChatAttachment[] | undefined,
): HermesChatAttachment[] | undefined {
  const merged = [...(persisted || [])];
  const indexes = new Map(merged.map((attachment, index) => [attachment.id, index]));
  for (const attachment of live || []) {
    const index = indexes.get(attachment.id);
    if (index === undefined) {
      indexes.set(attachment.id, merged.length);
      merged.push(attachment);
    } else {
      const durable = merged[index];
      merged[index] = {
        ...durable,
        ...attachment,
        downloadUrl: attachment.downloadUrl || durable.downloadUrl,
        name: attachment.name || durable.name,
      };
    }
  }
  return merged.length ? merged : undefined;
}

function richerOptionalText(
  persisted: string | undefined,
  live: string | undefined,
): string | undefined {
  if (persisted === undefined) return live;
  if (live === undefined) return persisted;
  return richerText(persisted, live);
}

function richerText(persisted: string, live: string, preferPersistedOnTie = false): string {
  const persistedLength = persisted.trim().length;
  const liveLength = live.trim().length;
  if (persistedLength > liveLength || (preferPersistedOnTie && persistedLength === liveLength)) {
    return persisted;
  }
  return live;
}

/**
 * Fold live messages into an authoritative snapshot before it replaces the
 * view, so a reconnect / poll / intervention snapshot does not drop live-only
 * interactive cards (awaiting choice, supervisor verdict, rework chips) or
 * flip message ids and remount the whole message list.
 */
export function mergeLiveMessagesIntoSnapshot(
  persisted: readonly ChatMessage[],
  live: readonly ChatMessage[],
): ChatMessage[] {
  const liveByKey = new Map<string, ChatMessage[]>();
  for (const message of live) {
    const key = liveMessageMergeKey(message);
    if (!key) continue;
    const bucket = liveByKey.get(key);
    if (bucket) bucket.push(message);
    else liveByKey.set(key, [message]);
  }
  if (!liveByKey.size) return [...persisted];
  const consumed = new Set<string>();
  const merged = persisted.map((message) => {
    const key = liveMessageMergeKey(message);
    if (!key) return message;
    const bucket = liveByKey.get(key);
    if (!bucket?.length) return message;
    consumed.add(key);
    return mergeSnapshotMessage(message, bucket[bucket.length - 1]);
  });
  const trailing: ChatMessage[] = [];
  for (const [key, bucket] of liveByKey) {
    if (consumed.has(key)) continue;
    trailing.push(...bucket);
  }
  return trailing.length ? [...merged, ...trailing] : merged;
}

export function optimisticConversationTitle(
  messages: readonly CollaborationMessage[],
  chinese: boolean,
): string {
  const firstUserContent = messages.find(({ role }) => role === 'user')?.content?.trim();
  return firstUserContent?.slice(0, 36) || (chinese ? '新对话' : 'New conversation');
}

function numericTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function mergeOptimisticConversationSummaries(
  conversations: readonly SingleConversation[],
  ledgers: readonly OptimisticConversationLedgerItem[],
  profile: string,
  chinese: boolean,
): SingleConversation[] {
  const existingIds = new Set(conversations.map(({ id }) => id));
  const optimisticOnly = ledgers.flatMap((entry) => {
    if (existingIds.has(entry.conversationId) || !entry.messages.length) return [];
    const createdAt = Math.min(
      ...entry.messages.map((message) => numericTimestamp(message.created_at) || entry.updatedAt),
    );
    return [{
      created_at: createdAt,
      id: entry.conversationId,
      message_count: entry.messages.length,
      messages: entry.messages.map((message) => ({
        ...message,
        ...(message.meta ? { meta: { ...message.meta } } : {}),
      })),
      profile,
      title: optimisticConversationTitle(entry.messages, chinese),
      updated_at: entry.updatedAt,
    } as SingleConversation];
  });
  return [...conversations, ...optimisticOnly].sort(
    (left, right) => (right.updated_at || 0) - (left.updated_at || 0),
  );
}

export function uniqueTurnId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  const random = uuid || [0, 1, 2, 3]
    .map(() => Math.random().toString(36).slice(2, 12))
    .join('');
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function stableStringHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function resolveConversationId(
  requestedId: string,
  conversations: readonly SingleConversation[],
): string {
  if (!requestedId) return conversations[0]?.id || '';
  if (conversations.some(({ id }) => id === requestedId)) return requestedId;
  if (requestedId.startsWith('official:')) {
    const placeholder = parseOfficialConversationPlaceholderId(requestedId);
    const sessionId = placeholder?.sessionId || requestedId.slice('official:'.length);
    const adopted = conversations.find((conversation) => (
      (
        conversation.official_session_id === sessionId
        && (
          !placeholder?.profile
          || (conversation.official_profile || conversation.profile) === placeholder.profile
        )
      )
      || (
        placeholder?.profile
          ? conversation.runtime_sessions?.[placeholder.profile] === sessionId
          : Object.values(conversation.runtime_sessions || {}).includes(sessionId)
      )
    ));
    if (adopted) return adopted.id;
  }
  return conversations[0]?.id || '';
}

export function isConversationNotFoundError(error: unknown): boolean {
  // DELETE endpoints commonly use 410 once a record has already been
  // purged. Treat it like 404 so a replayed local-first delete can converge
  // instead of retrying a tombstone forever.
  return isRecord(error) && (
    error.status === 404
    || error.status === 410
    || error.statusCode === 404
    || error.statusCode === 410
  );
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!values.length) return [];
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, worker),
  );
  return results;
}

export function serverFailure(error: unknown, chinese: boolean): string {
  if (error instanceof HermesApiError) {
    if (error.status === 401 || error.status === 403) {
      return chinese
        ? `HTTP ${error.status}：Hermes 登录状态已失效，请重新登录。`
        : `HTTP ${error.status}: Your Hermes session has expired. Sign in again.`;
    }
    if (error.status === 429) {
      return chinese
        ? 'HTTP 429：服务器请求过于频繁，请稍后重试。'
        : 'HTTP 429: The server is receiving too many requests. Try again shortly.';
    }
    if (error.status >= 500) {
      return chinese
        ? `HTTP ${error.status}：Hermes 服务暂时不可用，请稍后重试。`
        : `HTTP ${error.status}: Hermes is temporarily unavailable. Try again shortly.`;
    }
  }
  if (error instanceof Error && error.message) {
    return chinese ? `服务器操作失败：${error.message}` : `Server operation failed: ${error.message}`;
  }
  return chinese ? '服务器操作失败，请稍后重试。' : 'Server operation failed. Try again.';
}

export function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === 404;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
