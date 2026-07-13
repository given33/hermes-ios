import { useEffect, useRef, useState } from 'react';
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

const LOGIN_BACKGROUND = '#170d02';
const LOGIN_ACCENT = '#ffac02';
const LOGIN_FOREGROUND = '#ffffff';
const LOGIN_ERROR = '#ff6b6b';
const LOGIN_DITHER_SIZE = 3;
const LOGIN_DITHER_OPACITY = 0.04;
const LOGIN_GLOW_OPACITY = 0.06;
const LOGIN_GLOW_STOP = '55%';
const LOGIN_GLOW_RADIUS_X = '70.710678%';
const LOGIN_GLOW_RADIUS_Y = '141.421356%';
const LOGIN_EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
const CARD_SHADOW_SPREAD = 20;
const CARD_SHADOW_BLUR_SIGMA = 30;
const CARD_SHADOW_OFFSET_Y = 24;
const CARD_SHADOW_OPACITY = 0.6;

export function LoginScreen() {
  const { state, provision, unlock, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const apiKeyInput = useRef<TextInputHandle>(null);
  const entranceOpacity = useRef(new Animated.Value(0)).current;
  const entranceOffset = useRef(new Animated.Value(6)).current;
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
        duration: 600,
        easing: LOGIN_EASE_OUT,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(entranceOffset, {
        duration: 600,
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
                    <ActivityIndicator color={LOGIN_ACCENT} size="small" />
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
                    <PrimaryButton
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
                    <PrimaryButton
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

function PrimaryButton({
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.primaryButtonPressed,
      ]}
    >
      {({ pressed }) => (
        <>
          <View pointerEvents="none" style={styles.buttonBevel} />
          {busy ? (
            <ActivityIndicator
              color={pressed ? '#e8f2fd' : LOGIN_BACKGROUND}
              size="small"
            />
          ) : null}
          <Text
            style={[
              styles.primaryButtonText,
              pressed && !disabled && styles.primaryButtonTextPressed,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function CardShadow({ height, width }: { height: number; width: number }) {
  const shadowWidth = Math.max(0, width - CARD_SHADOW_SPREAD * 2);
  const shadowHeight = Math.max(0, height - CARD_SHADOW_SPREAD * 2);
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
            stdDeviation={CARD_SHADOW_BLUR_SIGMA}
          />
          <FeOffset
            dy={CARD_SHADOW_OFFSET_Y}
            in="blurred-shadow"
            result="offset-shadow"
          />
          <FeFlood
            floodColor="#000000"
            floodOpacity={CARD_SHADOW_OPACITY}
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
        x={CARD_SHADOW_SPREAD}
        y={CARD_SHADOW_SPREAD}
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
            height={LOGIN_DITHER_SIZE}
            id="login-dither"
            patternUnits="userSpaceOnUse"
            width={LOGIN_DITHER_SIZE}
          >
            <Rect
              fill={LOGIN_ACCENT}
              fillOpacity={LOGIN_DITHER_OPACITY}
              height={LOGIN_DITHER_SIZE / 2}
              width={LOGIN_DITHER_SIZE / 2}
            />
            <Rect
              fill={LOGIN_ACCENT}
              fillOpacity={LOGIN_DITHER_OPACITY}
              height={LOGIN_DITHER_SIZE / 2}
              width={LOGIN_DITHER_SIZE / 2}
              x={LOGIN_DITHER_SIZE / 2}
              y={LOGIN_DITHER_SIZE / 2}
            />
          </Pattern>
          <RadialGradient
            cx="50%"
            cy="0%"
            id="login-top-glow"
            rx={LOGIN_GLOW_RADIUS_X}
            ry={LOGIN_GLOW_RADIUS_Y}
          >
            <Stop
              offset="0%"
              stopColor={LOGIN_ACCENT}
              stopOpacity={LOGIN_GLOW_OPACITY}
            />
            <Stop offset={LOGIN_GLOW_STOP} stopColor={LOGIN_ACCENT} stopOpacity={0} />
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
    backgroundColor: LOGIN_BACKGROUND,
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
    color: LOGIN_ACCENT,
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
    backgroundColor: LOGIN_ACCENT,
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
    color: LOGIN_FOREGROUND,
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
    color: LOGIN_FOREGROUND,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 15.2,
    lineHeight: 22.8,
  },
  inputFocused: {
    borderColor: LOGIN_ACCENT,
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
    borderColor: LOGIN_ACCENT,
  },
  errorText: {
    color: LOGIN_ERROR,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 13.12,
    letterSpacing: 0.2624,
    lineHeight: 19.68,
  },
  primaryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 15.2,
    borderRadius: 0,
    backgroundColor: LOGIN_ACCENT,
  },
  primaryButtonText: {
    flexShrink: 1,
    color: LOGIN_BACKGROUND,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 12.48,
    letterSpacing: 2.496,
    lineHeight: 18.72,
    textAlign: 'center',
  },
  primaryButtonPressed: {
    backgroundColor: '#0053fd',
  },
  primaryButtonTextPressed: {
    color: '#e8f2fd',
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
    borderTopColor: 'rgba(255, 255, 255, 0.5)',
    borderLeftColor: 'rgba(255, 255, 255, 0.5)',
    borderRightColor: 'rgba(0, 0, 0, 0.5)',
    borderBottomColor: 'rgba(0, 0, 0, 0.5)',
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
    color: LOGIN_ACCENT,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 12.48,
    letterSpacing: 2.496,
    lineHeight: 18.72,
  },
  buttonDisabled: {
    opacity: 0.45,
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
