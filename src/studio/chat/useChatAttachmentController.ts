import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import {
  ActionSheetIOS,
  Keyboard,
  Platform,
  type TextInput,
} from 'react-native';

import { presentQuickLook } from '../../../modules/hermes-quick-look';
import { subscribeToWebPickerAbandonment } from '../../../modules/hermes-picker-lifecycle';
import {
  copyAttachmentIntoDraftCache,
  writeTextIntoDraftCache,
} from '../../api/attachment-draft-cache';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import { runOwnerEpochBound } from '../../api/owner-epoch-async';
import { attachmentOutboxOwnerComponent } from '../../api/attachment-outbox-crypto';
import {
  MAX_CONVERSATION_ATTACHMENT_BYTES,
  partitionAttachmentsBySize,
} from '../../api/attachment-size-policy';
import { writeBoundedDownload } from '../../api/bounded-download';
import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type { HermesChatAttachment as StoredChatAttachment } from '../../api/chat-view-model';
import { AsyncSingleFlight } from './AsyncSingleFlight';
import { serverFailure, stableStringHash, uniqueTurnId } from './chat-domain';
import { largePasteMarker } from './composer-draft-policy';
import {
  discardedImagePickerAttachments,
  ImagePickerRecoveryMarkerStore,
  matchesImagePickerRecoveryMarker,
} from './image-picker-recovery-marker';
import type { ChatAttachment } from './chat-types';

const imagePickerRecoveryMarkers = new ImagePickerRecoveryMarkerStore();

interface ChatAttachmentControllerOptions {
  cacheOwner: string;
  cleanupAttachmentSources(items: readonly ChatAttachment[]): void;
  cloudApi: HermesCloudApi | null;
  composerInputRef: MutableRefObject<TextInput | null>;
  isChinese: boolean;
  keepLatestVisible(immediate: boolean, force?: boolean): void;
  keyboardAvoidanceEnabled: { value: number };
  notify(message: string): void;
  pendingAttachmentCleanup: MutableRefObject<(() => void) | null>;
  setAttachmentsOpen(open: boolean): void;
  updateAttachments(
    update: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[]),
  ): void;
}

export function useChatAttachmentController({
  cacheOwner,
  cleanupAttachmentSources,
  cloudApi,
  composerInputRef,
  isChinese,
  keepLatestVisible,
  keyboardAvoidanceEnabled,
  notify,
  pendingAttachmentCleanup,
  setAttachmentsOpen,
  updateAttachments,
}: ChatAttachmentControllerOptions) {
  const attachmentDownloads = useRef(new Set<AbortController>());
  const attachmentPickerFlight = useRef(new AsyncSingleFlight());
  useEffect(() => () => {
    for (const controller of attachmentDownloads.current) controller.abort();
    attachmentDownloads.current.clear();
  }, [cacheOwner]);

  const appendPickedAttachments = useCallback((
    candidates: readonly ChatAttachment[],
    expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner),
  ) => {
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) {
      cleanupAttachmentSources(candidates);
      return;
    }
    const { accepted, rejected } = partitionAttachmentsBySize(
      candidates,
      (attachment) => {
        try {
          return new ExpoFile(attachment.uri).size;
        } catch {
          return 0;
        }
      },
    );
    if (accepted.length && isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) {
      updateAttachments((current) => [...current, ...accepted]);
    }
    if (rejected.length) {
      cleanupAttachmentSources(rejected);
      if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return;
      const limit = Math.floor(MAX_CONVERSATION_ATTACHMENT_BYTES / (1024 * 1024));
      notify(isChinese
        ? `单个附件不能超过 ${limit} MB：${rejected.map(({ name }) => name).join('、')}`
        : `Each attachment must be ${limit} MB or smaller: ${rejected.map(({ name }) => name).join(', ')}`);
    }
  }, [cacheOwner, cleanupAttachmentSources, isChinese, notify, updateAttachments]);

  const appendImagePickerAssets = useCallback((
    assets: readonly ImagePicker.ImagePickerAsset[],
    expectedOwnerEpoch: number,
  ) => {
    const prepared: ChatAttachment[] = [];
    try {
      for (const [index, asset] of assets.entries()) {
        const identity = uniqueTurnId(`image-${index}`);
        const name = asset.fileName
          ?? (isChinese ? `照片 ${index + 1}` : `Photo ${index + 1}`);
        prepared.push({
          draftPersistent: true,
          id: identity,
          kind: 'image',
          mimeType: asset.mimeType,
          ownedTemporary: Platform.OS !== 'web',
          name,
          size: asset.fileSize,
          uri: Platform.OS === 'web'
            ? asset.uri
            : copyAttachmentIntoDraftCache(cacheOwner || 'local', asset.uri, name, identity),
        });
      }
      appendPickedAttachments(prepared, expectedOwnerEpoch);
    } catch (error) {
      cleanupAttachmentSources(prepared);
      throw error;
    }
  }, [appendPickedAttachments, cacheOwner, cleanupAttachmentSources, isChinese]);

  const discardImagePickerAssets = useCallback((
    assets: readonly ImagePicker.ImagePickerAsset[],
  ) => {
    cleanupAttachmentSources(discardedImagePickerAttachments(assets));
  }, [cleanupAttachmentSources]);

  const appendDocumentPickerAssets = useCallback((
    assets: readonly DocumentPicker.DocumentPickerAsset[],
    expectedOwnerEpoch: number,
  ) => {
    const prepared: ChatAttachment[] = [];
    try {
      for (const [index, asset] of assets.entries()) {
        const identity = uniqueTurnId(`file-${index}`);
        prepared.push({
          draftPersistent: true,
          id: identity,
          kind: asset.mimeType?.startsWith('image/') ? 'image' : 'file',
          mimeType: asset.mimeType,
          ownedTemporary: Platform.OS !== 'web',
          name: asset.name,
          size: asset.size,
          uri: Platform.OS === 'web'
            ? asset.uri
            : copyAttachmentIntoDraftCache(
                cacheOwner || 'local', asset.uri, asset.name, identity,
              ),
        });
      }
      appendPickedAttachments(prepared, expectedOwnerEpoch);
    } catch (error) {
      cleanupAttachmentSources(prepared);
      throw error;
    }
  }, [appendPickedAttachments, cacheOwner, cleanupAttachmentSources]);

  const appendLargePastedText = useCallback((content: string) => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return null;
    const size = new TextEncoder().encode(content).byteLength;
    if (size > MAX_CONVERSATION_ATTACHMENT_BYTES) {
      const limit = Math.floor(MAX_CONVERSATION_ATTACHMENT_BYTES / (1024 * 1024));
      notify(isChinese
        ? `粘贴内容不能超过 ${limit} MB`
        : `Pasted text must be ${limit} MB or smaller.`);
      return null;
    }
    const ownerComponent = attachmentOutboxOwnerComponent(cacheOwner || 'local');
    const identity = uniqueTurnId('paste').replace(/[^A-Za-z0-9._-]/g, '');
    const name = `hermes-paste-${ownerComponent}-${identity}.txt`;
    const uri = Platform.OS === 'web'
      ? new ExpoFile(Paths.cache, name).uri
      : writeTextIntoDraftCache(cacheOwner || 'local', name, content);
    if (Platform.OS === 'web') new ExpoFile(uri).write(content);
    const attachment: ChatAttachment = {
      draftPersistent: true,
      id: identity,
      kind: 'file',
      mimeType: 'text/plain',
      name,
      ownedTemporary: true,
      size,
      uri,
    };
    return {
      attachment,
      marker: largePasteMarker(content, name, isChinese),
    };
  }, [cacheOwner, isChinese, notify]);

  const pickPhoto = useCallback(async (
    camera: boolean,
    expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner),
  ) => {
    const lifecycleCurrent = () => isConversationStorageEpochCurrent(
      cacheOwner,
      expectedOwnerEpoch,
    );
    try {
      await attachmentPickerFlight.current.run(async (flightCurrent) => {
        const operationCurrent = () => flightCurrent() && lifecycleCurrent();
        if (!operationCurrent()) return;
        if (Platform.OS !== 'web') {
          const permission = await runOwnerEpochBound(
            cacheOwner,
            expectedOwnerEpoch,
            () => camera
              ? ImagePicker.requestCameraPermissionsAsync()
              : ImagePicker.requestMediaLibraryPermissionsAsync(),
          );
          if (!permission || !operationCurrent()) return;
          if (!permission.granted) {
            notify(isChinese
              ? `请在系统设置中允许 Hermes 访问${camera ? '相机' : '照片'}。`
              : `Allow Hermes to access ${camera ? 'Camera' : 'Photos'} in Settings.`);
            return;
          }
        }
        const recoveryOperationId = Platform.OS === 'android' && cacheOwner.trim()
          ? uniqueTurnId('image-picker-recovery')
          : '';
        if (recoveryOperationId) {
          await imagePickerRecoveryMarkers.record({
            createdAt: Date.now(),
            operationId: recoveryOperationId,
            owner: cacheOwner,
            ownerEpoch: expectedOwnerEpoch,
          });
          if (!operationCurrent()) {
            await imagePickerRecoveryMarkers.clearIfMatches(recoveryOperationId);
            return;
          }
        }
        let result: ImagePicker.ImagePickerResult;
        try {
          result = await (camera
            ? ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
            : ImagePicker.launchImageLibraryAsync({
                allowsMultipleSelection: true,
                mediaTypes: ['images'],
                quality: 1,
                selectionLimit: 0,
              }));
        } finally {
          if (recoveryOperationId) {
            await imagePickerRecoveryMarkers.clearIfMatches(recoveryOperationId);
          }
        }
        if (!operationCurrent()) {
          if (!result.canceled) discardImagePickerAssets(result.assets);
          return;
        }
        if (!result.canceled) {
          appendImagePickerAssets(result.assets, expectedOwnerEpoch);
          if (operationCurrent()) setAttachmentsOpen(false);
        }
        if (operationCurrent()) keepLatestVisible(false);
      }, Platform.OS === 'web' ? subscribeToWebPickerAbandonment : undefined);
    } catch (error) {
      if (lifecycleCurrent()) notify(serverFailure(error, isChinese));
    }
  }, [
    appendImagePickerAssets,
    cacheOwner,
    discardImagePickerAssets,
    isChinese,
    keepLatestVisible,
    notify,
    setAttachmentsOpen,
  ]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner);
    let effectCurrent = true;
    const lifecycleCurrent = () => effectCurrent && isConversationStorageEpochCurrent(
      cacheOwner,
      expectedOwnerEpoch,
    );
    let recoveryOperationId = '';
    let consumedPendingResult = false;
    void (async () => {
      const marker = await imagePickerRecoveryMarkers.read();
      recoveryOperationId = marker?.operationId ?? '';
      const result = await ImagePicker.getPendingResultAsync();
      if (!result) return;
      consumedPendingResult = true;
      if ('code' in result) throw new Error(result.message || result.code);
      if (result.canceled) return;
      if (!effectCurrent) {
        discardImagePickerAssets(result.assets);
        return;
      }
      if (!matchesImagePickerRecoveryMarker(
        marker,
        cacheOwner,
        expectedOwnerEpoch,
      ) || !lifecycleCurrent()) {
        discardImagePickerAssets(result.assets);
        return;
      }
      appendImagePickerAssets(result.assets, expectedOwnerEpoch);
      if (lifecycleCurrent()) {
        setAttachmentsOpen(false);
        keepLatestVisible(false);
      }
    })()
      .catch((error) => {
        if (lifecycleCurrent()) notify(serverFailure(error, isChinese));
      })
      .finally(async () => {
        if (consumedPendingResult && recoveryOperationId) {
          await imagePickerRecoveryMarkers.clearIfMatches(recoveryOperationId);
        }
      })
      .catch((error) => {
        if (lifecycleCurrent()) notify(serverFailure(error, isChinese));
      });
    return () => {
      effectCurrent = false;
    };
  }, [
    appendImagePickerAssets,
    cacheOwner,
    discardImagePickerAssets,
    isChinese,
    keepLatestVisible,
    notify,
    setAttachmentsOpen,
  ]);

  const pickFile = useCallback(async (
    expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner),
  ) => {
    const lifecycleCurrent = () => isConversationStorageEpochCurrent(
      cacheOwner,
      expectedOwnerEpoch,
    );
    try {
      await attachmentPickerFlight.current.run(async (flightCurrent) => {
        const operationCurrent = () => flightCurrent() && lifecycleCurrent();
        if (!operationCurrent()) return;
        const result = await runOwnerEpochBound(
          cacheOwner,
          expectedOwnerEpoch,
          () => DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
            multiple: true,
          }),
        );
        if (!result || !operationCurrent()) return;
        if (!result.canceled && result.assets) {
          appendDocumentPickerAssets(result.assets, expectedOwnerEpoch);
          if (operationCurrent()) setAttachmentsOpen(false);
        }
        if (operationCurrent()) keepLatestVisible(false);
      }, Platform.OS === 'web' ? subscribeToWebPickerAbandonment : undefined);
    } catch (error) {
      if (lifecycleCurrent()) notify(serverFailure(error, isChinese));
    }
  }, [appendDocumentPickerAssets, cacheOwner, isChinese, keepLatestVisible, notify, setAttachmentsOpen]);

  const showIOSAttachmentPicker = useCallback((
    expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner),
  ) => {
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 3,
        options: isChinese
          ? ['照片图库', '拍照', '系统文件', '取消']
          : ['Photo Library', 'Take Photo', 'Choose File', 'Cancel'],
        title: isChinese ? '添加附件' : 'Add Attachment',
      },
      (index) => {
        if (index === 0) void pickPhoto(false, expectedOwnerEpoch);
        if (index === 1) void pickPhoto(true, expectedOwnerEpoch);
        if (index === 2) void pickFile(expectedOwnerEpoch);
      },
    );
  }, [cacheOwner, isChinese, pickFile, pickPhoto]);

  const openAttachmentPicker = useCallback(() => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    if (Platform.OS !== 'ios') {
      setAttachmentsOpen(true);
      return;
    }
    pendingAttachmentCleanup.current?.();
    keyboardAvoidanceEnabled.value = 0;
    const keyboardWasVisible = Keyboard.isVisible();
    composerInputRef.current?.blur();
    if (!keyboardWasVisible) {
      requestAnimationFrame(() => showIOSAttachmentPicker(ownerEpoch));
      return;
    }
    let completed = false;
    const present = () => {
      if (completed) return;
      completed = true;
      pendingAttachmentCleanup.current?.();
      showIOSAttachmentPicker(ownerEpoch);
    };
    const subscription = Keyboard.addListener('keyboardDidHide', present);
    const fallback = setTimeout(present, 450);
    pendingAttachmentCleanup.current = () => {
      subscription.remove();
      clearTimeout(fallback);
      pendingAttachmentCleanup.current = null;
    };
    Keyboard.dismiss();
  }, [
    cacheOwner,
    composerInputRef,
    keyboardAvoidanceEnabled,
    pendingAttachmentCleanup,
    setAttachmentsOpen,
    showIOSAttachmentPicker,
  ]);

  const shareAttachment = useCallback(async (
    attachment: ChatAttachment,
    expectedOwnerEpoch = captureConversationStorageEpoch(cacheOwner),
  ) => {
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return;
    const sharingAvailable = await Sharing.isAvailableAsync();
    if (!isConversationStorageEpochCurrent(cacheOwner, expectedOwnerEpoch)) return;
    if (sharingAvailable) {
      await Sharing.shareAsync(attachment.uri, {
        dialogTitle: attachment.name,
        mimeType: attachment.mimeType ?? undefined,
      });
      return;
    }
    notify(isChinese ? '当前设备无法打开系统分享' : 'System sharing is unavailable');
  }, [cacheOwner, isChinese, notify]);

  const previewAttachment = useCallback(async (attachment: ChatAttachment) => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    if (Platform.OS === 'ios') {
      const opened = await presentQuickLook(attachment.uri, attachment.name);
      if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
      if (opened) return;
    }
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    await shareAttachment(attachment, ownerEpoch);
  }, [cacheOwner, shareAttachment]);

  const removeAttachment = useCallback((attachment: ChatAttachment) => {
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    cleanupAttachmentSources([attachment]);
    updateAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }, [cacheOwner, cleanupAttachmentSources, updateAttachments]);

  const openStoredAttachment = useCallback(async (
    attachment: StoredChatAttachment,
    share = false,
  ) => {
    if (!cloudApi) return;
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
    const abortController = new AbortController();
    attachmentDownloads.current.add(abortController);
    try {
      const downloadIdentity = uniqueTurnId('attachment-download')
        .replace(/[^A-Za-z0-9._-]/g, '');
      const target = new ExpoFile(
        Paths.cache,
        `${stableStringHash(attachment.downloadUrl)}-${ownerEpoch}-${downloadIdentity}`
          + `-${attachment.name.replace(/[\\/:*?"<>|]+/g, '_')}`,
      );
      let ownsTarget = false;
      try {
        if (!target.exists) {
          await cloudApi.consumeConversationAttachment(
            attachment.downloadUrl,
            (response, signal) => writeBoundedDownload(response, target, {
              expectedBytes: attachment.size,
              expectedSha256: attachment.sha256,
              isCurrent: () => isConversationStorageEpochCurrent(cacheOwner, ownerEpoch),
              signal,
            }),
            abortController.signal,
          );
          ownsTarget = true;
        }
        if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
        if (!share) {
          const opened = await presentQuickLook(target.uri, attachment.name);
          if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
          if (opened) return;
        }
        if (await Sharing.isAvailableAsync()) {
          if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return;
          await Sharing.shareAsync(target.uri, {
            dialogTitle: attachment.name,
            mimeType: attachment.mimeType,
          });
        }
      } finally {
        if (ownsTarget && target.exists) target.delete();
      }
    } catch (error) {
      if (isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) {
        notify(serverFailure(error, isChinese));
      }
    } finally {
      attachmentDownloads.current.delete(abortController);
    }
  }, [cacheOwner, cloudApi, isChinese, notify]);

  return {
    appendLargePastedText,
    openAttachmentPicker,
    openStoredAttachment,
    pickFile,
    pickPhoto,
    previewAttachment,
    removeAttachment,
    shareAttachment,
  };
}
