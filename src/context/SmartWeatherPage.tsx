import { MapPin } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HermesStandardMapView, type IOSCoordinate, type IOSTodayPlace } from '../../modules/hermes-ios-context';
import type { HermesApiClient } from '../api/HermesApiClient';
import { useTheme } from '../design/ThemeProvider';
import {
  IOSIntelligenceApi,
  type IOSActiveForecast,
  type IOSIntelligenceSnapshot,
} from './IOSIntelligenceApi';

interface SmartWeatherPageProps {
  client?: HermesApiClient;
  locale: 'en' | 'zh';
  notify(message: string): void;
  onReady?(): void;
}

const EMPTY: IOSIntelligenceSnapshot = {
  date: '',
  timezone: 'Asia/Shanghai',
  trajectory: [],
  places: [],
};

export function SmartWeatherPage({ client, locale, notify, onReady }: SmartWeatherPageProps) {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const api = useMemo(() => client ? new IOSIntelligenceApi(client) : null, [client]);
  const [snapshot, setSnapshot] = useState<IOSIntelligenceSnapshot>(EMPTY);
  const [localDayKey, setLocalDayKey] = useState(() => dayKey(new Date()));

  const reload = useCallback(async () => {
    if (!api) {
      onReady?.();
      return;
    }
    try {
      setSnapshot(await api.snapshot());
    } catch (error) {
      notify(error instanceof Error ? error.message : (locale === 'zh' ? '智能天气加载失败' : 'Smart Weather failed to load'));
    } finally {
      onReady?.();
    }
  }, [api, locale, notify, onReady]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => { void reload(); }, 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = dayKey(new Date());
      setLocalDayKey((current) => {
        if (current === next) return current;
        // The cloud keeps the immutable history; the native surface starts a
        // fresh local-day view as soon as the device crosses midnight.
        setSnapshot((previous) => ({
          ...previous,
          trajectory: [],
          places: [],
        }));
        return next;
      });
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const todayTrajectory = snapshot.trajectory.filter((point) => dayKey(new Date(normalizeTimestamp(point.observed_at))) === localDayKey);
  const todayPlaces = snapshot.places.filter((place) => dayKey(new Date(normalizeTimestamp(place.arrived_at))) === localDayKey);
  const visibleForecasts = (snapshot.active_forecasts || snapshot.active_forecast || [])
    .map(normalizeForecast)
    .filter((forecast) => !forecast.expires_at || normalizeTimestamp(forecast.expires_at) > Date.now());

  const track: IOSCoordinate[] = todayTrajectory.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
    timestamp: normalizeTimestamp(point.observed_at),
  }));
  const places: IOSTodayPlace[] = todayPlaces.flatMap((place) => (
    typeof place.latitude === 'number' && typeof place.longitude === 'number'
      ? [{
          arrivedAt: normalizeTimestamp(place.arrived_at),
          ...(place.departed_at ? { departedAt: normalizeTimestamp(place.departed_at) } : {}),
          id: place.place_id,
          latitude: place.latitude,
          longitude: place.longitude,
          name: place.name || (locale === 'zh' ? '停留地点' : 'Visited place'),
        }]
      : []
  ));
  const foreground = tokens.colors.foreground;
  const secondary = tokens.colors.textSecondary;

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <HermesStandardMapView
        places={places}
        showsUserLocation
        style={StyleSheet.absoluteFill}
        track={track}
      />

      <View
        style={[
          styles.timeline,
          {
            backgroundColor: tokens.colors.background,
            borderColor: tokens.colors.border,
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        {visibleForecasts.map((forecast, index) => (
          <View
            key={forecast.id || `${forecast.starts_at || 0}:${index}`}
            style={[styles.forecast, { borderBottomColor: tokens.colors.border }]}
          >
            <Text style={[styles.forecastTitle, { color: foreground }]}>
              {forecast.title || (locale === 'zh' ? '出行天气' : 'Travel weather')}
            </Text>
            <Text numberOfLines={2} style={[styles.forecastBody, { color: secondary }]}>
              {forecast.summary || ''}
            </Text>
          </View>
        ))}
        <Text style={[styles.sectionTitle, { color: foreground }]}>
          {locale === 'zh' ? '今天到过的地方' : 'Places visited today'}
        </Text>
        <ScrollView contentContainerStyle={styles.placeList} showsVerticalScrollIndicator={false}>
          {todayPlaces.length ? todayPlaces.map((place) => (
            <View key={`${place.place_id}:${place.arrived_at}`} style={styles.placeRow}>
              <MapPin color={secondary} size={16} />
              <View style={styles.placeText}>
                <Text numberOfLines={1} style={[styles.placeName, { color: foreground }]}>
                  {place.name || (locale === 'zh' ? '停留地点' : 'Visited place')}
                </Text>
                <Text style={[styles.placeTime, { color: secondary }]}>
                  {formatRange(place.arrived_at, place.departed_at, locale)}
                </Text>
              </View>
            </View>
          )) : (
            <Text style={[styles.empty, { color: secondary }]}>
              {locale === 'zh' ? '今天还没有停留地点' : 'No visited places yet today'}
            </Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function normalizeTimestamp(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function normalizeForecast(forecast: IOSActiveForecast): IOSActiveForecast {
  const nested = forecast.data || {};
  return {
    ...forecast,
    ...nested,
    summary: nested.summary ?? nested.body ?? forecast.summary,
    starts_at: forecast.starts_at ?? forecast.valid_from ?? nested.starts_at,
    expires_at: forecast.expires_at ?? forecast.valid_until ?? nested.expires_at,
  };
}

function dayKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
}

function formatRange(start: number, end: number | null | undefined, locale: 'en' | 'zh') {
  const formatter = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const left = formatter.format(new Date(normalizeTimestamp(start)));
  const right = end
    ? formatter.format(new Date(normalizeTimestamp(end)))
    : locale === 'zh' ? '现在' : 'Now';
  const elapsed = Math.max(0, normalizeTimestamp(end ?? Date.now()) - normalizeTimestamp(start));
  const minutes = Math.round(elapsed / 60_000);
  const duration = minutes >= 60
    ? `${Math.floor(minutes / 60)}${locale === 'zh' ? '小时' : 'h'} ${minutes % 60}${locale === 'zh' ? '分钟' : 'm'}`
    : `${minutes}${locale === 'zh' ? '分钟' : 'm'}`;
  return `${left} - ${right} · ${locale === 'zh' ? '停留' : 'Stayed'} ${duration}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  timeline: {
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    maxHeight: '38%',
    paddingHorizontal: 16,
    paddingTop: 12,
    position: 'absolute',
    right: 0,
  },
  forecast: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 10 },
  forecastTitle: { fontSize: 16, fontWeight: '600' },
  forecastBody: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 10 },
  placeList: { gap: 9, paddingBottom: 2 },
  placeRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 38 },
  placeText: { flex: 1, minWidth: 0 },
  placeName: { fontSize: 14, fontWeight: '500' },
  placeTime: { fontSize: 12, marginTop: 2 },
  empty: { fontSize: 13, paddingBottom: 10 },
});
