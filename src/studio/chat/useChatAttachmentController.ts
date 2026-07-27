import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useCallback, type MutableRefObject } from 'react';
import {
  ActionSheetIOS,
  Keyboard,
  Platform,
  type TextInput,
} from 'react-native';

import { presentQuickLook } from '../../../modules/hermes-quick-look';
import { isUriInsideDirectory } from '../../api/attachment-draft-lifecycle';
import {
  MAX_CONVERSATION_ATTACHMENT_BYTES,
  partitionAttachmentsBySize,
} from '../../api/attachment-size-policy';
import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type { HermesChatAttachment as StoredChatAttachment } from '../../api/chat-view-model';
import { serverFailure, stableStringHash } from './chat-domain';
import type { ChatAttachment } from './chat-types';

interface ChatAttachmentControllerOptions {
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
  const appendPickedAttachments = useCallback((candidates: readonly ChatAttachment[]) => {
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
    if (accepted.length) updateAttachments((current) => [...current, ...accepted]);
    if (rejected.length) {
      cleanupAttachmentSources(rejected);
      const limit = Math.floor(MAX_CONVERSATION_ATTACHMENT_BYTES / (1024 * 1024));
      notify(isChinese
        ? `单个附件不能超过 ${limit} MB：${rejected.map(({ name }) => name).join('、')}`
        : `Each attachment must be ${limit} MB or smaller: ${rejected.map(({ name }) => name).join(', ')}`);
    }
  }, [cleanupAttachmentSources, isChinese, notify, updateAttachments]);

  const pickPhoto = useCallback(async (camera: boolean) => {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      notify(isChinese
        ? `请在系统设置中允许 Hermes 访问${camera ? '相机' : '照片'}。`
        : `Allow Hermes to access ${camera ? 'Camera' : 'Photos'} in Settings.`);
      return;
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          allowsMultipleSelection: true,
          mediaTypes: ['images'],
          quality: 1,
          selectionLimit: 0,
        });
    if (!result.canceled) {
      const stamp = Date.now();
      appendPickedAttachments(
        result.assets.map((asset, index): ChatAttachment => ({
          id: `image-${stamp}-${index}-${asset.assetId ?? asset.uri}`,
          kind: 'image',
          mimeType: asset.mimeType,
          ownedTemporary: Platform.OS !== 'web'
            && isUriInsideDirectory(asset.uri, Paths.cache.uri),
          name: asset.fileName ?? (isChinese ? `照片 ${index + 1}` : `Photo ${index + 1}`),
          size: asset.fileSize,
          uri: asset.uri,
        })),
      );
      setAttachmentsOpen(false);
    }
    keepLatestVisible(false);
  }, [appendPickedAttachments, isChinese, keepLatestVisible, notify, setAttachmentsOpen]);

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: false,
      multiple: true,
    });
    if (!result.canceled) {
      const stamp = Date.now();
      appendPickedAttachments(
        result.assets.map((asset, index): ChatAttachment => ({
          id: `file-${stamp}-${index}-${asset.uri}`,
          kind: asset.mimeType?.startsWith('image/') ? 'image' : 'file',
          mimeType: asset.mimeType,
          ownedTemporary: Platform.OS !== 'web'
            && isUriInsideDirectory(asset.uri, Paths.cache.uri),
          name: asset.name,
          size: asset.size,
          uri: asset.uri,
        })),
      );
      setAttachmentsOpen(false);
    }
    keepLatestVisible(false);
  }, [appendPickedAttachments, keepLatestVisible, setAttachmentsOpen]);

  const showIOSAttachmentPicker = useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: 3,
        options: isChinese
          ? ['照片图库', '拍照', '系统文件', '取消']
          : ['Photo Library', 'Take Photo', 'Choose File', 'Cancel'],
        title: isChinese ? '添加附件' : 'Add Attachment',
      },
      (index) => {
        if (index === 0) void pickPhoto(false);
        if (index === 1) void pickPhoto(true);
        if (index === 2) void pickFile();
      },
    );
  }, [isChinese, pickFile, pickPhoto]);

  const openAttachmentPicker = useCallback(() => {
    if (Platform.OS !== 'ios') {
      setAttachmentsOpen(true);
      return;
    }
    pendingAttachmentCleanup.current?.();
    keyboardAvoidanceEnabled.value = 0;
    const keyboardWasVisible = Keyboard.isVisible();
    composerInputRef.current?.blur();
    if (!keyboardWasVisible) {
      requestAnimationFrame(showIOSAttachmentPicker);
      return;
    }
    let completed = false;
    const present = () => {
      if (completed) return;
      completed = true;
      pendingAttachmentCleanup.current?.();
      showIOSAttachmentPicker();
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
    composerInputRef,
    keyboardAvoidanceEnabled,
    pendingAttachmentCleanup,
    setAttachmentsOpen,
    showIOSAttachmentPicker,
  ]);

  const shareAttachment = useCallback(async (attachment: ChatAttachment) => {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(attachment.uri, {
        dialogTitle: attachment.name,
        mimeType: attachment.mimeType ?? undefined,
      });
      return;
    }
    notify(isChinese ? '当前设备无法打开系统分享' : 'System sharing is unavailable');
  }, [isChinese, notify]);

  const previewAttachment = useCallback(async (attachment: ChatAttachment) => {
    if (Platform.OS === 'ios' && await presentQuickLook(attachment.uri, attachment.name)) {
      return;
    }
    await shareAttachment(attachment);
  }, [shareAttachment]);

  const removeAttachment = useCallback((attachment: ChatAttachment) => {
    cleanupAttachmentSources([attachment]);
    updateAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }, [cleanupAttachmentSources, updateAttachments]);

  const openStoredAttachment = useCallback(async (
    attachment: StoredChatAttachment,
    share = false,
  ) => {
    if (!cloudApi) return;
    try {
      const target = new ExpoFile(
        Paths.cache,
        `${stableStringHash(attachment.downloadUrl)}-${attachment.name.replace(/[\\/:*?"<>|]+/g, '_')}`,
      );
      try {
        if (!target.exists) {
          const blob = await cloudApi.downloadConversationAttachment(attachment.downloadUrl);
          target.write(new Uint8Array(await blob.arrayBuffer()));
        }
        if (!share && await presentQuickLook(target.uri, attachment.name)) return;
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(target.uri, {
            dialogTitle: attachment.name,
            mimeType: attachment.mimeType,
          });
        }
      } finally {
        if (target.exists) target.delete();
      }
    } catch (error) {
      notify(serverFailure(error, isChinese));
    }
  }, [cloudApi, isChinese, notify]);

  return {
    openAttachmentPicker,
    openStoredAttachment,
    pickFile,
    pickPhoto,
    previewAttachment,
    removeAttachment,
    shareAttachment,
  };
}
