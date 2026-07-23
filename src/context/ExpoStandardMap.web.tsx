import type * as Location from 'expo-location';
import { MapPin } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import type { IOSCoordinate, IOSTodayPlace } from '../../modules/hermes-ios-context';
import { IOSPressable } from '../components/ios/IOSPressable';
import { useTheme } from '../design/ThemeProvider';

export interface ExpoStandardMapProps {
  centerRequest: number;
  location: Location.LocationObject | null;
  locale: 'en' | 'zh';
  onLocate(): void;
  places: IOSTodayPlace[];
  track: IOSCoordinate[];
}

export function ExpoStandardMap({ location, locale, onLocate, places, track }: ExpoStandardMapProps) {
  const { tokens } = useTheme();
  const coordinate = location?.coords || track[track.length - 1] || places[0];
  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.card }]}>
      <View style={[styles.grid, { borderColor: tokens.colors.border }]} />
      <MapPin color={tokens.colors.primary} size={30} strokeWidth={1.8} />
      <Text style={[styles.coordinate, { color: tokens.colors.foreground }]}>
        {coordinate
          ? `${Number(coordinate.latitude).toFixed(5)}, ${Number(coordinate.longitude).toFixed(5)}`
          : (locale === 'zh' ? '等待位置' : 'Waiting for location')}
      </Text>
      <IOSPressable
        accessibilityLabel={locale === 'zh' ? '定位到当前位置' : 'Center on current location'}
        onPress={onLocate}
        style={[styles.locate, { borderColor: tokens.colors.border }]}
      >
        <MapPin color={tokens.colors.primary} size={20} strokeWidth={1.9} />
      </IOSPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  coordinate: { fontSize: 13, marginTop: 8 },
  grid: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.45,
  },
  locate: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: 'center',
    position: 'absolute',
    right: 14,
    top: 64,
    width: 42,
  },
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
