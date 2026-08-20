import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInput as TextInputHandle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { IOSPressable } from '../components/ios/IOSPressable';
import { WEBUI_FONT_FAMILIES } from '../app/webui-fonts';
import { IOS_MOTION } from '../design/ios-motion';
import { useAuth } from './AuthProvider';
import { MAX_FACE_ID_ATTEMPTS } from './auth-state';
import {
  INITIAL_PROVIDER_BUTTON_INTERACTION,
  LOGIN_VISUAL_CONTRACT,
  isLoginColorScheme,
  loginPalette,
  providerButtonLayerTargets,
  reduceProviderButtonInteraction,
  type LoginColorScheme,
  type LoginPalette,
} from './login-visual-contract';

const {
  appearanceStorageKey,
  button: LOGIN_BUTTON,
  card: LOGIN_CARD,
  entrance: LOGIN_ENTRANCE,
  input: LOGIN_INPUT,
  monogram: LOGIN_MONOGRAM,
  providerButton: PROVIDER_BUTTON,
  segmented: LOGIN_SEGMENTED,
  toggle: LOGIN_TOGGLE,
} = LOGIN_VISUAL_CONTRACT;
const LOGIN_EASE_OUT = Easing.bezier(...IOS_MOTION.curve.decelerate);
const PROVIDER_BUTTON_EASE_OUT = Easing.bezier(
  ...IOS_MOTION.curve.standard,
);

type LoginFieldKey = 'email' | 'verificationCode' | 'username' | 'password';

export function LoginScreen() {
  const {
    state,
    rememberedLogin,
    registrationOpen,
    authenticate,
    unlock,
    register,
    requestRegistrationCode,
    revealRememberedPassword,
    logout,
  } = useAuth();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const usernameInput = useRef<TextInputHandle>(null);
  const passwordInput = useRef<TextInputHandle>(null);
  const emailInput = useRef<TextInputHandle>(null);
  const verificationCodeInput = useRef<TextInputHandle>(null);
  const entranceOpacity = useRef(new Animated.Value(0)).current;
  const entranceOffset = useRef(new Animated.Value(LOGIN_ENTRANCE.translateY)).current;
  const [scheme, setScheme] = useState<LoginColorScheme>(LOGIN_VISUAL_CONTRACT.defaultScheme);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [codeMessage, setCodeMessage] = useState('');
  const [focusedField, setFocusedField] = useState<LoginFieldKey | null>(null);

  const palette = loginPalette(scheme);
  const loading = state.status === 'loading';
  const locked = state.status === 'locked';
  const busy = state.status !== 'loading' && state.status !== 'authenticated' && state.busy;
  const error = state.status === 'provisioning' ? state.error : undefined;
  const lockError = state.status === 'locked' ? state.error : undefined;
  const lockAttempts = state.status === 'locked' ? state.failedAttempts : 0;
  const canSubmit =
    username.trim().length > 0
    && password.length > 0
    && (
      mode === 'login'
      || (
        registrationOpen
        && email.trim().length > 0
        && /^\d{6}$/.test(verificationCode.trim())
      )
    )
    && !busy;
  const verticalPadding = Math.min(96, Math.max(24, height * 0.06));
  const rememberedLoginApplied = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(appearanceStorageKey)
      .then((stored) => {
        if (!cancelled && stored && isLoginColorScheme(stored)) setScheme(stored);
      })
      .catch(() => {
        // A missing or failing store simply keeps the light default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleScheme = () => {
    const next: LoginColorScheme = scheme === 'light' ? 'dark' : 'light';
    setScheme(next);
    void AsyncStorage.setItem(appearanceStorageKey, next).catch(() => {
      // Preference persistence is best-effort; the in-memory scheme stays.
    });
  };

  useEffect(() => {
    if (rememberedLoginApplied.current || state.status !== 'provisioning') return;
    rememberedLoginApplied.current = true;
    setUsername(rememberedLogin.username);
    setPassword(rememberedLogin.password);
    setRememberLogin(rememberedLogin.enabled);
  }, [rememberedLogin, state.status]);

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

  useEffect(() => {
    if (codeCooldown <= 0) return undefined;
    const timer = setTimeout(() => setCodeCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [codeCooldown]);

  // The segmented register tab only exists while registration is open; if the
  // status flips closed while the user is on it, fall back to the login form.
  useEffect(() => {
    if (mode === 'register' && !registrationOpen) setMode('login');
  }, [mode, registrationOpen]);

  const submit = () => {
    if (state.status === 'provisioning' && canSubmit) {
      if (mode === 'register') {
        void register(email, verificationCode, username, password);
      } else {
        void authenticate(username, password, rememberLogin);
      }
    }
  };

  const fillRememberedPassword = async () => {
    // The biometric prompt runs inside the provider; a null result means the
    // user cancelled or the item is gone, and manual entry continues.
    const savedPassword = await revealRememberedPassword();
    if (savedPassword) setPassword(savedPassword);
  };

  const sendRegistrationCode = async () => {
    if (!registrationOpen || sendingCode || codeCooldown > 0 || !email.trim()) return;
    setSendingCode(true);
    setCodeMessage('');
    try {
      const resendAfter = await requestRegistrationCode(email);
      setCodeCooldown(Math.max(1, Math.ceil(resendAfter)));
      setCodeMessage('验证码已发送，请查看 QQ 邮箱。');
      verificationCodeInput.current?.focus();
    } catch (sendError) {
      if (sendError instanceof Error && /closed/i.test(sendError.message)) {
        setCodeMessage('注册暂未开放。');
      } else {
        setCodeMessage('验证码发送失败，请稍后重试。');
      }
    } finally {
      setSendingCode(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.backgroundBottom }]}>
      <LoginBackdrop palette={palette} />
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
      <AppearanceToggle
        icon={scheme === 'light' ? 'moon' : 'sun'}
        palette={palette}
        style={{ top: Math.max(insets.top, 16) + 2 }}
        onPress={toggleScheme}
      />
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
          decelerationRate="normal"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={8}
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
            <BrandMark palette={palette} />

            <View
              style={[
                styles.card,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.cardBorder,
                  shadowColor: palette.shadow,
                },
              ]}
            >
              <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
                {locked ? '解锁' : mode === 'register' ? '创建账号' : '欢迎回来'}
              </Text>
              <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
                {loading
                  ? '正在读取 Hermes 安全连接。'
                  : locked
                    ? '使用 Face ID 解锁受保护的 Hermes 连接。'
                    : mode === 'register'
                      ? '使用 QQ 邮箱验证码创建 Hermes 账号。'
                      : '登录后继续使用 Hermes Agent 管理面板。'}
              </Text>

              {loading ? (
                <View accessibilityRole="progressbar" style={styles.loadingRow}>
                  <ActivityIndicator color={palette.accent} size="small" />
                  <Text style={[styles.loadingText, { color: palette.textSecondary }]}>
                    正在准备
                  </Text>
                </View>
              ) : locked ? (
                <View style={styles.form}>
                  <View style={[styles.lockGlyph, { backgroundColor: palette.accentSoft }]}>
                    <LockGlyph color={palette.accent} />
                  </View>
                  <Text style={[styles.formTitle, { color: palette.text }]}>
                    已保存的 Hermes 连接
                  </Text>
                  {lockError ? (
                    <View style={[styles.errorChip, { backgroundColor: palette.errorSoft }]}>
                      <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.error }]}>
                        {lockError}
                      </Text>
                    </View>
                  ) : null}
                  {lockAttempts > 0 ? (
                    <Text style={[styles.attemptText, { color: palette.textTertiary }]}>
                      {`解锁失败 ${lockAttempts}/${MAX_FACE_ID_ATTEMPTS} 次`}
                    </Text>
                  ) : null}
                  <ProviderButton
                    accent={palette.accent}
                    accentActive={palette.accentActive}
                    accentHover={palette.accentHover}
                    accentText={palette.accentText}
                    busy={busy}
                    disabled={busy}
                    label={busy ? '正在解锁' : '使用 Face ID 解锁'}
                    onPress={() => void unlock()}
                  />
                  <IOSPressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void logout()}
                    pressedStyle={styles.buttonPressed}
                    style={[
                      styles.secondaryButton,
                      { borderColor: palette.separator },
                    ]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: palette.textSecondary }]}>
                      使用密码登录
                    </Text>
                  </IOSPressable>
                </View>
              ) : (
                <View style={styles.form}>
                  {registrationOpen ? (
                    <SegmentedControl
                      palette={palette}
                      value={mode}
                      onChange={(next) => {
                        setMode(next);
                        setCodeMessage('');
                        setFocusedField(null);
                      }}
                    />
                  ) : null}
                  {mode === 'register' ? (
                    <>
                      <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>
                          QQ 邮箱
                        </Text>
                        <View style={styles.inputContainer}>
                          <TextInput
                            ref={emailInput}
                            accessibilityLabel="QQ 邮箱"
                            autoComplete="email"
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!busy && registrationOpen}
                            keyboardType="email-address"
                            onBlur={() => setFocusedField(null)}
                            onChangeText={setEmail}
                            onFocus={() => setFocusedField('email')}
                            onSubmitEditing={() => verificationCodeInput.current?.focus()}
                            placeholder="QQ 邮箱"
                            placeholderTextColor={palette.inputPlaceholder}
                            returnKeyType="next"
                            style={[
                              styles.input,
                              { backgroundColor: palette.inputFill, color: palette.text },
                              focusedField === 'email' && {
                                borderColor: palette.accent,
                              },
                            ]}
                            textContentType="emailAddress"
                            value={email}
                          />
                          {focusedField === 'email' ? (
                            <View
                              pointerEvents="none"
                              style={[
                                styles.inputFocusRing,
                                { borderColor: palette.accent },
                              ]}
                            />
                          ) : null}
                        </View>
                      </View>
                      <View style={styles.field}>
                        <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>
                          邮箱验证码
                        </Text>
                        <View style={styles.verificationRow}>
                          <View style={[styles.inputContainer, styles.verificationInput]}>
                            <TextInput
                              ref={verificationCodeInput}
                              accessibilityLabel="邮箱验证码"
                              autoComplete="one-time-code"
                              editable={!busy && registrationOpen}
                              keyboardType="number-pad"
                              maxLength={6}
                              onBlur={() => setFocusedField(null)}
                              onChangeText={(value) => setVerificationCode(value.replace(/\D/g, ''))}
                              onFocus={() => setFocusedField('verificationCode')}
                              onSubmitEditing={() => usernameInput.current?.focus()}
                              placeholder="6 位数字"
                              placeholderTextColor={palette.inputPlaceholder}
                              returnKeyType="next"
                              style={[
                                styles.input,
                                { backgroundColor: palette.inputFill },
                                focusedField === 'verificationCode' && {
                                  borderColor: palette.accent,
                                },
                              ]}
                              textContentType="oneTimeCode"
                              value={verificationCode}
                            />
                            {focusedField === 'verificationCode' ? (
                              <View
                                pointerEvents="none"
                                style={[
                                  styles.inputFocusRing,
                                  { borderColor: palette.accent },
                                ]}
                              />
                            ) : null}
                          </View>
                          <IOSPressable
                            accessibilityRole="button"
                            disabled={
                              !registrationOpen
                              || sendingCode
                              || codeCooldown > 0
                              || !email.trim()
                            }
                            onPress={() => void sendRegistrationCode()}
                            pressedStyle={styles.buttonPressed}
                            style={[
                              styles.codeButton,
                              { backgroundColor: palette.accentSoft },
                              (
                                !registrationOpen
                                || sendingCode
                                || codeCooldown > 0
                                || !email.trim()
                              ) && styles.codeButtonDisabled,
                            ]}
                          >
                            <Text style={[styles.codeButtonText, { color: palette.accentLabel }]}>
                              {sendingCode
                                ? '发送中'
                                : codeCooldown > 0 ? `${codeCooldown}秒` : '发送验证码'}
                            </Text>
                          </IOSPressable>
                        </View>
                        {codeMessage ? (
                          <Text style={[styles.codeMessage, { color: palette.textTertiary }]}>
                            {codeMessage}
                          </Text>
                        ) : null}
                      </View>
                    </>
                  ) : null}
                  <View style={styles.field}>
                    <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>
                      账号
                    </Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        ref={usernameInput}
                        accessibilityLabel="账号"
                        autoComplete="username"
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!busy && (mode === 'login' || registrationOpen)}
                        onBlur={() => setFocusedField(null)}
                        onChangeText={setUsername}
                        onFocus={() => setFocusedField('username')}
                        onSubmitEditing={() => passwordInput.current?.focus()}
                        placeholder="账号"
                        placeholderTextColor={palette.inputPlaceholder}
                        returnKeyType="next"
                        style={[
                          styles.input,
                          { backgroundColor: palette.inputFill, color: palette.text },
                          focusedField === 'username' && {
                            borderColor: palette.accent,
                          },
                        ]}
                        textContentType="username"
                        value={username}
                      />
                      {focusedField === 'username' ? (
                        <View
                          pointerEvents="none"
                          style={[
                            styles.inputFocusRing,
                            { borderColor: palette.accent },
                          ]}
                        />
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.field}>
                    <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>
                      密码
                    </Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        ref={passwordInput}
                        accessibilityLabel="密码"
                        autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!busy && (mode === 'login' || registrationOpen)}
                        onBlur={() => setFocusedField(null)}
                        onChangeText={setPassword}
                        onFocus={() => setFocusedField('password')}
                        onSubmitEditing={submit}
                        placeholder="密码"
                        placeholderTextColor={palette.inputPlaceholder}
                        returnKeyType="done"
                        secureTextEntry={!passwordVisible}
                        style={[
                          styles.input,
                          styles.inputWithAccessory,
                          { backgroundColor: palette.inputFill },
                          focusedField === 'password' && {
                            borderColor: palette.accent,
                          },
                        ]}
                        textContentType={mode === 'register' ? 'newPassword' : 'password'}
                        value={password}
                      />
                      {focusedField === 'password' ? (
                        <View
                          pointerEvents="none"
                          style={[
                            styles.inputFocusRing,
                            styles.inputAccessoryRing,
                            { borderColor: palette.accent },
                          ]}
                        />
                      ) : null}
                      <IOSPressable
                        accessibilityLabel={passwordVisible ? '隐藏密码' : '显示密码'}
                        accessibilityRole="button"
                        disabled={busy}
                        haptic="selection"
                        onPress={() => setPasswordVisible((current) => !current)}
                        style={styles.passwordToggle}
                      >
                        <EyeGlyph color={palette.textTertiary} visible={passwordVisible} />
                      </IOSPressable>
                    </View>
                  </View>
                  {mode === 'login' ? (
                    <IOSPressable
                      accessibilityLabel="记住账号和密码"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: rememberLogin }}
                      disabled={busy}
                      onPress={() => setRememberLogin((current) => !current)}
                      opacityTo={0.72}
                      style={styles.rememberRow}
                    >
                      <View
                        style={[
                          styles.rememberCheckbox,
                          { borderColor: rememberLogin ? palette.accent : palette.separator },
                          rememberLogin && { backgroundColor: palette.accent },
                        ]}
                      >
                        {rememberLogin ? (
                          <CheckmarkGlyph color={palette.accentText} />
                        ) : null}
                      </View>
                      <Text style={[styles.rememberText, { color: palette.textSecondary }]}>
                        记住账号和密码
                      </Text>
                    </IOSPressable>
                  ) : null}
                  {mode === 'login' && rememberedLogin.enabled && !password ? (
                    <IOSPressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void fillRememberedPassword()}
                      pressedStyle={styles.buttonPressed}
                      style={[
                        styles.softAction,
                        { backgroundColor: palette.accentSoft },
                      ]}
                    >
                      <Text style={[styles.softActionText, { color: palette.accentLabel }]}>
                        使用 Face ID 填充已保存的密码
                      </Text>
                    </IOSPressable>
                  ) : null}
                  {error ? (
                    <View style={[styles.errorChip, { backgroundColor: palette.errorSoft }]}>
                      <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.error }]}>
                        {error}
                      </Text>
                    </View>
                  ) : null}
                  <ProviderButton
                    accent={palette.accent}
                    accentActive={palette.accentActive}
                    accentHover={palette.accentHover}
                    accentText={palette.accentText}
                    busy={busy}
                    disabled={!canSubmit}
                    label={busy
                      ? mode === 'register' ? '正在注册' : '正在登录'
                      : mode === 'register' ? '注册并登录' : '登录'}
                    onPress={submit}
                  />
                </View>
              )}
            </View>

            <View style={styles.footer}>
              <View style={[styles.footerLine, { backgroundColor: palette.separator }]} />
              <Text style={[styles.footerText, { color: palette.textTertiary }]}>
                公网访问 · 需要身份验证
              </Text>
              <View style={[styles.footerLine, { backgroundColor: palette.separator }]} />
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function BrandMark({ palette }: { palette: LoginPalette }) {
  return (
    <View style={styles.brandColumn}>
      <View
        style={[
          styles.monogram,
          {
            borderRadius: LOGIN_MONOGRAM.radius,
            overflow: 'hidden' as const,
          },
        ]}
      >
          <Svg
            height={LOGIN_MONOGRAM.size}
            pointerEvents="none"
            style={styles.monogramGradient}
            width={LOGIN_MONOGRAM.size}
          >
            <Defs>
              <LinearGradient id="login-monogram-gradient" x1="0" x2="0" y1="0" y2="1">
                <Stop offset="0%" stopColor={palette.accent} />
                <Stop offset="100%" stopColor={palette.accentDeep} />
              </LinearGradient>
            </Defs>
            <Rect
              fill="url(#login-monogram-gradient)"
              height={LOGIN_MONOGRAM.size}
              width={LOGIN_MONOGRAM.size}
              x={0}
              y={0}
            />
          </Svg>
          <Text style={[styles.monogramLetter, { color: palette.accentText }]}>
            {LOGIN_MONOGRAM.letter}
          </Text>
      </View>
      <Text accessibilityRole="header" style={[styles.brandText, { color: palette.text }]}>
        HERMES AGENT
      </Text>
      <Text style={[styles.brandTagline, { color: palette.textTertiary }]}>
        智能体工作台
      </Text>
    </View>
  );
}

function AppearanceToggle({
  icon,
  palette,
  onPress,
  style,
}: {
  icon: 'sun' | 'moon';
  palette: LoginPalette;
  onPress(): void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.toggleSlot, style]}>
      <IOSPressable
        accessibilityLabel={icon === 'sun' ? '切换到亮色外观' : '切换到深色外观'}
        accessibilityRole="button"
        haptic="selection"
        onPress={onPress}
        style={[
          styles.toggle,
          {
            backgroundColor: palette.toggleFill,
            borderColor: palette.toggleBorder,
          },
        ]}
      >
        {icon === 'sun' ? (
          <SunGlyph color={palette.toggleIcon} />
        ) : (
          <MoonGlyph color={palette.toggleIcon} />
        )}
      </IOSPressable>
    </View>
  );
}

function SegmentedControl({
  palette,
  value,
  onChange,
}: {
  palette: LoginPalette;
  value: 'login' | 'register';
  onChange(next: 'login' | 'register'): void;
}) {
  const indicatorProgress = useRef(new Animated.Value(value === 'register' ? 1 : 0)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const animation = Animated.timing(indicatorProgress, {
      duration: IOS_MOTION.duration.control,
      easing: PROVIDER_BUTTON_EASE_OUT,
      toValue: value === 'register' ? 1 : 0,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [indicatorProgress, value]);

  // The pill slides one half-track; the inset (3) matches the indicator's
  // top/bottom/left/right inset in styles.
  const halfSlide = Math.max(0, (trackWidth - 6) / 2);

  return (
    <View
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[
        styles.segmentedTrack,
        { backgroundColor: palette.inputFill },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.segmentedIndicator,
          {
            backgroundColor: palette.card,
            width: Math.max(0, trackWidth / 2 - 3),
            transform: [{
              translateX: Animated.multiply(indicatorProgress, halfSlide),
            }],
          },
        ]}
      />
      {(['login', 'register'] as const).map((segment) => (
        <IOSPressable
          accessibilityRole="tab"
          accessibilityState={{ selected: value === segment }}
          key={segment}
          onPress={() => onChange(segment)}
          style={styles.segmentedOption}
        >
          <Text
            style={[
              styles.segmentedLabel,
              { color: value === segment ? palette.text : palette.textTertiary },
            ]}
          >
            {segment === 'login' ? '登录' : '注册'}
          </Text>
        </IOSPressable>
      ))}
    </View>
  );
}

function ProviderButton({
  accent,
  accentActive,
  accentHover,
  accentText,
  busy,
  disabled,
  label,
  onPress,
}: {
  accent: string;
  accentActive: string;
  accentHover: string;
  accentText: string;
  busy: boolean;
  disabled: boolean;
  label: string;
  onPress(): void;
}) {
  const hoverOpacity = useRef(new Animated.Value(0)).current;
  const activeOpacity = useRef(new Animated.Value(0)).current;
  const [focusVisible, setFocusVisible] = useState(false);
  const [interaction, dispatchInteraction] = useReducer(
    reduceProviderButtonInteraction,
    INITIAL_PROVIDER_BUTTON_INTERACTION,
  );
  const layerTargets = providerButtonLayerTargets(interaction);

  useEffect(() => {
    const animation = Animated.timing(hoverOpacity, {
      duration: IOS_MOTION.duration.press,
      easing: PROVIDER_BUTTON_EASE_OUT,
      toValue: layerTargets.hoverOpacity,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [hoverOpacity, layerTargets.hoverOpacity]);

  useEffect(() => {
    const animation = Animated.timing(activeOpacity, {
      duration: IOS_MOTION.duration.press,
      easing: PROVIDER_BUTTON_EASE_OUT,
      toValue: layerTargets.activeOpacity,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [activeOpacity, layerTargets.activeOpacity]);

  useEffect(() => {
    if (!disabled) return;
    dispatchInteraction('reset');
    setFocusVisible(false);
  }, [disabled]);

  return (
    <IOSPressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      focusable={!disabled}
      onBlur={() => setFocusVisible(false)}
      onFocus={() => setFocusVisible(true)}
      onHoverIn={() => dispatchInteraction('hover-in')}
      onHoverOut={() => dispatchInteraction('hover-out')}
      onPress={onPress}
      onPressIn={() => dispatchInteraction('press-in')}
      onPressOut={() => dispatchInteraction('press-out')}
      scaleTo={0.99}
      style={styles.providerButtonFrame}
    >
      <View
        accessibilityElementsHidden
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={[styles.primaryButton, { backgroundColor: accent }]}
      >
        {busy ? (
          <ActivityIndicator color={accentText} size="small" />
        ) : null}
        <Text style={[styles.primaryButtonText, { color: accentText }]}>
          {label}
        </Text>
        <Animated.View
          accessibilityElementsHidden
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[
            styles.providerButtonVisualLayer,
            { backgroundColor: accentHover, opacity: hoverOpacity },
          ]}
        >
          <Text style={[styles.primaryButtonText, { color: accentText }]}>
            {label}
          </Text>
        </Animated.View>
        <Animated.View
          accessibilityElementsHidden
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[
            styles.providerButtonVisualLayer,
            { backgroundColor: accentActive, opacity: activeOpacity },
          ]}
        >
          <Text style={[styles.primaryButtonText, { color: accentText }]}>
            {label}
          </Text>
        </Animated.View>
      </View>
      {focusVisible ? (
        <View
          pointerEvents="none"
          style={[
            styles.providerButtonFocusRing,
            { borderColor: accent },
          ]}
        />
      ) : null}
    </IOSPressable>
  );
}

function LoginBackdrop({ palette }: { palette: LoginPalette }) {
  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <Svg height="100%" width="100%">
        <Defs>
          <LinearGradient id="login-canvas" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0%" stopColor={palette.backgroundTop} />
            <Stop offset="100%" stopColor={palette.backgroundBottom} />
          </LinearGradient>
          <RadialGradient
            cx="50%"
            cy="0%"
            id="login-top-glow"
            rx="70.710678%"
            ry="55%"
          >
            <Stop offset="0%" stopColor={palette.glow} />
            <Stop offset="100%" stopColor={palette.glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect fill="url(#login-canvas)" height="100%" width="100%" />
        <Rect fill="url(#login-top-glow)" height="100%" width="100%" />
      </Svg>
    </View>
  );
}

function SunGlyph({ color }: { color: string }) {
  return (
    <Svg
      fill="none"
      height={20}
      pointerEvents="none"
      stroke={color}
      strokeLinecap="round"
      strokeWidth={1.8}
      width={20}
    >
      <Circle cx={10} cy={10} r={3.4} />
      {[
        [10, 1.6, 10, 3.6],
        [10, 16.4, 10, 18.4],
        [1.6, 10, 3.6, 10],
        [16.4, 10, 18.4, 10],
        [4.2, 4.2, 5.6, 5.6],
        [14.4, 14.4, 15.8, 15.8],
        [15.8, 4.2, 14.4, 5.6],
        [4.2, 15.8, 5.6, 14.4],
      ].map(([x1, y1, x2, y2]) => (
        <Line key={`sun-ray-${x1}-${y1}`} x1={x1} x2={x2} y1={y1} y2={y2} />
      ))}
    </Svg>
  );
}

function MoonGlyph({ color }: { color: string }) {
  return (
    <Svg
      fill="none"
      height={20}
      pointerEvents="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      width={20}
    >
      <Path d="M 15.6 12.4 A 6.2 6.2 0 1 1 7.6 4.4 A 5 5 0 0 0 15.6 12.4 Z" />
    </Svg>
  );
}

function EyeGlyph({ color, visible }: { color: string; visible: boolean }) {
  if (visible) {
    return (
      <Svg
        fill="none"
        height={20}
        pointerEvents="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.6}
        width={20}
      >
        <Path d="M 1.8 10 C 4.4 5.6 7.2 3.6 10 3.6 C 12.8 3.6 15.6 5.6 18.2 10 C 15.6 14.4 12.8 16.4 10 16.4 C 7.2 16.4 4.4 14.4 1.8 10 Z" />
        <Circle cx={10} cy={10} r={2.6} />
      </Svg>
    );
  }
  return (
    <Svg
      fill="none"
      height={20}
      pointerEvents="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      width={20}
    >
      <Path d="M 1.8 10 C 4.4 5.6 7.2 3.6 10 3.6 C 12.8 3.6 15.6 5.6 18.2 10 C 15.6 14.4 12.8 16.4 10 16.4 C 7.2 16.4 4.4 14.4 1.8 10 Z" />
      <Line x1={3.4} x2={16.6} y1={16.8} y2={3.2} />
    </Svg>
  );
}

function CheckmarkGlyph({ color }: { color: string }) {
  return (
    <Svg
      fill="none"
      height={12}
      pointerEvents="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.2}
      width={12}
    >
      <Path d="M 2 6.4 L 4.8 9.2 L 10 3.2" />
    </Svg>
  );
}

function LockGlyph({ color }: { color: string }) {
  return (
    <Svg
      fill="none"
      height={28}
      pointerEvents="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      width={28}
    >
      <Rect height={10} rx={2.4} width={16} x={6} y={12} />
      <Path d="M 9.4 12 V 9.2 A 4.6 4.6 0 0 1 18.6 9.2 V 12" />
      <Circle cx={14} cy={17} r={1.4} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  toggleSlot: {
    position: 'absolute',
    right: 20,
    zIndex: 2,
  },
  toggle: {
    width: LOGIN_TOGGLE.size,
    height: LOGIN_TOGGLE.size,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: LOGIN_TOGGLE.radius,
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
  brandColumn: {
    alignItems: 'center',
    marginBottom: 28,
    gap: 10,
  },
  monogram: {
    width: LOGIN_MONOGRAM.size,
    height: LOGIN_MONOGRAM.size,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  monogramLetter: {
    fontFamily: WEBUI_FONT_FAMILIES.RulesCompressedMedium,
    fontSize: 30,
    lineHeight: 34,
  },
  brandText: {
    fontFamily: WEBUI_FONT_FAMILIES.RulesCompressedMedium,
    fontSize: 19,
    letterSpacing: 5.376,
    lineHeight: 25.2,
  },
  brandTagline: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 12.8,
    letterSpacing: 1.6,
    lineHeight: 18,
  },
  card: {
    borderWidth: 1,
    borderRadius: LOGIN_CARD.radius,
    padding: LOGIN_CARD.padding,
    shadowOffset: { width: 0, height: LOGIN_CARD.shadowOffsetY },
    shadowOpacity: LOGIN_CARD.shadowOpacity,
    shadowRadius: LOGIN_CARD.shadowRadius,
    elevation: 8,
  },
  heading: {
    marginBottom: 6,
    fontFamily: WEBUI_FONT_FAMILIES.RulesCompressedMedium,
    fontSize: 27,
    letterSpacing: 1.2,
    lineHeight: 34,
  },
  subtitle: {
    marginBottom: 22,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 14.4,
    lineHeight: 21.6,
  },
  loadingRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 14,
    lineHeight: 21,
  },
  form: {
    gap: 14,
  },
  formTitle: {
    textAlign: 'center',
    fontFamily: WEBUI_FONT_FAMILIES.RulesCompressedMedium,
    fontSize: 15,
    letterSpacing: 1.2,
    lineHeight: 22,
  },
  lockGlyph: {
    width: 64,
    height: 64,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    marginBottom: 2,
  },
  segmentedTrack: {
    height: LOGIN_SEGMENTED.height,
    flexDirection: 'row',
    borderRadius: LOGIN_SEGMENTED.radius,
    position: 'relative',
  },
  segmentedIndicator: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: LOGIN_SEGMENTED.indicatorRadius,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentedOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentedLabel: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 13.2,
    lineHeight: 18,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 12.4,
    letterSpacing: 0.6,
    lineHeight: 17,
  },
  input: {
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: LOGIN_INPUT.radius,
    minHeight: LOGIN_INPUT.minHeight,
    borderColor: 'transparent',
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 15.2,
    lineHeight: 22.8,
  },
  inputWithAccessory: {
    paddingRight: 48,
  },
  inputContainer: {
    position: 'relative',
  },
  inputFocusRing: {
    position: 'absolute',
    top: -LOGIN_INPUT.focusRingWidth,
    right: -LOGIN_INPUT.focusRingWidth,
    bottom: -LOGIN_INPUT.focusRingWidth,
    left: -LOGIN_INPUT.focusRingWidth,
    borderWidth: LOGIN_INPUT.focusRingWidth,
    borderRadius: LOGIN_INPUT.radius + LOGIN_INPUT.focusRingWidth,
    opacity: 0.9,
  },
  inputAccessoryRing: {
    right: 44,
  },
  passwordToggle: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verificationRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  verificationInput: {
    flex: 1,
  },
  codeButton: {
    minWidth: 108,
    minHeight: LOGIN_INPUT.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: LOGIN_INPUT.radius,
  },
  codeButtonDisabled: {
    opacity: 0.45,
  },
  codeButtonText: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 12.4,
    lineHeight: 17,
    textAlign: 'center',
  },
  codeMessage: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 12,
    lineHeight: 18,
  },
  errorChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: LOGIN_INPUT.radius,
  },
  errorText: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 13.12,
    lineHeight: 19.68,
  },
  providerButtonFrame: {
    position: 'relative',
    marginTop: 6,
  },
  primaryButton: {
    minHeight: LOGIN_BUTTON.minHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 16,
    borderRadius: LOGIN_VISUAL_CONTRACT.button.radius,
  },
  primaryButtonText: {
    flexShrink: 1,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 14.4,
    letterSpacing: 2.2,
    lineHeight: 20,
    textAlign: 'center',
  },
  providerButtonVisualLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 16,
    borderRadius: LOGIN_VISUAL_CONTRACT.button.radius,
  },
  providerButtonFocusRing: {
    position: 'absolute',
    top: -(PROVIDER_BUTTON.focusVisible.offset + PROVIDER_BUTTON.focusVisible.width),
    right: -(PROVIDER_BUTTON.focusVisible.offset + PROVIDER_BUTTON.focusVisible.width),
    bottom: -(PROVIDER_BUTTON.focusVisible.offset + PROVIDER_BUTTON.focusVisible.width),
    left: -(PROVIDER_BUTTON.focusVisible.offset + PROVIDER_BUTTON.focusVisible.width),
    borderWidth: PROVIDER_BUTTON.focusVisible.width,
    borderRadius: LOGIN_VISUAL_CONTRACT.button.radius
      + PROVIDER_BUTTON.focusVisible.offset
      + PROVIDER_BUTTON.focusVisible.width,
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: LOGIN_VISUAL_CONTRACT.button.radius - 2,
  },
  secondaryButtonText: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 12.48,
    letterSpacing: 2.2,
    lineHeight: 18.72,
  },
  softAction: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: LOGIN_INPUT.radius,
  },
  softActionText: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 13.12,
    lineHeight: 19.68,
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.78,
  },
  attemptText: {
    textAlign: 'center',
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 12,
    lineHeight: 18,
  },
  rememberRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rememberCheckbox: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 6,
  },
  rememberText: {
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 13.12,
    lineHeight: 19.68,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    gap: 14.4,
  },
  footerLine: {
    width: 24,
    height: 1,
    marginBottom: 2.4,
  },
  footerText: {
    flexShrink: 1,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 12,
    letterSpacing: 1.2,
    lineHeight: 20.4,
    textAlign: 'center',
  },
});
