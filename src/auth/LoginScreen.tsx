import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type TextInput as TextInputHandle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  FeComposite,
  FeFlood,
  FeGaussianBlur,
  FeOffset,
  Filter,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { HERMES_ORIGIN } from '../config';
import { WEBUI_FONT_FAMILIES } from '../app/webui-fonts';
import { useAuth } from './AuthProvider';
import { LOGIN_VISUAL_CONTRACT } from './login-visual-contract';

const {
  cardShadow: LOGIN_CARD_SHADOW,
  colors: LOGIN_COLORS,
  dither: LOGIN_DITHER,
  entrance: LOGIN_ENTRANCE,
  glow: LOGIN_GLOW,
  providerButton: PROVIDER_BUTTON,
} = LOGIN_VISUAL_CONTRACT;
const LOGIN_EASE_OUT = Easing.bezier(...LOGIN_ENTRANCE.easing);
const PROVIDER_BUTTON_EASE_OUT = Easing.bezier(
  ...PROVIDER_BUTTON.filterTransition.easing,
);

export function LoginScreen() {
  const { state, provision, unlock, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const apiKeyInput = useRef<TextInputHandle>(null);
  const entranceOpacity = useRef(new Animated.Value(0)).current;
  const entranceOffset = useRef(new Animated.Value(LOGIN_ENTRANCE.translateY)).current;
  const [baseUrl, setBaseUrl] = useState(
    state.status === 'locked' ? state.baseUrl : HERMES_ORIGIN,
  );
  const [apiKey, setApiKey] = useState('');
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
  const [focusedField, setFocusedField] = useState<'baseUrl' | 'apiKey' | null>(null);

  const loading = state.status === 'loading';
  const locked = state.status === 'locked';
  const busy = state.status !== 'loading' && state.status !== 'authenticated' && state.busy;
  const error =
    state.status === 'locked' || state.status === 'provisioning' ? state.error : undefined;
  const canSubmit = baseUrl.trim().length > 0 && apiKey.trim().length > 0 && !busy;
  const verticalPadding = Math.min(96, Math.max(24, height * 0.06));

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(entranceOpacity, {
        duration: LOGIN_ENTRANCE.durationMs,
        easing: LOGIN_EASE_OUT,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(entranceOffset, {
        duration: LOGIN_ENTRANCE.durationMs,
        easing: LOGIN_EASE_OUT,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [entranceOffset, entranceOpacity]);

  const submit = () => {
    if (state.status === 'provisioning' && canSubmit) {
      void provision(baseUrl, apiKey);
    }
  };

  return (
    <View style={styles.root}>
      <LoginBackdrop />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardArea}
      >
        <ScrollView
          bounces={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: Math.max(insets.top, verticalPadding),
              paddingBottom: Math.max(insets.bottom, verticalPadding),
            },
          ]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            style={[
              styles.panel,
              {
                opacity: entranceOpacity,
                transform: [{ translateY: entranceOffset }],
              },
            ]}
          >
            <View accessibilityRole="header" style={styles.brand}>
              <Text style={styles.brandText}>NOUS</Text>
              <View style={styles.brandDot} />
              <Text style={styles.brandText}>RESEARCH</Text>
            </View>

            <View style={styles.cardShell}>
              <CardShadow height={cardSize.height} width={cardSize.width} />
              <View
                onLayout={(event) => updateCardSize(event, setCardSize)}
                style={styles.card}
              >
                <View pointerEvents="none" style={styles.cardHighlight} />
                <Text style={styles.heading}>登录</Text>
                <Text style={styles.subtitle}>
                  {loading
                    ? '正在读取 Hermes 安全连接。'
                    : locked
                      ? state.baseUrl
                      : '登录后继续使用 Hermes Agent 管理面板。'}
                </Text>

                {loading ? (
                  <View accessibilityRole="progressbar" style={styles.loadingRow}>
                    <ActivityIndicator color={LOGIN_COLORS.accent} size="small" />
                    <Text style={styles.loadingText}>正在准备</Text>
                  </View>
                ) : locked ? (
                  <View style={styles.form}>
                    <Text style={styles.formTitle}>使用 FACE ID 登录</Text>
                    {error ? (
                      <Text accessibilityRole="alert" style={styles.errorText}>
                        {error}
                      </Text>
                    ) : null}
                    <ProviderButton
                      busy={busy}
                      disabled={busy}
                      label={busy ? '正在验证' : '使用 FACE ID 登录'}
                      onPress={() => void unlock()}
                    />
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void logout()}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        pressed && !busy && styles.buttonPressed,
                      ]}
                    >
                      <Text style={styles.secondaryButtonText}>更换连接</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.form}>
                    <Text style={styles.formTitle}>使用 API 密钥登录</Text>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>BASE URL</Text>
                      <View style={styles.inputContainer}>
                        <TextInput
                          accessibilityLabel="Base URL"
                          autoCapitalize="none"
                          autoCorrect={false}
                          editable={!busy}
                          keyboardType="url"
                          onBlur={() => setFocusedField(null)}
                          onChangeText={setBaseUrl}
                          onFocus={() => setFocusedField('baseUrl')}
                          onSubmitEditing={() => apiKeyInput.current?.focus()}
                          placeholder="https://8.138.40.16"
                          placeholderTextColor="rgba(255, 255, 255, 0.32)"
                          returnKeyType="next"
                          selectTextOnFocus={false}
                          style={[
                            styles.input,
                            focusedField === 'baseUrl' && styles.inputFocused,
                          ]}
                          textContentType="URL"
                          value={baseUrl}
                        />
                        {focusedField === 'baseUrl' ? (
                          <View pointerEvents="none" style={styles.inputFocusRing} />
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>API 密钥</Text>
                      <View style={styles.inputContainer}>
                        <TextInput
                          ref={apiKeyInput}
                          accessibilityLabel="API 密钥"
                          autoComplete="off"
                          autoCapitalize="none"
                          autoCorrect={false}
                          editable={!busy}
                          onBlur={() => setFocusedField(null)}
                          onChangeText={setApiKey}
                          onFocus={() => setFocusedField('apiKey')}
                          onSubmitEditing={submit}
                          returnKeyType="done"
                          secureTextEntry
                          style={[
                            styles.input,
                            focusedField === 'apiKey' && styles.inputFocused,
                          ]}
                          textContentType="none"
                          value={apiKey}
                        />
                        {focusedField === 'apiKey' ? (
                          <View pointerEvents="none" style={styles.inputFocusRing} />
                        ) : null}
                      </View>
                    </View>
                    {error ? (
                      <Text accessibilityRole="alert" style={styles.errorText}>
                        {error}
                      </Text>
                    ) : null}
                    <ProviderButton
                      busy={busy}
                      disabled={!canSubmit}
                      label={busy ? '正在连接' : '登录'}
                      onPress={submit}
                    />
                  </View>
                )}
              </View>
            </View>

            <View style={styles.footer}>
              <View style={styles.footerLine} />
              <Text style={styles.footerText}>公网访问 · 需要身份验证</Text>
              <View style={styles.footerLine} />
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function ProviderButton({
  busy,
  disabled,
  label,
  onPress,
}: {
  busy: boolean;
  disabled: boolean;
  label: string;
  onPress(): void;
}) {
  const filterProgress = useRef(new Animated.Value(0)).current;
  const [focusVisible, setFocusVisible] = useState(false);
  const animateFilter = useCallback(
    (toValue: 0 | 1) => {
      Animated.timing(filterProgress, {
        duration: PROVIDER_BUTTON.filterTransition.durationMs,
        easing: PROVIDER_BUTTON_EASE_OUT,
        toValue,
        useNativeDriver: false,
      }).start();
    },
    [filterProgress],
  );

  useEffect(() => {
    if (!disabled) return;
    filterProgress.setValue(0);
    setFocusVisible(false);
  }, [disabled, filterProgress]);

  const backgroundColor = filterProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [
      PROVIDER_BUTTON.base.backgroundColor,
      PROVIDER_BUTTON.active.backgroundColor,
    ],
  });
  const textColor = filterProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [PROVIDER_BUTTON.base.textColor, PROVIDER_BUTTON.active.textColor],
  });
  const bevelTopColor = filterProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [PROVIDER_BUTTON.base.bevel.top, PROVIDER_BUTTON.active.bevel.top],
  });
  const bevelRightColor = filterProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [PROVIDER_BUTTON.base.bevel.right, PROVIDER_BUTTON.active.bevel.right],
  });
  const bevelBottomColor = filterProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [
      PROVIDER_BUTTON.base.bevel.bottom,
      PROVIDER_BUTTON.active.bevel.bottom,
    ],
  });
  const bevelLeftColor = filterProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [PROVIDER_BUTTON.base.bevel.left, PROVIDER_BUTTON.active.bevel.left],
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      focusable={!disabled}
      onBlur={() => setFocusVisible(false)}
      onFocus={() => setFocusVisible(true)}
      onPress={onPress}
      onPressIn={() => animateFilter(1)}
      onPressOut={() => animateFilter(0)}
      style={styles.providerButtonFrame}
    >
      <Animated.View style={[styles.primaryButton, { backgroundColor }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.buttonBevel,
            {
              borderTopColor: bevelTopColor,
              borderRightColor: bevelRightColor,
              borderBottomColor: bevelBottomColor,
              borderLeftColor: bevelLeftColor,
            },
          ]}
        />
        {busy ? (
          <ActivityIndicator color={PROVIDER_BUTTON.base.textColor} size="small" />
        ) : null}
        <Animated.Text style={[styles.primaryButtonText, { color: textColor }]}>
          {label}
        </Animated.Text>
      </Animated.View>
      {focusVisible ? (
        <View pointerEvents="none" style={styles.providerButtonFocusRing} />
      ) : null}
    </Pressable>
  );
}

function CardShadow({ height, width }: { height: number; width: number }) {
  const shadowWidth = Math.max(0, width - LOGIN_CARD_SHADOW.spread * 2);
  const shadowHeight = Math.max(0, height - LOGIN_CARD_SHADOW.spread * 2);
  if (!shadowWidth || !shadowHeight) return null;

  return (
    <Svg
      height={height}
      pointerEvents="none"
      style={styles.cardShadow}
      width={width}
    >
      <Defs>
        <Filter height="400%" id="login-card-shadow" width="300%" x="-100%" y="-100%">
          <FeGaussianBlur
            in="SourceAlpha"
            result="blurred-shadow"
            stdDeviation={LOGIN_CARD_SHADOW.blurSigma}
          />
          <FeOffset
            dy={LOGIN_CARD_SHADOW.offsetY}
            in="blurred-shadow"
            result="offset-shadow"
          />
          <FeFlood
            floodColor="#000000"
            floodOpacity={LOGIN_CARD_SHADOW.opacity}
            result="shadow-color"
          />
          <FeComposite
            in="shadow-color"
            in2="offset-shadow"
            operator="in"
            result="card-shadow"
          />
        </Filter>
      </Defs>
      <Rect
        fill="#000000"
        filter="url(#login-card-shadow)"
        height={shadowHeight}
        width={shadowWidth}
        x={LOGIN_CARD_SHADOW.spread}
        y={LOGIN_CARD_SHADOW.spread}
      />
    </Svg>
  );
}

function updateCardSize(
  event: LayoutChangeEvent,
  setCardSize: (size: { width: number; height: number }) => void,
) {
  const { height, width } = event.nativeEvent.layout;
  setCardSize({ height, width });
}

function LoginBackdrop() {
  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <Svg height="100%" width="100%">
        <Defs>
          <Pattern
            height={LOGIN_DITHER.size}
            id="login-dither"
            patternUnits="userSpaceOnUse"
            width={LOGIN_DITHER.size}
          >
            {LOGIN_DITHER.cells.map((cell, index) => (
              <Rect
                fill={LOGIN_COLORS.accent}
                fillOpacity={LOGIN_DITHER.opacity}
                key={`login-dither-${index}`}
                {...cell}
              />
            ))}
          </Pattern>
          <RadialGradient
            cx="50%"
            cy="0%"
            id="login-top-glow"
            rx={LOGIN_GLOW.radiusX}
            ry={LOGIN_GLOW.radiusY}
          >
            <Stop
              offset="0%"
              stopColor={LOGIN_COLORS.accent}
              stopOpacity={LOGIN_GLOW.opacity}
            />
            <Stop
              offset={LOGIN_GLOW.stop}
              stopColor={LOGIN_COLORS.accent}
              stopOpacity={0}
            />
          </RadialGradient>
        </Defs>
        <Rect fill="url(#login-dither)" height="100%" width="100%" />
        <Rect fill="url(#login-top-glow)" height="100%" width="100%" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: LOGIN_COLORS.background,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  keyboardArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  panel: {
    width: '100%',
    maxWidth: 416,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  brandText: {
    color: LOGIN_COLORS.accent,
    fontFamily: WEBUI_FONT_FAMILIES.RulesCompressedMedium,
    fontSize: 16.8,
    letterSpacing: 5.376,
    lineHeight: 25.2,
  },
  brandDot: {
    width: 6,
    height: 6,
    marginHorizontal: 9.24,
    marginBottom: 3.024,
    borderRadius: 1,
    backgroundColor: LOGIN_COLORS.accent,
  },
  cardShell: {
    position: 'relative',
  },
  cardShadow: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'visible',
  },
  card: {
    position: 'relative',
    paddingTop: 36,
    paddingHorizontal: 32,
    paddingBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(255, 172, 2, 0.18)',
    borderRadius: 0,
    backgroundColor: '#1c1207',
  },
  cardHighlight: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    borderLeftColor: 'rgba(255, 255, 255, 0.05)',
    borderRightColor: 'rgba(0, 0, 0, 0.4)',
    borderBottomColor: 'rgba(0, 0, 0, 0.4)',
  },
  heading: {
    marginBottom: 6.4,
    color: LOGIN_COLORS.foreground,
    fontFamily: WEBUI_FONT_FAMILIES.RulesCompressedMedium,
    fontSize: 29.6,
    letterSpacing: 1.48,
    lineHeight: 44.4,
  },
  subtitle: {
    marginBottom: 28,
    color: 'rgba(255, 255, 255, 0.65)',
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 15.2,
    lineHeight: 22.8,
  },
  loadingRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 14,
    lineHeight: 21,
  },
  form: {
    gap: 12,
  },
  formTitle: {
    color: 'rgba(255, 255, 255, 0.70)',
    fontFamily: WEBUI_FONT_FAMILIES.RulesCompressedMedium,
    fontSize: 11.52,
    letterSpacing: 2.0736,
    lineHeight: 17.28,
  },
  field: {
    gap: 4.8,
  },
  fieldLabel: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 11.52,
    letterSpacing: 1.3824,
    lineHeight: 17.28,
  },
  input: {
    paddingHorizontal: 12.8,
    paddingVertical: 11.2,
    borderWidth: 1,
    borderColor: 'rgba(255, 172, 2, 0.35)',
    borderRadius: 0,
    backgroundColor: '#110a02',
    color: LOGIN_COLORS.foreground,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 15.2,
    lineHeight: 22.8,
  },
  inputFocused: {
    borderColor: LOGIN_COLORS.accent,
  },
  inputContainer: {
    position: 'relative',
  },
  inputFocusRing: {
    position: 'absolute',
    top: -1,
    right: -1,
    bottom: -1,
    left: -1,
    borderWidth: 1,
    borderColor: LOGIN_COLORS.accent,
  },
  errorText: {
    color: LOGIN_COLORS.error,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 13.12,
    letterSpacing: 0.2624,
    lineHeight: 19.68,
  },
  providerButtonFrame: {
    position: 'relative',
    marginTop: 4,
  },
  primaryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 16,
    paddingVertical: 15.2,
    borderRadius: 0,
  },
  primaryButtonText: {
    flexShrink: 1,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 12.48,
    letterSpacing: 2.496,
    lineHeight: 18.72,
    textAlign: 'center',
  },
  buttonBevel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
  },
  providerButtonFocusRing: {
    position: 'absolute',
    top: -(PROVIDER_BUTTON.focusVisible.offset + PROVIDER_BUTTON.focusVisible.width),
    right: -(PROVIDER_BUTTON.focusVisible.offset + PROVIDER_BUTTON.focusVisible.width),
    bottom: -(PROVIDER_BUTTON.focusVisible.offset + PROVIDER_BUTTON.focusVisible.width),
    left: -(PROVIDER_BUTTON.focusVisible.offset + PROVIDER_BUTTON.focusVisible.width),
    borderWidth: PROVIDER_BUTTON.focusVisible.width,
    borderColor: PROVIDER_BUTTON.focusVisible.color,
    borderRadius: 0,
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 172, 2, 0.35)',
    borderRadius: 0,
  },
  secondaryButtonText: {
    color: LOGIN_COLORS.accent,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 12.48,
    letterSpacing: 2.496,
    lineHeight: 18.72,
  },
  buttonPressed: {
    opacity: 0.78,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  footerLine: {
    width: 24,
    height: 1,
    marginHorizontal: 7.2,
    marginBottom: 2.4,
    backgroundColor: 'rgba(255, 172, 2, 0.35)',
  },
  footerText: {
    flexShrink: 1,
    color: 'rgba(255, 255, 255, 0.45)',
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 12,
    letterSpacing: 1.2,
    lineHeight: 20.4,
    textAlign: 'center',
  },
});
