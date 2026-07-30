export interface ConversationDraftScope {
  owner: string;
  conversationId: string;
}

export function conversationDraftScope(
  owner: string,
  conversationId: string,
): ConversationDraftScope {
  return { owner: owner.trim(), conversationId: conversationId.trim() };
}

export function persistedDraftTarget(
  previous: ConversationDraftScope,
): ConversationDraftScope | null {
  return previous.owner && previous.conversationId ? previous : null;
}

export function canApplyHydratedDraft(
  expectedGeneration: number,
  currentGeneration: number,
  expected: ConversationDraftScope,
  current: ConversationDraftScope,
  hydrationRevision: number,
  currentRevision: number,
): boolean {
  return expectedGeneration === currentGeneration
    && expected.owner === current.owner
    && expected.conversationId === current.conversationId
    && hydrationRevision === currentRevision;
}
