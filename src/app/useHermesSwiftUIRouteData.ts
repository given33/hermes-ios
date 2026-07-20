import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { HermesApiError, type HermesApiClient } from '../api/HermesApiClient';
import { expireSystemRouteData } from '../api/managed-node-status';
import {
  conversationSessionSummary,
  createCollaborationRoomRequestId,
  HermesCloudApi,
} from '../api/HermesCloudApi';
import {
  ConversationLocalStore,
  synchronizeConversationCache,
} from '../api/conversation-local-store';
import {
  decodeHermesSwiftUIRouteAction,
  encodeHermesSwiftUIRouteSnapshot,
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
  type HermesSwiftUIRouteOperationSnapshot,
} from './swiftui-route-contract';
import {
  loadHermesSwiftUIRouteSnapshot,
  performHermesSwiftUIRouteAction,
  createHermesSwiftUISessionsSnapshot,
} from './hermes-route-data';

interface UseHermesSwiftUIRouteDataOptions {
  cacheOwner?: string;
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
  cacheOwner = '',
  client,
  locale,
  notify,
  profile,
  routeId,
}: UseHermesSwiftUIRouteDataOptions): HermesSwiftUIRouteDataController {
  const api = useMemo(() => client ? new HermesCloudApi(client) : null, [client]);
  const localStore = useMemo(
    () => cacheOwner ? new ConversationLocalStore() : null,
    [cacheOwner],
  );
  const requestVersion = useRef(0);
  const lastSuccessfulReloadAt = useRef(0);
  const selectedItemId = useRef('');
  const acknowledgedRoomRequestId = useRef('');
  const collaborationReplay = useRef<Promise<string> | null>(null);
  const operationRef = useRef<HermesSwiftUIRouteOperationSnapshot | undefined>(undefined);
  const [dataJson, setDataJson] = useState(() => encodeHermesSwiftUIRouteSnapshot({
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: routeId,
  }));
  const updateOperation = useCallback((
    operation: HermesSwiftUIRouteOperationSnapshot | undefined,
  ) => {
    operationRef.current = operation;
    setDataJson((current) => mergeRouteOperation(current, operation));
  }, []);

  const replayPendingCollaborationMessages = useCallback(async () => {
    if (!api || !localStore || !cacheOwner || routeId !== 'collaboration') return '';
    if (collaborationReplay.current) return collaborationReplay.current;
    const replay = (async () => {
      let lastAcknowledged = '';
      let discarded = 0;
      const pending = await localStore.readPendingRoomMessages(cacheOwner);
      for (const item of pending.sort((left, right) => left.queuedAt - right.queuedAt)) {
        try {
          await api.sendCollaborationRoomMessage(
            item.roomId,
            item.content,
            item.profiles,
            item.requestId,
          );
          await localStore.removePendingRoomMessage(cacheOwner, item.requestId);
          lastAcknowledged = item.requestId;
        } catch (error) {
          if (!isPermanentRoomSendError(error)) throw error;
          await localStore.removePendingRoomMessage(cacheOwner, item.requestId);
          discarded += 1;
        }
      }
      if (discarded) notify(`${discarded} 条待发群聊消息已失效，请重新选择房间发送。`);
      if (lastAcknowledged) acknowledgedRoomRequestId.current = lastAcknowledged;
      return lastAcknowledged;
    })();
    collaborationReplay.current = replay;
    try {
      return await replay;
    } finally {
      if (collaborationReplay.current === replay) collaborationReplay.current = null;
    }
  }, [api, cacheOwner, localStore, notify, routeId]);

  const reload = useCallback(async () => {
    if (!api) return;
    const version = ++requestVersion.current;
    try {
      await replayPendingCollaborationMessages().catch(() => undefined);
      let snapshot = routeId === 'sessions' && localStore && cacheOwner
        ? createHermesSwiftUISessionsSnapshot({
            sessions: (
              await synchronizeConversationCache(
                api,
                localStore,
                cacheOwner,
                profile,
              )
            ).conversations.map(conversationSessionSummary),
          })
        : await loadHermesSwiftUIRouteSnapshot(
            api,
            routeId,
            profile,
            selectedItemId.current,
            locale === 'zh',
          );
      if (
        routeId === 'collaboration'
        && acknowledgedRoomRequestId.current
        && snapshot.collaboration
      ) {
        snapshot = {
          ...snapshot,
          collaboration: {
            ...snapshot.collaboration,
            acknowledgedRequestId: acknowledgedRoomRequestId.current,
          },
        };
      }
      if (version !== requestVersion.current) return;
      if (routeId === 'system') lastSuccessfulReloadAt.current = Date.now();
      if (routeId === 'models' && operationRef.current) {
        snapshot = { ...snapshot, operation: operationRef.current };
      }
      setDataJson(encodeHermesSwiftUIRouteSnapshot(snapshot));
    } catch (error) {
      if (version !== requestVersion.current) return;
      if (routeId === 'system') {
        setDataJson((current) => expireSystemRouteData(
          current,
          lastSuccessfulReloadAt.current,
        ));
      }
      notify(serverErrorMessage(error));
    }
  }, [
    api,
    cacheOwner,
    localStore,
    locale,
    notify,
    profile,
    replayPendingCollaborationMessages,
    routeId,
  ]);

  useEffect(() => {
    const lifecycleVersion = ++requestVersion.current;
    lastSuccessfulReloadAt.current = 0;
    selectedItemId.current = '';
    operationRef.current = undefined;
    setDataJson(encodeHermesSwiftUIRouteSnapshot({
      version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
      route: routeId,
    }));
    void (async () => {
      if (routeId === 'sessions' && localStore && cacheOwner) {
        const cached = await localStore.read(cacheOwner);
        if (cached && lifecycleVersion === requestVersion.current) {
          setDataJson(encodeHermesSwiftUIRouteSnapshot(
            createHermesSwiftUISessionsSnapshot({
              sessions: cached.conversations.map(conversationSessionSummary),
            }),
          ));
        }
      }
      if (lifecycleVersion === requestVersion.current) await reload();
    })();
    if (!api || routeId === 'models') return undefined;

    const interval = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (routeId === 'system') {
        setDataJson((current) => expireSystemRouteData(
          current,
          lastSuccessfulReloadAt.current,
        ));
      }
      void reload();
    }, FOREGROUND_REFRESH_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (routeId === 'system') {
        setDataJson((current) => expireSystemRouteData(
          current,
          lastSuccessfulReloadAt.current,
        ));
      }
      void reload();
    });
    return () => {
      requestVersion.current += 1;
      clearInterval(interval);
      appState.remove();
    };
  }, [api, cacheOwner, localStore, reload, routeId]);

  const onAction = useCallback(async (action: string, payloadJson: string) => {
    if (!api) return;
    const event = decodeHermesSwiftUIRouteAction(action, payloadJson);
    if (!event) {
      notify('无法识别页面操作，请刷新后重试。');
      return;
    }
    const modelOperation = modelOperationForAction(event.action);
    if (modelOperation) {
      updateOperation({
        action: modelOperation,
        message: modelOperationRunningMessage(modelOperation),
        state: 'running',
      });
    }
    if (
      (
        event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.fileSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.sessionSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.skillSelect
      )
      && event.payload.id
    ) {
      selectedItemId.current = event.payload.id;
      await reload();
      return;
    }
    try {
      if (event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationSend) {
        const roomId = event.payload.id?.trim() || '';
        const content = event.payload.value?.trim() || '';
        if (!roomId || !content) return;
        const requestId = event.payload.requestId?.trim()
          || createCollaborationRoomRequestId();
        const item = {
          content,
          profiles: [],
          queuedAt: Date.now(),
          requestId,
          roomId,
        };
        if (localStore && cacheOwner) {
          await localStore.upsertPendingRoomMessage(cacheOwner, item);
        }
        try {
          await api.sendCollaborationRoomMessage(roomId, content, item.profiles, requestId);
        } catch (error) {
          if (localStore && cacheOwner && isPermanentRoomSendError(error)) {
            await localStore.removePendingRoomMessage(cacheOwner, requestId);
          }
          throw error;
        }
        if (localStore && cacheOwner) {
          await localStore.removePendingRoomMessage(cacheOwner, requestId);
        }
        acknowledgedRoomRequestId.current = requestId;
        await reload();
        return;
      }
      const result = await performHermesSwiftUIRouteAction(api, event, profile);
      if (
        localStore
        && cacheOwner
        && (
          event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.sessionDelete
          || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.sessionRename
        )
      ) {
        const cached = await localStore.read(cacheOwner);
        if (cached) {
          const value = event.payload.value?.trim() || event.payload.name?.trim() || '';
          const conversations = event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.sessionDelete
            ? cached.conversations.filter(({ id }) => id !== event.payload.id)
            : cached.conversations.map((conversation) => (
                conversation.id === event.payload.id && value
                  ? { ...conversation, title: value, updated_at: Date.now() }
                  : conversation
              ));
          const activeId = conversations.some(({ id }) => id === cached.activeConversationId)
            ? cached.activeConversationId
            : conversations[0]?.id || '';
          await localStore.write(cacheOwner, conversations, activeId);
        }
      }
      if (typeof result === 'object' && result.detectedModels) {
        setDataJson((current) => mergeDetectedModels(current, result.detectedModels || []));
      }
      const resultMessage = typeof result === 'object' ? result.message : '';
      if (modelOperation) {
        updateOperation({
          action: modelOperation,
          message: resultMessage || modelOperationSuccessMessage(modelOperation),
          state: 'success',
        });
      }
      if (result === 'reload' || (typeof result === 'object' && result.reload)) {
        await reload();
      }
      if (resultMessage) notify(resultMessage);
    } catch (error) {
      const message = serverErrorMessage(error);
      if (modelOperation) {
        updateOperation({ action: modelOperation, message, state: 'error' });
      }
      notify(message);
    }
  }, [api, cacheOwner, localStore, notify, profile, reload, updateOperation]);

  return { dataJson, onAction, reload };
}

function mergeRouteOperation(
  dataJson: string,
  operation: HermesSwiftUIRouteOperationSnapshot | undefined,
): string {
  try {
    const source: unknown = JSON.parse(dataJson);
    if (typeof source !== 'object' || source === null || Array.isArray(source)) return dataJson;
    const next = { ...source } as Record<string, unknown>;
    if (operation) next.operation = operation;
    else delete next.operation;
    return JSON.stringify(next);
  } catch {
    return dataJson;
  }
}

function modelOperationForAction(
  action: string,
): HermesSwiftUIRouteOperationSnapshot['action'] | null {
  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.modelDiscover) return 'model.discover';
  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.modelSave) return 'model.save';
  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.modelTest) return 'model.test';
  return null;
}

function modelOperationRunningMessage(
  action: HermesSwiftUIRouteOperationSnapshot['action'],
): string {
  if (action === 'model.discover') return '正在检测可用模型…';
  if (action === 'model.test') return '正在测试模型连接…';
  return '正在保存模型配置…';
}

function modelOperationSuccessMessage(
  action: HermesSwiftUIRouteOperationSnapshot['action'],
): string {
  if (action === 'model.discover') return '模型检测完成';
  if (action === 'model.test') return '模型连接测试通过';
  return '模型配置已保存';
}

function mergeDetectedModels(dataJson: string, models: readonly string[]): string {
  try {
    const source: unknown = JSON.parse(dataJson);
    if (typeof source !== 'object' || source === null || Array.isArray(source)) return dataJson;
    const detectedModels = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
    return JSON.stringify({ ...source, detectedModels });
  } catch {
    return dataJson;
  }
}

function serverErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `服务器操作失败：${error.message}`;
  }
  return '服务器操作失败，请稍后重试。';
}

function isPermanentRoomSendError(error: unknown): boolean {
  return error instanceof HermesApiError
    && error.status >= 400
    && error.status < 500
    && ![401, 408, 429].includes(error.status);
}
