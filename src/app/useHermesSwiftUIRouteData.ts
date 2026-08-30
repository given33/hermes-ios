import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { HermesApiError, type HermesApiClient } from '../api/HermesApiClient';
import { isAlreadyDeletedRemote as isAlreadyDeletedRemoteShared } from '../api/hermes-studio';
import { withAbortableDeadline } from '../api/async-deadline';
import { expireSystemRouteData } from '../api/managed-node-status';
import { consumeManagedResourceEvents } from '../api/managed-resource-events';
import {
  consumeKanbanEventsWebSocket,
  kanbanEventBoardFromRouteData,
  kanbanEventCursorFromBoard,
} from '../api/kanban-events';
import { reconnectDelay } from '../api/reconnect-backoff';
import {
  createCollaborationRoomRequestId,
  createWorkflowStartRequestId,
  parseOfficialConversationPlaceholderId,
  type HermesCloudApi,
} from '../api/HermesCloudApi';
import {
  createConversationDeleteReplayService,
  synchronizeConversationCache,
} from '../api/conversation-local-store';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../api/conversation-storage-coordinator';
import {
  hermesCloudApiFor,
  sharedConversationLocalStore,
} from '../api/hermes-api-registry';
import { WorkflowStartSingleFlight } from '../api/workflow-start-single-flight';
import {
  decodeHermesSwiftUIRouteAction,
  encodeHermesSwiftUIRouteSnapshot,
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
  type HermesSwiftUIRouteSnapshot,
  type HermesSwiftUIRouteOperationSnapshot,
} from './swiftui-route-contract';
import {
  encodeModelSelection,
  loadHermesSwiftUIRouteSnapshot,
  performHermesSwiftUIRouteAction,
  createHermesSwiftUISessionsSnapshotFromConversations,
} from './hermes-route-data';
import { operationShareUrls } from './route-actions/presentation';
import {
  beginKanbanDetailRequest,
  resetKanbanDetailFence,
  shouldApplyKanbanDetail,
  shouldClearKanbanDetail,
  type KanbanDetailFenceState,
} from './route-actions/kanban';
import { mergeRouteField } from './route-loaders/remote-metadata';
import {
  initialRouteRefreshDelay,
  nextRouteRefreshDelay,
} from './route-refresh-policy';

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

interface ProviderOauthPollState {
  cancelled: boolean;
  provider: string;
  sessionId: string;
  status: string;
}

const FOREGROUND_REFRESH_MS = 15_000;
const INSTALLATION_REFRESH_MS = 2_000;
const COLLABORATION_SEND_TIMEOUT_MS = 20_000;
const EVENT_FAILURE_LOG_INTERVAL_MS = 60_000;
const KANBAN_EVENT_CONNECT_TIMEOUT_MS = 5_000;

function sendCollaborationRoomMessageWithDeadline(
  api: HermesCloudApi,
  item: {
    content: string;
    profiles: string[];
    requestId: string;
    roomId: string;
  },
): Promise<unknown> {
  return withAbortableDeadline(
    (signal) => api.sendCollaborationRoomMessage(
      item.roomId,
      item.content,
      item.profiles,
      item.requestId,
      signal,
    ),
    COLLABORATION_SEND_TIMEOUT_MS,
    'Hermes collaboration message delivery timed out',
  );
}

export function useHermesSwiftUIRouteData({
  cacheOwner = '',
  client,
  locale,
  notify,
  profile,
  routeId,
}: UseHermesSwiftUIRouteDataOptions): HermesSwiftUIRouteDataController {
  const api = useMemo(
    () => client ? hermesCloudApiFor(client, cacheOwner) : null,
    [cacheOwner, client],
  );
  const localStore = useMemo(
    () => cacheOwner ? sharedConversationLocalStore() : null,
    [cacheOwner],
  );
  const selectedItemId = useRef('');
  const conversationDeleteReplayService = useMemo(() => (
    api && localStore && cacheOwner
      ? createConversationDeleteReplayService({
          activeConversationId: () => selectedItemId.current,
          cacheOwner,
          deleteRemote: async (item) => {
            if (item.kind === 'session') {
              const placeholder = parseOfficialConversationPlaceholderId(item.conversationId);
              const sessionId = placeholder?.sessionId
                || (item.conversationId.startsWith('official:')
                  ? item.conversationId.slice('official:'.length)
                  : item.conversationId);
              const result = await api.deleteSession(
                sessionId,
                item.profile || placeholder?.profile || profile,
              );
              if (result?.ok === false) {
                throw new Error('Remote session deletion was not accepted');
              }
              return;
            }
            const result = await api.deleteConversation(item.conversationId);
            if (result?.ok === false) {
              throw new Error('Remote conversation deletion was not accepted');
            }
          },
          describeError: (error) => serverErrorMessage(error, locale),
          isAlreadyDeleted: isAlreadyDeletedRemote,
          // The local tombstone is the committed user action. Keep it until
          // the server acknowledges it, including while this route is open.
          isRetryable: () => true,
          outbox: localStore,
          kinds: ['conversation', 'session'],
          retryDelayMs: 60_000,
          workerId: `swiftui-route:${routeId}`,
        })
      : null
  ), [api, cacheOwner, localStore, locale, profile, routeId]);
  const workflowStartFlights = useMemo(
    () => new WorkflowStartSingleFlight(),
    [cacheOwner, client, profile],
  );
  const requestVersion = useRef(0);
  const lastSuccessfulReloadAt = useRef(0);
  const acknowledgedRoomRequestId = useRef('');
  const collaborationReplay = useRef<Promise<string> | null>(null);
  const lifecycleEpoch = useRef(0);
  const operationRef = useRef<HermesSwiftUIRouteOperationSnapshot | undefined>(undefined);
  const providerOauthPollRef = useRef<ProviderOauthPollState | null>(null);
  const kanbanDetailFence = useRef<KanbanDetailFenceState>({ generation: 0, taskId: '' });
  const resetRefreshCadence = useRef<() => void>(() => undefined);
  const lastEventFailureLogAt = useRef(0);
  const [dataJson, setDataJson] = useState(() => encodeHermesSwiftUIRouteSnapshot({
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: routeId,
  }));
  const dataJsonRef = useRef(dataJson);
  const activeKanbanBoard = useMemo(
    () => kanbanEventBoardFromRouteData(dataJson),
    [dataJson],
  );

  useEffect(() => {
    dataJsonRef.current = dataJson;
  }, [dataJson]);
  useEffect(() => () => {
    if (providerOauthPollRef.current) providerOauthPollRef.current.cancelled = true;
    providerOauthPollRef.current = null;
  }, [api, profile, routeId]);
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
      const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
      const replayEpoch = lifecycleEpoch.current;
      const replayIsCurrent = () => replayEpoch === lifecycleEpoch.current
        && isConversationStorageEpochCurrent(cacheOwner, ownerEpoch);
      let lastAcknowledged = '';
      let discarded = 0;
      const pending = await localStore.readPendingRoomMessages(cacheOwner);
      for (const item of pending.sort((left, right) => left.queuedAt - right.queuedAt)) {
        try {
          if (!replayIsCurrent()) {
            return lastAcknowledged;
          }
          await sendCollaborationRoomMessageWithDeadline(api, item);
          if (!replayIsCurrent()) {
            return lastAcknowledged;
          }
          await localStore.removePendingRoomMessage(cacheOwner, item.requestId);
          lastAcknowledged = item.requestId;
        } catch (error) {
          if (!isPermanentRoomSendError(error)) throw error;
          if (!replayIsCurrent()) {
            return lastAcknowledged;
          }
          await localStore.removePendingRoomMessage(cacheOwner, item.requestId);
          discarded += 1;
        }
      }
      if (discarded) {
        notify(locale === 'zh'
          ? `${discarded} 条待发群聊消息已失效，请重新选择房间发送。`
          : `${discarded} pending room messages expired. Choose a room and send them again.`);
      }
      if (lastAcknowledged) acknowledgedRoomRequestId.current = lastAcknowledged;
      return lastAcknowledged;
    })();
    collaborationReplay.current = replay;
    try {
      return await replay;
    } finally {
      if (collaborationReplay.current === replay) collaborationReplay.current = null;
    }
  }, [api, cacheOwner, localStore, locale, notify, routeId]);

  const reload = useCallback(async () => {
    if (!api) return;
    const version = ++requestVersion.current;
    try {
      if (routeId === 'sessions' && localStore && cacheOwner) {
        const [cached, pendingIds] = await Promise.all([
          localStore.read(cacheOwner),
          localStore.readPendingConversationDeletionIds(cacheOwner),
        ]);
        if (version !== requestVersion.current) return;
        if (cached) {
          const localSnapshot = createHermesSwiftUISessionsSnapshotFromConversations(
            cached.conversations,
            pendingIds,
            locale,
          );
          // Publish downloaded history before any network operation. A later
          // sync replaces it, while an offline failure leaves it intact.
          setDataJson(encodeHermesSwiftUIRouteSnapshot(localSnapshot));
        }
      }
      await conversationDeleteReplayService?.replay().catch(() => undefined);
      await replayPendingCollaborationMessages().catch(() => undefined);
      let snapshot: HermesSwiftUIRouteSnapshot;
      if (routeId === 'sessions' && localStore && cacheOwner) {
        const synchronized = await synchronizeConversationCache(
          api,
          localStore,
          cacheOwner,
          profile,
        );
        const synchronizedPendingDeletionIds = await localStore.readPendingConversationDeletionIds(
          cacheOwner,
        );
        const synchronizedSnapshot = createHermesSwiftUISessionsSnapshotFromConversations(
          synchronized.conversations,
          synchronizedPendingDeletionIds,
          locale,
        );
        const sessions = synchronizedSnapshot.sessions || [];
        const selectedId = selectedItemId.current;
        const selected = sessions.find(({ id }) => id === selectedId);
        const sessionState = selected && !selectedId.startsWith('official:')
          ? await api.getConversationSessionState(selectedId, selected?.profile || profile)
          : undefined;
        snapshot = createHermesSwiftUISessionsSnapshotFromConversations(
          synchronized.conversations,
          synchronizedPendingDeletionIds,
          locale,
          sessionState,
        );
      } else {
        snapshot = await loadHermesSwiftUIRouteSnapshot(
          api,
          routeId,
          profile,
          selectedItemId.current,
          locale,
        );
      }
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
      if (routeId === 'models' && providerOauthPollRef.current?.cancelled === false) {
        snapshot = {
          ...snapshot,
          providerOauthPendingJSON: JSON.stringify(providerOauthPollRef.current),
        };
      }
      if (
        routeId === 'workflows'
        && operationRef.current?.action === 'workflow.start'
      ) {
        snapshot = { ...snapshot, operation: operationRef.current };
      }
      const encodedSnapshot = encodeHermesSwiftUIRouteSnapshot(snapshot);
      setDataJson((current) => {
        if (routeId !== 'kanban') return encodedSnapshot;
        const currentDetail = routeStringField(current, 'kanbanDetailJSON');
        return currentDetail === undefined
          ? encodedSnapshot
          : mergeRouteField(encodedSnapshot, 'kanbanDetailJSON', currentDetail);
      });
    } catch (error) {
      if (version !== requestVersion.current) return;
      if (routeId === 'system') {
        setDataJson((current) => expireSystemRouteData(
          current,
          lastSuccessfulReloadAt.current,
        ));
      }
      notify(serverErrorMessage(error, locale));
    }
  }, [
    api,
    cacheOwner,
    conversationDeleteReplayService,
    localStore,
    locale,
    notify,
    profile,
    replayPendingCollaborationMessages,
    routeId,
  ]);

  useEffect(() => {
    if (!api || (routeId !== 'skills' && routeId !== 'mcp')) return undefined;
    let disposed = false;
    let cursor = 0;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed || controller || AppState.currentState !== 'active') return;
      controller = new AbortController();
      const activeController = controller;
      void consumeManagedResourceEvents(
        api,
        cursor,
        activeController.signal,
        async (frame) => {
          cursor = Math.max(cursor, frame.cursor);
          if (!disposed && AppState.currentState === 'active') await reload();
        },
      ).then((nextCursor) => {
        cursor = Math.max(cursor, nextCursor);
      }).catch((error: unknown) => {
        if (activeController.signal.aborted) return;
        const now = Date.now();
        if (now - lastEventFailureLogAt.current < EVENT_FAILURE_LOG_INTERVAL_MS) return;
        lastEventFailureLogAt.current = now;
        console.warn(
          'Hermes managed-resource event refresh failed',
          error instanceof Error ? error.name : 'Error',
        );
      }).finally(() => {
        if (controller === activeController) controller = null;
        if (!disposed && AppState.currentState === 'active') {
          reconnectTimer = setTimeout(connect, INSTALLATION_REFRESH_MS);
        }
      });
    };

    connect();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        connect();
      } else {
        controller?.abort();
        controller = null;
        if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      }
    });
    return () => {
      disposed = true;
      controller?.abort();
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      appState.remove();
    };
  }, [api, reload, routeId]);

  useEffect(() => {
    if (!api || routeId !== 'kanban') return undefined;
    let disposed = false;
    let cursor = 0;
    let cursorInitialized = false;
    let reconnectAttempt = 0;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const clearReconnectTimer = () => {
      if (reconnectTimer === undefined) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };
    const scheduleReconnect = () => {
      if (
        disposed
        || controller
        || reconnectTimer !== undefined
        || AppState.currentState !== 'active'
      ) return;
      const delay = reconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };
    const connect = () => {
      if (disposed || controller || AppState.currentState !== 'active') return;
      clearReconnectTimer();
      controller = new AbortController();
      const activeController = controller;
      void (async () => {
        if (!cursorInitialized) {
          const board = await api.getKanbanBoard(
            activeKanbanBoard ? { board: activeKanbanBoard } : undefined,
          );
          if (disposed || activeController.signal.aborted) return cursor;
          cursor = kanbanEventCursorFromBoard(board, cursor);
          cursorInitialized = true;
        }
        return consumeKanbanEventsWebSocket(
          api,
          cursor,
          activeKanbanBoard,
          activeController.signal,
          async (frame) => {
            cursor = Math.max(cursor, frame.cursor);
            reconnectAttempt = 0;
            if (!disposed && AppState.currentState === 'active') await reload();
          },
          KANBAN_EVENT_CONNECT_TIMEOUT_MS,
        );
      })().then((nextCursor) => {
        cursor = Math.max(cursor, nextCursor);
      }).catch((error: unknown) => {
        if (activeController.signal.aborted) return;
        const now = Date.now();
        if (now - lastEventFailureLogAt.current < EVENT_FAILURE_LOG_INTERVAL_MS) return;
        lastEventFailureLogAt.current = now;
        console.warn(
          'Hermes Kanban event refresh failed',
          error instanceof Error ? error.name : 'Error',
        );
      }).finally(() => {
        if (controller === activeController) controller = null;
        scheduleReconnect();
      });
    };

    connect();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        connect();
      } else {
        controller?.abort();
        controller = null;
        clearReconnectTimer();
      }
    });
    return () => {
      disposed = true;
      controller?.abort();
      controller = null;
      clearReconnectTimer();
      appState.remove();
    };
  }, [activeKanbanBoard, api, reload, routeId]);

  useEffect(() => {
    lifecycleEpoch.current += 1;
    const lifecycleVersion = ++requestVersion.current;
    lastSuccessfulReloadAt.current = 0;
    selectedItemId.current = '';
    operationRef.current = undefined;
    kanbanDetailFence.current = resetKanbanDetailFence(kanbanDetailFence.current);
    acknowledgedRoomRequestId.current = '';
    setDataJson(encodeHermesSwiftUIRouteSnapshot({
      version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
      route: routeId,
    }));
    void (async () => {
      // Do not render an unverified local index. The server's account-scoped
      // index is authoritative and will repopulate the cache during reload.
      if (lifecycleVersion === requestVersion.current) await reload();
    })();
    if (!api || routeId === 'models') return undefined;

    // Adaptive cadence instead of a fixed interval: the tight installation
    // cadence applies only while an installation is actually progressing, an
    // idle route backs off geometrically once consecutive snapshots stop
    // changing, and any activity (payload change, user action, foreground)
    // snaps back to the base cadence. See route-refresh-policy.ts.
    const installationRoute = routeId === 'skills' || routeId === 'mcp';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let pollInFlight = false;
    let delayMs = initialRouteRefreshDelay(
      routeId,
      FOREGROUND_REFRESH_MS,
      INSTALLATION_REFRESH_MS,
      dataJsonRef.current,
    );
    let lastPayload = dataJsonRef.current;
    const schedule = (nextDelayMs: number) => {
      if (disposed) return;
      delayMs = nextDelayMs;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => { void tick(); }, delayMs);
    };
    const tick = async () => {
      if (AppState.currentState === 'active') {
        if (routeId === 'system') {
          setDataJson((current) => expireSystemRouteData(
            current,
            lastSuccessfulReloadAt.current,
          ));
        }
        // A poll never stacks onto a poll still on the wire; on a slow link
        // the old fixed interval kept issuing identical snapshot requests.
        if (!pollInFlight) {
          pollInFlight = true;
          try {
            await reload();
          } finally {
            pollInFlight = false;
          }
        }
      }
      const payload = dataJsonRef.current;
      const payloadChanged = payload !== lastPayload;
      lastPayload = payload;
      schedule(nextRouteRefreshDelay({
        baseDelayMs: FOREGROUND_REFRESH_MS,
        installationDelayMs: INSTALLATION_REFRESH_MS,
        installationRoute,
        payloadChanged,
        pinned: routeId === 'system',
        previousDelayMs: delayMs,
        routeDataJson: payload,
      }));
    };
    resetRefreshCadence.current = () => {
      lastPayload = dataJsonRef.current;
      schedule(initialRouteRefreshDelay(
        routeId,
        FOREGROUND_REFRESH_MS,
        INSTALLATION_REFRESH_MS,
        dataJsonRef.current,
      ));
    };
    schedule(delayMs);
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (routeId === 'system') {
        setDataJson((current) => expireSystemRouteData(
          current,
          lastSuccessfulReloadAt.current,
        ));
      }
      // Returning to the foreground is activity: refresh now and resume the
      // base cadence rather than waiting out a backed-off idle timer.
      resetRefreshCadence.current();
      void reload();
    });
    return () => {
      disposed = true;
      lifecycleEpoch.current += 1;
      requestVersion.current += 1;
      if (timer !== undefined) clearTimeout(timer);
      resetRefreshCadence.current = () => undefined;
      appState.remove();
    };
  }, [api, cacheOwner, localStore, profile, reload, routeId]);

  const onAction = useCallback(async (action: string, payloadJson: string) => {
    if (!api) {
      notify(locale === 'zh'
        ? 'Hermes 服务尚未连接，此操作未执行。'
        : 'Hermes is not connected. The action was not executed.');
      return;
    }
    const event = decodeHermesSwiftUIRouteAction(action, payloadJson);
    if (!event) {
      notify(locale === 'zh'
        ? '无法识别页面操作，请刷新后重试。'
        : 'Unrecognized page action. Refresh and try again.');
      return;
    }
    const kanbanDetailRequest = beginKanbanDetailRequest(
      kanbanDetailFence.current,
      event.action,
      event.payload.id || '',
    );
    kanbanDetailFence.current = kanbanDetailRequest.state;
    // A user action is an activity signal: resume the base polling cadence so
    // follow-up server state (a just-started installation, a fresh run) is
    // observed at the tight latency instead of a backed-off idle timer.
    resetRefreshCadence.current();
    const modelOperation = modelOperationForAction(event.action);
    if (
      event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.modelSelect
      || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.modelSelectCancel
    ) {
      setDataJson((current) => mergeModelConfirmation(current));
    }
    if (modelOperation) {
      updateOperation({
        action: modelOperation,
        message: modelOperationRunningMessage(modelOperation, locale),
        state: 'running',
      });
    }
    if (event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.providerOauthCancel) {
      const sessionId = event.payload.value?.trim() || event.payload.name?.trim() || '';
      const pending = providerOauthPollRef.current;
      if (pending && (!sessionId || pending.sessionId === sessionId)) {
        pending.cancelled = true;
        pending.status = 'cancelled';
        providerOauthPollRef.current = null;
        setDataJson((current) => mergeRouteField(
          current,
          'providerOauthPendingJSON',
          JSON.stringify(pending),
        ));
      }
    }
    if (
      (
        event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.collaborationSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.workflowSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.approvalSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.runtimeSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.fileSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.sessionSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.skillSelect
        || event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.gitSelect
      )
      && event.payload.id
    ) {
      selectedItemId.current = event.payload.id;
      await reload();
      return;
    }
    try {
      if (event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.workflowStart) {
        const workflowId = event.payload.id?.trim() || '';
        if (!workflowId) return;
        const flight = workflowStartFlights.run(
          workflowId,
          event.payload.requestId?.trim() || createWorkflowStartRequestId(),
          (requestId) => api.startWorkflow(workflowId, profile, requestId),
        );
        if (!flight.leader) {
          await flight.promise.catch(() => undefined);
          return;
        }
        updateOperation({
          action: 'workflow.start',
          message: locale === 'zh' ? '正在启动工作流…' : 'Starting workflow…',
          requestId: flight.requestId,
          state: 'running',
          targetId: workflowId,
        });
        try {
          await flight.promise;
        } catch (error) {
          const message = serverErrorMessage(error, locale);
          updateOperation({
            action: 'workflow.start',
            message,
            requestId: flight.requestId,
            state: 'error',
            targetId: workflowId,
          });
          notify(message);
          return;
        }
        updateOperation({
          action: 'workflow.start',
          message: locale === 'zh' ? '工作流已启动' : 'Workflow started',
          requestId: flight.requestId,
          state: 'success',
          targetId: workflowId,
        });
        await reload();
        return;
      }
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
          await sendCollaborationRoomMessageWithDeadline(api, item);
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
      if (
        event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.sessionDelete
        && event.payload.id
        && localStore
        && cacheOwner
      ) {
        const conversationId = event.payload.id.trim();
        if (!conversationId) return;
        const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
        const cached = await localStore.read(cacheOwner);
        const conversation = cached?.conversations.find(({ id }) => id === conversationId);
        const queued = await localStore.stageConversationDeletion(
          cacheOwner,
          {
            conversationId,
            kind: conversationId.startsWith('official:') ? 'session' : 'conversation',
            profile: conversation?.profile || event.payload.fields?.profile || profile,
            queuedAt: Date.now(),
          },
          cached?.activeConversationId || selectedItemId.current,
          ownerEpoch,
        );
        if (!queued) {
          throw new Error(locale === 'zh' ? '本地会话删除未提交' : 'Local session deletion was not committed');
        }
        if (selectedItemId.current === conversationId) selectedItemId.current = '';
        // The native list must react immediately even when the network is
        // offline; the persistent tombstone prevents a later sync from
        // reintroducing this row.
        setDataJson((current) => removeSessionFromRouteSnapshot(current, conversationId));
        await conversationDeleteReplayService?.replay(ownerEpoch).catch(() => undefined);
        await reload();
        return;
      }
      const result = await performHermesSwiftUIRouteAction(api, event, profile, locale);
      if (
        localStore
        && cacheOwner
        && event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.sessionRename
      ) {
        const cached = await localStore.read(cacheOwner);
        if (cached) {
          const value = event.payload.value?.trim() || event.payload.name?.trim() || '';
          const conversations = cached.conversations.map((conversation) => (
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
      const skillHubResultJSON = typeof result === 'object' && result !== null
        ? result.skillHubResultJSON
        : undefined;
      if (typeof skillHubResultJSON === 'string' && skillHubResultJSON) {
        setDataJson((current) => mergeRouteField(current, 'skillHubResultJSON', skillHubResultJSON));
      }
      const channelOnboardingJSON = typeof result === 'object' && result !== null
        ? result.channelOnboardingJSON
        : undefined;
      if (typeof channelOnboardingJSON === 'string') {
        setDataJson((current) => mergeRouteField(current, 'channelOnboardingJSON', channelOnboardingJSON));
      }
      const managedFilesJSON = typeof result === 'object' && result !== null
        ? result.managedFilesJSON
        : undefined;
      const accountFilesJSON = typeof result === 'object' && result !== null
        ? result.accountFilesJSON
        : undefined;
      if (typeof accountFilesJSON === 'string' && accountFilesJSON) {
        setDataJson((current) => mergeRouteField(current, 'accountFilesJSON', accountFilesJSON));
      }
      if (typeof managedFilesJSON === 'string' && managedFilesJSON) {
        setDataJson((current) => mergeRouteField(current, 'managedFilesJSON', managedFilesJSON));
      }
      const kanbanDetailJSON = typeof result === 'object' && result !== null
        ? result.kanbanDetailJSON
        : undefined;
      if (typeof result === 'object' && result.confirmRequired) {
        setDataJson((current) => mergeModelConfirmation(current, {
          id: encodeModelSelection(result.provider || '', result.model || ''),
          message: result.confirmMessage || 'This model has unusually high known pricing.',
          model: result.model || '',
          provider: result.provider || '',
        }));
        return;
      }
      const resultMessage = typeof result === 'object' ? result.message : '';
      const resultUrl = operationShareUrls(result)[0] || '';
      if (resultUrl) void Linking.openURL(resultUrl).catch(() => undefined);
      if (typeof result === 'object' && result.flowId && event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.mcpAuth) {
        const flowId = String(result.flowId);
        const oauthLifecycle = lifecycleEpoch.current;
        const oauthIsCurrent = () => oauthLifecycle === lifecycleEpoch.current;
        let terminalMessage = '';
        for (let attempt = 0; attempt < 90; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          if (!oauthIsCurrent()) return;
          if (AppState.currentState !== 'active') break;
          const flow = await api.getMcpOauthFlow(flowId).catch(() => undefined);
          if (!oauthIsCurrent()) return;
          const status = typeof flow === 'object' ? String(flow?.status || '') : '';
          if (status === 'approved') { terminalMessage = locale === 'zh' ? 'MCP OAuth 已完成' : 'MCP OAuth completed'; break; }
          if (status === 'error') { terminalMessage = String(flow?.error || (locale === 'zh' ? 'MCP OAuth 失败' : 'MCP OAuth failed')); break; }
        }
        if (!oauthIsCurrent()) return;
        if (terminalMessage) notify(terminalMessage);
        await reload();
      }
      if (typeof result === 'object' && result.oauthProvider && result.oauthSessionId && event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.providerOauthStart) {
        const provider = String(result.oauthProvider); const sessionId = String(result.oauthSessionId);
        if (providerOauthPollRef.current) providerOauthPollRef.current.cancelled = true;
        const pending: ProviderOauthPollState = {
          cancelled: false,
          provider,
          sessionId,
          status: 'waiting',
        };
        providerOauthPollRef.current = pending;
        setDataJson((current) => mergeRouteField(
          current,
          'providerOauthPendingJSON',
          JSON.stringify(pending),
        ));
        let terminalMessage = '';
        for (let attempt = 0; attempt < 90; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          if (pending.cancelled || providerOauthPollRef.current !== pending) break;
          if (AppState.currentState !== 'active') continue;
          const flow = await api.pollProviderOauth(provider, sessionId, profile).catch(() => undefined);
          if (pending.cancelled || providerOauthPollRef.current !== pending) break;
          const status = typeof flow === 'object' ? String(flow?.status || '') : '';
          if (status) {
            pending.status = status;
            setDataJson((current) => mergeRouteField(
              current,
              'providerOauthPendingJSON',
              JSON.stringify(pending),
            ));
          }
          if (status === 'complete' || status === 'approved' || status === 'connected') { terminalMessage = locale === 'zh' ? 'Provider OAuth 已完成' : 'Provider OAuth completed'; break; }
          if (status === 'error' || status === 'failed') { terminalMessage = String(flow?.error || (locale === 'zh' ? 'Provider OAuth 失败' : 'Provider OAuth failed')); break; }
        }
        if (providerOauthPollRef.current === pending) providerOauthPollRef.current = null;
        if (pending.cancelled) return;
        if (terminalMessage) notify(terminalMessage);
        else notify(locale === 'zh' ? 'Provider OAuth 等待已超时' : 'Provider OAuth timed out');
        await reload();
      }
      if (modelOperation) {
        updateOperation({
          action: modelOperation,
          message: resultMessage || modelOperationSuccessMessage(modelOperation, locale),
          state: 'success',
        });
      }
      if (result === 'reload' || (typeof result === 'object' && result.reload)) {
        await reload();
      }
      // Kanban mutations often refresh the board. Merge the task envelope
      // afterwards so the reload cannot erase the open native detail sheet.
      if (typeof kanbanDetailJSON === 'string') {
        const clearDetail = event.action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanBoardSwitch
          && kanbanDetailJSON === ''
          && shouldClearKanbanDetail(
            kanbanDetailFence.current,
            kanbanDetailRequest.token,
          );
        if (
          clearDetail
          || shouldApplyKanbanDetail(
            kanbanDetailFence.current,
            kanbanDetailRequest.token,
            kanbanDetailJSON,
          )
        ) {
          setDataJson((current) => mergeRouteField(current, 'kanbanDetailJSON', kanbanDetailJSON));
        }
      }
      if (resultMessage) notify(resultMessage);
    } catch (error) {
      const message = serverErrorMessage(error, locale);
      if (modelOperation) {
        updateOperation({ action: modelOperation, message, state: 'error' });
      }
      notify(message);
    }
  }, [
    api,
    cacheOwner,
    conversationDeleteReplayService,
    localStore,
    locale,
    notify,
    profile,
    reload,
    updateOperation,
    workflowStartFlights,
  ]);

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
  locale: 'en' | 'zh',
): string {
  const zh = locale === 'zh';
  if (action === 'model.discover') return zh ? '正在检测可用模型…' : 'Detecting available models…';
  if (action === 'model.test') return zh ? '正在测试模型连接…' : 'Testing model connection…';
  return zh ? '正在保存模型配置…' : 'Saving model configuration…';
}

function modelOperationSuccessMessage(
  action: HermesSwiftUIRouteOperationSnapshot['action'],
  locale: 'en' | 'zh',
): string {
  const zh = locale === 'zh';
  if (action === 'model.discover') return zh ? '模型检测完成' : 'Model detection finished';
  if (action === 'model.test') return zh ? '模型连接测试通过' : 'Model connection test passed';
  return zh ? '模型配置已保存' : 'Model configuration saved';
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

function routeStringField(dataJson: string, key: string): string | undefined {
  try {
    const source: unknown = JSON.parse(dataJson);
    if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined;
    const value = (source as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function mergeModelConfirmation(
  dataJson: string,
  confirmation?: {
    id: string;
    message: string;
    model: string;
    provider: string;
  },
): string {
  try {
    const source: unknown = JSON.parse(dataJson);
    if (typeof source !== 'object' || source === null || Array.isArray(source)) return dataJson;
    const next = { ...source } as Record<string, unknown>;
    if (confirmation) next.modelConfirmation = confirmation;
    else delete next.modelConfirmation;
    return JSON.stringify(next);
  } catch {
    return dataJson;
  }
}

function serverErrorMessage(error: unknown, locale: 'en' | 'zh'): string {
  if (error instanceof Error && error.message) {
    return locale === 'zh'
      ? `服务器操作失败：${error.message}`
      : `Server operation failed: ${error.message}`;
  }
  return locale === 'zh'
    ? '服务器操作失败，请稍后重试。'
    : 'Server operation failed. Try again later.';
}

function isPermanentRoomSendError(error: unknown): boolean {
  return error instanceof HermesApiError
    && error.status >= 400
    && error.status < 500
    && ![401, 408, 429].includes(error.status);
}

function isAlreadyDeletedRemote(error: unknown): boolean {
  // Shared helper with the agent-group controller; the constructor argument
  // keeps the instanceof fast path this file relied on.
  return isAlreadyDeletedRemoteShared(
    error,
    HermesApiError as unknown as abstract new (...args: never[]) => { status?: number },
  );
}

function removeSessionFromRouteSnapshot(dataJson: string, conversationId: string): string {
  try {
    const source: unknown = JSON.parse(dataJson);
    if (!isJsonRecord(source) || !Array.isArray(source.sessions)) return dataJson;
    const next: Record<string, unknown> = {
      ...source,
      sessions: source.sessions.filter((item) => (
        !isJsonRecord(item) || item.id !== conversationId
      )),
    };
    const context = source.sessionContext;
    if (
      isJsonRecord(context)
      && (context.conversationId === conversationId || context.sessionId === conversationId)
    ) {
      delete next.sessionContext;
    }
    return JSON.stringify(next);
  } catch {
    return dataJson;
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
