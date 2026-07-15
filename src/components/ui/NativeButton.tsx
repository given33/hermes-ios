import {
  Children,
  cloneElement,
  forwardRef,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Reanimated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';

import {
  CONTROL_METRICS,
  INITIAL_NATIVE_BUTTON_INTERACTION,
  reduceNativeButtonInteraction,
  resolveArcGradient,
  resolveButtonMetrics,
  resolveButtonVisual,
  resolveCssGradientGeometry,
  resolveNativeButtonVisualState,
  type NativeButtonSize,
  type NativeButtonVariant,
} from '../../design/control-contracts';
import { resolveNativeFontStack } from '../../design/native-font-faces';
import { useTheme } from '../../design/ThemeProvider';
import { IOS_MOTION } from '../../design/ios-motion';
import { useNativeLocalization } from '../../i18n/NativeLocalization';
import { playHaptic, type IOSHaptic } from '../ios/IOSPressable';

const AnimatedRect = Reanimated.createAnimatedComponent(Rect);

export interface NativeButtonProps
  extends Omit<PressableProps, 'children' | 'style'>,
    NativeButtonVariant {
  borderRadius?: number;
  children?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  haptic?: IOSHaptic;
  loading?: boolean;
  prefix?: ReactNode;
  size?: NativeButtonSize;
  style?: PressableProps['style'];
  suffix?: ReactNode;
  textStyle?: StyleProp<TextStyle>;
}

export const NativeButton = forwardRef<View, NativeButtonProps>(
  function NativeButton(
    {
      accessibilityLabel,
      accessibilityState,
      borderRadius = 0,
      children,
      contentStyle,
      destructive = false,
      disabled = false,
      ghost = false,
      haptic,
      invert = false,
      loading = false,
      onBlur,
      onFocus,
      onHoverIn,
      onHoverOut,
      onLayout,
      onPress,
      onPressIn,
      onPressOut,
      outlined = false,
      prefix,
      size = 'default',
      style,
      suffix,
      textStyle,
      ...props
    },
    ref,
  ) {
    const { tokens } = useTheme();
    const { t } = useNativeLocalization();
    const [interaction, dispatch] = useReducer(
      reduceNativeButtonInteraction,
      INITIAL_NATIVE_BUTTON_INTERACTION,
    );
    const [layout, setLayout] = useState({ height: 0, width: 0 });
    const pressProgress = useSharedValue(0);
    const blocked = disabled === true || loading;
    const visualState = resolveNativeButtonVisualState(
      interaction,
      disabled === true,
      loading,
    );
    const variant = { destructive, ghost, invert, outlined };
    const visual = resolveButtonVisual(tokens, variant, visualState);
    const metrics = resolveButtonMetrics(tokens, size);
    const runtimeFont = resolveNativeFontStack(tokens.typography.fontMono, 700);
    const square = size === 'icon' || size === 'xs';
    // CSS `leading-0` lets glyph ink paint outside the line box. React Native
    // clips that ink, so small text buttons need an explicit painted height.
    const paintedHeight = square
      ? metrics.visibleHeight
      : Math.max(metrics.visibleHeight, size === 'sm' ? 30 : 40);
    const paintedLineHeight = Math.max(
      metrics.fontSize,
      metrics.fontSize * (size === 'sm' ? 1.35 : 1.2),
    );
    const pressStyle = useAnimatedStyle(() => ({
      opacity: 1 - pressProgress.value * 0.08,
      transform: [{ scale: 1 - pressProgress.value * 0.025 }],
    }));

    useEffect(() => {
      if (blocked) dispatch('reset');
    }, [blocked]);

    return (
      <Pressable
        {...props}
        accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined}
        accessibilityRole={props.accessibilityRole ?? 'button'}
        accessibilityState={{
          ...accessibilityState,
          busy: loading || accessibilityState?.busy,
          disabled: blocked,
        }}
        disabled={blocked}
        focusable={!blocked}
        hitSlop={props.hitSlop ?? metrics.hitSlop}
        onBlur={(event) => {
          dispatch('blur');
          onBlur?.(event);
        }}
        onFocus={(event) => {
          dispatch('focus');
          onFocus?.(event);
        }}
        onHoverIn={(event) => {
          dispatch('hover-in');
          onHoverIn?.(event);
        }}
        onHoverOut={(event) => {
          dispatch('hover-out');
          onHoverOut?.(event);
        }}
        onLayout={(event) => {
          const { height, width } = event.nativeEvent.layout;
          setLayout((current) => (
            current.height === height && current.width === width
              ? current
              : { height, width }
          ));
          onLayout?.(event);
        }}
        onPressIn={(event) => {
          dispatch('press-in');
          pressProgress.value = withSpring(1, {
            damping: IOS_MOTION.spring.damping,
            mass: 0.72,
            stiffness: IOS_MOTION.spring.stiffness + 80,
          });
          onPressIn?.(event);
        }}
        onPress={(event) => {
          void playHaptic(haptic ?? (destructive ? 'medium' : 'none'));
          onPress?.(event);
        }}
        onPressOut={(event) => {
          dispatch('press-out');
          pressProgress.value = withSpring(0, {
            damping: IOS_MOTION.spring.damping,
            mass: 0.72,
            stiffness: IOS_MOTION.spring.stiffness + 80,
          });
          onPressOut?.(event);
        }}
        ref={ref}
        style={(state) => [
          styles.pressable,
          {
            borderRadius,
            height: paintedHeight,
            width: square ? paintedHeight : undefined,
          },
          typeof style === 'function' ? style(state) : style,
        ]}
      >
        <ArcBorder
          borderRadius={borderRadius}
          filter={visual.filter}
          height={layout.height}
          tokens={tokens}
          visible={!ghost && visual.arcVisible}
          width={layout.width}
        />

        <Reanimated.View
          pointerEvents="none"
          style={[
            styles.content,
            {
              backgroundColor: visual.backgroundColor,
              borderColor: visual.borderColor,
              borderRadius,
              borderWidth: visual.id === 'outlined-destructive' ? 1 : 0,
              height: paintedHeight,
              paddingLeft: square ? 0 : metrics.paddingLeft,
              paddingRight: square ? 0 : metrics.paddingRight,
              width: square ? paintedHeight : undefined,
            },
            contentStyle,
            pressStyle,
          ]}
        >
          {visual.bevel ? <ButtonBevel bevel={visual.bevel} /> : null}
          {prefix ? (
            <>
              <View style={{ width: metrics.prefixSuffixSpacerWidth }} />
              <View
                style={[
                  styles.affix,
                  {
                    left: metrics.prefixSuffixOffset,
                    transform: [{ translateY: -metrics.prefixSuffixIconSize / 2 }],
                  },
                ]}
              >
                {renderIcon(prefix, visual.textColor, metrics.prefixSuffixIconSize)}
              </View>
            </>
          ) : null}

          {Children.map(children, (child) => renderChild(
            child,
            visual.textColor,
            metrics.iconSize,
            runtimeFont,
            metrics.fontSize,
            paintedLineHeight,
            metrics.letterSpacing,
            textStyle,
            t,
          ))}

          {suffix ? (
            <>
              <View style={{ width: metrics.prefixSuffixSpacerWidth }} />
              <View
                style={[
                  styles.affix,
                  {
                    right: metrics.prefixSuffixOffset,
                    transform: [{ translateY: -metrics.prefixSuffixIconSize / 2 }],
                  },
                ]}
              >
                {renderIcon(suffix, visual.textColor, metrics.prefixSuffixIconSize)}
              </View>
            </>
          ) : null}
        </Reanimated.View>
      </Pressable>
    );
  },
);

function ArcBorder({
  borderRadius,
  filter,
  height,
  tokens,
  visible,
  width,
}: {
  borderRadius: number;
  filter: ReturnType<typeof resolveButtonVisual>['filter'];
  height: number;
  tokens: ReturnType<typeof useTheme>['tokens'];
  visible: boolean;
  width: number;
}) {
  const opacity = useSharedValue(0);
  const progress = useSharedValue(0);
  const nativeId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `hermes-button-arc-gradient-${nativeId}`;
  const maskId = `hermes-button-arc-mask-${nativeId}`;
  const inset = -CONTROL_METRICS.button.arcBorderInset;
  const arcWidth = width + inset * 2;
  const arcHeight = height + inset * 2;
  const imageWidth = arcWidth * CONTROL_METRICS.button.arcBorderBackgroundSizePercent / 100;
  const imageHeight = arcHeight * CONTROL_METRICS.button.arcBorderBackgroundSizePercent / 100;
  const gradient = useMemo(() => resolveArcGradient(tokens, filter), [filter, tokens]);
  const geometry = useMemo(
    () => resolveCssGradientGeometry(
      imageWidth,
      imageHeight,
      gradient.angleDegrees,
    ),
    [gradient.angleDegrees, imageHeight, imageWidth],
  );
  const fromX = (arcWidth - imageWidth) * gradient.positionStart[0] / 100;
  const toX = (arcWidth - imageWidth) * gradient.positionEnd[0] / 100;
  const fromY = (arcHeight - imageHeight) * gradient.positionStart[1] / 100;
  const toY = (arcHeight - imageHeight) * gradient.positionEnd[1] / 100;

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: IOS_MOTION.duration.control,
      easing: Easing.bezier(...IOS_MOTION.curve.standard),
    });
  }, [opacity, visible]);

  useEffect(() => {
    cancelAnimation(progress);
    if (visible) {
      progress.value = 0;
      progress.value = withRepeat(
        withTiming(1, {
          duration: CONTROL_METRICS.button.arcBorderDurationMs,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    }
    return () => cancelAnimation(progress);
  }, [progress, visible]);

  const opacityStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const movingRectProps = useAnimatedProps(() => ({
    x: interpolate(
      progress.value,
      [0, 1],
      [fromX, toX],
    ),
    y: interpolate(
      progress.value,
      [0, 1],
      [fromY, toY],
    ),
  }));

  if (arcWidth <= 0 || arcHeight <= 0) return null;

  const stroke = CONTROL_METRICS.button.arcBorderWidth;
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        styles.arc,
        {
          height: arcHeight,
          left: CONTROL_METRICS.button.arcBorderInset,
          top: CONTROL_METRICS.button.arcBorderInset,
          width: arcWidth,
        },
        opacityStyle,
      ]}
    >
      <Svg height={arcHeight} width={arcWidth}>
        <Defs>
          <LinearGradient
            gradientUnits="objectBoundingBox"
            id={gradientId}
            x1={geometry.x1}
            x2={geometry.x2}
            y1={geometry.y1}
            y2={geometry.y2}
          >
            {gradient.stops.map((stop, index) => (
              <Stop
                key={`${index}-${stop.offset}`}
                offset={stop.offset}
                stopColor={stop.color}
              />
            ))}
          </LinearGradient>
          <Mask id={maskId}>
            <Rect
              fill="#ffffff"
              height={arcHeight}
              rx={borderRadius}
              width={arcWidth}
            />
            <Rect
              fill="#000000"
              height={Math.max(0, arcHeight - stroke * 2)}
              rx={Math.max(0, borderRadius - stroke)}
              width={Math.max(0, arcWidth - stroke * 2)}
              x={stroke}
              y={stroke}
            />
          </Mask>
        </Defs>
        <AnimatedRect
          animatedProps={movingRectProps}
          fill={`url(#${gradientId})`}
          height={imageHeight}
          mask={`url(#${maskId})`}
          width={imageWidth}
        />
      </Svg>
    </Reanimated.View>
  );
}

function ButtonBevel({
  bevel,
}: {
  bevel: NonNullable<ReturnType<typeof resolveButtonVisual>['bevel']>;
}) {
  const width = CONTROL_METRICS.button.bevelWidth;
  return (
    <>
      <View style={[styles.bevelTop, { backgroundColor: bevel.top, height: width }]} />
      <View style={[styles.bevelRight, { backgroundColor: bevel.right, width }]} />
      <View style={[styles.bevelBottom, { backgroundColor: bevel.bottom, height: width }]} />
      <View style={[styles.bevelLeft, { backgroundColor: bevel.left, width }]} />
    </>
  );
}

function renderChild(
  child: ReactNode,
  color: string,
  iconSize: number,
  fontFamily: string | undefined,
  fontSize: number,
  lineHeight: number,
  letterSpacing: number,
  textStyle: StyleProp<TextStyle>,
  translate: (value: string) => string,
): ReactNode {
  if (typeof child === 'string' || typeof child === 'number') {
    const displayChild = typeof child === 'string' ? translate(child) : child;
    return (
      <Text
        style={buttonTextStyles(
          color,
          fontFamily,
          fontSize,
          lineHeight,
          typeof displayChild === 'string' && containsCjk(displayChild)
            ? 0
            : letterSpacing,
          textStyle,
        )}
      >
        {displayChild}
      </Text>
    );
  }
  if (!isValidElement(child)) return child;
  if (child.type === Fragment) {
    const fragment = child as ReactElement<{ children?: ReactNode }>;
    return (
      <Fragment>
        {Children.map(fragment.props.children, (nested) => renderChild(
          nested,
          color,
          iconSize,
          fontFamily,
          fontSize,
          lineHeight,
          letterSpacing,
          textStyle,
          translate,
        ))}
      </Fragment>
    );
  }
  if (child.type === Text) {
    const text = child as ReactElement<{
      children?: ReactNode;
      style?: StyleProp<TextStyle>;
    }>;
    return cloneElement(text, {
      style: buttonTextStyles(
        color,
        fontFamily,
        fontSize,
        lineHeight,
        containsCjk(textContent(text.props.children)) ? 0 : letterSpacing,
        [text.props.style, textStyle],
      ),
      children: Children.map(text.props.children, (nested) => renderChild(
        nested,
        color,
        iconSize,
        fontFamily,
        fontSize,
        lineHeight,
        letterSpacing,
        textStyle,
        translate,
      )),
    });
  }
  if (child.type === View) {
    const view = child as ReactElement<{ children?: ReactNode }>;
    return cloneElement(view, {
      children: Children.map(view.props.children, (nested) => renderChild(
        nested,
        color,
        iconSize,
        fontFamily,
        fontSize,
        lineHeight,
        letterSpacing,
        textStyle,
        translate,
      )),
    });
  }
  const composite = child as ReactElement<{
    color?: ColorValue;
    size?: number;
    style?: StyleProp<TextStyle>;
  }>;
  return cloneElement(composite, {
    color,
    size: iconSize,
    style: [
      buttonTextStyles(
        color,
        fontFamily,
        fontSize,
        lineHeight,
        letterSpacing,
        textStyle,
      ),
      composite.props.style,
    ],
  });
}

function buttonTextStyles(
  color: string,
  fontFamily: string | undefined,
  fontSize: number,
  lineHeight: number,
  letterSpacing: number,
  textStyle: StyleProp<TextStyle>,
): StyleProp<TextStyle> {
  return [
    styles.text,
    {
      color,
      fontFamily,
      fontSize,
      fontWeight: fontFamily?.startsWith('Hermes') ? undefined : '700',
      letterSpacing,
      lineHeight,
    },
    textStyle,
  ];
}

function textContent(node: ReactNode): string {
  let value = '';
  Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      value += String(child);
    }
  });
  return value;
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(value);
}

function renderIcon(node: ReactNode, color: string, size: number) {
  if (!isValidElement(node)) return node;
  return cloneElement(node as ReactElement<{ color?: ColorValue; size?: number }>, {
    color,
    size,
  });
}

const styles = StyleSheet.create({
  pressable: {
    alignSelf: 'flex-start',
    overflow: 'visible',
    position: 'relative',
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    overflow: 'visible',
    position: 'relative',
  },
  text: {
    includeFontPadding: false,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  affix: {
    position: 'absolute',
    top: '50%',
  },
  arc: {
    position: 'absolute',
  },
  bevelTop: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  bevelRight: {
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  bevelBottom: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  bevelLeft: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
});
