import type { CollaborationMessage } from './HermesCloudApi';
import type {
  ConversationStorageAdapter,
  OptimisticConversationLedgerItem,
  OptimisticPendingTurn,
} from './conversation-store-types';
import {
  isRecord,
  normalizeOwner,
  numberValue,
  ownerStorageKey,
  stringValue,
} from './conversation-storage-primitives';
import type { ConversationSerializedWrite } from './conversation-room-outbox';

const OPTIMISTIC_LEDGER_VERSION = 1 as const;
const OPTIMISTIC_LEDGER_PREFIX = 'hermes.native.optimistic-messages.v1';

export class OptimisticConversationLedgerRepository {
  constructor(
    private readonly storage: ConversationStorageAdapter,
    private readonly runSerialized: ConversationSerializedWrite,
  ) {}

  async read(owner: string): Promise<OptimisticConversationLedgerItem[]> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return [];
    let snapshot: OptimisticConversationLedgerItem[] = [];
    await this.runSerialized(normalizedOwner, async () => {
      snapshot = await this.readInTransaction(normalizedOwner);
    });
    return snapshot;
  }

  async replaceMessages(
    owner: string,
    conversationId: string,
    messages: readonly CollaborationMessage[],
    pendingTurn?: OptimisticPendingTurn | null,
    expectedMessageIds?: readonly string[],
    expectedOwnerEpoch?: number,
  ): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedConversationId = stringValue(conversationId);
    if (!normalizedOwner || !normalizedConversationId) return false;
    const normalizedMessages = messages.flatMap(normalizeCollaborationMessage);
    let committed = false;
    await this.runSerialized(normalizedOwner, async () => {
      const current = await this.readInTransaction(normalizedOwner);
      const currentEntry = findEntry(current, normalizedConversationId);
      const expectedIdsMatch = !expectedMessageIds
        || sameMessageIds(currentEntry?.messages || [], expectedMessageIds);
      const completesCurrentPendingTurn = Boolean(
        !expectedIdsMatch
        && pendingTurn === null
        && currentEntry?.pendingTurn
        && normalizedMessages.some(
          ({ id, role }) => id === currentEntry.pendingTurn?.userMessageId && role === 'user',
        )
        && normalizedMessages.some(({ id, role, status }) => (
          role === 'assistant'
          && id.includes(currentEntry.pendingTurn?.userMessageId || '')
          && (status === 'failed' || status === 'completed')
        )),
      );
      if (expectedMessageIds && !expectedIdsMatch && !completesCurrentPendingTurn) return;
      const normalizedPendingTurn = pendingTurn === undefined
        ? currentEntry?.pendingTurn
        : pendingTurn === null
          ? undefined
          : normalizeOptimisticPendingTurn(pendingTurn);
      const next = withoutConversation(current, normalizedConversationId);
      if (normalizedMessages.length || normalizedPendingTurn) {
        next.push({
          conversationId: normalizedConversationId,
          messages: normalizedMessages,
          ...(normalizedPendingTurn ? { pendingTurn: normalizedPendingTurn } : {}),
          updatedAt: Date.now(),
        });
      }
      await this.writeInTransaction(normalizedOwner, next);
      committed = true;
    }, expectedOwnerEpoch);
    return committed;
  }

  async updatePendingTurn(
    owner: string,
    conversationId: string,
    pendingTurn: OptimisticPendingTurn,
    expectedOwnerEpoch?: number,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedConversationId = stringValue(conversationId);
    const normalizedPendingTurn = normalizeOptimisticPendingTurn(pendingTurn);
    if (!normalizedOwner || !normalizedConversationId || !normalizedPendingTurn) return;
    await this.runSerialized(normalizedOwner, () => this.writePendingTurnInTransaction(
      normalizedOwner,
      normalizedConversationId,
      normalizedPendingTurn,
    ), expectedOwnerEpoch);
  }

  async finalizeTurn(
    owner: string,
    conversationId: string,
    terminalMessages: readonly CollaborationMessage[],
    expectedOwnerEpoch?: number,
  ): Promise<OptimisticConversationLedgerItem | null> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedConversationId = stringValue(conversationId);
    const normalizedTerminal = terminalMessages.flatMap(normalizeCollaborationMessage);
    if (!normalizedOwner || !normalizedConversationId || !normalizedTerminal.length) return null;
    let finalized: OptimisticConversationLedgerItem | null = null;
    await this.runSerialized(normalizedOwner, async () => {
      finalized = await this.writeTerminalInTransaction(
        normalizedOwner,
        normalizedConversationId,
        normalizedTerminal,
      );
    }, expectedOwnerEpoch);
    return finalized;
  }

  async readInTransaction(owner: string): Promise<OptimisticConversationLedgerItem[]> {
    return parseOptimisticConversations(
      await this.storage.getItem(optimisticLedgerKey(owner)),
      owner,
    );
  }

  async findInTransaction(
    owner: string,
    conversationId: string,
  ): Promise<OptimisticConversationLedgerItem | undefined> {
    return findEntry(await this.readInTransaction(owner), conversationId);
  }

  async appendInterventionInTransaction(
    owner: string,
    conversationId: string,
    message: CollaborationMessage,
  ): Promise<void> {
    const current = await this.readInTransaction(owner);
    const currentEntry = findEntry(current, conversationId);
    const messages = new Map(
      (currentEntry?.messages || []).map((entry) => [entry.id, entry]),
    );
    messages.set(message.id, cloneCollaborationMessage(message));
    const next = withoutConversation(current, conversationId);
    next.push({
      conversationId,
      messages: [...messages.values()].map(cloneCollaborationMessage).sort(compareMessages),
      ...(currentEntry?.pendingTurn ? { pendingTurn: { ...currentEntry.pendingTurn } } : {}),
      updatedAt: Date.now(),
    });
    await this.writeInTransaction(owner, next);
  }

  async failInterventionInTransaction(
    owner: string,
    conversationId: string,
    message: CollaborationMessage,
    error: string,
  ): Promise<void> {
    const current = await this.readInTransaction(owner);
    const currentEntry = findEntry(current, conversationId);
    const failedMessage: CollaborationMessage = {
      ...message,
      status: 'failed',
      meta: {
        ...(isRecord(message.meta) ? message.meta : {}),
        delivery_error: error,
      },
    };
    const existingMessages = currentEntry?.messages || [];
    const hasIntervention = existingMessages.some(({ id }) => id === message.id);
    const next = withoutConversation(current, conversationId);
    next.push({
      conversationId,
      messages: [
        ...existingMessages.map((entry) => (
          entry.id === message.id ? failedMessage : cloneCollaborationMessage(entry)
        )),
        ...(hasIntervention ? [] : [failedMessage]),
      ].sort(compareMessages),
      ...(currentEntry?.pendingTurn ? { pendingTurn: { ...currentEntry.pendingTurn } } : {}),
      updatedAt: Date.now(),
    });
    await this.writeInTransaction(owner, next);
  }

  async initializeTurnInTransaction(
    owner: string,
    conversationId: string,
    messages: readonly CollaborationMessage[],
    pendingTurn: OptimisticPendingTurn,
  ): Promise<void> {
    const current = await this.readInTransaction(owner);
    const currentEntry = findEntry(current, conversationId);
    const mergedMessages = new Map(
      (currentEntry?.messages || []).map((message) => (
        [message.id, cloneCollaborationMessage(message)]
      )),
    );
    for (const message of messages) {
      const previous = mergedMessages.get(message.id);
      if (!previous || shouldReplaceOptimisticMessage(previous, message)) {
        mergedMessages.set(message.id, cloneCollaborationMessage(message));
      }
    }
    const next = withoutConversation(current, conversationId);
    next.push({
      conversationId,
      messages: [...mergedMessages.values()].sort(compareMessages),
      pendingTurn,
      updatedAt: Date.now(),
    });
    await this.writeInTransaction(owner, next);
  }

  async writePendingTurnInTransaction(
    owner: string,
    conversationId: string,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<void> {
    const current = await this.readInTransaction(owner);
    const entry = findEntry(current, conversationId);
    if (!entry) return;
    const next = withoutConversation(current, conversationId);
    next.push({
      conversationId,
      messages: entry.messages.map(cloneCollaborationMessage),
      pendingTurn,
      updatedAt: Date.now(),
    });
    await this.writeInTransaction(owner, next);
  }

  async writeTerminalInTransaction(
    owner: string,
    conversationId: string,
    terminalMessages: readonly CollaborationMessage[],
  ): Promise<OptimisticConversationLedgerItem> {
    const current = await this.readInTransaction(owner);
    const entry = findEntry(current, conversationId);
    const messages = new Map(
      (entry?.messages || []).map((message) => [message.id, cloneCollaborationMessage(message)]),
    );
    for (const message of terminalMessages) {
      const previous = messages.get(message.id);
      if (!previous || shouldReplaceOptimisticMessage(previous, message)) {
        messages.set(message.id, cloneCollaborationMessage(message));
      }
    }
    const finalized: OptimisticConversationLedgerItem = {
      conversationId,
      messages: [...messages.values()].sort(compareMessages),
      updatedAt: Date.now(),
    };
    await this.writeInTransaction(owner, [
      ...withoutConversation(current, conversationId),
      finalized,
    ]);
    return finalized;
  }

  async reconcileAcceptedTurnInTransaction(
    owner: string,
    conversationId: string,
    userMessageId: string,
    pendingTurn: OptimisticPendingTurn,
  ): Promise<void> {
    const current = await this.readInTransaction(owner);
    const entry = findEntry(current, conversationId);
    if (!entry) return;
    const localFailureIds = new Set([
      `send-failed-${userMessageId}`,
      `connection-unavailable-${userMessageId}`,
    ]);
    const next = withoutConversation(current, conversationId);
    next.push({
      conversationId,
      messages: entry.messages
        .filter(({ id }) => !localFailureIds.has(id))
        .map(cloneCollaborationMessage),
      pendingTurn,
      updatedAt: Date.now(),
    });
    await this.writeInTransaction(owner, next);
  }

  async writeCancellationInTransaction(
    owner: string,
    conversationId: string,
    userMessageId: string,
    terminalMessages: readonly CollaborationMessage[],
  ): Promise<void> {
    const current = await this.readInTransaction(owner);
    const entry = findEntry(current, conversationId);
    const replaceableIds = new Set([
      `send-failed-${userMessageId}`,
      `connection-unavailable-${userMessageId}`,
      `cancelled-${userMessageId}`,
    ]);
    const messages = new Map(
      (entry?.messages || [])
        .filter(({ id }) => !replaceableIds.has(id))
        .map((message) => [message.id, cloneCollaborationMessage(message)]),
    );
    for (const message of terminalMessages) {
      messages.set(message.id, cloneCollaborationMessage(message));
    }
    const next = withoutConversation(current, conversationId);
    next.push({
      conversationId,
      messages: [...messages.values()].sort(compareMessages),
      updatedAt: Date.now(),
    });
    await this.writeInTransaction(owner, next);
  }

  private async writeInTransaction(
    owner: string,
    items: readonly OptimisticConversationLedgerItem[],
  ): Promise<void> {
    await this.storage.setItem(optimisticLedgerKey(owner), JSON.stringify({
      version: OPTIMISTIC_LEDGER_VERSION,
      owner,
      items,
    }));
  }
}

export function optimisticLedgerKey(owner: string): string {
  return `${OPTIMISTIC_LEDGER_PREFIX}.${ownerStorageKey(owner)}`;
}

export function cloneOptimisticLedgerEntry(
  entry: OptimisticConversationLedgerItem,
): OptimisticConversationLedgerItem {
  return {
    conversationId: entry.conversationId,
    messages: entry.messages.map(cloneCollaborationMessage),
    ...(entry.pendingTurn ? { pendingTurn: { ...entry.pendingTurn } } : {}),
    updatedAt: entry.updatedAt,
  };
}

export function cloneCollaborationMessage(message: CollaborationMessage): CollaborationMessage {
  return {
    ...message,
    ...(message.meta ? { meta: { ...message.meta } } : {}),
  };
}

export function shouldReplaceOptimisticMessage(
  current: CollaborationMessage,
  incoming: CollaborationMessage,
): boolean {
  if (current.status === 'failed' && incoming.status !== 'failed') return false;
  if (incoming.status === 'failed' && current.status !== 'failed') return true;
  return optimisticMessageRevision(incoming) >= optimisticMessageRevision(current);
}

export function messageTimestamp(message: CollaborationMessage): number {
  return timestampNumber(message.created_at) || timestampNumber(message.updated_at);
}

export function normalizeOptimisticPendingTurn(
  value: unknown,
): OptimisticPendingTurn | undefined {
  if (!isRecord(value)) return undefined;
  const userMessageId = stringValue(value.userMessageId);
  const phase = stringValue(value.phase);
  if (
    !userMessageId
    || (
      phase !== 'thinking'
      && phase !== 'reconnecting'
      && phase !== 'executing'
      && phase !== 'cancel_requested'
    )
  ) return undefined;
  return {
    attempt: Math.max(0, Math.min(5, Math.floor(numberValue(value.attempt)))),
    ...(stringValue(value.lastError) ? { lastError: stringValue(value.lastError) } : {}),
    phase,
    phaseStartedAt: numberValue(value.phaseStartedAt) || Date.now(),
    ...(stringValue(value.turnId) ? { turnId: stringValue(value.turnId) } : {}),
    updatedAt: numberValue(value.updatedAt) || Date.now(),
    userMessageId,
  };
}

export function normalizeCollaborationMessage(value: unknown): CollaborationMessage[] {
  if (!isRecord(value)) return [];
  const id = stringValue(value.id);
  const role = stringValue(value.role);
  if (!id || (role !== 'user' && role !== 'assistant')) return [];
  return [{
    ...value,
    id,
    role,
    name: stringValue(value.name),
    content: stringValue(value.content),
    ...(isRecord(value.meta) ? { meta: { ...value.meta } } : {}),
  } as CollaborationMessage];
}

function parseOptimisticConversations(
  raw: string | null,
  owner: string,
): OptimisticConversationLedgerItem[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== OPTIMISTIC_LEDGER_VERSION) return [];
    if (normalizeOwner(value.owner) !== owner || !Array.isArray(value.items)) return [];
    return value.items.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const conversationId = stringValue(entry.conversationId);
      if (!conversationId || !Array.isArray(entry.messages)) return [];
      const messages = entry.messages.flatMap(normalizeCollaborationMessage);
      const pendingTurn = normalizeOptimisticPendingTurn(entry.pendingTurn);
      if (!messages.length && !pendingTurn) return [];
      return [{
        conversationId,
        messages,
        ...(pendingTurn ? { pendingTurn } : {}),
        updatedAt: numberValue(entry.updatedAt) || Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

function findEntry(
  items: readonly OptimisticConversationLedgerItem[],
  conversationId: string,
): OptimisticConversationLedgerItem | undefined {
  return items.find(({ conversationId: currentId }) => currentId === conversationId);
}

function withoutConversation(
  items: readonly OptimisticConversationLedgerItem[],
  conversationId: string,
): OptimisticConversationLedgerItem[] {
  return items.filter(({ conversationId: currentId }) => currentId !== conversationId);
}

function sameMessageIds(
  messages: readonly CollaborationMessage[],
  expectedMessageIds: readonly string[],
): boolean {
  const current = messages.map(({ id }) => id).sort();
  const expected = [...expectedMessageIds].map(stringValue).filter(Boolean).sort();
  return current.length === expected.length
    && current.every((id, index) => id === expected[index]);
}

function compareMessages(left: CollaborationMessage, right: CollaborationMessage): number {
  return messageTimestamp(left) - messageTimestamp(right);
}

function optimisticMessageRevision(message: CollaborationMessage): number {
  return Math.max(
    timestampNumber(message.created_at),
    timestampNumber(message.updated_at),
    timestampNumber(message.completed_at),
  );
}

function timestampNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
