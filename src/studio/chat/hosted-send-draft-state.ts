import type { ConversationDraftClaim } from '../../api/conversation-store-types';
import type { ChatAttachment } from './chat-types';

export interface ComposerSnapshot {
  attachments: ChatAttachment[];
  content: string;
}

export function draftClaimForComposer(
  requestId: string,
  content: string,
  attachments: readonly ChatAttachment[],
): ConversationDraftClaim {
  return {
    attachments: attachments.flatMap((attachment) => (
      attachment.draftPersistent
        ? [{ id: attachment.id, uri: attachment.uri }]
        : []
    )),
    content,
    requestId,
  };
}

export function recoverUndurableComposer(
  sent: ComposerSnapshot,
  current: ComposerSnapshot,
): ComposerSnapshot {
  const content = !current.content || current.content === sent.content
    ? sent.content
    : !sent.content || current.content.startsWith(`${sent.content}\n`)
      ? current.content
      : `${sent.content}${sent.content.endsWith('\n') ? '' : '\n'}${current.content}`;
  const identities = new Set(sent.attachments.map(attachmentIdentity));
  return {
    attachments: [
      ...sent.attachments,
      ...current.attachments.filter((attachment) => {
        const identity = attachmentIdentity(attachment);
        if (identities.has(identity)) return false;
        identities.add(identity);
        return true;
      }),
    ],
    content,
  };
}

function attachmentIdentity(attachment: ChatAttachment): string {
  return `${attachment.id}\u0000${attachment.uri}`;
}
