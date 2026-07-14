import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { TriangleAlert } from 'lucide-react-native';

import { WEBUI_FONT_FAMILIES } from '../../app/webui-fonts';
import {
  CONTROL_METRICS,
  INITIAL_CONFIRM_DIALOG_GATE,
  resolveControlColors,
  transitionConfirmDialogGate,
  type ConfirmDialogGateEvent,
  type ConfirmDialogGateState,
} from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { NativeButton } from './NativeButton';

const DIALOG_DURATION_MS = 150;
const DIALOG_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);

export interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  description?: string;
  destructive?: boolean;
  loading?: boolean;
  onCancel(): void;
  onConfirm(): void;
  open: boolean;
  title: string;
}

export function ConfirmDialog({
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  description,
  destructive = false,
  loading = false,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  const { width } = useWindowDimensions();
  const { tokens } = useTheme();
  const colors = resolveControlColors(tokens).dialog;
  const [mounted, setMounted] = useState(open);
  const progress = useRef(new Animated.Value(0)).current;
  const gate = useRef<ConfirmDialogGateState>(INITIAL_CONFIRM_DIALOG_GATE);
  const callbacks = useRef({ onCancel, onConfirm });
  callbacks.current = { onCancel, onConfirm };

  useEffect(() => {
    gate.current = transitionConfirmDialogGate(gate.current, {
      type: 'sync',
      open,
      loading,
    }).state;
  }, [loading, open]);

  useEffect(() => {
    progress.stopAnimation();
    if (open) {
      setMounted(true);
      progress.setValue(0);
      Animated.timing(progress, {
        duration: DIALOG_DURATION_MS,
        easing: DIALOG_EASING,
        toValue: 1,
        useNativeDriver: true,
      }).start();
      return;
    }
    if (!mounted) return;
    Animated.timing(progress, {
      duration: DIALOG_DURATION_MS,
      easing: DIALOG_EASING,
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [mounted, open, progress]);

  const trigger = (event: Exclude<ConfirmDialogGateEvent, { type: 'sync' }>) => {
    const transition = transitionConfirmDialogGate(gate.current, event);
    gate.current = transition.state;
    if (transition.effect === 'cancel') callbacks.current.onCancel();
    if (transition.effect === 'confirm') callbacks.current.onConfirm();
  };

  const contentWidth = Math.min(
    CONTROL_METRICS.confirmDialog.maxWidth,
    Math.max(
      0,
      width - CONTROL_METRICS.confirmDialog.viewportHorizontalInset * 2,
    ),
  );

  return (
    <Modal
      animationType="none"
      onRequestClose={() => trigger({ type: 'cancel' })}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape-left',
        'landscape-right',
      ]}
      transparent
      visible={mounted}
    >
      <View style={styles.modalRoot}>
        <Animated.View
          pointerEvents="none"
          style={[styles.overlay, { opacity: progress }]}
        >
          <BlurView intensity={16} style={StyleSheet.absoluteFill} tint="dark" />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.overlay },
            ]}
          />
        </Animated.View>

        <Animated.View
          accessibilityRole="alert"
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              opacity: progress,
              transform: [
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.95, 1],
                  }),
                },
              ],
              width: contentWidth,
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            {destructive ? (
              <View accessibilityElementsHidden style={styles.warningIcon}>
                <TriangleAlert
                  color={tokens.colors.destructive}
                  size={CONTROL_METRICS.confirmDialog.warningIconSize}
                  strokeWidth={2}
                />
              </View>
            ) : null}

            <View style={styles.copy}>
              <Text
                accessibilityRole="header"
                style={[
                  styles.title,
                  { color: colors.foregroundBase },
                ]}
              >
                {title.toUpperCase()}
              </Text>
              {description ? (
                <Text style={[styles.description, { color: colors.description }]}>
                  {description}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.footer}>
            <NativeButton
              disabled={loading}
              onPress={() => trigger({ type: 'cancel' })}
              outlined
            >
              {cancelLabel}
            </NativeButton>
            <NativeButton
              destructive={destructive}
              loading={loading}
              onPress={() => trigger({ type: 'confirm' })}
            >
              {loading ? '\u2026' : confirmLabel}
            </NativeButton>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    borderWidth: CONTROL_METRICS.confirmDialog.borderWidth,
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  },
  header: {
    alignItems: 'flex-start',
    borderBottomWidth: CONTROL_METRICS.confirmDialog.borderWidth,
    flexDirection: 'row',
    gap: CONTROL_METRICS.confirmDialog.headerGap,
    padding: CONTROL_METRICS.confirmDialog.headerPadding,
  },
  warningIcon: {
    flexShrink: 0,
    marginTop: 2,
  },
  copy: {
    flex: 1,
    gap: CONTROL_METRICS.confirmDialog.contentGap,
    minWidth: 0,
  },
  title: {
    fontFamily: WEBUI_FONT_FAMILIES.RulesExpandedBold,
    fontSize: CONTROL_METRICS.confirmDialog.titleFontSize,
    letterSpacing:
      CONTROL_METRICS.confirmDialog.titleFontSize
      * CONTROL_METRICS.confirmDialog.titleLetterSpacingEm,
  },
  description: {
    fontFamily: WEBUI_FONT_FAMILIES.MondwestRegular,
    fontSize: CONTROL_METRICS.confirmDialog.descriptionFontSize,
    lineHeight: CONTROL_METRICS.confirmDialog.descriptionLineHeight,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: CONTROL_METRICS.confirmDialog.footerGap,
    justifyContent: 'flex-end',
    padding: CONTROL_METRICS.confirmDialog.footerPadding,
  },
});
