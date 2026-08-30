import type { HermesCloudApi } from '../../api/HermesCloudApi';
import { boundedUploadBody } from '../../api/upload-body';
import { writeBoundedDownload } from '../../api/bounded-download';
import { fileNameFromUri, removeStagedFileImport } from './presentation';

export const KANBAN_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export function validateKanbanAttachmentSize(size: number, name: string): void {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`Attachment is empty or unavailable: ${name}`);
  }
  if (size > KANBAN_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Kanban attachments must be 25 MB or smaller: ${name}`);
  }
}

export async function uploadKanbanAttachmentUris(
  api: HermesCloudApi,
  taskId: string,
  uris: readonly string[],
  options: {
    board?: string;
    stagedImport?: boolean;
    uploadedBy?: string;
  } = {},
): Promise<void> {
  for (const uri of uris) {
    const name = fileNameFromUri(uri);
    try {
      const body = await boundedUploadBody(uri, name);
      validateKanbanAttachmentSize(body.size, name);
      await api.uploadKanbanTaskAttachment(
        taskId,
        body,
        name,
        options.uploadedBy || 'ios',
        options.board,
      );
    } finally {
      if (options.stagedImport) await removeStagedFileImport(uri);
    }
  }
}

export async function presentKanbanAttachment(
  api: HermesCloudApi,
  id: number | string,
  name: string,
  options: { board?: string; expectedBytes?: number } = {},
): Promise<void> {
  const [quickLook, Sharing, { temporaryPlaintextFile }] = await Promise.all([
    import('../../../modules/hermes-quick-look'),
    import('expo-sharing'),
    import('../../api/temporary-plaintext-files'),
  ]);
  const target = temporaryPlaintextFile(name || `kanban-attachment-${id}`, 'kanban-attachment');
  try {
    await api.consumeKanbanAttachment(
      id,
      (response, signal) => writeBoundedDownload(response, target, {
        expectedBytes: options.expectedBytes,
        maximumBytes: KANBAN_ATTACHMENT_MAX_BYTES,
        signal,
      }),
      { board: options.board, expectedBytes: options.expectedBytes },
    );
    const title = name || `Kanban attachment ${id}`;
    const presented = await quickLook.presentQuickLook(target.uri, title);
    if (!presented && await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target.uri, { dialogTitle: title });
    }
  } finally {
    if (target.exists) target.delete();
  }
}
