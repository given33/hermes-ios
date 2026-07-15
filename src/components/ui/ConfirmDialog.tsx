import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { TriangleAlert } from 'lucide-react-native';

import { WEBUI_FONT_FAMILIES } from '../../app/webui-fonts';
import { HermesLiveBlurView } from '../../../modules/hermes-live-blur';
import {
  hasNativeAlertPresenter,
  HermesAlertPresenterView,
} from '../../../modules/hermes-ios-controls';
import {
  CONTROL_METRICS,
  INITIAL_CONFIRM_DIALOG_GATE,
  resolveConfirmDialogMetrics,
  resolveControlColors,
  transitionConfirmDialogGate,
  type ConfirmDialogGateEvent,
  type ConfirmDialogGateState,
} from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { IOS_MOTION } from '../../design/ios-motion';
import { useNativeLocalization } from '../../i18n/NativeLocalization';
import { NativeButton } from './NativeButton';

const DIALOG_DURATION_MS = IOS_MOTION.duration.modal;
const DIALOG_EASING = Easing.bezier(...IOS_MOTION.curve.standard);

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
  const { t } = useNativeLocalization();
  const colors = resolveControlColors(tokens).dialog;
  const metrics = resolveConfirmDialogMetrics(tokens);
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
    metrics.maxWidth,
    Math.max(
      0,
      width - metrics.viewportHorizontalInset * 2,
    ),
  );
  const dialogContents = (
    <>
      <View
        style={[
          styles.header,
          {
            borderBottomColor: colors.border,
            gap: metrics.headerGap,
            padding: metrics.headerPadding,
          },
        ]}
      >
        {destructive ? (
          <View
            accessibilityElementsHidden
            style={{
              flexShrink: 0,
              marginTop: metrics.warningIconMarginTop,
            }}
          >
            <TriangleAlert
              color={tokens.colors.destructive}
              size={metrics.warningIconSize}
              strokeWidth={2}
            />
          </View>
        ) : null}

        <View style={[styles.copy, { gap: metrics.contentGap }]}>
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              {
                color: colors.foregroundBase,
                fontSize: metrics.titleFontSize,
                letterSpacing: metrics.titleLetterSpacing,
                lineHeight: metrics.titleLineHeight,
              },
            ]}
          >
            {t(title).toUpperCase()}
          </Text>
          {description ? (
            <Text
              style={[
                styles.description,
                {
                  color: colors.description,
                  fontSize: metrics.descriptionFontSize,
                  lineHeight: metrics.descriptionLineHeight,
                },
              ]}
            >
              {t(description)}
            </Text>
          ) : null}
        </View>
      </View>

      <View
        style={[
          styles.footer,
          { gap: metrics.footerGap, padding: metrics.footerPadding },
        ]}
      >
        <NativeButton
          disabled={loading}
          onPress={() => trigger({ type: 'cancel' })}
          outlined
        >
          {t(cancelLabel)}
        </NativeButton>
        <NativeButton
          destructive={destructive}
          loading={loading}
          onPress={() => trigger({ type: 'confirm' })}
        >
          {loading ? '\u2026' : t(confirmLabel)}
        </NativeButton>
      </View>
    </>
  );

  if (Platform.OS === 'ios' && hasNativeAlertPresenter) {
    return (
      <HermesAlertPresenterView
        open={open}
        overlayColor={colors.overlay}
        style={styles.swiftUIHost}
      >
        <View
          accessibilityRole="alert"
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              width: contentWidth,
            },
          ]}
        >
          {dialogContents}
        </View>
      </HermesAlertPresenterView>
    );
  }

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
          <HermesLiveBlurView
            blurRadius={CONTROL_METRICS.confirmDialog.backdropBlurRadius}
            style={StyleSheet.absoluteFill}
          />
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
          {dialogContents}
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
  swiftUIHost: {
    height: 1,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 1,
  },
  dialog: {
    borderWidth: CONTROL_METRICS.confirmDialog.borderWidth,
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  },
  header: {
    alignItems: 'flex-start',
    borderBottomWidth: CONTROL_METRICS.confirmDialog.borderWidth,
    flexDirection: 'row',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: WEBUI_FONT_FAMILIES.RulesExpandedBold,
  },
  description: {
    fontFamily: WEBUI_FONT_FAMILIES.MondwestRegular,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
