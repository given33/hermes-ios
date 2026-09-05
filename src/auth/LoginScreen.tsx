import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Image,
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
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Moon, Sun } from 'lucide-react-native';

import { IOSPressable } from '../components/ios/IOSPressable';
import { IOS_MOTION } from '../design/ios-motion';
import { useMotion } from '../design/motion';
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
  entrance: LOGIN_ENTRANCE,
  input: LOGIN_INPUT,
  providerButton: PROVIDER_BUTTON,
  segmented: LOGIN_SEGMENTED,
  toggle: LOGIN_TOGGLE,
} = LOGIN_VISUAL_CONTRACT;
const LOGIN_EASE_OUT = Easing.bezier(...IOS_MOTION.curve.decelerate);
const BODY_REGULAR = 'HermesGoogle-IBMPlexSans-400-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
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
  const motion = useMotion();
  const { height } = useWindowDimensions();
  const usernameInput = useRef<TextInputHandle>(null);
  const passwordInput = useRef<TextInputHandle>(null);
  const emailInput = useRef<TextInputHandle>(null);
  const verificationCodeInput = useRef<TextInputHandle>(null);
  const entranceOpacity = useRef(new Animated.Value(motion.reduceMotion ? 1 : 0)).current;
  const entranceOffset = useRef(new Animated.Value(motion.reduceMotion ? 0 : LOGIN_ENTRANCE.translateY)).current;
  const [scheme, setScheme] = useState<LoginColorScheme>(LOGIN_VISUAL_CONTRACT.defaultScheme);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submittedMode, setSubmittedMode] = useState<'login' | 'register' | null>(null);
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
  const error = state.status === 'provisioning' && (submittedMode === null || submittedMode === mode)
    ? state.error : undefined;
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
        duration: motion.duration(LOGIN_ENTRANCE.durationMs),
        easing: LOGIN_EASE_OUT,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(entranceOffset, {
        duration: motion.duration(LOGIN_ENTRANCE.durationMs),
        easing: LOGIN_EASE_OUT,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [entranceOffset, entranceOpacity, motion]);

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
      setSubmittedMode(mode);
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
                  backgroundColor: 'transparent',
                },
              ]}
            >
              <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
                {locked ? '解锁 Hermes' : mode === 'register' ? '创建账号' : '欢迎回来'}
              </Text>
              <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
                {loading
                  ? '正在读取 Hermes 安全连接。'
                  : locked
                    ? '使用 Face ID 解锁受保护的 Hermes 连接。'
                    : mode === 'register'
                      ? '使用 QQ 邮箱验证码创建 Hermes 账号。'
                      : '登录 Hermes'}
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
                              { backgroundColor: palette.inputFill, borderColor: palette.inputBorder, color: palette.text },
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
                                { backgroundColor: palette.inputFill, borderColor: palette.inputBorder, color: palette.text },
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
                          { backgroundColor: palette.inputFill, borderColor: palette.inputBorder, color: palette.text },
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
                          { backgroundColor: palette.inputFill, borderColor: palette.inputBorder, color: palette.text },
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
              <Text style={[styles.footerText, { color: palette.textTertiary }]}>
                Hermes Agent
              </Text>
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
      <Image source={require('../../assets/icon.png')} accessibilityLabel="Hermes" style={{ width: 48, height: 48, borderRadius: 8 }} />
      <View style={styles.brandCopy}>
        <Text accessibilityRole="header" style={[styles.brandText, { color: palette.text }]}>Hermes</Text>
        <Text style={[styles.brandTagline, { color: palette.textSecondary }]}>Agent 工作空间</Text>
      </View>
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
  const motion = useMotion();
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const animation = Animated.timing(indicatorProgress, {
      duration: motion.duration(IOS_MOTION.duration.control),
      easing: PROVIDER_BUTTON_EASE_OUT,
      toValue: value === 'register' ? 1 : 0,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [indicatorProgress, value, motion]);

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
        style={[styles.primaryButton, { backgroundColor: accent, opacity: disabled ? 0.45 : 1 }]}
      >
        {busy ? (
          <ActivityIndicator color={accentText} size="small" />
        ) : null}
        <Text style={[styles.primaryButtonText, { color: accentText }]}>
          {label}
        </Text>
        {!busy ? <ArrowRight color={accentText} size={18} /> : null}
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
          {!busy ? <ArrowRight color={accentText} size={18} /> : null}
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
          {!busy ? <ArrowRight color={accentText} size={18} /> : null}
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

function SunGlyph({ color }: { color: string }) {
  return <Sun color={color} pointerEvents="none" size={20} strokeWidth={1.8} />;
}

function MoonGlyph({ color }: { color: string }) {
  return <Moon color={color} pointerEvents="none" size={20} strokeWidth={1.8} />;
}

function EyeGlyph({ color, visible }: { color: string; visible: boolean }) {
  const Icon = visible ? Eye : EyeOff;
  return <Icon color={color} pointerEvents="none" size={20} strokeWidth={1.8} />;
}

function CheckmarkGlyph({ color }: { color: string }) {
  return <Check color={color} pointerEvents="none" size={12} strokeWidth={2.2} />;
}

function LockGlyph({ color }: { color: string }) {
  return <LockKeyhole color={color} pointerEvents="none" size={28} strokeWidth={1.8} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
    paddingHorizontal: 28,
  },
  panel: {
    width: '100%',
    maxWidth: 416,
  },
  brandColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 44,
    gap: 12,
  },
  brandCopy: { flex: 1, gap: 1 },
  brandText: {
    fontWeight: '600',
    fontSize: 25,
    letterSpacing: 0,
    lineHeight: 32,
  },
  brandTagline: {
    fontFamily: BODY_REGULAR,
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 20,
  },
  card: {
    padding: 0,
  },
  heading: {
    marginBottom: 6,
    fontWeight: '600',
    fontSize: 26,
    letterSpacing: 0,
    lineHeight: 36,
  },
  subtitle: {
    marginBottom: 28,
    fontFamily: BODY_REGULAR,
    fontSize: 14,
    lineHeight: 22,
  },
  loadingRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: BODY_REGULAR,
    fontSize: 14,
    lineHeight: 21,
  },
  form: {
    gap: 14,
  },
  formTitle: {
    textAlign: 'center',
    fontFamily: BODY_SEMIBOLD,
    fontSize: 15,
    letterSpacing: 0,
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
    fontFamily: BODY_SEMIBOLD,
    fontSize: 14,
    lineHeight: 20,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: BODY_REGULAR,
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 20,
  },
  input: {
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: LOGIN_INPUT.radius,
    minHeight: LOGIN_INPUT.minHeight,
    borderColor: 'transparent',
    fontFamily: BODY_REGULAR,
    fontSize: 16,
    lineHeight: 24,
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
    fontFamily: BODY_SEMIBOLD,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  codeMessage: {
    fontFamily: BODY_REGULAR,
    fontSize: 12,
    lineHeight: 18,
  },
  errorChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: LOGIN_INPUT.radius,
  },
  errorText: {
    fontFamily: BODY_REGULAR,
    fontSize: 14,
    lineHeight: 20,
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
    fontFamily: BODY_SEMIBOLD,
    fontSize: 16,
    letterSpacing: 0,
    lineHeight: 22,
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
    fontFamily: BODY_SEMIBOLD,
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 20,
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
    fontFamily: BODY_REGULAR,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  buttonPressed: {
    opacity: 0.78,
  },
  attemptText: {
    textAlign: 'center',
    fontFamily: BODY_REGULAR,
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
    fontFamily: BODY_REGULAR,
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    gap: 14.4,
  },
  footerText: {
    flexShrink: 1,
    fontFamily: BODY_REGULAR,
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 20.4,
    textAlign: 'center',
  },
});
