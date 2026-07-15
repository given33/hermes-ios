import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { resolveNativeFontStack } from '../../design/native-font-faces';
import { useTheme } from '../../design/ThemeProvider';

export function IOSTimePicker({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange(value: Date): void;
  value: Date;
}) {
  const { theme, tokens } = useTheme();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const handleChange = (event: DateTimePickerEvent, next?: Date) => {
    if (event.type !== 'set' || !next) return;
    onChange(next);
  };

  return (
    <View style={styles.row}>
      <Text
        style={{
          color: tokens.colors.textSecondary,
          fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 500),
          fontSize: rootSize * 0.72,
          lineHeight: rootSize,
        }}
      >
        {label}
      </Text>
      <DateTimePicker
        accentColor={tokens.colors.primary}
        display={Platform.OS === 'ios' ? 'compact' : 'default'}
        is24Hour
        mode="time"
        onChange={handleChange}
        textColor={tokens.colors.foreground}
        themeVariant={isLightHex(theme.palette.background.hex) ? 'light' : 'dark'}
        value={value}
      />
    </View>
  );
}

function isLightHex(value: string): boolean {
  const hex = value.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150;
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
});
