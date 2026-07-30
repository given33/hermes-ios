import type {
  ConversationDraftClaim,
  ConversationStorageAdapter,
} from './conversation-store-types';
import {
  awaitConversationStorageWrites,
  enqueueConversationStorageWrite,
  isConversationStorageOwnerBlocked,
} from './conversation-storage-coordinator';
import {
  isRecord,
  normalizeOwner,
  ownerStorageKey,
} from './conversation-storage-primitives';

const DRAFT_PREFIX = 'hermes:conversation-drafts:v1:';
const DRAFT_DELETION_PREFIX = 'hermes:conversation-owner-deleted:v1:';

export interface ConversationDraft {
  attachments: ConversationDraftAttachment[];
  content: string;
  updatedAt: number;
}

export interface ConversationDraftAttachment {
  draftPersistent: true;
  encryption?: 'aes-gcm-chunked-v2' | 'aes-gcm-v1';
  id: string;
  kind: 'file' | 'image';
  mimeType?: string | null;
  name: string;
  ownedTemporary?: boolean;
  size?: number | null;
  uri: string;
}

export function conversationDraftsKey(owner: string): string {
  return `${DRAFT_PREFIX}${ownerStorageKey(normalizeOwner(owner))}`;
}

export function conversationOwnerDeletionKey(owner: string): string {
  return `${DRAFT_DELETION_PREFIX}${ownerStorageKey(normalizeOwner(owner))}`;
}

export class ConversationDraftRepository {
  constructor(private readonly storage: ConversationStorageAdapter) {}

  async read(owner: string, conversationId: string): Promise<ConversationDraft | null> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedConversationId = conversationId.trim();
    if (!normalizedOwner || !normalizedConversationId) return null;
    await awaitConversationStorageWrites(normalizedOwner);
    if (
      isConversationStorageOwnerBlocked(normalizedOwner)
      || await this.storage.getItem(conversationOwnerDeletionKey(normalizedOwner))
    ) return null;
    const drafts = await this.readAll(normalizedOwner);
    return drafts[normalizedConversationId] || null;
  }

  async readReconciledInTransaction(
    owner: string,
    conversationId: string,
    claims: readonly ConversationDraftClaim[],
  ): Promise<ConversationDraft | null> {
    if (
      isConversationStorageOwnerBlocked(owner)
      || await this.storage.getItem(conversationOwnerDeletionKey(owner))
    ) return null;
    const drafts = await this.readAll(owner);
    const draft = drafts[conversationId] || null;
    if (!draft || !claims.some((claim) => draftMatchesClaim(draft, claim))) return draft;
    delete drafts[conversationId];
    await this.writeAllInTransaction(owner, drafts);
    return null;
  }

  async clearClaimedInTransaction(
    owner: string,
    conversationId: string,
    claim: ConversationDraftClaim | undefined,
  ): Promise<void> {
    if (
      !claim
      || isConversationStorageOwnerBlocked(owner)
      || await this.storage.getItem(conversationOwnerDeletionKey(owner))
    ) return;
    const drafts = await this.readAll(owner);
    const draft = drafts[conversationId];
    if (!draft || !draftMatchesClaim(draft, claim)) return;
    delete drafts[conversationId];
    await this.writeAllInTransaction(owner, drafts);
  }

  async write(
    owner: string,
    conversationId: string,
    content: string,
    attachments: readonly ConversationDraftAttachment[] = [],
    expectedEpoch?: number,
  ): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedConversationId = conversationId.trim();
    if (!normalizedOwner || !normalizedConversationId) return;
    await enqueueConversationStorageWrite(normalizedOwner, async () => {
      if (await this.storage.getItem(conversationOwnerDeletionKey(normalizedOwner))) return;
      const drafts = await this.readAll(normalizedOwner);
      const normalizedAttachments = normalizeDraftAttachments(attachments);
      if (content || normalizedAttachments.length) {
        drafts[normalizedConversationId] = {
          attachments: normalizedAttachments,
          content,
          updatedAt: Date.now(),
        };
      } else {
        delete drafts[normalizedConversationId];
      }
      await this.writeAllInTransaction(normalizedOwner, drafts);
    }, expectedEpoch);
  }

  private async writeAllInTransaction(
    owner: string,
    drafts: Readonly<Record<string, ConversationDraft>>,
  ): Promise<void> {
    const key = conversationDraftsKey(owner);
    if (Object.keys(drafts).length) {
      await this.storage.setItem(key, JSON.stringify({ drafts, version: 1 }));
    } else {
      await this.storage.removeItem(key);
    }
  }

  private async readAll(owner: string): Promise<Record<string, ConversationDraft>> {
    const raw = await this.storage.getItem(conversationDraftsKey(owner));
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || !isRecord(parsed.drafts)) return {};
      const drafts: Record<string, ConversationDraft> = {};
      for (const [conversationId, value] of Object.entries(parsed.drafts)) {
        if (!isRecord(value)) continue;
        const content = typeof value.content === 'string' ? value.content : '';
        const attachments = normalizeDraftAttachments(
          Array.isArray(value.attachments) ? value.attachments : [],
        );
        const updatedAt = Number(value.updatedAt);
        if (
          !conversationId
          || (!content && !attachments.length)
          || !Number.isFinite(updatedAt)
          || updatedAt < 0
        ) continue;
        drafts[conversationId] = { attachments, content, updatedAt };
      }
      return drafts;
    } catch {
      return {};
    }
  }
}

function draftMatchesClaim(
  draft: ConversationDraft,
  claim: ConversationDraftClaim,
): boolean {
  if (draft.content !== claim.content) return false;
  const draftAttachments = draft.attachments
    .map(({ id, uri }) => `${id}\u0000${uri}`)
    .sort();
  const claimedAttachments = claim.attachments
    .map(({ id, uri }) => `${id}\u0000${uri}`)
    .sort();
  return draftAttachments.length === claimedAttachments.length
    && draftAttachments.every((identity, index) => identity === claimedAttachments[index]);
}

function normalizeDraftAttachments(value: readonly unknown[]): ConversationDraftAttachment[] {
  return value.slice(0, 16).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 512) : '';
    const kind = candidate.kind === 'image' ? 'image' : candidate.kind === 'file' ? 'file' : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, 255) : '';
    const uri = typeof candidate.uri === 'string' ? candidate.uri.trim().slice(0, 4_096) : '';
    if (!id || !kind || !name || !uri) return [];
    const mimeType = typeof candidate.mimeType === 'string'
      ? candidate.mimeType.trim().slice(0, 255)
      : null;
    const rawSize = Number(candidate.size);
    const size = Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : null;
    return [{
      draftPersistent: true as const,
      ...(candidate.encryption === 'aes-gcm-v1' || candidate.encryption === 'aes-gcm-chunked-v2'
        ? { encryption: candidate.encryption }
        : {}),
      id,
      kind,
      ...(mimeType ? { mimeType } : {}),
      name,
      ownedTemporary: candidate.ownedTemporary === true,
      ...(size === null ? {} : { size }),
      uri,
    }];
  });
}
