import multiavatar from '@multiavatar/multiavatar';
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useTheme } from '../../design/ThemeProvider';

interface StudioProfileAvatarProps {
  seed: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

// Native port of Hermes Studio's ProfileAvatar.vue. Keeping generation local
// prevents profile images from flashing blank during route transitions.
export function StudioProfileAvatar({
  seed,
  size = 24,
  style,
}: StudioProfileAvatarProps) {
  const { tokens } = useTheme();
  const svg = useMemo(() => multiavatar(seed || 'Hermes Woman'), [seed]);
  return (
    <View
      accessibilityIgnoresInvertColors
      style={[
        styles.root,
        {
          backgroundColor: tokens.colors.secondary,
          borderRadius: size / 2,
          height: size,
          width: size,
        },
        style,
      ]}
    >
      <SvgXml height={size} width={size} xml={svg} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
