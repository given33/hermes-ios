import type { ComponentProps } from 'react';
import { File, Image as ImageIcon } from 'lucide-react-native';
import { Modal, View } from 'react-native';
import Reanimated from 'react-native-reanimated';

import { NativeButton } from '../../components/ui/NativeButton';
import { PreviewModal } from '../PreviewPrimitives';
import { ChatComposer } from './ChatComposer';
import { ChatHeader } from './ChatHeader';
import { ChatMessageStream } from './ChatMessageStream';
import { ConversationHistory, styles } from './ChatPresentation';

type HistoryProps = ComponentProps<typeof ConversationHistory>;

interface ChatPageShellProps {
  attachmentsOpen: boolean;
  backgroundColor: string;
  compact: boolean;
  composerKeyboardStyle: ComponentProps<typeof Reanimated.View>['style'];
  composerProps: ComponentProps<typeof ChatComposer>;
  headerProps: ComponentProps<typeof ChatHeader>;
  historyCollapsed: boolean;
  historyModalOpen: boolean;
  historyProps: HistoryProps;
  isChinese: boolean;
  keyboardRootStyle: ComponentProps<typeof Reanimated.View>['style'];
  modalHistoryProps: HistoryProps;
  onCloseAttachments(): void;
  onCloseHistory(): void;
  onComposerLayout(): void;
  onPickFile(): void;
  onPickPhoto(camera: boolean): void;
  safeAreaLeft: number;
  safeAreaRight: number;
  showHistory: boolean;
  streamProps: ComponentProps<typeof ChatMessageStream>;
}

/** Pure chat layout. Network, persistence and state-machine work stays in hooks. */
export function ChatPageShell({
  attachmentsOpen,
  backgroundColor,
  compact,
  composerKeyboardStyle,
  composerProps,
  headerProps,
  historyCollapsed,
  historyModalOpen,
  historyProps,
  isChinese,
  keyboardRootStyle,
  modalHistoryProps,
  onCloseAttachments,
  onCloseHistory,
  onComposerLayout,
  onPickFile,
  onPickPhoto,
  safeAreaLeft,
  safeAreaRight,
  showHistory,
  streamProps,
}: ChatPageShellProps) {
  return (
    <Reanimated.View
      style={[
        styles.root,
        { backgroundColor },
        keyboardRootStyle,
      ]}
    >
      <View style={styles.chat}>
        {showHistory && !historyCollapsed ? (
          <ConversationHistory {...historyProps} />
        ) : null}

        <View style={styles.main}>
          <ChatHeader {...headerProps} />
          <ChatMessageStream {...streamProps} />
          <Reanimated.View
            onLayout={onComposerLayout}
            style={[
              styles.composer,
              {
                backgroundColor: 'transparent',
                paddingLeft: (compact ? 4 : 8) + safeAreaLeft,
                paddingRight: (compact ? 4 : 8) + safeAreaRight,
              },
              composerKeyboardStyle,
            ]}
          >
            <ChatComposer {...composerProps} />
          </Reanimated.View>
        </View>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={onCloseHistory}
        presentationStyle="pageSheet"
        visible={historyModalOpen}
      >
        <ConversationHistory {...modalHistoryProps} />
      </Modal>

      <PreviewModal
        onClose={onCloseAttachments}
        open={attachmentsOpen}
        title={isChinese ? '添加附件' : 'Add attachment'}
      >
        <NativeButton onPress={() => onPickPhoto(false)} outlined prefix={<ImageIcon />}>
          {isChinese ? '照片图库' : 'Photo library'}
        </NativeButton>
        <NativeButton onPress={() => onPickPhoto(true)} outlined prefix={<ImageIcon />}>
          {isChinese ? '拍照' : 'Take photo'}
        </NativeButton>
        <NativeButton onPress={onPickFile} outlined prefix={<File />}>
          {isChinese ? '系统文件' : 'System files'}
        </NativeButton>
      </PreviewModal>
    </Reanimated.View>
  );
}
