import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { HermesApiClient } from '../api/HermesApiClient';
import { HermesCloudApi } from '../api/HermesCloudApi';
import {
  decodeHermesSwiftUIRouteAction,
  encodeHermesSwiftUIRouteSnapshot,
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
} from './swiftui-route-contract';
import {
  loadHermesSwiftUIRouteSnapshot,
  performHermesSwiftUIRouteAction,
} from './hermes-route-data';

interface UseHermesSwiftUIRouteDataOptions {
  client?: HermesApiClient;
  locale: 'en' | 'zh';
  notify(message: string): void;
  profile: string;
  routeId: string;
}

interface HermesSwiftUIRouteDataController {
  dataJson: string;
  onAction(action: string, payloadJson: string): Promise<void>;
  reload(): Promise<void>;
}

const FOREGROUND_REFRESH_MS = 15_000;

export function useHermesSwiftUIRouteData({
  client,
  locale,
  notify,
  profile,
  routeId,
}: UseHermesSwiftUIRouteDataOptions): HermesSwiftUIRouteDataController {
  const api = useMemo(() => client ? new HermesCloudApi(client) : null, [client]);
  const requestVersion = useRef(0);
  const selectedItemId = useRef('');
  const [dataJson, setDataJson] = useState(() => encodeHermesSwiftUIRouteSnapshot({
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: routeId,
  }));

  const reload = useCallback(async () => {
    if (!api) return;
    const version = ++requestVersion.current;
    try {
      const snapshot = await loadHermesSwiftUIRouteSnapshot(
        api,
        routeId,
        profile,
        selectedItemId.current,
        locale === 'zh',
      );
      if (version !== requestVersion.current) return;
      setDataJson(encodeHermesSwiftUIRouteSnapshot(snapshot));
    } catch (error) {
      if (version !== requestVersion.current) return;
      notify(serverErrorMessage(error));
    }
  }, [api, locale, notify, profile, routeId]);

  useEffect(() => {
    requestVersion.current += 1;
    selectedItemId.current = '';
    setDataJson(encodeHermesSwiftUIRouteSnapshot({
      version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
      route: routeId,
    }));
    void reload();
    if (!api) return undefined;

    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void reload();
    }, FOREGROUND_REFRESH_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    return () => {
      requestVersion.current += 1;
      clearInterval(interval);
      appState.remove();
    };
  }, [api, reload, routeId]);

  const onAction = useCallback(async (action: string, payloadJson: string) => {
    if (!api) return;
    const event = decodeHermesSwiftUIRouteAction(action, payloadJson);
    if (!event) {
      notify('无法识别页面操作，请刷新后重试。');
      return;
    }
    if (
      (
        event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.fileSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.sessionSelect
      )
      && event.payload.id
    ) {
      selectedItemId.current = event.payload.id;
      await reload();
      return;
    }
    try {
      const result = await performHermesSwiftUIRouteAction(api, event, profile);
      if (result === 'reload') await reload();
    } catch (error) {
      notify(serverErrorMessage(error));
    }
  }, [api, notify, profile, reload]);

  return { dataJson, onAction, reload };
}

function serverErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `服务器操作失败：${error.message}`;
  }
  return '服务器操作失败，请稍后重试。';
}
