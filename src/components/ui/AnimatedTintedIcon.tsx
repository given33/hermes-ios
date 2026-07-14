import MaskedView from '@react-native-masked-view/masked-view';
import type { LucideProps } from 'lucide-react-native';
import {
  cloneElement,
  type ReactElement,
} from 'react';
import {
  StyleSheet,
  type DimensionValue,
  type ViewStyle,
} from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

export interface AnimatedTintedIconProps {
  color: SharedValue<string>;
  icon: ReactElement<LucideProps>;
}

export function AnimatedTintedIcon({
  color,
  icon,
}: AnimatedTintedIconProps) {
  const size = icon.props.size ?? 24;
  const iconStyle = StyleSheet.flatten(icon.props.style) as ViewStyle | undefined;
  const width = (
    icon.props.width ?? iconStyle?.width ?? size
  ) as DimensionValue;
  const height = (
    icon.props.height ?? iconStyle?.height ?? size
  ) as DimensionValue;
  const animatedFillStyle = useAnimatedStyle(() => ({
    backgroundColor: color.value,
  }));

  return (
    <MaskedView
      maskElement={cloneElement(icon, {
        color: '#000000',
        height: height as LucideProps['height'],
        style: undefined,
        width: width as LucideProps['width'],
      })}
      pointerEvents="none"
      style={[icon.props.style, { height, width }]}
    >
      <Reanimated.View style={[StyleSheet.absoluteFill, animatedFillStyle]} />
    </MaskedView>
  );
}
