import { SymbolView } from 'expo-symbols';
import { Camera, Keyboard as KeyboardIcon, Mic, Plus } from 'lucide-react-native';
import type { RefObject } from 'react';
import {
  DynamicColorIOS,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Reanimated, { Easing, FadeIn, FadeInUp, FadeOut } from 'react-native-reanimated';

import { hasNativeIOSContext, type IOSVoiceState } from '../../../modules/hermes-ios-context';
import type { ConversationCollaborationState } from '../../api/chat-view-model';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { IOS_MOTION } from '../../design/ios-motion';
import { MOTION, useMotion } from '../../design/motion';
import {
  AttachmentItem,
  ComposerSurface,
  OpenMinisVoiceWaveform,
  PendingDot,
} from './ChatPresentation';
import {
  composerVoicePrimaryAction,
  isComposerVoiceControlDisabled,
} from './chat-composer-voice-policy';
import { styles } from './chat-presentation-styles';
import type { ChatAttachment, PendingPhase } from './chat-types';
import type { SlashCommandDescriptor } from './useChatComposerNavigationController';

const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);
const RECONNECT_MAX_ATTEMPTS = 5;

interface ChatComposerModel {
  attachments: readonly ChatAttachment[];
  canCancelHostedTurn: boolean;
  canSend: boolean;
  cancellingHostedTurn: boolean;
  collaborationState: ConversationCollaborationState;
  content: string;
  filteredSlashCommands: readonly SlashCommandDescriptor[];
  hostedRunning: boolean;
  inputFontSize: number;
  isChinese: boolean;
  pendingPhase: PendingPhase;
  readRepliesAloud: boolean;
  reconnectAttempt: number;
  sending: boolean;
  slashMenuOpen: boolean;
  voiceError: string;
  voiceState: IOSVoiceState['state'];
}

interface ChatComposerActions {
  onCancelHostedTurn(): void;
  onContentChange(value: string): void;
  onFocus(): void;
  onOpenAttachmentPicker(): void;
  onPreviewAttachment(attachment: ChatAttachment): void;
  onRemoveAttachment(attachment: ChatAttachment): void;
  onSelectSlashCommand(command: SlashCommandDescriptor): void;
  onSend(): void;
  onShareAttachment(attachment: ChatAttachment): void;
  onTakePhoto(): void;
  onToggleReadRepliesAloud(): void;
  onToggleVoiceInput(): void;
}

export interface ChatComposerProps {
  actions: ChatComposerActions;
  inputRef: RefObject<TextInput | null>;
  model: ChatComposerModel;
}

export function ChatComposer({ actions, inputRef, model }: ChatComposerProps) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const attachmentCount = model.attachments.length;
  const voiceControlDisabled = !hasNativeIOSContext || isComposerVoiceControlDisabled(model);
  const voicePrimaryAction = hasNativeIOSContext ? composerVoicePrimaryAction(model) : 'none';
  const readRepliesAccessibilityValue = model.readRepliesAloud
    ? model.isChinese ? '自动朗读回复已开启' : 'Spoken replies on'
    : model.isChinese ? '自动朗读回复已关闭' : 'Spoken replies off';

  return (
    <>
      {model.collaborationState !== 'single' && (model.hostedRunning || model.sending) ? (
        <View style={styles.collaborationStatusBar}>
          <View style={styles.collaborationStatusDots}>
            {[0, 1, 2].map((dot) => <PendingDot delay={dot * 120} key={dot} />)}
          </View>
          <Text numberOfLines={1} style={[styles.collaborationStatusText, { color: tokens.colors.textSecondary }]}>
            {model.collaborationState === 'lifting'
              ? (model.isChinese ? '群聊正在拉起' : 'Starting group chat')
              : model.pendingPhase === 'reconnecting'
                ? (model.isChinese
                    ? `协作成员正在重连 (${model.reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})`
                    : `Collaboration member reconnecting (${model.reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})`)
                : (model.isChinese ? 'Hermes 调度员正在协调成员' : 'Hermes Manager is coordinating members')}
          </Text>
        </View>
      ) : null}
      {model.slashMenuOpen ? (
        <Reanimated.View
          entering={motion.fade(
            FadeInUp.duration(180).easing(IOS_DECELERATE_EASING),
            FadeIn.duration(MOTION.fade.reduced),
          )}
          exiting={FadeOut.duration(motion.fadeDuration(120)).easing(IOS_STANDARD_EASING)}
          style={[
            styles.openMinisSlashPopup,
            {
              backgroundColor: Platform.OS === 'ios'
                ? DynamicColorIOS({ dark: '#262626', light: '#ffffff' })
                : tokens.colors.card,
              borderColor: tokens.colors.border,
              shadowColor: tokens.colors.foreground,
            },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="always"
            scrollEventThrottle={8}
            showsVerticalScrollIndicator
            style={styles.openMinisSlashScroll}
          >
            {model.filteredSlashCommands.length ? model.filteredSlashCommands.map((item) => (
              <IOSPressable
                accessibilityLabel={`${item.command} ${model.isChinese ? item.zh : item.en}`}
                haptic="selection"
                key={item.command}
                onPress={() => actions.onSelectSlashCommand(item)}
                opacityTo={0.72}
                pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.08) }}
                style={styles.openMinisSlashRow}
              >
                <Text style={[styles.openMinisSlashCommand, { color: tokens.colors.foreground }]}>
                  {item.command}
                </Text>
                <Text numberOfLines={1} style={[styles.openMinisSlashDescription, { color: tokens.colors.textSecondary }]}>
                  {model.isChinese ? item.zh : item.en}
                </Text>
              </IOSPressable>
            )) : (
              <View style={styles.openMinisSlashEmpty}>
                <Text style={[styles.openMinisSlashDescription, { color: tokens.colors.textSecondary }]}>
                  {model.isChinese ? '没有匹配的命令' : 'No matching commands'}
                </Text>
              </View>
            )}
          </ScrollView>
        </Reanimated.View>
      ) : null}
      <ComposerSurface>
        {attachmentCount > 0 ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            scrollEventThrottle={8}
            showsVerticalScrollIndicator={attachmentCount > 6}
            style={styles.openMinisAttachmentViewport}
          >
            <View style={styles.openMinisAttachmentGrid}>
              {model.attachments.map((attachment) => (
                <AttachmentItem
                  attachment={attachment}
                  isChinese={model.isChinese}
                  key={attachment.id}
                  onPreview={() => actions.onPreviewAttachment(attachment)}
                  onRemove={() => actions.onRemoveAttachment(attachment)}
                  onShare={() => actions.onShareAttachment(attachment)}
                />
              ))}
            </View>
          </ScrollView>
        ) : null}

        {model.voiceState === 'listening' ? (
          <View style={styles.openMinisVoiceInput}>
            <OpenMinisVoiceWaveform color={tokens.colors.textSecondary} />
            <Text numberOfLines={4} style={[styles.openMinisTranscript, { color: tokens.colors.textSecondary }]}>
              {model.content || (model.isChinese ? '正在聆听…' : 'Listening…')}
            </Text>
          </View>
        ) : (
          <TextInput
            blurOnSubmit={false}
            multiline
            onChangeText={actions.onContentChange}
            onFocus={actions.onFocus}
            onSubmitEditing={actions.onSend}
            placeholder={model.isChinese ? '输入消息（@ 可提醒成员）' : 'Message Hermes (@ to mention members)'}
            placeholderTextColor={tokens.colors.textDisabled}
            returnKeyType="send"
            ref={inputRef}
            selectionColor={tokens.colors.foreground}
            style={[
              styles.openMinisInput,
              {
                color: tokens.colors.foreground,
                fontSize: model.inputFontSize,
              },
            ]}
            submitBehavior="submit"
            value={model.content}
          />
        )}

        {model.voiceError ? (
          <Text
            accessibilityRole="alert"
            numberOfLines={2}
            style={[styles.voiceError, { color: tokens.colors.destructive }]}
          >
            {model.voiceError}
          </Text>
        ) : null}

        <View style={styles.openMinisToolbar}>
          <IOSPressable
            accessibilityLabel={model.isChinese ? '上传图片或文件' : 'Upload image or file'}
            disabled={model.sending}
            haptic="light"
            hitSlop={8}
            onPress={actions.onOpenAttachmentPicker}
            opacityTo={0.76}
            pressRetentionOffset={12}
            scaleTo={0.9}
            style={[
              styles.openMinisRoundControl,
              { backgroundColor: 'transparent' },
            ]}
          >
            <SymbolView
              fallback={<Plus color={tokens.colors.textSecondary} size={24} />}
              name="plus"
              size={24}
              tintColor={tokens.colors.textSecondary}
              weight="medium"
            />
          </IOSPressable>

          <IOSPressable
            accessibilityLabel={model.isChinese ? '拍照' : 'Take photo'}
            disabled={model.sending}
            haptic="light"
            hitSlop={8}
            onPress={actions.onTakePhoto}
            opacityTo={0.76}
            scaleTo={0.9}
            style={[
              styles.openMinisRoundControl,
              { backgroundColor: 'transparent' },
            ]}
          >
            <SymbolView
              fallback={<Camera color={tokens.colors.textSecondary} size={22} />}
              name="camera.fill"
              size={22}
              tintColor={tokens.colors.textSecondary}
              weight="medium"
            />
          </IOSPressable>

          <View style={styles.openMinisToolbarSpacer} />

          <IOSPressable
            accessibilityActions={hasNativeIOSContext ? [{
              label: model.readRepliesAloud
                ? model.isChinese ? '关闭自动朗读回复' : 'Turn off spoken replies'
                : model.isChinese ? '开启自动朗读回复' : 'Turn on spoken replies',
              name: 'toggleReadRepliesAloud',
            }] : []}
            accessibilityLabel={!hasNativeIOSContext
              ? model.isChinese ? '语音输入不可用' : 'Voice input unavailable'
              : voicePrimaryAction === 'toggleReadRepliesAloud'
              ? model.isChinese ? '关闭自动朗读回复' : 'Turn off spoken replies'
              : model.voiceState === 'listening'
                ? model.isChinese ? '切换到文字输入' : 'Switch to text input'
                : model.isChinese ? '语音输入' : 'Voice input'}
            accessibilityHint={!hasNativeIOSContext
              ? model.isChinese
                ? '语音功能需要原生 iPhone 版本'
                : 'Voice features require the native iPhone build'
              : model.isChinese
                ? '长按可切换自动朗读回复'
                : 'Long press to toggle spoken replies'}
            accessibilityRole="button"
            accessibilityState={{
              disabled: voiceControlDisabled,
              selected: model.readRepliesAloud,
            }}
            accessibilityValue={{ text: readRepliesAccessibilityValue }}
            delayLongPress={400}
            disabled={voiceControlDisabled}
            haptic={model.voiceState === 'listening' ? 'medium' : 'light'}
            hitSlop={8}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'toggleReadRepliesAloud') {
                actions.onToggleReadRepliesAloud();
              }
            }}
            onLongPress={hasNativeIOSContext ? actions.onToggleReadRepliesAloud : undefined}
            onPress={voicePrimaryAction === 'toggleVoiceInput'
              ? actions.onToggleVoiceInput
              : voicePrimaryAction === 'toggleReadRepliesAloud'
                ? actions.onToggleReadRepliesAloud
                : undefined}
            opacityTo={0.72}
            scaleTo={0.9}
            style={[
              styles.openMinisRoundControl,
              {
                backgroundColor: model.readRepliesAloud
                  ? multiplyAlpha(tokens.colors.accent, 0.18)
                  : 'transparent',
              },
            ]}
          >
            <SymbolView
              fallback={model.voiceState === 'listening'
                ? <KeyboardIcon color={tokens.colors.textSecondary} size={15} />
                : <Mic color={tokens.colors.textSecondary} size={18} />}
              name={model.voiceState === 'listening' ? 'keyboard' : 'mic'}
              size={model.voiceState === 'listening' ? 15 : 18}
              tintColor={tokens.colors.textSecondary}
              weight="medium"
            />
          </IOSPressable>

          <IOSPressable
            accessibilityLabel={model.canCancelHostedTurn
              ? model.isChinese ? '取消当前任务' : 'Cancel current task'
              : model.isChinese ? '发送消息' : 'Send message'}
            disabled={model.canCancelHostedTurn ? model.cancellingHostedTurn : !model.canSend}
            haptic={model.canCancelHostedTurn ? 'medium' : model.canSend ? 'light' : 'none'}
            hitSlop={8}
            onPress={model.canCancelHostedTurn ? actions.onCancelHostedTurn : actions.onSend}
            opacityTo={0.78}
            pressRetentionOffset={12}
            scaleTo={0.9}
            style={[
              styles.openMinisSendControl,
              {
                backgroundColor: model.canCancelHostedTurn
                  ? tokens.colors.destructive
                  : model.canSend
                    ? tokens.colors.foreground
                    : multiplyAlpha(tokens.colors.textSecondary, 0.24),
                opacity: model.canCancelHostedTurn
                  ? model.cancellingHostedTurn ? 0.55 : 1
                  : model.canSend ? 1 : 0.3,
              },
            ]}
          >
            <SymbolView
              fallback={(
                <View
                  style={[
                    styles.openMinisSendFallbackCircle,
                    {
                      backgroundColor: model.canCancelHostedTurn
                        ? tokens.colors.destructive
                        : tokens.colors.foreground,
                    },
                  ]}
                >
                  <Text style={[
                    styles.openMinisSendFallback,
                    {
                      color: model.canCancelHostedTurn
                        ? tokens.colors.destructiveForeground
                        : tokens.colors.background,
                    },
                  ]}>
                    {model.canCancelHostedTurn ? '■' : '↑'}
                  </Text>
                </View>
              )}
              name={model.canCancelHostedTurn ? 'stop.fill' : 'arrow.up'}
              size={model.canCancelHostedTurn ? 18 : 22}
              tintColor={model.canCancelHostedTurn
                ? tokens.colors.destructiveForeground
                : tokens.colors.background}
              weight="medium"
            />
          </IOSPressable>
        </View>
      </ComposerSurface>
    </>
  );
}
