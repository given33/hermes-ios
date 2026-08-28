import * as Location from 'expo-location';
import { AlertTriangle, BellOff, ChevronDown, ChevronUp, MapPin, RefreshCw } from 'lucide-react-native';
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
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HermesStandardMapView,
  getNativeMapProviderStatus,
  hasNativeStandardMapView,
  setNativeMapPrivacyConsent,
  type HermesNativeMapProviderStatus,
  type IOSCoordinate,
  type IOSTodayPlace,
} from '../../modules/hermes-ios-context';
import type { HermesApiClient } from '../api/HermesApiClient';
import { NativeButton } from '../components/ui/NativeButton';
import { IOSPressable } from '../components/ios/IOSPressable';
import { ScreenState } from '../components/ui/ScreenState';
import { multiplyAlpha } from '../design/control-contracts';
import { useTheme } from '../design/ThemeProvider';
import {
  IOSIntelligenceApi,
  type IOSActiveForecast,
  type IOSIntelligenceHealth,
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
import {
  isForecastActive,
  normalizeForecast,
  normalizeSnapshot,
} from './smart-weather-snapshot';
import { useIOSPermissionCoordinator } from './IOSContextProvider';
import { ExpoStandardMap } from './ExpoStandardMap';
import { useNotificationHealth } from '../notifications/NotificationProvider';

interface SmartWeatherPageProps {
  client?: HermesApiClient;
  locale: 'en' | 'zh';
  notify(message: string): void;
  onOpenNavigation?(): void;
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
  const [activeForecastFallback, setActiveForecastFallback] = useState<IOSActiveForecast[]>([]);
  const [intelligenceHealth, setIntelligenceHealth] = useState<IOSIntelligenceHealth | null>(null);
  const [learnedPlaceCount, setLearnedPlaceCount] = useState(0);
  const [learnedRouteCount, setLearnedRouteCount] = useState(0);
  const [currentDayKey, setCurrentDayKey] = useState(() => dayKey(new Date()));
  const [loadError, setLoadError] = useState('');
  const [snapshotStale, setSnapshotStale] = useState(false);
  const [mapError, setMapError] = useState('');
  const [mapAttempt, setMapAttempt] = useState(0);
  const [nativeMapProvider, setNativeMapProvider] = useState(
    getNativeMapProviderStatus,
  );
  const [centerRequest, setCenterRequest] = useState(0);
  const [previewLocation, setPreviewLocation] = useState<Location.LocationObject | null>(null);
  const [previewLocationError, setPreviewLocationError] = useState('');
  const [previewLocationState, setPreviewLocationState] = useState<
    'authorized' | 'denied' | 'notDetermined' | 'restricted'
  >('notDetermined');
  const [previewLocationLoading, setPreviewLocationLoading] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const reloadGenerationRef = useRef(0);
  const reloadInFlightRef = useRef(false);
  const previewLocationInFlightRef = useRef(false);
  const nextAutomaticReloadAtRef = useRef(0);
  const onReadyRef = useRef(onReady);
  const readyReportedRef = useRef(false);
  const nativePermissionRequestedRef = useRef(false);
  const permissions = useIOSPermissionCoordinator();
  const notificationHealth = useNotificationHealth();
  onReadyRef.current = onReady;

  const reportReady = useCallback(() => {
    if (readyReportedRef.current) return;
    readyReportedRef.current = true;
    onReadyRef.current?.();
  }, []);

  const requestPreviewLocation = useCallback(async () => {
    if (hasNativeStandardMapView || previewLocationInFlightRef.current) return;
    previewLocationInFlightRef.current = true;
    setPreviewLocationLoading(true);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status === Location.PermissionStatus.UNDETERMINED) {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      const normalized = permission.status === Location.PermissionStatus.GRANTED
        ? 'authorized'
        : permission.status === Location.PermissionStatus.DENIED
          ? 'denied'
          : 'restricted';
      setPreviewLocationState(normalized);
      if (normalized !== 'authorized') return;
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
        mayShowUserSettingsDialog: true,
      });
      setPreviewLocation(location);
      setPreviewLocationError('');
      setCenterRequest((value) => value + 1);
    } catch (error) {
      setPreviewLocationError(locale === 'zh'
        ? `当前位置获取失败：${error instanceof Error ? error.message : String(error)}`
        : `Current location failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      previewLocationInFlightRef.current = false;
      setPreviewLocationLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (!hasNativeStandardMapView) void requestPreviewLocation();
  }, [requestPreviewLocation]);

  useEffect(() => {
    if (!hasNativeStandardMapView || nativePermissionRequestedRef.current) return;
    const location = permissions.snapshot.permissions.location;
    if (location !== 'notDetermined' || permissions.snapshot.phase === 'requesting') return;
    nativePermissionRequestedRef.current = true;
    permissions.retry();
  }, [permissions]);

  const reload = useCallback(async (manual = false) => {
    if (reloadInFlightRef.current) return;
    if (!manual && Date.now() < nextAutomaticReloadAtRef.current) return;
    reloadInFlightRef.current = true;
    const generation = ++reloadGenerationRef.current;
    const requestedDay = dayKey(new Date());
    if (!api) {
      setLoadError(locale === 'zh' ? '尚未连接 Hermes 服务' : 'Hermes is not connected');
      setActiveForecastFallback([]);
      setIntelligenceHealth(null);
      setLearnedPlaceCount(0);
      setLearnedRouteCount(0);
      reloadInFlightRef.current = false;
      reportReady();
      return;
    }
    try {
      const next = normalizeSnapshot(await api.snapshot());
      // These reads are auxiliary to the map snapshot.  A deployed worker may
      // be on an older build (or temporarily restarting), so one missing
      // intelligence endpoint must not blank an otherwise usable map.
      const [healthResult, forecastResult, placesResult, routesResult] = await Promise.allSettled([
        api.health(false),
        api.activeForecast(next.timezone),
        api.learnedPlaces(100),
        api.learnedRoutes('', 100),
      ]);
      if (
        generation !== reloadGenerationRef.current
        || requestedDay !== dayKey(new Date())
      ) return;
      setIntelligenceHealth(
        healthResult.status === 'fulfilled' ? healthResult.value : null,
      );
      setActiveForecastFallback(
        forecastResult.status === 'fulfilled'
          ? normalizeForecastList(forecastResult.value.forecast)
          : [],
      );
      setLearnedPlaceCount(
        placesResult.status === 'fulfilled' && Array.isArray(placesResult.value.places)
          ? placesResult.value.places.length
          : 0,
      );
      setLearnedRouteCount(
        routesResult.status === 'fulfilled' && Array.isArray(routesResult.value.routes)
          ? routesResult.value.routes.length
          : 0,
      );
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
  const snapshotForecasts = snapshot.active_forecasts ?? snapshot.active_forecast ?? [];
  const visibleForecasts = (snapshotForecasts.length ? snapshotForecasts : activeForecastFallback)
    .map(normalizeForecast)
    .filter((forecast) => isForecastActive(forecast, now));
  const intelligenceStatus = intelligenceHealth?.ok
    ? locale === 'zh' ? '智能服务正常' : 'Intelligence healthy'
    : locale === 'zh' ? '智能服务不可用' : 'Intelligence unavailable';

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
  const locationState = hasNativeStandardMapView
    ? permissions.snapshot.permissions.location
    : previewLocationState;
  const locationMessage = hasNativeStandardMapView
    ? permissionMessage(
        permissions.snapshot.phase,
        permissions.snapshot.current,
        locationState,
        permissions.snapshot.locationAlways,
        permissions.snapshot.locationPrecise,
        locale,
      )
    : previewPermissionMessage(
        previewLocationState,
        previewLocationLoading,
        previewLocationError,
        locale,
      );
  const notificationState = permissions.snapshot.permissions.notification;
  const notificationMessage = notificationPermissionMessage(
    notificationState,
    notificationHealth,
    locale,
  );
  const providerMessage = nativeMapProviderMessage(nativeMapProvider, locale);
  const retry = useCallback(() => {
    setMapError('');
    setPreviewLocationError('');
    setMapAttempt((value) => value + 1);
    if (hasNativeStandardMapView) permissions.retry();
    else void requestPreviewLocation();
    void reload(true);
  }, [permissions, reload, requestPreviewLocation]);
  const mapUnavailableMessage = mapError;
  const needsAMapPrivacyConsent = hasNativeStandardMapView
    && nativeMapProvider.amapConfigured
    && !nativeMapProvider.privacyConsent;
  const enableAMap = useCallback(async () => {
    const next = await setNativeMapPrivacyConsent(true);
    setNativeMapProvider(next);
  }, []);

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
            {hasNativeStandardMapView ? (
              <HermesStandardMapView
                amapPrivacyConsentGranted={nativeMapProvider.privacyConsent}
                centerOnUserRequest={centerRequest}
                onLocationPress={() => {
                  if (
                    permissions.snapshot.phase !== 'requesting'
                    && (locationState === 'notDetermined' || locationState === 'limited')
                  ) permissions.retry();
                }}
                onProviderStatus={(event) => setNativeMapProvider(event.nativeEvent)}
                places={places}
                providerResetRequest={mapAttempt}
                showsUserLocation={locationState === 'authorized' || locationState === 'limited'}
                style={StyleSheet.absoluteFill}
                track={track}
              />
            ) : (
              <ExpoStandardMap
                centerRequest={centerRequest}
                location={previewLocation}
                locale={locale}
                onLocate={() => { void requestPreviewLocation(); }}
                places={places}
                track={track}
              />
            )}
          </NativeMapErrorBoundary>
        )}

        {needsAMapPrivacyConsent && !mapUnavailableMessage ? (
          <View style={[styles.bannerStack, { top: insets.top + 12 }]}>
            {needsAMapPrivacyConsent ? (
              <View
                style={[
                  styles.permissionBanner,
                  { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border },
                ]}
                testID="smart-weather-amap-consent"
              >
                <Text style={[styles.permissionText, { color: secondary }]}>
                  {locale === 'zh'
                    ? '高德地图需要处理设备、网络和位置信息来加载中文地图与实时路况。'
                    : 'AMap processes device, network, and location data to load the map and live traffic.'}
                </Text>
                <View style={styles.permissionActions}>
                  <NativeButton
                    accessibilityLabel={locale === 'zh' ? '查看高德隐私政策' : 'View AMap privacy policy'}
                    onPress={() => { void Linking.openURL('https://lbs.amap.com/pages/privacy/'); }}
                    outlined
                    size="sm"
                  >
                    {locale === 'zh' ? '隐私政策' : 'Privacy policy'}
                  </NativeButton>
                  <NativeButton
                    accessibilityLabel={locale === 'zh' ? '同意并启用高德地图' : 'Accept and enable AMap'}
                    onPress={() => { void enableAMap(); }}
                    size="sm"
                  >
                    {locale === 'zh' ? '同意并启用' : 'Accept and enable'}
                  </NativeButton>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
        {!mapUnavailableMessage && (providerMessage || locationMessage || notificationMessage || loadError) ? (
          <View style={[styles.warningRail, { top: insets.top + 118 }]}>
            {providerMessage ? (
              <IOSPressable
                accessibilityLabel={providerMessage}
                haptic="selection"
                onPress={retry}
                style={[styles.warningButton, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border }]}
                testID="smart-weather-provider-warning"
              >
                <AlertTriangle color={tokens.colors.warning} size={18} />
              </IOSPressable>
            ) : null}
            {locationMessage ? (
              <IOSPressable
                accessibilityLabel={locationMessage}
                haptic="selection"
                onPress={() => {
                  if (locationState === 'denied' || locationState === 'restricted') {
                    void (hasNativeStandardMapView ? permissions.openSettings() : Linking.openSettings());
                  } else {
                    retry();
                  }
                }}
                style={[styles.warningButton, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border }]}
                testID="smart-weather-permission-warning"
              >
                <AlertTriangle color={tokens.colors.warning} size={18} />
              </IOSPressable>
            ) : null}
            {notificationMessage ? (
              <IOSPressable
                accessibilityLabel={notificationMessage}
                haptic="selection"
                onPress={() => {
                  if (notificationState === 'denied' || notificationState === 'restricted') {
                    void (hasNativeStandardMapView ? permissions.openSettings() : Linking.openSettings());
                  } else {
                    permissions.retry();
                  }
                }}
                style={[styles.warningButton, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border }]}
                testID="smart-weather-notification-warning"
              >
                <BellOff color={tokens.colors.warning} size={18} />
              </IOSPressable>
            ) : null}
            {loadError ? (
              <IOSPressable
                accessibilityLabel={snapshotStale
                  ? locale === 'zh' ? `显示上次同步数据：${loadError}` : `Showing last-synced data: ${loadError}`
                  : loadError}
                haptic="selection"
                onPress={() => { void reload(true); }}
                style={[styles.warningButton, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border }]}
                testID={snapshotStale ? 'smart-weather-stale-warning' : 'smart-weather-load-warning'}
              >
                <RefreshCw color={tokens.colors.warning} size={18} />
              </IOSPressable>
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
            maxHeight: timelineExpanded ? '76%' : '38%',
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <IOSPressable
          accessibilityLabel={timelineExpanded
            ? locale === 'zh' ? '收起今日地点' : 'Collapse today places'
            : locale === 'zh' ? '展开今日地点' : 'Expand today places'}
          haptic="selection"
          onPress={() => setTimelineExpanded((current) => !current)}
          style={styles.timelineHandle}
        >
          <View style={[styles.timelineHandleBar, { backgroundColor: tokens.colors.textTertiary }]} />
          {timelineExpanded
            ? <ChevronDown color={secondary} size={16} />
            : <ChevronUp color={secondary} size={16} />}
        </IOSPressable>
        <View
          style={[styles.intelligenceSummary, { borderBottomColor: tokens.colors.border }]}
          testID="smart-weather-intelligence-summary"
        >
          <Text style={[styles.intelligenceTitle, { color: foreground }]}>
            {locale === 'zh' ? 'Hermes 智能状态' : 'Hermes intelligence'}
          </Text>
          <Text style={[styles.intelligenceBody, { color: secondary }]}>
            {`${intelligenceStatus} · ${locale === 'zh' ? '地点' : 'Places'} ${learnedPlaceCount} · ${locale === 'zh' ? '路线' : 'Routes'} ${learnedRouteCount}`}
          </Text>
        </View>
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
          {todayPlaces.length >= 2 ? (
            <DailyRouteCurve
              end={todayPlaces[todayPlaces.length - 1]?.name || (locale === 'zh' ? '当前位置' : 'Current')}
              foreground={foreground}
              secondary={secondary}
              start={todayPlaces[0]?.name || (locale === 'zh' ? '起点' : 'Start')}
            />
          ) : null}
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

function nativeMapProviderMessage(
  status: HermesNativeMapProviderStatus,
  locale: 'en' | 'zh',
): string {
  if (status.phase !== 'degraded' && status.phase !== 'failed') return '';
  if (status.phase === 'degraded') {
    return locale === 'zh'
      ? '高德地图加载失败，已切换到 Apple 地图。点按重试'
      : 'AMap failed to load. Apple Maps is active; tap to retry.';
  }
  return locale === 'zh'
    ? '地图服务加载失败。点按重试'
    : 'The map provider failed to load; tap to retry.';
}

function DailyRouteCurve({
  end,
  foreground,
  secondary,
  start,
}: {
  end: string;
  foreground: string;
  secondary: string;
  start: string;
}) {
  return (
    <View style={styles.routeCurve}>
      <Svg height={54} width={104}>
        <Path
          d="M 10 42 C 34 3, 72 3, 94 42"
          fill="none"
          stroke={secondary}
          strokeDasharray="4 4"
          strokeLinecap="round"
          strokeWidth={2}
        />
        <Circle cx={10} cy={42} fill={foreground} r={4} />
        <Circle cx={94} cy={42} fill={foreground} r={4} />
      </Svg>
      <View style={styles.routeCurveLabels}>
        <Text numberOfLines={1} style={[styles.routeCurveLabel, { color: foreground }]}>{start}</Text>
        <Text numberOfLines={1} style={[styles.routeCurveLabel, styles.routeCurveLabelEnd, { color: foreground }]}>{end}</Text>
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

function previewPermissionMessage(
  state: 'authorized' | 'denied' | 'notDetermined' | 'restricted',
  loading: boolean,
  error: string,
  locale: 'en' | 'zh',
): string {
  if (error) return error;
  if (state === 'denied' || state === 'restricted') {
    return locale === 'zh'
      ? '定位权限未开启，请允许访问位置后重试。'
      : 'Location permission is off. Allow location access, then retry.';
  }
  if (loading || state === 'notDetermined') {
    return locale === 'zh' ? '正在请求定位权限并获取当前位置' : 'Requesting location and finding your position';
  }
  return '';
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

function notificationPermissionMessage(
  state: string,
  health: string,
  locale: 'en' | 'zh',
): string {
  if (state === 'denied' || state === 'restricted') {
    return locale === 'zh'
      ? '天气通知权限未开启；请在系统设置中允许通知。'
      : 'Weather notifications are disabled. Allow notifications in Settings.';
  }
  if (state === 'unavailable') {
    return locale === 'zh'
      ? '此安装包暂不支持天气通知。'
      : 'Weather notifications are unavailable in this build.';
  }
  if (health === 'error') {
    return locale === 'zh'
      ? '天气通知连接失败，正在后台自动重试。'
      : 'Weather notification registration failed and will retry automatically.';
  }
  return '';
}

function smartWeatherErrorMessage(error: unknown, locale: 'en' | 'zh'): string {
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
  if (status === 404 || status === 503) {
    return locale === 'zh'
      ? '服务器智能天气服务暂不可用，地图和定位仍可继续使用。'
      : 'The Smart Weather service is temporarily unavailable. Map and location remain usable.';
  }
  return locale === 'zh'
    ? '智能天气数据加载失败，请重试。'
    : 'Smart Weather data failed to load. Try again.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function normalizeForecastList(value: unknown): IOSActiveForecast[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    try {
      return [normalizeForecast(entry)];
    } catch {
      // A malformed optional forecast should not prevent the map and place
      // timeline from rendering. The next scheduled reload can recover it.
      return [];
    }
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  bannerStack: {
    gap: 8,
    left: 0,
    position: 'absolute',
    // Keep the persistent compass and locate controls unobstructed. The
    // banners render above the native map, so a full-width banner would cover
    // the compass even though the native control remained mounted.
    right: 58,
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
  warningRail: { gap: 7, position: 'absolute', right: 10 },
  warningButton: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  timeline: {
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    paddingHorizontal: 16,
    paddingTop: 4,
    position: 'absolute',
    right: 0,
  },
  timelineHandle: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 30 },
  timelineHandleBar: { borderRadius: 2, height: 4, opacity: 0.45, width: 42 },
  intelligenceSummary: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 8 },
  intelligenceTitle: { fontSize: 14, fontWeight: '600' },
  intelligenceBody: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  forecast: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 10 },
  forecastTitle: { fontSize: 16, fontWeight: '600' },
  forecastBody: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 10 },
  placeList: { gap: 9, paddingBottom: 2 },
  routeCurve: { minHeight: 72, paddingHorizontal: 2, position: 'relative' },
  routeCurveLabels: { bottom: 1, flexDirection: 'row', justifyContent: 'space-between', left: 0, position: 'absolute', right: 0 },
  routeCurveLabel: { fontSize: 11, maxWidth: '44%' },
  routeCurveLabelEnd: { textAlign: 'right' },
  placeRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 38 },
  placeText: { flex: 1, minWidth: 0 },
  placeName: { fontSize: 14, fontWeight: '500' },
  placeTime: { fontSize: 12, marginTop: 2 },
  empty: { fontSize: 13, paddingBottom: 10 },
});
