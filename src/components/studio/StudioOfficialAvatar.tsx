import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '../../design/ThemeProvider';

const HERMES_AGENT_AVATAR = require('../../../assets/icon.png');
const HERMES_STUDIO_AVATAR = require('../../../assets/third-party/hermes-studio/logo.png');

interface StudioOfficialAvatarProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
  variant?: 'agent' | 'studio';
}

/** Bundled avatars stay available while routes remount or the network changes. */
export function StudioOfficialAvatar({
  size = 24,
  style,
  variant = 'agent',
}: StudioOfficialAvatarProps) {
  const { tokens } = useTheme();
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
      <Image
        resizeMode="cover"
        source={variant === 'studio' ? HERMES_STUDIO_AVATAR : HERMES_AGENT_AVATAR}
        style={{ height: size, width: size }}
      />
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
