import type * as Location from 'expo-location';
import { Compass, MapPin } from 'lucide-react-native';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, type Region } from 'react-native-maps';

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

export function ExpoStandardMap({
  centerRequest,
  location,
  locale,
  onLocate,
  places,
  track,
}: ExpoStandardMapProps) {
  const { tokens } = useTheme();
  const mapRef = useRef<MapView>(null);
  const fallbackCoordinate = track[track.length - 1]
    || places[0]
    || { latitude: 35, longitude: 104 };
  const currentCoordinate = location
    ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
    : fallbackCoordinate;
  const initialRegionRef = useRef<Region>({
    latitude: fallbackCoordinate.latitude,
    latitudeDelta: track.length || places.length ? 0.02 : 24,
    longitude: fallbackCoordinate.longitude,
    longitudeDelta: track.length || places.length ? 0.02 : 24,
  });

  useEffect(() => {
    if (!centerRequest && !location) return;
    mapRef.current?.animateToRegion({
      latitude: currentCoordinate.latitude,
      latitudeDelta: 0.012,
      longitude: currentCoordinate.longitude,
      longitudeDelta: 0.012,
    }, 320);
  }, [centerRequest, currentCoordinate.latitude, currentCoordinate.longitude, location]);

  const resetNorth = useCallback(() => {
    mapRef.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 240 });
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        initialRegion={initialRegionRef.current}
        mapType="standard"
        pitchEnabled={false}
        ref={mapRef}
        rotateEnabled
        showsBuildings={false}
        showsCompass={false}
        showsIndoors={false}
        showsPointsOfInterest
        showsScale
        showsTraffic
        showsUserLocation={Boolean(location)}
        style={StyleSheet.absoluteFill}
        toolbarEnabled={false}
      >
        {track.length > 1 ? <Polyline coordinates={track} strokeColor="#0A84FF" strokeWidth={4} /> : null}
        {places.map((place) => (
          <Marker
            coordinate={{ latitude: place.latitude, longitude: place.longitude }}
            description={place.name}
            key={place.id}
            pinColor="#0A84FF"
            title={place.name}
          />
        ))}
        {location && typeof location.coords.accuracy === 'number' ? (
          <Circle
            center={currentCoordinate}
            fillColor="rgba(10,132,255,0.12)"
            radius={Math.max(1, location.coords.accuracy)}
            strokeColor="rgba(10,132,255,0.45)"
            strokeWidth={1}
          />
        ) : null}
      </MapView>
      <IOSPressable
        accessibilityLabel={locale === 'zh' ? '地图恢复朝北' : 'Reset map to north'}
        onPress={resetNorth}
        style={[styles.compass, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}
      >
        <Compass color={tokens.colors.foreground} size={21} strokeWidth={1.9} />
      </IOSPressable>
      <IOSPressable
        accessibilityLabel={locale === 'zh' ? '定位到当前位置' : 'Center on current location'}
        onPress={onLocate}
        style={[styles.locate, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}
      >
        <MapPin color={tokens.colors.primary} size={21} strokeWidth={1.9} />
      </IOSPressable>
    </View>
  );
}

const control = {
  alignItems: 'center' as const,
  borderRadius: 8,
  borderWidth: StyleSheet.hairlineWidth,
  height: 42,
  justifyContent: 'center' as const,
  position: 'absolute' as const,
  right: 14,
  width: 42,
};

const styles = StyleSheet.create({
  compass: { ...control, top: 14 },
  // Smart Weather's opaque places timeline occupies the bottom of the map.
  // Keep Locate in the same stable top stack as the compass so it stays
  // visible and tappable regardless of timeline height.
  locate: { ...control, top: 64 },
});
