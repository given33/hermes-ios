import { Check, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Reanimated, {
  Easing,
  Extrapolation,
  FadeIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HermesSwiftUIModelToolsView,
  hasNativeSwiftUIModelTools,
} from '../../../modules/hermes-ios-controls';
import { NativeButton } from '../../components/ui/NativeButton';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { IOS_MOTION } from '../../design/ios-motion';
import { MOTION, useMotion } from '../../design/motion';
import { resolveSwiftUIThemeProps } from '../../design/swiftui-theme';
import { useTheme } from '../../design/ThemeProvider';
import { PreviewBadge, PreviewSegmented } from '../PreviewPrimitives';
import { AnimatedChevron } from '../WorkflowTimeline';
import { styles } from './chat-presentation-styles';

const IOS_DECELERATE_EASING = Easing.bezier(...IOS_MOTION.curve.decelerate);

export function ModelToolsDrawer({
  isChinese,
  onClose,
  onNewConversation,
  open,
}: {
  isChinese: boolean;
  onClose(): void;
  onNewConversation(): void;
  open: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const motion = useMotion();
  const [mounted, setMounted] = useState(open);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState('claude-sonnet-4');
  const [reasoning, setReasoning] = useState<'low' | 'medium' | 'high'>('medium');
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const translateX = useSharedValue(256);
  const panelOpacity = useSharedValue(open ? 1 : 0);
  const openModelPicker = () => {
    const models = ['claude-sonnet-4', 'gpt-5.6-sol'] as const;
    if (Platform.OS !== 'ios') {
      setModelOpen((current) => !current);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: models.length,
        options: [...models, isChinese ? '取消' : 'Cancel'],
        title: isChinese ? '选择模型' : 'Choose Model',
      },
      (index) => {
        const next = models[index];
        if (next) setModel(next);
      },
    );
  };

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        if (motion.reduceMotion) {
          translateX.value = 0;
          panelOpacity.value = withTiming(1, {
            duration: MOTION.fade.reduced,
          });
          return;
        }
        panelOpacity.value = 1;
        translateX.value = withSpring(0, {
          damping: IOS_MOTION.spring.damping,
          mass: IOS_MOTION.spring.mass,
          overshootClamping: true,
          stiffness: IOS_MOTION.spring.stiffness,
        });
      });
    } else if (mounted) {
      if (motion.reduceMotion) {
        panelOpacity.value = withTiming(0, {
          duration: MOTION.fade.reduced,
        }, (finished) => {
          if (finished) runOnJS(setMounted)(false);
        });
        return;
      }
      translateX.value = withSpring(256, {
        damping: IOS_MOTION.spring.damping,
        mass: IOS_MOTION.spring.mass,
        overshootClamping: true,
        stiffness: IOS_MOTION.spring.stiffness,
      }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [motion.reduceMotion, mounted, open, panelOpacity, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: panelOpacity.value,
    transform: [{ translateX: motion.reduceMotion ? 0 : translateX.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: motion.reduceMotion
      ? panelOpacity.value
      : interpolate(
          translateX.value,
          [0, 256],
          [1, 0],
          Extrapolation.CLAMP,
        ),
  }));

  if (Platform.OS === 'ios' && hasNativeSwiftUIModelTools) {
    return (
      <Modal
        animationType="none"
        onRequestClose={onClose}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={open}
      >
        <HermesSwiftUIModelToolsView
          {...resolveSwiftUIThemeProps(tokens)}
          locale={isChinese ? 'zh' : 'en'}
          model={model}
          onModelChange={(event) => setModel(event.nativeEvent.model)}
          onNewConversation={onNewConversation}
          onReasoningChange={(event) => {
            const next = event.nativeEvent.reasoning;
            if (next === 'low' || next === 'medium' || next === 'high') {
              setReasoning(next);
            }
          }}
          onRequestClose={onClose}
          onToolsChange={(event) => setToolsEnabled(event.nativeEvent.enabled)}
          open={open}
          reasoning={reasoning}
          style={styles.drawerRoot}
          toolsEnabled={toolsEnabled}
        />
      </Modal>
    );
  }

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <View style={styles.drawerRoot}>
        <Reanimated.View
          style={[StyleSheet.absoluteFill, styles.drawerBackdrop, backdropStyle]}
        >
          <IOSPressable haptic="none" onPress={onClose} opacityTo={1} scaleTo={1} style={StyleSheet.absoluteFill} />
        </Reanimated.View>
        <Reanimated.View
          style={[
            styles.drawer,
            {
              backgroundColor: 'transparent',
              borderLeftColor: tokens.colors.border,
              paddingBottom: insets.bottom,
              paddingTop: insets.top,
            },
            animatedStyle,
          ]}
        >
          <View style={[styles.drawerHeader, { borderBottomColor: tokens.colors.border }]}>
            <Text style={[styles.drawerTitle, { color: tokens.colors.foreground }]}>
              {isChinese ? '模型\n与工具' : 'MODEL\n& TOOLS'}
            </Text>
            <IOSPressable accessibilityLabel={isChinese ? '关闭' : 'Close'} onPress={onClose} scaleTo={0.9} style={styles.drawerClose}>
              <X color={tokens.colors.textSecondary} size={18} />
            </IOSPressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.drawerContent}
            decelerationRate="normal"
            scrollEventThrottle={8}
            showsVerticalScrollIndicator={false}
          >
            <NativeButton
              onPress={() => {
                onNewConversation();
                onClose();
              }}
              outlined
              style={styles.drawerNewChat}
            >
              {isChinese ? '新建对话' : 'New chat'}
            </NativeButton>
            <View style={[styles.drawerCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
              <View style={styles.drawerCardRow}>
                <View style={styles.drawerCardCopy}>
                  <Text style={[styles.drawerLabel, { color: tokens.colors.textTertiary }]}>{isChinese ? '模型' : 'MODEL'}</Text>
                  <IOSPressable haptic="selection" onPress={openModelPicker} style={styles.modelPicker}>
                    <Text numberOfLines={1} style={[styles.modelName, { color: tokens.colors.foreground }]}>{model}</Text>
                    <AnimatedChevron color={tokens.colors.textSecondary} open={modelOpen} size={14} />
                  </IOSPressable>
                </View>
                <PreviewBadge tone="success">{isChinese ? '在线' : 'LIVE'}</PreviewBadge>
              </View>
              {Platform.OS !== 'ios' && modelOpen ? (
                <Reanimated.View
                  entering={FadeIn
                    .duration(IOS_MOTION.duration.control)
                    .easing(IOS_DECELERATE_EASING)}
                  style={[styles.modelOptions, { borderTopColor: tokens.colors.border }]}
                >
                  {['claude-sonnet-4', 'gpt-5.6-sol'].map((option) => (
                    <IOSPressable
                      haptic="selection"
                      key={option}
                      onPress={() => {
                        setModel(option);
                        setModelOpen(false);
                      }}
                      style={styles.modelOption}
                    >
                      <Text style={[styles.modelOptionText, { color: tokens.colors.foreground }]}>{option}</Text>
                      {model === option ? <Check color={tokens.colors.success} size={14} /> : null}
                    </IOSPressable>
                  ))}
                </Reanimated.View>
              ) : null}
            </View>
            <View style={[styles.drawerCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
              <View style={styles.drawerCardRow}>
                <View style={styles.drawerCardCopy}>
                  <Text style={[styles.drawerLabel, { color: tokens.colors.textTertiary }]}>{isChinese ? '工具事件流' : 'TOOL EVENTS'}</Text>
                  <Text numberOfLines={1} style={[styles.drawerDetail, { color: tokens.colors.textSecondary }]}>
                    {isChinese ? '等待下一次工具调用' : 'Waiting for the next tool call'}
                  </Text>
                </View>
                <PreviewBadge tone="success">{isChinese ? '在线' : 'LIVE'}</PreviewBadge>
              </View>
            </View>
            <View style={[styles.reasoningCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
              <Text style={[styles.reasoningTitle, { color: tokens.colors.foreground }]}>{isChinese ? '推理强度' : 'Reasoning effort'}</Text>
              <View style={[styles.reasoningBody, { borderTopColor: tokens.colors.border }]}>
                <PreviewSegmented<'low' | 'medium' | 'high'>
                  onChange={setReasoning}
                  options={[
                    { label: isChinese ? '低' : 'Low', value: 'low' },
                    { label: isChinese ? '中' : 'Medium', value: 'medium' },
                    { label: isChinese ? '高' : 'High', value: 'high' },
                  ]}
                  value={reasoning}
                />
              </View>
            </View>
          </ScrollView>
        </Reanimated.View>
      </View>
    </Modal>
  );
}
