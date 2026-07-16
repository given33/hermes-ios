import type { HermesApiClient } from './HermesApiClient';

export interface HermesChatStreamRuntime {
  currentAppState(): string;
  createSocket(url: string): WebSocket;
  now(): number;
  random(): number;
  subscribeAppState(listener: (state: string) => void): () => void;
  subscribeNetwork(listener: (online: boolean) => void): () => void;
}

export interface HermesStreamEvent {
  type: string;
  session_id?: string;
  payload: Record<string, unknown>;
}

export interface HermesStreamTurnOptions {
  conversationId: string;
  existingSessionId?: string;
  profile: string;
  prompt: string;
  sessionTitle?: string;
  turnId: string;
}

export interface HermesStreamTurnResult {
  recovered?: boolean;
  sessionId: string;
  status: string;
  storedSessionId: string;
  text: string;
}

interface RpcFrame {
  id?: string;
  error?: { message?: string };
  result?: Record<string, unknown>;
  method?: string;
  params?: HermesStreamEvent;
}

interface RpcWaiter {
  reject(error: Error): void;
  resolve(result: Record<string, unknown>): void;
}

const RECONNECT_MAX_ATTEMPTS = 12;
const RECONNECT_BASE_DELAY_MS = 600;
const RECONNECT_MAX_DELAY_MS = 8_000;
const CONNECT_TIMEOUT_MS = 12_000;
const TURN_TIMEOUT_MS = 30 * 60_000;
const BACKGROUND_STALE_MS = 30_000;

let rpcSequence = 0;

/**
 * React Native port of the modified Hermes WebUI `/api/ws` turn transport.
 * Sessions are created with `close_on_disconnect: false`, so closing the App
 * only detaches this viewer; execution remains owned by the server and can be
 * resumed from the stored session id on another device.
 */
export class HermesChatStream {
  private appStateSubscription: (() => void) | null = null;
  private appState: string;
  private backgroundedAt = 0;
  private completed = false;
  private connectGeneration = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private networkSubscription: (() => void) | null = null;
  private online = true;
  private options: HermesStreamTurnOptions | null = null;
  private pending = new Map<string, RpcWaiter>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rejectRun: ((error: Error) => void) | null = null;
  private resolveRun: ((result: HermesStreamTurnResult) => void) | null = null;
  private sessionId = '';
  private socket: WebSocket | null = null;
  private storedSessionId = '';
  private submitted = false;
  private submittedBaselineMessageCount = 0;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly client: HermesApiClient,
    private readonly onEvent: (event: HermesStreamEvent) => void | Promise<void>,
    private readonly runtime: HermesChatStreamRuntime,
  ) {
    this.appState = runtime.currentAppState();
  }

  run(options: HermesStreamTurnOptions): Promise<HermesStreamTurnResult> {
    if (this.resolveRun || this.rejectRun) {
      throw new Error('A Hermes stream turn is already running');
    }
    this.storedSessionId = options.existingSessionId?.trim() ?? '';
    this.options = options;
    this.installLifecycleObservers();
    this.turnTimer = setTimeout(() => {
      this.fail(new Error(`${options.profile} 执行超时`));
    }, TURN_TIMEOUT_MS);

    const result = new Promise<HermesStreamTurnResult>((resolve, reject) => {
      this.resolveRun = resolve;
      this.rejectRun = reject;
    });
    void this.connect(options);
    return result;
  }

  /** Detach the UI without interrupting the server-owned turn. */
  detach(): void {
    if (this.completed) return;
    const error = new Error('Hermes stream detached');
    error.name = 'HermesStreamDetachedError';
    this.fail(error);
  }

  async interrupt(): Promise<void> {
    if (this.socket?.readyState === 1 && this.sessionId) {
      try {
        await this.request(this.socket, 'session.interrupt', {
          session_id: this.sessionId,
        });
      } catch {
        // The server may have completed between the tap and the RPC.
      }
    }
    this.detach();
  }

  private async connect(options: HermesStreamTurnOptions): Promise<void> {
    if (this.completed || this.isBackgrounded()) return;
    if (!this.online) {
      this.scheduleReconnect(options, new Error('设备当前离线'));
      return;
    }
    const generation = ++this.connectGeneration;
    let url: string;
    try {
      url = await this.client.createWebSocketUrl('/api/ws');
    } catch (error) {
      this.scheduleReconnect(options, toError(error));
      return;
    }
    if (this.completed || generation !== this.connectGeneration) return;

    const socket = this.runtime.createSocket(url);
    this.socket = socket;
    this.clearConnectTimer();
    this.connectTimer = setTimeout(() => {
      if (socket.readyState === 0) socket.close();
    }, CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      this.clearConnectTimer();
      void this.initializeSession(socket, options);
    };
    socket.onmessage = (message) => this.handleMessage(socket, message);
    socket.onerror = () => {};
    socket.onclose = (event) => {
      this.clearConnectTimer();
      if (this.socket === socket) this.socket = null;
      this.rejectPending(new Error('流式连接已断开'));
      if (!this.completed) {
        this.scheduleReconnect(
          options,
          new Error(event.reason || `连接关闭（${event.code || '未知状态'}）`),
        );
      }
    };
  }

  private async initializeSession(socket: WebSocket, options: HermesStreamTurnOptions) {
    let resumePayload: Record<string, unknown> | null = null;
    try {
      if (this.storedSessionId) {
        try {
          resumePayload = await this.request(socket, 'session.resume', {
            cols: 100,
            close_on_disconnect: false,
            conversation_id: options.conversationId,
            profile: options.profile,
            session_id: this.storedSessionId,
            source: 'ios-unified',
            turn_id: options.turnId,
          });
          this.sessionId = stringValue(resumePayload.session_id);
          this.storedSessionId =
            stringValue(resumePayload.resumed)
            || stringValue(resumePayload.session_key)
            || this.storedSessionId;
        } catch (error) {
          if (this.submitted) throw error;
          this.storedSessionId = '';
        }
      }
      if (!this.sessionId) {
        const created = await this.request(socket, 'session.create', {
          cols: 100,
          close_on_disconnect: false,
          conversation_id: options.conversationId,
          profile: options.profile,
          source: 'ios-unified',
          ...(options.sessionTitle ? { title: options.sessionTitle } : {}),
          turn_id: options.turnId,
        });
        this.sessionId = stringValue(created.session_id);
        this.storedSessionId =
          stringValue(created.stored_session_id)
          || stringValue(created.session_key)
          || this.sessionId;
      }

      if (!this.submitted) {
        await this.onEvent({
          type: 'session.ready',
          payload: {
            session_id: this.sessionId,
            stored_session_id: this.storedSessionId,
          },
        });
      }

      if (this.submitted) {
        this.reconnectAttempts = 0;
        await this.onEvent({ type: 'connection.restored', payload: {} });
        const running = resumePayload?.running === true
          || resumePayload?.status === 'streaming';
        if (!running) {
          const recovered = latestAssistantTextAfter(
            Array.isArray(resumePayload?.messages) ? resumePayload.messages : [],
            this.submittedBaselineMessageCount,
          );
          this.finish({
            recovered: true,
            sessionId: this.sessionId,
            status: recovered ? 'completed' : 'error',
            storedSessionId: this.storedSessionId,
            text: recovered || '本轮任务已结束，但 Hermes 没有返回新的回复。',
          });
        }
        return;
      }

      this.submittedBaselineMessageCount = Array.isArray(resumePayload?.messages)
        ? resumePayload.messages.length
        : 0;
      const submission = this.request(socket, 'prompt.submit', {
        conversation_id: options.conversationId,
        session_id: this.sessionId,
        text: options.prompt,
        turn_id: options.turnId,
      });
      // Set before awaiting: a lost RPC reply must resume, never resubmit.
      this.submitted = true;
      await submission;
    } catch (error) {
      if (!this.completed && socket.readyState === 1) {
        this.fail(toError(error));
      }
    }
  }

  private handleMessage(socket: WebSocket, message: { data: unknown }) {
    let frame: RpcFrame;
    try {
      frame = JSON.parse(String(message.data)) as RpcFrame;
    } catch {
      return;
    }
    if (frame.id && this.pending.has(frame.id)) {
      const waiter = this.pending.get(frame.id)!;
      this.pending.delete(frame.id);
      if (frame.error) waiter.reject(new Error(frame.error.message || 'RPC 请求失败'));
      else waiter.resolve(frame.result ?? {});
      return;
    }
    if (frame.method !== 'event' || !frame.params) return;
    const event = normalizeStreamEvent(frame.params);
    if (this.sessionId && event.session_id && event.session_id !== this.sessionId) return;
    void this.onEvent(event);
    if (event.type === 'message.complete') {
      this.finish({
        sessionId: this.sessionId,
        status: stringValue(event.payload.status) || 'completed',
        storedSessionId: this.storedSessionId,
        text: structuredText(event.payload.text),
      });
    } else if (event.type === 'error') {
      this.finish({
        sessionId: this.sessionId,
        status: 'error',
        storedSessionId: this.storedSessionId,
        text: structuredText(event.payload.message) || 'Hermes 执行失败',
      });
    }
  }

  private request(
    socket: WebSocket,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (socket.readyState !== 1) {
      return Promise.reject(new Error('流式连接当前不可用'));
    }
    const id = `ios-${++rpcSequence}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        socket.send(JSON.stringify({ id, jsonrpc: '2.0', method, params }));
      } catch (error) {
        this.pending.delete(id);
        reject(toError(error));
      }
    });
  }

  private scheduleReconnect(options: HermesStreamTurnOptions, reason: Error) {
    if (this.completed || this.reconnectTimer || this.isBackgrounded()) return;
    if (!this.online) {
      void this.onEvent({
        type: 'connection.waiting',
        payload: { reason: reason.message },
      });
      return;
    }
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.fail(new Error(`网络连接持续中断，已自动重试 ${RECONNECT_MAX_ATTEMPTS} 次`));
      return;
    }
    this.reconnectAttempts += 1;
    const backoff = RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
    const delay = Math.min(
      backoff + Math.floor(this.runtime.random() * 250),
      RECONNECT_MAX_DELAY_MS,
    );
    void this.onEvent({
      type: 'connection.reconnecting',
      payload: {
        attempt: this.reconnectAttempts,
        max_attempts: RECONNECT_MAX_ATTEMPTS,
        delay_ms: delay,
        reason: reason.message,
      },
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(options);
    }, delay);
  }

  private installLifecycleObservers() {
    this.appStateSubscription = this.runtime.subscribeAppState((next) => {
      const wasBackgrounded = this.isBackgrounded();
      this.appState = next;
      if (this.isBackgrounded()) {
        this.backgroundedAt ||= this.runtime.now();
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        return;
      }
      const stale = this.backgroundedAt > 0
        && this.runtime.now() - this.backgroundedAt >= BACKGROUND_STALE_MS;
      this.backgroundedAt = 0;
      if (wasBackgrounded && (stale || this.socket?.readyState !== 1)) {
        this.restartConnection(new Error('应用已回到前台'));
      }
    });
    this.networkSubscription = this.runtime.subscribeNetwork((online) => {
      const recovered = !this.online && online;
      this.online = online;
      if (!online) this.restartConnection(new Error('设备当前离线'));
      else if (recovered) this.restartConnection(new Error('网络已恢复'));
    });
  }

  private restartConnection(reason: Error) {
    if (this.completed) return;
    this.connectGeneration += 1;
    this.clearConnectTimer();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(); } catch {}
    }
    if (this.options) this.scheduleReconnect(this.options, reason);
  }

  private isBackgrounded() {
    return this.appState === 'background' || this.appState === 'inactive';
  }

  private finish(result: HermesStreamTurnResult) {
    if (this.completed) return;
    this.completed = true;
    const resolve = this.resolveRun;
    this.cleanup();
    resolve?.(result);
  }

  private fail(error: Error) {
    if (this.completed) return;
    this.completed = true;
    const reject = this.rejectRun;
    this.cleanup();
    reject?.(error);
  }

  private cleanup() {
    this.clearConnectTimer();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.reconnectTimer = null;
    this.turnTimer = null;
    this.rejectPending(new Error('流式连接已关闭'));
    this.appStateSubscription?.();
    this.networkSubscription?.();
    this.appStateSubscription = null;
    this.networkSubscription = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(); } catch {}
    }
    this.resolveRun = null;
    this.rejectRun = null;
    this.options = null;
  }

  private rejectPending(error: Error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  private clearConnectTimer() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }
}

function normalizeStreamEvent(event: HermesStreamEvent): HermesStreamEvent {
  return {
    ...event,
    payload: isRecord(event.payload) ? event.payload : {},
  };
}

function latestAssistantTextAfter(messages: unknown[], baseline: number): string {
  for (let index = messages.length - 1; index >= Math.max(0, baseline); index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== 'assistant') continue;
    const text = structuredText(message.text ?? message.content);
    if (text) return text;
  }
  return '';
}

export function structuredText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(structuredText).filter(Boolean).join('');
  }
  if (isRecord(value)) {
    if ('text' in value) return structuredText(value.text);
    if ('content' in value) return structuredText(value.content);
  }
  return '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
