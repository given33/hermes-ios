import { memo, useCallback, useState } from 'react';
import { Image, StyleSheet, Text, View, Pressable, Dimensions } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { useTheme } from '../../design/ThemeProvider';
import { IOS_MOTION } from '../../design/ios-motion';
import type { HermesChatAttachment as StoredChatAttachment } from '../../api/chat-view-model';

const SCREEN_WIDTH = Dimensions.get('window').width;
const COLLAPSED_IMAGE_SIZE = 80;
const COLLAPSED_OFFSET = 12;
const EXPANDED_IMAGE_WIDTH = Math.min(SCREEN_WIDTH * 0.7, 280);
const EXPANDED_IMAGE_HEIGHT = EXPANDED_IMAGE_WIDTH * 1.2;

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 180,
  mass: 0.8,
};

interface CollapsibleImageCardProps {
  attachments: readonly StoredChatAttachment[];
  isChinese: boolean;
  onOpenAttachment(attachment: StoredChatAttachment): void;
}

export const CollapsibleImageCard = memo(function CollapsibleImageCard({
  attachments,
  isChinese,
  onOpenAttachment,
}: CollapsibleImageCardProps) {
  const { tokens } = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const expandProgress = useSharedValue(0);

  const imageAttachments = attachments.filter(
    (att) => att.mimeType?.startsWith('image/')
  );

  const toggleExpand = useCallback(() => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    expandProgress.value = withSpring(nextState ? 1 : 0, SPRING_CONFIG);
  }, [isExpanded, expandProgress]);

  if (imageAttachments.length === 0) return null;

  // 单张图片直接显示，不需要折叠
  if (imageAttachments.length === 1) {
    return (
      <Pressable onPress={() => onOpenAttachment(imageAttachments[0])} style={styles.singleImageContainer}>
        <Image
          source={{ uri: imageAttachments[0].url }}
          style={styles.singleImage}
          resizeMode="cover"
        />
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      {!isExpanded ? (
        <CollapsedView
          attachments={imageAttachments}
          onExpand={toggleExpand}
          isChinese={isChinese}
        />
      ) : (
        <ExpandedView
          attachments={imageAttachments}
          onCollapse={toggleExpand}
          onOpenAttachment={onOpenAttachment}
          expandProgress={expandProgress}
        />
      )}
    </View>
  );
});

interface CollapsedViewProps {
  attachments: StoredChatAttachment[];
  onExpand: () => void;
  isChinese: boolean;
}

const CollapsedView = memo(function CollapsedView({
  attachments,
  onExpand,
  isChinese,
}: CollapsedViewProps) {
  const { tokens } = useTheme();

  // 最多显示3张堆叠的图片预览
  const previewCount = Math.min(3, attachments.length);

  return (
    <Pressable onPress={onExpand} style={styles.collapsedContainer}>
      <View style={styles.stackedImages}>
        {attachments.slice(0, previewCount).map((attachment, index) => {
          const offset = index * COLLAPSED_OFFSET;
          const zIndex = previewCount - index;
          const scale = 1 - index * 0.05;

          return (
            <Reanimated.View
              key={attachment.id}
              style={[
                styles.stackedImage,
                {
                  transform: [
                    { translateX: offset },
                    { translateY: offset },
                    { scale },
                  ],
                  zIndex,
                },
              ]}
            >
              <Image
                source={{ uri: attachment.url }}
                style={styles.collapsedImagePreview}
                resizeMode="cover"
              />
            </Reanimated.View>
          );
        })}
      </View>

      <View
        style={[
          styles.expandButton,
          { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border },
        ]}
      >
        <Text style={[styles.expandButtonText, { color: tokens.colors.primary }]}>
          {isChinese ? `展开 ${attachments.length}` : `Expand ${attachments.length}`}
        </Text>
      </View>
    </Pressable>
  );
});

interface ExpandedViewProps {
  attachments: StoredChatAttachment[];
  onCollapse: () => void;
  onOpenAttachment: (attachment: StoredChatAttachment) => void;
  expandProgress: Reanimated.SharedValue<number>;
}

const ExpandedView = memo(function ExpandedView({
  attachments,
  onCollapse,
  onOpenAttachment,
  expandProgress,
}: ExpandedViewProps) {
  const { tokens } = useTheme();

  return (
    <View style={styles.expandedContainer}>
      {attachments.map((attachment, index) => {
        const animatedStyle = useAnimatedStyle(() => {
          const delay = index * 50;
          const progress = Math.max(0, Math.min(1, expandProgress.value * 1.5 - delay / 300));

          return {
            opacity: withTiming(progress, {
              duration: 300,
              easing: Easing.bezier(0.25, 0.1, 0.25, 1),
            }),
            transform: [
              {
                translateY: withTiming(
                  interpolate(progress, [0, 1], [20, 0]),
                  { duration: 400, easing: Easing.bezier(0.25, 0.1, 0.25, 1) }
                ),
              },
              {
                scale: withTiming(
                  interpolate(progress, [0, 1], [0.92, 1]),
                  { duration: 400, easing: Easing.bezier(0.25, 0.1, 0.25, 1) }
                ),
              },
            ],
          };
        });

        return (
          <Reanimated.View key={attachment.id} style={[styles.expandedImageWrapper, animatedStyle]}>
            <Pressable
              onPress={() => onOpenAttachment(attachment)}
              style={[
                styles.expandedImageContainer,
                { backgroundColor: tokens.colors.secondary, borderColor: tokens.colors.border },
              ]}
            >
              <Image
                source={{ uri: attachment.url }}
                style={styles.expandedImage}
                resizeMode="cover"
              />
            </Pressable>
          </Reanimated.View>
        );
      })}

      <Pressable
        onPress={onCollapse}
        style={[
          styles.collapseButton,
          { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border },
        ]}
      >
        <Text style={[styles.collapseButtonText, { color: tokens.colors.textSecondary }]}>
          收起
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    width: '100%',
  },
  singleImageContainer: {
    marginTop: 10,
    borderRadius: 12,
    overflow: 'hidden',
  },
  singleImage: {
    width: EXPANDED_IMAGE_WIDTH,
    height: EXPANDED_IMAGE_HEIGHT,
    borderRadius: 12,
  },
  collapsedContainer: {
    position: 'relative',
    width: COLLAPSED_IMAGE_SIZE + 40,
    height: COLLAPSED_IMAGE_SIZE + 60,
  },
  stackedImages: {
    position: 'relative',
    width: COLLAPSED_IMAGE_SIZE,
    height: COLLAPSED_IMAGE_SIZE,
  },
  stackedImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: COLLAPSED_IMAGE_SIZE,
    height: COLLAPSED_IMAGE_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  collapsedImagePreview: {
    width: '100%',
    height: '100%',
  },
  expandButton: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  expandButtonText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  expandedContainer: {
    gap: 10,
  },
  expandedImageWrapper: {
    width: '100%',
  },
  expandedImageContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  expandedImage: {
    width: EXPANDED_IMAGE_WIDTH,
    height: EXPANDED_IMAGE_HEIGHT,
  },
  collapseButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 4,
  },
  collapseButtonText: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
});
