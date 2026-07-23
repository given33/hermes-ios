export const MAX_CONVERSATION_ATTACHMENT_BYTES = 64 * 1024 * 1024;

export interface SizedAttachmentCandidate {
  size?: number | null;
}

export function partitionAttachmentsBySize<T extends SizedAttachmentCandidate>(
  attachments: readonly T[],
  resolveSize: (attachment: T) => number,
  maximumBytes = MAX_CONVERSATION_ATTACHMENT_BYTES,
): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const attachment of attachments) {
    const declared = attachment.size;
    const bytes = typeof declared === 'number' && Number.isFinite(declared) && declared >= 0
      ? declared
      : resolveSize(attachment);
    (bytes > maximumBytes ? rejected : accepted).push(attachment);
  }
  return { accepted, rejected };
}
