import { MapPin, RefreshCw, Settings } from 'lucide-react-native';
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HermesStandardMapView,
  hasNativeStandardMapView,
  type IOSCoordinate,
  type IOSTodayPlace,
} from '../../modules/hermes-ios-context';
import type { HermesApiClient } from '../api/HermesApiClient';
import { NativeButton } from '../components/ui/NativeButton';
import { ScreenState } from '../components/ui/ScreenState';
import { useTheme } from '../design/ThemeProvider';
import {
  IOSIntelligenceApi,
  type IOSActiveForecast,
  type IOSIntelligenceSnapshot,
} from './IOSIntelligenceApi';
import {
  dayKey,
  normalizeTimestamp,
  timestampOverlapsLocalDay,
} from './smart-weather-day';
import {
  smartWeatherLoadErrorMessage,
  smartWeatherRetryDelayMs,
} from './smart-weather-load';
import { useIOSPermissionCoordinator } from './IOSContextProvider';

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

export function SmartWeatherPage({ client, locale, onReady }: SmartWeatherPageProps) {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const api = useMemo(() => client ? new IOSIntelligenceApi(client) : null, [client]);
  const [snapshot, setSnapshot] = useState<IOSIntelligenceSnapshot>(EMPTY);
  const [currentDayKey, setCurrentDayKey] = useState(() => dayKey(new Date()));
  const [loadError, setLoadError] = useState('');
  const [snapshotStale, setSnapshotStale] = useState(false);
  const [mapError, setMapError] = useState('');
  const [mapAttempt, setMapAttempt] = useState(0);
  const [centerRequest, setCenterRequest] = useState(0);
  const reloadGenerationRef = useRef(0);
  const reloadInFlightRef = useRef(false);
  const nextAutomaticReloadAtRef = useRef(0);
  const onReadyRef = useRef(onReady);
  const readyReportedRef = useRef(false);
  const permissions = useIOSPermissionCoordinator();
  onReadyRef.current = onReady;

  const reportReady = useCallback(() => {
    if (readyReportedRef.current) return;
    readyReportedRef.current = true;
    onReadyRef.current?.();
  }, []);

  const reload = useCallback(async (manual = false) => {
    if (reloadInFlightRef.current) return;
    if (!manual && Date.now() < nextAutomaticReloadAtRef.current) return;
    reloadInFlightRef.current = true;
    const generation = ++reloadGenerationRef.current;
    const requestedDay = dayKey(new Date());
    if (!api) {
      setLoadError(locale === 'zh' ? '尚未连接 Hermes 服务' : 'Hermes is not connected');
      reloadInFlightRef.current = false;
      reportReady();
      return;
    }
    try {
      const next = await api.snapshot();
      if (
        generation !== reloadGenerationRef.current
        || requestedDay !== dayKey(new Date())
      ) return;
      setSnapshot(next);
      setLoadError('');
      setSnapshotStale(false);
      nextAutomaticReloadAtRef.current = 0;
    } catch (error) {
      if (
        generation !== reloadGenerationRef.current
        || requestedDay !== dayKey(new Date())
      ) return;
      const message = smartWeatherLoadErrorMessage(error, locale);
      // Keep last-good data only when we already had a successful snapshot;
      // mark it stale so the UI never presents failed reloads as live weather.
      setSnapshot((previous) => {
        if (previous.date !== '') {
          setSnapshotStale(true);
          return previous;
        }
        setSnapshotStale(false);
        return EMPTY;
      });
      setLoadError(message);
      nextAutomaticReloadAtRef.current = Date.now() + smartWeatherRetryDelayMs(error);
    } finally {
      if (generation === reloadGenerationRef.current) {
        reportReady();
      }
      reloadInFlightRef.current = false;
    }
  }, [api, locale, reportReady]);

  useEffect(() => {
    void reload(false);
    const timer = setInterval(() => { void reload(false); }, 30_000);
    return () => {
      reloadGenerationRef.current += 1;
      clearInterval(timer);
    };
  }, [reload]);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = dayKey(new Date());
      setCurrentDayKey((current) => {
        if (current === next) return current;
        // The cloud keeps the immutable history; the native surface starts a
        // fresh local-day view as soon as the device crosses midnight and
        // immediately reloads so yesterday's forecasts do not linger.
        setSnapshot(EMPTY);
        setSnapshotStale(false);
        void reload(false);
        return next;
      });
    }, 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  const effectiveDayKey = snapshot.date && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.date)
    ? snapshot.date
    : currentDayKey;
  const todayTrajectory = snapshot.trajectory.filter((point) => (
    dayKey(new Date(normalizeTimestamp(point.observed_at))) === effectiveDayKey
  ));
  const todayPlaces = snapshot.places.filter((place) => timestampOverlapsLocalDay(
    place.arrived_at,
    place.departed_at,
    effectiveDayKey,
  ));
  const now = Date.now();
  const visibleForecasts = (snapshot.active_forecasts || snapshot.active_forecast || [])
    .map(normalizeForecast)
    .filter((forecast) => {
      const expires = forecast.expires_at ? normalizeTimestamp(forecast.expires_at) : null;
      const starts = forecast.starts_at ? normalizeTimestamp(forecast.starts_at) : null;
      // Incomplete validity windows are not treated as live travel weather.
      if (expires === null && starts === null) return false;
      if (expires !== null && expires <= now) return false;
      return true;
    });

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
  const locationState = permissions.snapshot.permissions.location;
  const locationMessage = permissionMessage(
    permissions.snapshot.phase,
    permissions.snapshot.current,
    locationState,
    permissions.snapshot.locationAlways,
    permissions.snapshot.locationPrecise,
    locale,
  );
  const retry = useCallback(() => {
    setMapError('');
    setMapAttempt((value) => value + 1);
    permissions.retry();
    void reload(true);
  }, [permissions, reload]);
  const mapUnavailableMessage = mapError || (!hasNativeStandardMapView
    ? (locale === 'zh'
      ? '当前安装包缺少智能天气原生地图组件，请安装最新构建后重试。'
      : 'This build is missing the native Smart Weather map. Install the latest build and retry.')
    : '');

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <View style={StyleSheet.absoluteFill}>
        {mapUnavailableMessage ? (
          <ScreenState
            kind="error"
            message={mapUnavailableMessage}
            onRetry={retry}
            retryLabel={locale === 'zh' ? '重试' : 'Retry'}
            testID="smart-weather-map-error"
          />
        ) : (
          <NativeMapErrorBoundary
            fallback={(
              <ScreenState
                kind="error"
                message={locale === 'zh' ? '原生地图加载失败' : 'The native map failed to load'}
                onRetry={retry}
                retryLabel={locale === 'zh' ? '重试' : 'Retry'}
              />
            )}
            onError={(error) => setMapError(error.message)}
            resetKey={mapAttempt}
          >
            <HermesStandardMapView
              centerOnUserRequest={centerRequest}
              onLocationPress={() => {
                setCenterRequest((value) => value + 1);
                if (
                  permissions.snapshot.phase !== 'requesting'
                  && (locationState === 'notDetermined' || locationState === 'limited')
                ) permissions.retry();
              }}
              places={places}
              showsUserLocation={locationState === 'authorized' || locationState === 'limited'}
              style={StyleSheet.absoluteFill}
              track={track}
            />
          </NativeMapErrorBoundary>
        )}

        {(locationMessage || loadError) && !mapUnavailableMessage ? (
          <View style={[styles.bannerStack, { top: insets.top + 12 }]}>
            {locationMessage ? (
              <View
                style={[
                  styles.permissionBanner,
                  { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border },
                ]}
                testID="smart-weather-permission-status"
              >
                <Text style={[styles.permissionText, { color: secondary }]}>{locationMessage}</Text>
                <View style={styles.permissionActions}>
                  <NativeButton
                    accessibilityLabel={locale === 'zh' ? '重试位置权限' : 'Retry location permission'}
                    onPress={retry}
                    outlined
                    prefix={<RefreshCw color={foreground} size={15} />}
                    size="sm"
                  >
                    {locale === 'zh' ? '重试' : 'Retry'}
                  </NativeButton>
                  {(locationState === 'denied' || locationState === 'restricted') ? (
                    <NativeButton
                      accessibilityLabel={locale === 'zh' ? '打开系统设置' : 'Open system settings'}
                      onPress={() => { void permissions.openSettings(); }}
                      outlined
                      prefix={<Settings color={foreground} size={15} />}
                      size="sm"
                    >
                      {locale === 'zh' ? '设置' : 'Settings'}
                    </NativeButton>
                  ) : null}
                </View>
              </View>
            ) : null}
            {loadError ? (
              <View
                style={[
                  styles.permissionBanner,
                  { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border },
                ]}
                testID={snapshotStale ? 'smart-weather-stale-banner' : 'smart-weather-load-error'}
              >
                <Text style={[styles.permissionText, { color: secondary }]}>
                  {snapshotStale
                    ? locale === 'zh'
                      ? `显示上次同步的数据：${loadError}`
                      : `Showing last-synced data: ${loadError}`
                    : loadError}
                </Text>
                <NativeButton
                  accessibilityLabel={locale === 'zh' ? '重新加载' : 'Reload'}
                  onPress={() => { void reload(true); }}
                  outlined
                  prefix={<RefreshCw color={foreground} size={15} />}
                  size="sm"
                >
                  {locale === 'zh' ? '重试' : 'Retry'}
                </NativeButton>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

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

interface NativeMapErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError(error: Error): void;
  resetKey: number;
}

class NativeMapErrorBoundary extends Component<NativeMapErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error);
  }

  componentDidUpdate(previous: NativeMapErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function permissionMessage(
  phase: string,
  current: string | null,
  state: string,
  always: boolean,
  precise: boolean,
  locale: 'en' | 'zh',
): string {
  if (state === 'denied' || state === 'restricted') {
    return locale === 'zh'
      ? '定位权限未开启，当前位置和新轨迹暂不可用。'
      : 'Location permission is off. Current location and new tracks are unavailable.';
  }
  if (state === 'unavailable') {
    return locale === 'zh'
      ? '此设备或安装包不支持定位能力。'
      : 'Location is unavailable on this device or build.';
  }
  if (state === 'notDetermined' || (phase === 'paused' && current === 'location')) {
    if (phase === 'requesting' || phase === 'idle') {
      return locale === 'zh' ? '正在确认定位权限' : 'Checking location permission';
    }
    return locale === 'zh'
      ? '定位授权尚未完成，完成系统提示后可重试。'
      : 'Location authorization is unfinished. Complete the system prompt, then retry.';
  }
  // Once location itself is usable, later HealthKit/EventKit prompts must not
  // leave the map covered by a generic permission-in-progress banner.
  if (!always || !precise || state === 'limited') {
    return locale === 'zh'
      ? '定位权限受限；请开启“始终”和“精确位置”以恢复完整轨迹。'
      : 'Location is limited. Enable Always and Precise Location for complete tracks.';
  }
  return '';
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
  bannerStack: {
    gap: 8,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  permissionBanner: {
    alignItems: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  permissionText: { fontSize: 12, lineHeight: 17 },
  permissionActions: { alignSelf: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
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
