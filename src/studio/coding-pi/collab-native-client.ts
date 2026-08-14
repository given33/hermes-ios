import * as ExpoCrypto from 'expo-crypto';
import { gcm } from '@noble/ciphers/aes.js';
import { useSyncExternalStore } from 'react';

export const COLLAB_PROTO = 3;
const DEFAULT_RELAY_URL = 'wss://my.omp.sh';
const ROOM_KEY_BYTES = 32;
const WRITE_TOKEN_BYTES = 16;
const IV_BYTES = 12;
const MAX_PENDING_SENDS = 256;
const WELCOME_TIMEOUT_MS = 30_000;
const SNAPSHOT_PROGRESS_TIMEOUT_MS = 30_000;
const TRANSCRIPT_TIMEOUT_MS = 10_000;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type CollabConnectionPhase =
  | 'connecting'
  | 'waiting'
  | 'live'
  | 'reconnecting'
  | 'ended';

export type CollabNoticeLevel = 'info' | 'warning' | 'error';

export interface CollabNotice {
  id: number;
  level: CollabNoticeLevel;
  message: string;
  at: number;
}

export interface CollabActiveTool {
  toolCallId: string;
  toolName: string;
  args: unknown;
  intent?: string;
  partialResult?: unknown;
  startedAt: number;
}

export interface CollabTranscriptResult {
  kind: 'rows' | 'error';
  text?: string;
  newSize?: number;
  message?: string;
}

export type CollabUiSelectItem = string | { label: string; description?: string };

export type CollabUiRequest =
  | {
      kind: 'select';
      title: string;
      options: CollabUiSelectItem[];
      initialIndex?: number;
      selectionMarker?: 'radio' | 'checkbox';
      checkedIndices?: number[];
      markableCount?: number;
      helpText?: string;
      reqId: number;
    }
  | {
      kind: 'editor';
      title: string;
      prefill?: string;
      reqId: number;
    };

export interface CollabSessionHeader {
  type?: string;
  id: string;
  title?: string;
  timestamp?: string;
  cwd: string;
  [key: string]: unknown;
}

export interface CollabSessionState {
  isStreaming: boolean;
  queuedMessageCount: number;
  sessionName?: string;
  cwd: string;
  model?: {
    id?: string;
    name?: string;
    provider?: string;
    contextWindow?: number | null;
    [key: string]: unknown;
  };
  thinkingLevel?: string;
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number | null;
    percent?: number | null;
    [key: string]: unknown;
  };
  participants: Array<{
    name: string;
    role: 'host' | 'guest' | string;
    readOnly?: boolean;
  }>;
  isAborting?: boolean;
  [key: string]: unknown;
}

export interface CollabAgentSnapshot {
  id: string;
  displayName: string;
  kind: 'main' | 'sub' | string;
  parentId?: string;
  status: 'running' | 'idle' | 'parked' | 'aborted' | string;
  hasSessionFile: boolean;
  createdAt: number;
  lastActivity: number;
  [key: string]: unknown;
}

export interface CollabAgentProgress {
  index?: number;
  id: string;
  agent?: string;
  status?: string;
  task?: string;
  description?: string;
  lastIntent?: string;
  currentTool?: string;
  currentToolArgs?: string;
  currentToolStartMs?: number;
  recentTools?: Array<{ tool: string; args: string; endMs: number }>;
  recentOutput?: string[];
  toolCount?: number;
  requests?: number;
  tokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  cost?: number;
  durationMs?: number;
  resolvedModel?: string;
  [key: string]: unknown;
}

export interface CollabSubagentProgressPayload {
  index?: number;
  agent?: string;
  task?: string;
  parentToolCallId?: string;
  assignment?: string;
  progress: CollabAgentProgress;
  sessionFile?: string;
  [key: string]: unknown;
}

import type { HostedComponentLifecycle } from '../../api/hosted-runtime-types';

export interface CollabSubagentLifecyclePayload {
  id: string;
  agent?: string;
  description?: string;
  status?: string;
  lifecycle?: HostedComponentLifecycle;
  sessionFile?: string;
  parentToolCallId?: string;
  index?: number;
  [key: string]: unknown;
}

export interface CollabSnapshot {
  phase: CollabConnectionPhase;
  endedReason: string | null;
  header: CollabSessionHeader | null;
  entries: unknown[];
  state: CollabSessionState | null;
  agents: CollabAgentSnapshot[];
  progress: ReadonlyMap<string, CollabSubagentProgressPayload>;
  lifecycle: ReadonlyMap<string, CollabSubagentLifecyclePayload>;
  stream: unknown | null;
  streamDone: boolean;
  activeTools: ReadonlyMap<string, CollabActiveTool>;
  working: boolean;
  readOnly: boolean;
  uiRequest: CollabUiRequest | null;
  notices: readonly CollabNotice[];
}

interface ParsedCollabLink {
  wsUrl: string;
  roomId: string;
  key: Uint8Array;
  writeToken?: Uint8Array;
}

type GuestFrame =
  | { t: 'hello'; proto: number; name: string; writeToken?: string }
  | { t: 'prompt'; text: string }
  | { t: 'ui-response'; reqId: number; value?: string }
  | { t: 'abort' }
  | { t: 'agent-cmd'; cmd: 'chat' | 'kill' | 'revive'; agentId: string; text?: string }
  | { t: 'fetch-transcript'; reqId: number; agentId: string; fromByte: number };

interface ActiveToolEvent {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  intent?: string;
  partialResult?: unknown;
}

type HostFrame = {
  t: string;
  [key: string]: any;
};

interface PendingTranscript {
  resolve: (result: CollabTranscriptResult | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CollabSocketOptions {
  wsUrl: string;
  key: Uint8Array;
  name: string;
  writeToken?: string;
}

/**
 * Native counterpart of omp's collab-web relay socket. The relay only sees
 * opaque envelopes; all session frames stay AES-GCM encrypted end-to-end.
 */
class CollabRelaySocket {
  onOpen?: () => void;
  onFrame?: (frame: HostFrame, fromPeer: number) => void;
  onControl?: (message: { t: string }) => void;
  onClose?: (reason: string, willReconnect: boolean) => void;

  private readonly options: CollabSocketOptions;
  private websocket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private closed = false;
  private sendChain: Promise<void> = Promise.resolve();
  private receiveChain: Promise<void> = Promise.resolve();
  private pendingSends: ArrayBuffer[] = [];

  constructor(options: CollabSocketOptions) {
    this.options = options;
  }

  connect(): void {
    if (this.websocket || this.retryTimer) return;
    this.closed = false;
    this.retryAttempt = 0;
    this.openSocket();
  }

  close(): void {
    const hadActivity = Boolean(this.websocket || this.retryTimer);
    this.clearRetry();
    const wasClosed = this.closed;
    this.closed = true;
    this.pendingSends = [];
    const websocket = this.websocket;
    this.websocket = null;
    if (websocket) {
      try {
        websocket.close(1000);
      } catch {
        // The native socket may already be closing.
      }
    }
    if (hadActivity && !wasClosed) this.onClose?.('closed', false);
  }

  send(frame: GuestFrame): void {
    this.sendChain = this.sendChain
      .then(async () => {
        if (this.closed) return;
        const sealed = await sealFrame(this.options.key, frame);
        const envelope = packEnvelope(0, sealed);
        const websocket = this.websocket;
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(envelope);
          return;
        }
        if (this.pendingSends.length < MAX_PENDING_SENDS) this.pendingSends.push(envelope);
      })
      .catch((error) => {
        this.onClose?.(error instanceof Error ? error.message : String(error), false);
      });
  }

  private openSocket(): void {
    let websocket: WebSocket;
    try {
      websocket = new WebSocket(`${this.options.wsUrl}?role=guest`);
      websocket.binaryType = 'arraybuffer';
    } catch (error) {
      this.handleClose(1006, error instanceof Error ? error.message : String(error));
      return;
    }
    this.websocket = websocket;
    websocket.onopen = () => {
      if (this.websocket !== websocket) return;
      this.retryAttempt = 0;
      for (const envelope of this.pendingSends) websocket.send(envelope);
      this.pendingSends = [];
      this.onOpen?.();
    };
    websocket.onmessage = (event) => {
      if (this.websocket !== websocket) return;
      this.handleMessage(websocket, event.data);
    };
    websocket.onerror = () => {
      // React Native provides the actionable close code in onclose.
    };
    websocket.onclose = (event) => {
      if (this.websocket !== websocket) return;
      this.websocket = null;
      this.handleClose(event.code, event.reason);
    };
  }

  private handleMessage(websocket: WebSocket, data: unknown): void {
    if (typeof data === 'string') {
      try {
        this.onControl?.(JSON.parse(data) as { t: string });
      } catch {
        // The official collab-web client treats an unrelated/malformed relay
        // control message as ignorable noise. A transient relay message must
        // not tear down an otherwise healthy encrypted room connection.
      }
      return;
    }
    const decode = async (): Promise<Uint8Array | null> => {
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (data instanceof Uint8Array) return data;
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return new Uint8Array(await data.arrayBuffer());
      }
      return null;
    };
    this.receiveChain = this.receiveChain.then(async () => {
      const bytes = await decode();
      if (!bytes || this.websocket !== websocket) return;
      const envelope = unpackEnvelope(bytes);
      if (!envelope) return;
      try {
        const frame = await openFrame(this.options.key, envelope.payload);
        if (this.websocket === websocket) this.onFrame?.(frame, envelope.peerId);
      } catch {
        this.failFatal('bad key or corrupted frame');
      }
    }).catch(() => {
      // Keep the ordered receive chain alive after a malformed frame.
    });
  }

  private handleClose(code: number, reason: string): void {
    if (this.closed) return;
    const fatalReasons: Record<number, string> = {
      4001: 'room closed',
      4004: 'no such room',
      4009: 'a host is already connected for this room',
      4029: 'room is full',
    };
    const fatalReason = fatalReasons[code];
    if (fatalReason) {
      this.closed = true;
      this.pendingSends = [];
      this.onClose?.(fatalReason, false);
      return;
    }
    this.onClose?.(reason || `connection lost (code ${code})`, true);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    const base = Math.min(1_000 * 2 ** this.retryAttempt, 30_000);
    this.retryAttempt += 1;
    const delay = base * (0.75 + Math.random() * 0.5);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.closed) this.openSocket();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private failFatal(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.clearRetry();
    this.pendingSends = [];
    const websocket = this.websocket;
    this.websocket = null;
    try {
      websocket?.close(1000);
    } catch {
      // Ignore a socket that is already closed.
    }
    this.onClose?.(reason, false);
  }
}

export class NativeCollabClient {
  readonly link: string;
  private readonly socket: CollabRelaySocket;
  private readonly name: string;
  private readonly writeToken?: string;
  private readonly listeners = new Set<() => void>();
  private readonly pendingTranscripts = new Map<number, PendingTranscript>();
  private requestSequence = 0;
  private noticeSequence = 0;
  private everConnected = false;
  private welcomed = false;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotProgressTimer: ReturnType<typeof setTimeout> | null = null;
  private phase: CollabConnectionPhase = 'connecting';
  private endedReason: string | null = null;
  private header: CollabSessionHeader | null = null;
  private entries: unknown[] = [];
  private state: CollabSessionState | null = null;
  private agents: CollabAgentSnapshot[] = [];
  private progress = new Map<string, CollabSubagentProgressPayload>();
  private lifecycle = new Map<string, CollabSubagentLifecyclePayload>();
  private stream: any | null = null;
  private streamDone = false;
  private activeTools = new Map<string, CollabActiveTool>();
  private working = false;
  private readOnly = false;
  private uiRequest: CollabUiRequest | null = null;
  private uiRequestQueue: CollabUiRequest[] = [];
  private notices: CollabNotice[] = [];
  private snapshot: CollabSnapshot;

  constructor(link: string, displayName: string) {
    const parsed = parseCollabLink(link);
    if ('error' in parsed) throw new Error(parsed.error);
    this.link = link.trim();
    this.name = displayName.trim().slice(0, 64) || 'guest';
    this.writeToken = parsed.writeToken ? encodeBase64Url(parsed.writeToken) : undefined;
    this.socket = new CollabRelaySocket({
      key: parsed.key,
      name: this.name,
      wsUrl: parsed.wsUrl,
      writeToken: this.writeToken,
    });
    this.socket.onOpen = () => {
      this.socket.send({ t: 'hello', proto: COLLAB_PROTO, name: this.name, writeToken: this.writeToken });
      this.phase = this.everConnected ? 'reconnecting' : 'waiting';
      this.everConnected = true;
      this.commit();
    };
    this.socket.onFrame = (frame) => this.applyFrameSafe(frame);
    this.socket.onControl = (message) => {
      if (message.t === 'room-closed') this.end('room closed');
    };
    this.socket.onClose = (reason, willReconnect) => {
      // A reconnect starts a fresh welcome/snapshot train. Do not let the
      // previous train's watchdog end the session while the relay is retrying.
      this.clearSnapshotProgressTimer();
      if (willReconnect) {
        if (this.phase !== 'ended') {
          this.phase = 'reconnecting';
          this.commit();
        }
      } else {
        this.end(reason);
      }
    };
    this.snapshot = this.buildSnapshot();
  }

  connect(): void {
    if (this.phase === 'ended') {
      this.phase = 'connecting';
      this.endedReason = null;
      // Rejoin mirrors the official App's creation of a fresh GuestClient:
      // discard the ended room's snapshot and arm a new welcome watchdog.
      this.everConnected = false;
      this.welcomed = false;
      this.header = null;
      this.entries = [];
      this.state = null;
      this.agents = [];
      this.progress = new Map();
      this.lifecycle = new Map();
      this.stream = null;
      this.streamDone = false;
      this.activeTools = new Map();
      this.working = false;
      this.readOnly = false;
      this.clearUiRequests();
      this.commit();
    }
    this.socket.connect();
    if (!this.welcomed && !this.welcomeTimer) {
      this.welcomeTimer = setTimeout(() => {
        this.welcomeTimer = null;
        if (!this.welcomed) this.end("timed out waiting for the host's welcome");
      }, WELCOME_TIMEOUT_MS);
    }
  }

  close(): void {
    this.clearWelcomeTimer();
    this.clearSnapshotProgressTimer();
    this.socket.close();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): CollabSnapshot {
    return this.snapshot;
  }

  sendPrompt(text: string): void {
    const normalized = text.trim();
    if (normalized && !this.readOnly) this.socket.send({ t: 'prompt', text: normalized });
  }

  sendUiResponse(reqId: number, value?: string): void {
    if (!this.readOnly) this.socket.send({ t: 'ui-response', reqId, value });
    if (this.uiRequest?.reqId === reqId) {
      this.showNextUiRequest();
      this.commit();
    }
  }

  sendAbort(): void {
    if (!this.readOnly) this.socket.send({ t: 'abort' });
  }

  sendAgentCommand(command: 'chat' | 'kill' | 'revive', agentId: string, text?: string): void {
    if (!this.readOnly && agentId) this.socket.send({ t: 'agent-cmd', cmd: command, agentId, text });
  }

  fetchTranscript(agentId: string, fromByte: number): Promise<CollabTranscriptResult | null> {
    const reqId = ++this.requestSequence;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTranscripts.delete(reqId);
        resolve(null);
      }, TRANSCRIPT_TIMEOUT_MS);
      this.pendingTranscripts.set(reqId, { resolve, timer });
      this.socket.send({ t: 'fetch-transcript', reqId, agentId, fromByte: Math.max(0, fromByte) });
    });
  }

  private applyFrameSafe(frame: HostFrame): void {
    try {
      this.applyFrame(frame);
    } catch (error) {
      if (frame.t === 'welcome' && !this.welcomed) {
        this.end(`failed to apply session snapshot: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      this.pushNotice('error', `failed to apply ${frame.t} frame`);
      this.commit();
    }
  }

  private applyFrame(frame: HostFrame): void {
    switch (frame.t) {
      case 'welcome':
        this.header = isRecord(frame.header) ? frame.header as CollabSessionHeader : null;
        this.entries = [];
        this.state = isRecord(frame.state) ? normalizeState(frame.state) : null;
        this.agents = arrayOfRecords(frame.agents) as CollabAgentSnapshot[];
        this.stream = null;
        this.streamDone = false;
        this.activeTools = new Map();
        this.progress = new Map();
        this.lifecycle = new Map();
        this.working = Boolean(this.state?.isStreaming);
        this.readOnly = frame.readOnly === true;
        this.clearUiRequests();
        this.welcomed = true;
        this.clearWelcomeTimer();
        this.endedReason = null;
        if (Number(frame.entryCount) === 0) {
          this.clearSnapshotProgressTimer();
          this.phase = 'live';
        } else {
          this.armSnapshotProgressTimer();
        }
        break;
      case 'snapshot-chunk':
        this.entries = [...this.entries, ...(Array.isArray(frame.entries) ? frame.entries : [])];
        if (frame.final === true) {
          this.clearSnapshotProgressTimer();
          this.phase = 'live';
        } else {
          this.armSnapshotProgressTimer();
        }
        break;
      case 'entry':
        if (frame.entry !== undefined) this.entries = [...this.entries, frame.entry];
        if (this.streamDone && isMessageEntry(frame.entry) && frame.entry.message?.role === 'assistant') {
          this.stream = null;
          this.streamDone = false;
        }
        break;
      case 'event':
        this.applyEvent(isRecord(frame.event) ? frame.event : {});
        break;
      case 'state':
        this.state = normalizeState(frame.state);
        this.working = Boolean(this.state?.isStreaming);
        if (!this.state?.isStreaming) {
          this.activeTools = new Map();
          if (this.streamDone) {
            this.stream = null;
            this.streamDone = false;
          }
        }
        break;
      case 'agents':
        this.agents = arrayOfRecords(frame.agents) as CollabAgentSnapshot[];
        break;
      case 'bus':
        if (frame.channel === 'task:subagent:progress' && isRecord(frame.data) && isRecord(frame.data.progress)) {
          const payload = frame.data as CollabSubagentProgressPayload;
          this.progress = new Map(this.progress).set(String(payload.progress.id), payload);
        } else if (frame.channel === 'task:subagent:lifecycle' && isRecord(frame.data) && typeof frame.data.id === 'string') {
          const payload = frame.data as CollabSubagentLifecyclePayload;
          this.lifecycle = new Map(this.lifecycle).set(payload.id, payload);
        }
        break;
      case 'ui-request':
        if (isUiRequest(frame.request)) {
          if (this.uiRequest) this.uiRequestQueue = [...this.uiRequestQueue, frame.request];
          else this.uiRequest = frame.request;
        }
        break;
      case 'ui-request-end':
        if (this.uiRequest?.reqId === Number(frame.reqId)) this.showNextUiRequest();
        else this.uiRequestQueue = this.uiRequestQueue.filter((request) => request.reqId !== Number(frame.reqId));
        break;
      case 'transcript': {
        const pending = this.pendingTranscripts.get(Number(frame.reqId));
        if (pending) {
          this.pendingTranscripts.delete(Number(frame.reqId));
          clearTimeout(pending.timer);
          pending.resolve(frame.error !== undefined
            ? { kind: 'error', message: String(frame.error) }
            : { kind: 'rows', text: String(frame.text || ''), newSize: Number(frame.newSize) || 0 });
        }
        break;
      }
      case 'bye':
        this.end(String(frame.reason || 'session ended'));
        return;
      case 'error':
        if (!this.welcomed) {
          this.end(String(frame.message || 'collab connection failed'));
          return;
        }
        this.pushNotice('error', String(frame.message || 'collab host returned an error'));
        break;
      default:
        break;
    }
    this.commit();
  }

  private applyEvent(event: Record<string, any>): void {
    switch (event.type) {
      case 'message_start':
      case 'message_update':
        if (isAssistantMessage(event.message)) {
          this.stream = event.message;
          this.streamDone = false;
        }
        break;
      case 'message_end':
        if (isAssistantMessage(event.message)) {
          this.stream = event.message;
          this.streamDone = true;
        }
        break;
      case 'tool_execution_start': {
        const tool: CollabActiveTool = {
          toolCallId: String(event.toolCallId),
          toolName: String(event.toolName || 'tool'),
          args: event.args,
          intent: typeof event.intent === 'string' ? event.intent : undefined,
          startedAt: Date.now(),
        };
        this.activeTools = new Map(this.activeTools).set(tool.toolCallId, tool);
        break;
      }
      case 'tool_execution_update': {
        const id = String(event.toolCallId);
        const existing = this.activeTools.get(id);
        const tool: CollabActiveTool = existing
          ? { ...existing, partialResult: event.partialResult }
          : {
              toolCallId: id,
              toolName: String(event.toolName || 'tool'),
              args: event.args,
              partialResult: event.partialResult,
              startedAt: Date.now(),
            };
        this.activeTools = new Map(this.activeTools).set(id, tool);
        break;
      }
      case 'tool_execution_end':
        {
          const next = new Map(this.activeTools);
          next.delete(String(event.toolCallId));
          this.activeTools = next;
        }
        break;
      case 'agent_start':
        this.working = true;
        break;
      case 'agent_end':
        this.working = false;
        break;
      case 'notice':
        this.pushNotice(normalizeNoticeLevel(event.level), String(event.message || 'Pi notice'));
        break;
      case 'auto_retry_start':
        this.pushNotice('info', `retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`);
        break;
      case 'auto_retry_end':
        if (!event.success) this.pushNotice('error', String(event.finalError || 'retry failed'));
        break;
      case 'auto_compaction_start':
        this.pushNotice('info', `compacting context (${event.reason || 'automatic'})`);
        break;
      case 'auto_compaction_end':
        if (!event.skipped) {
          this.pushNotice('info', event.aborted
            ? 'compaction aborted'
            : event.errorMessage
              ? `compaction failed: ${event.errorMessage}`
              : 'context compacted');
        }
        break;
      default:
        break;
    }
  }

  private end(reason: string): void {
    if (this.phase === 'ended') return;
    this.clearWelcomeTimer();
    this.clearSnapshotProgressTimer();
    this.phase = 'ended';
    this.endedReason = reason;
    for (const pending of this.pendingTranscripts.values()) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this.pendingTranscripts.clear();
    this.clearUiRequests();
    this.commit();
    this.socket.close();
  }

  private armSnapshotProgressTimer(): void {
    this.clearSnapshotProgressTimer();
    this.snapshotProgressTimer = setTimeout(() => {
      this.snapshotProgressTimer = null;
      this.end("timed out waiting for the host's session snapshot");
    }, SNAPSHOT_PROGRESS_TIMEOUT_MS);
  }

  private clearWelcomeTimer(): void {
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    this.welcomeTimer = null;
  }

  private clearSnapshotProgressTimer(): void {
    if (this.snapshotProgressTimer) clearTimeout(this.snapshotProgressTimer);
    this.snapshotProgressTimer = null;
  }

  private clearUiRequests(): void {
    this.uiRequest = null;
    this.uiRequestQueue = [];
  }

  private showNextUiRequest(): void {
    const [next, ...rest] = this.uiRequestQueue;
    this.uiRequest = next || null;
    this.uiRequestQueue = rest;
  }

  private pushNotice(level: CollabNoticeLevel, message: string): void {
    const notice: CollabNotice = { id: ++this.noticeSequence, level, message, at: Date.now() };
    this.notices = [...this.notices, notice].slice(-50);
  }

  private buildSnapshot(): CollabSnapshot {
    return {
      phase: this.phase,
      endedReason: this.endedReason,
      header: this.header,
      entries: this.entries,
      state: this.state,
      agents: this.agents,
      progress: this.progress,
      lifecycle: this.lifecycle,
      stream: this.stream,
      streamDone: this.streamDone,
      activeTools: this.activeTools,
      working: this.working,
      readOnly: this.readOnly,
      uiRequest: this.uiRequest,
      notices: this.notices,
    };
  }

  private commit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}

export function useNativeCollabSnapshot(client: NativeCollabClient | null): CollabSnapshot | null {
  // Kept as a small adapter so the page can use the same controller/store
  // pattern as Hermes Chat without placing transport state in JSX.
  return useSyncExternalStore(
    client ? (listener: () => void) => client.subscribe(listener) : () => () => undefined,
    client ? () => client.getSnapshot() : () => null,
    client ? () => client.getSnapshot() : () => null,
  );
}

export function parseCollabLink(link: string): ParsedCollabLink | { error: string } {
  let text = link.trim().replace(/%23/gi, '#');
  if (!text) return { error: 'paste a collab link first' };
  const bare = /^([A-Za-z0-9_-]{10,64})[.#]([A-Za-z0-9_-]+)$/.exec(text);
  if (bare) text = `${DEFAULT_RELAY_URL}/r/${bare[1]}.${bare[2]}`;
  else if (!text.includes('://')) text = `wss://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: `invalid collab link: ${link}` };
  }
  if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hash) {
    const inner = url.hash.slice(1);
    const parsed = parseCollabLink(inner);
    if (!('error' in parsed)) return parsed;
  }
  const protocol = url.protocol;
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(protocol)) {
    return { error: 'collab link must use ws://, wss://, http://, or https://' };
  }
  if ((protocol === 'ws:' || protocol === 'http:') && !isLocalOrPrivateLanHost(url.hostname)) {
    return { error: 'plain ws:// is only allowed for localhost or a private LAN relay; use wss:// for a remote relay' };
  }
  const wsProtocol = protocol === 'https:' || protocol === 'wss:' ? 'wss:' : 'ws:';
  const pathMatch = /^\/r\/([A-Za-z0-9_-]{10,64})(?:\.([A-Za-z0-9_-]+))?$/.exec(url.pathname);
  if (!pathMatch) return { error: 'collab link must contain a /r/<room> path' };
  const secretText = pathMatch[2] || (url.hash.startsWith('#') ? url.hash.slice(1) : '');
  const secret = decodeBase64Url(secretText);
  if (!secret || (secret.length !== ROOM_KEY_BYTES && secret.length !== ROOM_KEY_BYTES + WRITE_TOKEN_BYTES)) {
    return { error: 'collab link key must contain a 32-byte room key' };
  }
  return {
    wsUrl: `${wsProtocol}//${url.host}/r/${pathMatch[1]}`,
    roomId: pathMatch[1],
    key: secret.slice(0, ROOM_KEY_BYTES),
    writeToken: secret.length > ROOM_KEY_BYTES ? secret.slice(ROOM_KEY_BYTES) : undefined,
  };
}

async function sealFrame(key: Uint8Array, frame: GuestFrame): Promise<Uint8Array> {
  const iv = await randomBytes(IV_BYTES);
  const plaintext = new TextEncoder().encode(JSON.stringify(frame));
  const ciphertext = gcm(key, iv).encrypt(plaintext);
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return out;
}

async function openFrame(key: Uint8Array, data: Uint8Array): Promise<HostFrame> {
  if (data.length <= IV_BYTES) throw new Error('sealed frame too short');
  const plaintext = gcm(key, data.slice(0, IV_BYTES)).decrypt(data.slice(IV_BYTES));
  return JSON.parse(new TextDecoder().decode(plaintext)) as HostFrame;
}

async function randomBytes(length: number): Promise<Uint8Array> {
  const nativeCrypto = globalThis.crypto;
  if (nativeCrypto && typeof nativeCrypto.getRandomValues === 'function') {
    return nativeCrypto.getRandomValues(new Uint8Array(length));
  }
  return ExpoCrypto.getRandomBytesAsync(length);
}

function packEnvelope(peerId: number, sealed: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(4 + sealed.length);
  new DataView(out.buffer).setUint32(0, peerId, false);
  out.set(sealed, 4);
  return out.buffer;
}

function unpackEnvelope(data: Uint8Array): { peerId: number; payload: Uint8Array } | null {
  if (data.length < 4) return null;
  return {
    peerId: new DataView(data.buffer, data.byteOffset, 4).getUint32(0, false),
    payload: data.slice(4),
  };
}

export function encodeBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] || 0;
    const b = bytes[index + 1] || 0;
    const c = bytes[index + 2] || 0;
    const triple = (a << 16) | (b << 8) | c;
    output += alphabet[(triple >>> 18) & 63];
    output += alphabet[(triple >>> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triple >>> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }
  return output.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output: number[] = [];
  for (let index = 0; index < padded.length; index += 4) {
    const a = alphabet.indexOf(padded[index]);
    const b = alphabet.indexOf(padded[index + 1]);
    const c = padded[index + 2] === '=' ? 0 : alphabet.indexOf(padded[index + 2]);
    const d = padded[index + 3] === '=' ? 0 : alphabet.indexOf(padded[index + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    output.push((triple >>> 16) & 255);
    if (padded[index + 2] !== '=') output.push((triple >>> 8) & 255);
    if (padded[index + 3] !== '=') output.push(triple & 255);
  }
  return new Uint8Array(output);
}

function normalizeState(value: unknown): CollabSessionState | null {
  if (!isRecord(value)) return null;
  return {
    ...(value as CollabSessionState),
    isStreaming: value.isStreaming === true,
    queuedMessageCount: typeof value.queuedMessageCount === 'number' ? value.queuedMessageCount : 0,
    cwd: typeof value.cwd === 'string' ? value.cwd : '',
    participants: Array.isArray(value.participants) ? value.participants as CollabSessionState['participants'] : [],
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function arrayOfRecords(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isMessageEntry(value: unknown): value is { message: any } {
  return isRecord(value) && value.type === 'message' && isRecord(value.message);
}

function isAssistantMessage(value: unknown): boolean {
  return isRecord(value) && value.role === 'assistant' && Array.isArray(value.content);
}

function isUiRequest(value: unknown): value is CollabUiRequest {
  return isRecord(value)
    && (value.kind === 'select' || value.kind === 'editor')
    && typeof value.reqId === 'number'
    && typeof value.title === 'string';
}

function normalizeNoticeLevel(value: unknown): CollabNoticeLevel {
  return value === 'error' || value === 'warning' ? value : 'info';
}

/**
 * The upstream browser client keeps cleartext relays to localhost only. The
 * native Hermes surface also supports the explicitly configured RFC1918 LAN
 * service used by Expo Go (`EXPO_PUBLIC_CODING_PI_URL=http://192.168.x.x:8787`).
 * Public cleartext relays remain rejected; outside the LAN the coordinator
 * must advertise HTTPS/WSS exactly like the official web client.
 */
function isLocalOrPrivateLanHost(hostname: string): boolean {
  if (LOCAL_HOSTNAMES.has(hostname)) return true;
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}
