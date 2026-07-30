import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImagePickerAsset } from 'expo-image-picker';

import type { ConversationStorageAdapter } from '../../api/conversation-store-types';
import type { ChatAttachment } from './chat-types';

const IMAGE_PICKER_RECOVERY_MARKER_KEY = '@hermes/image-picker-recovery/v1';
const IMAGE_PICKER_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export interface ImagePickerRecoveryMarker {
  createdAt: number;
  operationId: string;
  owner: string;
  ownerEpoch: number;
}

export class ImagePickerRecoveryMarkerStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly storage: ConversationStorageAdapter = AsyncStorage) {}

  read(): Promise<ImagePickerRecoveryMarker | null> {
    return this.enqueue(async () => parseMarker(
      await this.storage.getItem(IMAGE_PICKER_RECOVERY_MARKER_KEY),
    ));
  }

  record(marker: ImagePickerRecoveryMarker): Promise<void> {
    return this.enqueue(() => this.storage.setItem(
      IMAGE_PICKER_RECOVERY_MARKER_KEY,
      JSON.stringify(marker),
    ));
  }

  clearIfMatches(operationId: string): Promise<void> {
    return this.enqueue(async () => {
      const current = parseMarker(await this.storage.getItem(IMAGE_PICKER_RECOVERY_MARKER_KEY));
      if (current?.operationId !== operationId) return;
      await this.storage.removeItem(IMAGE_PICKER_RECOVERY_MARKER_KEY);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function matchesImagePickerRecoveryMarker(
  marker: ImagePickerRecoveryMarker | null,
  owner: string,
  ownerEpoch: number,
  now = Date.now(),
): boolean {
  return Boolean(
    marker
    && marker.owner === owner
    && marker.ownerEpoch === ownerEpoch
    && marker.createdAt <= now
    && now - marker.createdAt <= IMAGE_PICKER_RECOVERY_MAX_AGE_MS,
  );
}

export function discardedImagePickerAttachments(
  assets: readonly ImagePickerAsset[],
): ChatAttachment[] {
  return assets.map((asset, index) => ({
    draftPersistent: false,
    id: `discarded-picker-${index}`,
    kind: 'image',
    mimeType: asset.mimeType,
    name: asset.fileName ?? `discarded-picker-${index}`,
    ownedTemporary: true,
    size: asset.fileSize,
    uri: asset.uri,
  }));
}

function parseMarker(value: string | null): ImagePickerRecoveryMarker | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ImagePickerRecoveryMarker>;
    if (
      typeof parsed.createdAt !== 'number'
      || !Number.isFinite(parsed.createdAt)
      || typeof parsed.operationId !== 'string'
      || !parsed.operationId.trim()
      || typeof parsed.owner !== 'string'
      || !parsed.owner.trim()
      || typeof parsed.ownerEpoch !== 'number'
      || !Number.isSafeInteger(parsed.ownerEpoch)
      || parsed.ownerEpoch < 0
    ) {
      return null;
    }
    return {
      createdAt: parsed.createdAt,
      operationId: parsed.operationId,
      owner: parsed.owner,
      ownerEpoch: parsed.ownerEpoch,
    };
  } catch {
    return null;
  }
}
