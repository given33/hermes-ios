import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { HermesApiClient } from '../api/HermesApiClient';
import type { NativeRouteLocale } from '../app/route-composition';
import { useHermesSwiftUIRouteData } from '../app/useHermesSwiftUIRouteData';
import { NativeButton } from '../components/ui/NativeButton';
import { ScreenState } from '../components/ui/ScreenState';
import { useTheme } from '../design/ThemeProvider';
import { PreviewText } from './PreviewPrimitives';

/**
 * Live API-backed fallback for Expo Go and other builds without the optional
 * SwiftUI route module. It intentionally consumes the same route snapshot and
 * action controller as the native shell, so an unavailable native renderer
 * never falls back to fixture data or an unusable error page.
 */
export function LiveRouteFallbackPage({
  cacheOwner,
  client,
  locale,
  notify,
  profile,
  routeId,
}: {
  cacheOwner: string;
  client?: HermesApiClient;
  locale: NativeRouteLocale;
  notify(message: string): void;
  profile: string;
  routeId: string;
}) {
  const { tokens } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const routeData = useHermesSwiftUIRouteData({
    cacheOwner,
    client,
    locale,
    notify,
    profile,
    routeId,
  });
  const snapshot = useMemo(() => {
    try {
      return JSON.parse(routeData.dataJson) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [routeData.dataJson]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await routeData.reload();
    } finally {
      setRefreshing(false);
    }
  }, [routeData]);
  if (!client) {
    return <ScreenState kind="error" message={locale === 'zh' ? '需要登录后加载此页面。' : 'Sign in to load this page.'} />;
  }
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      testID="live-route-fallback"
    >
      <View style={styles.header}>
        <View style={styles.heading}>
          <PreviewText variant="heading">{routeId}</PreviewText>
          <PreviewText color={tokens.colors.textSecondary} variant="muted">
            {locale === 'zh' ? '实时 Hermes 数据' : 'Live Hermes data'}
          </PreviewText>
        </View>
        <NativeButton
          disabled={refreshing}
          onPress={() => void refresh()}
          outlined
          size="sm"
        >
          {refreshing ? (locale === 'zh' ? '刷新中' : 'Refreshing') : (locale === 'zh' ? '刷新' : 'Refresh')}
        </NativeButton>
      </View>
      {snapshot ? (
        <View style={[styles.payload, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
          <PreviewText color={tokens.colors.textSecondary} variant="mono">
            {JSON.stringify(snapshot, null, 2)}
          </PreviewText>
        </View>
      ) : (
        <ScreenState kind="loading" message={locale === 'zh' ? '正在加载 Hermes 数据…' : 'Loading Hermes data…'} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, padding: 16 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  heading: { flex: 1, gap: 2, minWidth: 0 },
  payload: { borderRadius: 8, borderWidth: 1, padding: 12 },
});
