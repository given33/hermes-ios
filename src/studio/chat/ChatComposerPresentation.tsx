import { SymbolView } from 'expo-symbols';
import { File, X } from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import {
  DynamicColorIOS,
  Image,
  Platform,
  PlatformColor,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Reanimated, {
  Easing,
  FadeIn,
  FadeInUp,
  FadeOut,
  LinearTransition,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { IOSContextMenu } from '../../components/ios/IOSContextMenu';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { IOS_MOTION } from '../../design/ios-motion';
import { MOTION, useMotion } from '../../design/motion';
import { useTheme } from '../../design/ThemeProvider';
import { formatAttachmentSize } from './chat-attachments';
import { styles } from './chat-presentation-styles';
import type { ChatAttachment } from './chat-types';

const IOS_STANDARD_EASING = Easing.bezier(...IOS_MOTION.curve.standard);
const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);

export function OpenMinisVoiceWaveform({ color }: { color: string }) {
  return (
    <View accessibilityElementsHidden style={styles.openMinisWaveform}>
      {[0.42, 0.72, 1, 0.62, 0.9, 0.52, 0.78, 0.46].map((height, index) => (
        <OpenMinisVoiceWaveBar
          color={color}
          height={height}
          index={index}
          key={`${height}-${index}`}
        />
      ))}
    </View>
  );
}
function OpenMinisVoiceWaveBar({
  color,
  height,
  index,
}: {
  color: string;
  height: number;
  index: number;
}) {
  const motion = useMotion();
  const scale = useSharedValue(0.35 + (index % 3) * 0.1);
  useEffect(() => {
    cancelAnimation(scale);
    if (motion.reduceMotion) {
      scale.value = 0.65;
      return undefined;
    }
    scale.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 360 + index * 29, easing: IOS_STANDARD_EASING }),
        withTiming(0.3, { duration: 320 + index * 23, easing: IOS_DECELERATE_EASING }),
      ),
      -1,
      true,
    );
    return () => cancelAnimation(scale);
  }, [index, motion.reduceMotion, scale]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }],
  }));
  return (
    <Reanimated.View
      style={[
        styles.openMinisWaveBar,
        { backgroundColor: color, height: 28 * height },
        animatedStyle,
      ]}
    />
  );
}

export function ComposerSurface({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  const surfaceStyle = [
    styles.inputShell,
    {
      backgroundColor: Platform.OS === 'ios'
        ? DynamicColorIOS({ dark: '#3a3a3a', light: '#f2f2f2' })
        : tokens.colors.card,
      borderColor: Platform.OS === 'ios'
        ? DynamicColorIOS({ dark: '#565656', light: '#d0d0d0' })
        : tokens.colors.border,
    },
  ];

  return (
    <View style={[styles.inputShellShadow, { shadowColor: tokens.colors.foreground }]}>
      <View style={surfaceStyle}>
        {children}
      </View>
    </View>
  );
}

export function AttachmentItem({
  attachment,
  isChinese,
  onPreview,
  onRemove,
  onShare,
}: {
  attachment: ChatAttachment;
  isChinese: boolean;
  onPreview(): void;
  onRemove(): void;
  onShare(): void;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const isImage = attachment.kind === 'image';
  const backgroundColor = Platform.OS === 'ios'
    ? PlatformColor('secondarySystemBackground')
    : multiplyAlpha(tokens.colors.card, 0.92);
  const borderColor = Platform.OS === 'ios'
    ? PlatformColor('separator')
    : multiplyAlpha(tokens.colors.foreground, 0.14);
  const labelColor = Platform.OS === 'ios'
    ? PlatformColor('label')
    : tokens.colors.foreground;
  const secondaryLabelColor = Platform.OS === 'ios'
    ? PlatformColor('secondaryLabel')
    : tokens.colors.textSecondary;
  const systemBlue = Platform.OS === 'ios'
    ? PlatformColor('systemBlue')
    : tokens.colors.primary;
  return (
    <Reanimated.View
      entering={motion.fade(
        FadeInUp
          .duration(IOS_MOTION.duration.content)
          .easing(IOS_DECELERATE_EASING),
        FadeIn.duration(MOTION.fade.reduced),
      )}
      exiting={FadeOut
        .duration(motion.fadeDuration(IOS_MOTION.duration.control))
        .easing(IOS_STANDARD_EASING)}
      layout={motion.animate(
        LinearTransition
          .duration(IOS_MOTION.duration.control)
          .easing(IOS_STANDARD_EASING),
      )}
      style={[
        styles.attachmentItem,
        isImage ? styles.attachmentImageItem : styles.attachmentFileItem,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.attachmentSurface,
          { backgroundColor, borderColor },
        ]}
      />
      <IOSContextMenu
        accessibilityLabel={isChinese
          ? `快速查看 ${attachment.name}`
          : `Quick Look ${attachment.name}`}
        actions={[
          {
            id: 'preview',
            onPress: onPreview,
            systemImage: 'doc.text.magnifyingglass',
            title: isChinese ? '快速查看' : 'Quick Look',
          },
          {
            id: 'share',
            onPress: onShare,
            systemImage: 'square.and.arrow.up',
            title: isChinese ? '分享' : 'Share',
          },
          {
            destructive: true,
            id: 'remove',
            onPress: onRemove,
            systemImage: 'trash',
            title: isChinese ? '移除附件' : 'Remove Attachment',
          },
        ]}
        onPress={onPreview}
        style={isImage ? styles.attachmentImagePreview : styles.attachmentFilePreview}
      >
        {isImage ? (
          <Image resizeMode="cover" source={{ uri: attachment.uri }} style={styles.attachmentThumbnail} />
        ) : (
          <>
            <View style={styles.attachmentFileIcon}>
              <SymbolView
                fallback={<File color={systemBlue} size={27} strokeWidth={1.6} />}
                name="doc.fill"
                size={28}
                tintColor={systemBlue}
                type="hierarchical"
              />
            </View>
            <View style={styles.attachmentFileCopy}>
              <Text numberOfLines={1} style={[styles.attachmentName, { color: labelColor }]}>
                {attachment.name}
              </Text>
              <Text style={[styles.attachmentSize, { color: secondaryLabelColor }]}>
                {formatAttachmentSize(attachment.size)}
              </Text>
            </View>
          </>
        )}
      </IOSContextMenu>
      <IOSPressable
        accessibilityLabel={isChinese
          ? `移除 ${attachment.name}`
          : `Remove ${attachment.name}`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onRemove}
        opacityTo={0.72}
        scaleTo={0.86}
        style={styles.attachmentRemove}
      >
        <SymbolView
          fallback={(
            <View style={styles.attachmentRemoveFallback}>
              <X color="#ffffff" size={12} strokeWidth={2.4} />
            </View>
          )}
          name="xmark.circle.fill"
          size={22}
          tintColor={Platform.OS === 'ios'
            ? PlatformColor('systemGray')
            : '#636366'}
        />
      </IOSPressable>
    </Reanimated.View>
  );
}
