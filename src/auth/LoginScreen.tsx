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

import { IOSPressable } from '../components/ios/IOSPressable';
import { WEBUI_FONT_FAMILIES } from '../app/webui-fonts';
import { IOS_MOTION } from '../design/ios-motion';
import { useAuth } from './AuthProvider';
import {
  INITIAL_PROVIDER_BUTTON_INTERACTION,
  LOGIN_VISUAL_CONTRACT,
  providerButtonLayerTargets,
  reduceProviderButtonInteraction,
} from './login-visual-contract';

const {
  cardShadow: LOGIN_CARD_SHADOW,
  colors: LOGIN_COLORS,
  dither: LOGIN_DITHER,
  entrance: LOGIN_ENTRANCE,
  glow: LOGIN_GLOW,
  providerButton: PROVIDER_BUTTON,
} = LOGIN_VISUAL_CONTRACT;
const LOGIN_EASE_OUT = Easing.bezier(...IOS_MOTION.curve.decelerate);
const PROVIDER_BUTTON_EASE_OUT = Easing.bezier(
  ...IOS_MOTION.curve.standard,
);

export function LoginScreen() {
  const {
    state,
    rememberedLogin,
    registrationOpen,
    authenticate,
    register,
    requestRegistrationCode,
    unlock,
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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberLogin, setRememberLogin] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [codeMessage, setCodeMessage] = useState('');
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
  const [focusedField, setFocusedField] = useState<
    'email' | 'verificationCode' | 'username' | 'password' | null
  >(null);

  const loading = state.status === 'loading';
  const locked = state.status === 'locked';
  const busy = state.status !== 'loading' && state.status !== 'authenticated' && state.busy;
  const error =
    state.status === 'locked' || state.status === 'provisioning' ? state.error : undefined;
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
    if (rememberedLoginApplied.current || state.status !== 'provisioning') return;
    rememberedLoginApplied.current = true;
    setUsername(rememberedLogin.username);
    setPassword(rememberedLogin.password);
    setRememberLogin(rememberedLogin.enabled);
  }, [rememberedLogin, state.status]);

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(entranceOpacity, {
        duration: IOS_MOTION.duration.content,
        easing: LOGIN_EASE_OUT,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(entranceOffset, {
        duration: IOS_MOTION.duration.content,
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

  const submit = () => {
    if (state.status === 'provisioning' && canSubmit) {
      if (mode === 'register') {
        void register(email, verificationCode, username, password);
      } else {
        void authenticate(username, password, rememberLogin);
      }
    }
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
                <Text style={styles.heading}>{mode === 'register' ? '注册' : '登录'}</Text>
                <Text style={styles.subtitle}>
                  {loading
                    ? '正在读取 Hermes 安全连接。'
                    : locked
                      ? '使用 Face ID 快速解锁已登录账号。'
                      : mode === 'register'
                        ? '使用 QQ 邮箱验证码创建 Hermes 账号。'
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
                    <Text style={styles.attemptText}>
                      {state.failedAttempts > 0
                        ? `已尝试 ${state.failedAttempts}/5 次`
                        : '验证失败后可继续重试，连续 5 次后使用密码登录'}
                    </Text>
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
                    <IOSPressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void logout()}
                      pressedStyle={!busy ? styles.buttonPressed : undefined}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>使用其他账号</Text>
                    </IOSPressable>
                  </View>
                ) : (
                  <View style={styles.form}>
                    <Text style={styles.formTitle}>
                      {mode === 'register' ? '创建 HERMES 账号' : '使用账号密码登录'}
                    </Text>
                    {mode === 'register' ? (
                      <>
                        {!registrationOpen ? (
                          <Text accessibilityRole="alert" style={styles.registrationNotice}>
                            注册暂未开放
                          </Text>
                        ) : null}
                        <View style={styles.field}>
                          <Text style={styles.fieldLabel}>QQ 邮箱</Text>
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
                              placeholderTextColor="rgba(255, 255, 255, 0.32)"
                              returnKeyType="next"
                              style={[
                                styles.input,
                                focusedField === 'email' && styles.inputFocused,
                              ]}
                              textContentType="emailAddress"
                              value={email}
                            />
                            {focusedField === 'email' ? (
                              <View pointerEvents="none" style={styles.inputFocusRing} />
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.field}>
                          <Text style={styles.fieldLabel}>邮箱验证码</Text>
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
                                returnKeyType="next"
                                style={[
                                  styles.input,
                                  focusedField === 'verificationCode' && styles.inputFocused,
                                ]}
                                textContentType="oneTimeCode"
                                value={verificationCode}
                              />
                              {focusedField === 'verificationCode' ? (
                                <View pointerEvents="none" style={styles.inputFocusRing} />
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
                                (
                                  !registrationOpen
                                  || sendingCode
                                  || codeCooldown > 0
                                  || !email.trim()
                                ) && styles.codeButtonDisabled,
                              ]}
                            >
                              <Text style={styles.codeButtonText}>
                                {sendingCode
                                  ? '发送中'
                                  : codeCooldown > 0 ? `${codeCooldown}秒` : '发送验证码'}
                              </Text>
                            </IOSPressable>
                          </View>
                          {codeMessage ? (
                            <Text style={styles.codeMessage}>{codeMessage}</Text>
                          ) : null}
                        </View>
                      </>
                    ) : null}
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>账号</Text>
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
                          returnKeyType="next"
                          style={[
                            styles.input,
                            focusedField === 'username' && styles.inputFocused,
                          ]}
                          textContentType="username"
                          value={username}
                        />
                        {focusedField === 'username' ? (
                          <View pointerEvents="none" style={styles.inputFocusRing} />
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.fieldLabel}>密码</Text>
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
                          returnKeyType="done"
                          secureTextEntry
                          style={[
                            styles.input,
                            focusedField === 'password' && styles.inputFocused,
                          ]}
                          textContentType={mode === 'register' ? 'newPassword' : 'password'}
                          value={password}
                        />
                        {focusedField === 'password' ? (
                          <View pointerEvents="none" style={styles.inputFocusRing} />
                        ) : null}
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
                        <View style={[
                          styles.rememberCheckbox,
                          rememberLogin && styles.rememberCheckboxChecked,
                        ]}>
                          {rememberLogin ? <Text style={styles.rememberCheckmark}>✓</Text> : null}
                        </View>
                        <Text style={styles.rememberText}>记住账号和密码</Text>
                      </IOSPressable>
                    ) : null}
                    {error ? (
                      <Text accessibilityRole="alert" style={styles.errorText}>
                        {error}
                      </Text>
                    ) : null}
                    <ProviderButton
                      busy={busy}
                      disabled={!canSubmit}
                      label={busy
                        ? mode === 'register' ? '正在注册' : '正在登录'
                        : mode === 'register' ? '注册并登录' : '登录'}
                      onPress={submit}
                    />
                    <IOSPressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => {
                        setMode((current) => current === 'login' ? 'register' : 'login');
                        setCodeMessage('');
                        setFocusedField(null);
                      }}
                      pressedStyle={styles.buttonPressed}
                      style={styles.modeSwitch}
                    >
                      <Text style={styles.modeSwitchText}>
                        {mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}
                      </Text>
                    </IOSPressable>
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
      style={styles.providerButtonFrame}
    >
      <View
        accessibilityElementsHidden
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.primaryButton,
          { backgroundColor: PROVIDER_BUTTON.base.backgroundColor },
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            styles.buttonBevel,
            {
              borderTopColor: PROVIDER_BUTTON.base.bevel.top,
              borderRightColor: PROVIDER_BUTTON.base.bevel.right,
              borderBottomColor: PROVIDER_BUTTON.base.bevel.bottom,
              borderLeftColor: PROVIDER_BUTTON.base.bevel.left,
            },
          ]}
        />
        {busy ? (
          <ActivityIndicator color={PROVIDER_BUTTON.base.textColor} size="small" />
        ) : null}
        <Text
          style={[
            styles.primaryButtonText,
            { color: PROVIDER_BUTTON.base.textColor },
          ]}
        >
          {label}
        </Text>
        <Animated.View
          accessibilityElementsHidden
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[
            styles.providerButtonVisualLayer,
            {
              backgroundColor: PROVIDER_BUTTON.hover.backgroundColor,
              opacity: hoverOpacity,
            },
          ]}
        >
          <View
            pointerEvents="none"
            style={[
              styles.buttonBevel,
              {
                borderTopColor: PROVIDER_BUTTON.hover.bevel.top,
                borderRightColor: PROVIDER_BUTTON.hover.bevel.right,
                borderBottomColor: PROVIDER_BUTTON.hover.bevel.bottom,
                borderLeftColor: PROVIDER_BUTTON.hover.bevel.left,
              },
            ]}
          />
          <Text
            style={[
              styles.primaryButtonText,
              { color: PROVIDER_BUTTON.hover.textColor },
            ]}
          >
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
            {
              backgroundColor: PROVIDER_BUTTON.active.backgroundColor,
              opacity: activeOpacity,
            },
          ]}
        >
          <View
            pointerEvents="none"
            style={[
              styles.buttonBevel,
              {
                borderTopColor: PROVIDER_BUTTON.active.bevel.top,
                borderRightColor: PROVIDER_BUTTON.active.bevel.right,
                borderBottomColor: PROVIDER_BUTTON.active.bevel.bottom,
                borderLeftColor: PROVIDER_BUTTON.active.bevel.left,
              },
            ]}
          />
          <Text
            style={[
              styles.primaryButtonText,
              { color: PROVIDER_BUTTON.active.textColor },
            ]}
          >
            {label}
          </Text>
        </Animated.View>
      </View>
      {focusVisible ? (
        <View pointerEvents="none" style={styles.providerButtonFocusRing} />
      ) : null}
    </IOSPressable>
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
  registrationNotice: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 172, 2, 0.35)',
    color: LOGIN_COLORS.accent,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 13.12,
    lineHeight: 19.68,
    textAlign: 'center',
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
  verificationRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  verificationInput: {
    flex: 1,
  },
  codeButton: {
    minWidth: 104,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 172, 2, 0.55)',
    backgroundColor: '#1c1207',
  },
  codeButtonDisabled: {
    opacity: 0.45,
  },
  codeButtonText: {
    color: LOGIN_COLORS.accent,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 11.52,
    lineHeight: 17.28,
    textAlign: 'center',
  },
  codeMessage: {
    color: 'rgba(255, 255, 255, 0.62)',
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 12,
    lineHeight: 18,
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
    paddingVertical: 15.2,
    borderRadius: 0,
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
  attemptText: {
    color: 'rgba(255, 255, 255, 0.58)',
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
    borderWidth: 1,
    borderColor: 'rgba(255, 172, 2, 0.5)',
  },
  rememberCheckboxChecked: {
    backgroundColor: LOGIN_COLORS.accent,
    borderColor: LOGIN_COLORS.accent,
  },
  rememberCheckmark: {
    color: '#080604',
    fontFamily: WEBUI_FONT_FAMILIES.CollapseBold,
    fontSize: 14,
    lineHeight: 17,
  },
  rememberText: {
    color: 'rgba(255, 255, 255, 0.76)',
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 13.12,
    lineHeight: 19.68,
  },
  modeSwitch: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  modeSwitchText: {
    color: LOGIN_COLORS.accent,
    fontFamily: WEBUI_FONT_FAMILIES.CollapseRegular,
    fontSize: 13.12,
    lineHeight: 19.68,
    textAlign: 'center',
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
