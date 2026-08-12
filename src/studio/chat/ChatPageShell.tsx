import { useMemo, type ComponentProps } from 'react';
import { File, Image as ImageIcon } from 'lucide-react-native';
import { Modal, View } from 'react-native';
import Reanimated from 'react-native-reanimated';

import { NativeButton } from '../../components/ui/NativeButton';
import { PreviewModal } from '../PreviewPrimitives';
import { AgentGroupChatView } from '../agent-group/AgentGroupChatView';
import { CodingPiChatView } from '../coding-pi/CodingPiChatView';
import { ChatComposer } from './ChatComposer';
import { ChatHeader } from './ChatHeader';
import { ChatMessageStream } from './ChatMessageStream';
import { ContextUsageRing } from './ChatPresentation';
import { ChatPlanDrawer } from './ChatPlanDrawer';
import { ConversationHistory, styles } from './ChatPresentation';
import type { ChatPlan } from './chat-plan-model';

type HistoryProps = ComponentProps<typeof ConversationHistory>;

interface ChatPageShellProps {
  attachmentsOpen: boolean;
  agentGroupChatProps: ComponentProps<typeof AgentGroupChatView>;
  codingPiChatProps: ComponentProps<typeof CodingPiChatView>;
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
  onPickFile(): void;
  onPickPhoto(camera: boolean): void;
  plan: ChatPlan | null;
  safeAreaLeft: number;
  safeAreaRight: number;
  showHistory: boolean;
  streamProps: ComponentProps<typeof ChatMessageStream>;
}

/** Pure chat layout. Network, persistence and state-machine work stays in hooks. */
export function ChatPageShell({
  attachmentsOpen,
  agentGroupChatProps,
  codingPiChatProps,
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
  onPickFile,
  onPickPhoto,
  plan,
  safeAreaLeft,
  safeAreaRight,
  showHistory,
  streamProps,
}: ChatPageShellProps) {
  // Latest context usage without allocating a reversed copy on every render.
  const contextUsedPercent = useMemo(() => {
    const { messages } = streamProps;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const value = messages[index].contextUsedPercent;
      if (typeof value === 'number') return value;
    }
    return undefined;
  }, [streamProps.messages]);
  return (
    <Reanimated.View
      style={[
        styles.root,
        { backgroundColor },
        keyboardRootStyle,
      ]}
    >
      <View style={styles.chat}>
        {showHistory && !historyCollapsed && headerProps.chatMode !== 'agent-group' ? (
          <ConversationHistory {...historyProps} />
        ) : null}

        <View style={styles.main}>
          <ChatHeader {...headerProps} />
          {headerProps.chatMode === 'agent-group' ? (
            <AgentGroupChatView {...agentGroupChatProps} />
          ) : headerProps.chatMode === 'coding' ? (
            <CodingPiChatView {...codingPiChatProps} />
          ) : (
            <>
              <ChatMessageStream {...streamProps} />
              <ChatPlanDrawer isChinese={isChinese} plan={plan}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                  <ContextUsageRing
                    isChinese={isChinese}
                    value={contextUsedPercent}
                  />
                </View>
                <Reanimated.View
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
              </ChatPlanDrawer>
            </>
          )}
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
