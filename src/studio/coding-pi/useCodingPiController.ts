import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Linking } from 'react-native';

import type { HermesApiClient } from '../../api/HermesApiClient';
import {
  hermesCodingPiApiFor,
} from '../../api/hermes-api-registry';
import type {
  HermesCodingPiAgentCommand,
  HermesCodingPiCommandResponse,
  HermesCodingPiJson,
  HermesCodingPiNode,
  HermesCodingPiSession,
  HermesCodingPiSnapshot,
} from '../../api/hermes-coding-pi';
import { assertSseFrameWithinLimit, decodeSseTextStream } from '../../api/sse-stream-safety';
import {
  isRecord,
  normalizePiMessage,
  numberValue,
  snapshotActivities,
  snapshotMessages,
  stringValue,
  toolResultText,
  type CodingPiActivity,
  type CodingPiMessage,
} from './coding-pi-model';

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];
const CODING_EVENT_STREAM_IDLE_TIMEOUT_MS = 90_000;

export interface CodingPiController {
  activeSession: HermesCodingPiSession | null;
  activeSessionId: string;
  activities: CodingPiActivity[];
  agentTranscripts: Record<string, string>;
  agents: HermesCodingPiJson[];
  available: boolean | null;
  commands: HermesCodingPiJson[];
  error: string | null;
  input: string;
  loading: boolean;
  messages: CodingPiMessage[];
  nodes: HermesCodingPiNode[];
  pendingUiRequests: HermesCodingPiJson[];
  sessions: HermesCodingPiSession[];
  snapshot: HermesCodingPiSnapshot | null;
  streaming: boolean;
  setInput(value: string): void;
  refresh(): Promise<void>;
  createSession(input?: { name?: string; workspace?: string }): Promise<void>;
  selectSession(sessionId: string): void;
  send(message?: string): Promise<void>;
  sendCommand(command: HermesCodingPiJson): Promise<HermesCodingPiCommandResponse | null>;
  agentCommand(command: HermesCodingPiAgentCommand, agentId: string, text?: string): Promise<void>;
  respondToUiRequest(requestId: string, response: HermesCodingPiJson): Promise<void>;
  handoff(targetNodeId: string, instructions?: string): Promise<void>;
  stop(force?: boolean): Promise<void>;
}

export function useCodingPiController({
  cacheOwner,
  client,
  enabled,
  fixtureMode,
  notify,
  profile,
}: {
  cacheOwner: string;
  client?: HermesApiClient;
  enabled: boolean;
  fixtureMode: boolean;
  notify(message: string): void;
  profile: string;
}): CodingPiController {
  const api = useMemo(() => client ? hermesCodingPiApiFor(client) : null, [client]);
  const [sessions, setSessions] = useState<HermesCodingPiSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [snapshot, setSnapshot] = useState<HermesCodingPiSnapshot | null>(null);
  const [messages, setMessages] = useState<CodingPiMessage[]>([]);
  const [activities, setActivities] = useState<CodingPiActivity[]>([]);
  const [agentTranscripts, setAgentTranscripts] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<HermesCodingPiJson[]>([]);
  const [pendingUiRequests, setPendingUiRequests] = useState<HermesCodingPiJson[]>([]);
  const [nodes, setNodes] = useState<HermesCodingPiNode[]>([]);
  const [commands, setCommands] = useState<HermesCodingPiJson[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  const sessionEpochRef = useRef(0);
  const eventSequenceRef = useRef(0);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  activeSessionIdRef.current = activeSessionId;

  const activeSession = sessions.find((session) => session.id === activeSessionId) || null;

  const applySnapshot = useCallback((next: HermesCodingPiSnapshot) => {
    setSnapshot(next);
    setMessages(snapshotMessages(next));
    setActivities(snapshotActivities(next));
    const rawCommands = isRecord(next.commands) && Array.isArray(next.commands.commands)
      ? next.commands.commands
      : [];
    setCommands(rawCommands.filter(isRecord));
    const rawAgents = isRecord(next.subagents) && Array.isArray(next.subagents.subagents)
      ? next.subagents.subagents
      : Array.isArray(next.subagents)
        ? next.subagents
        : [];
    setAgents(rawAgents.filter(isRecord));
    eventSequenceRef.current = Math.max(eventSequenceRef.current, next.sequence || 0);
    setStreaming(Boolean(isRecord(next.state) && next.state.isStreaming));
    setSessions((current) => current.map((session) => (
      session.id === next.session.id ? next.session : session
    )));
  }, []);

  const refresh = useCallback(async () => {
    if (!api || !enabled || fixtureMode) {
      setAvailable(false);
      return;
    }
    setLoading(true);
    try {
      const config = await api.getConfig();
      setAvailable(config.available);
      setNodes(config.nodes || []);
      if (!config.available) {
        setError(config.error || 'oh-my-pi is unavailable on the Pi service');
        return;
      }
      const result = await api.listSessions(profile);
      setSessions(result.sessions);
      setActiveSessionId((current) => current || result.sessions[0]?.id || '');
      setError(null);
    } catch (nextError) {
      setAvailable(false);
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [api, enabled, fixtureMode, profile]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const loadSnapshot = useCallback(async (sessionId: string) => {
    if (!api || !sessionId || !enabled || fixtureMode) return;
    const requestEpoch = sessionEpochRef.current;
    try {
      const nextSnapshot = await api.getSession(profile, sessionId);
      // A slow snapshot from a previously selected Pi session must never
      // overwrite the session currently visible on screen.
      if (sessionEpochRef.current !== requestEpoch || activeSessionIdRef.current !== sessionId) return;
      applySnapshot(nextSnapshot);
      // Pi defaults subagent streaming to off. Enable the full lifecycle/event
      // channel so Coding mode does not silently lose delegated work.
      await api.command(profile, sessionId, {
        type: 'set_subagent_subscription',
        level: 'events',
      });
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }, [api, applySnapshot, enabled, fixtureMode, profile]);

  // Pi's RPC protocol deliberately leaves host tools and URI schemes to the
  // embedding host. Hermes iOS does not claim arbitrary server-side tools, so
  // respond with an explicit error instead of leaving Pi waiting forever when
  // an extension asks for a capability this host has not registered.
  const sendHostFrame = useCallback(async (frame: HermesCodingPiJson) => {
    if (!api || !enabled || fixtureMode || !activeSessionIdRef.current) return;
    try {
      await api.command(profile, activeSessionIdRef.current, frame);
    } catch (nextError) {
      const detail = errorMessage(nextError);
      setActivities((current) => upsertActivity(current, {
        id: `host-bridge-${Date.now()}`,
        title: 'Pi host bridge',
        detail,
        status: 'error',
        updatedAt: Date.now(),
      }));
    }
  }, [api, enabled, fixtureMode, profile]);

  useEffect(() => {
    if (!api || !enabled || fixtureMode || !activeSessionId) return;
    const effectAbortController = new AbortController();
    let disposed = false;
    let reconnectAttempt = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const consume = async () => {
      while (!disposed) {
        const streamController = new AbortController();
        const onEffectAbort = () => streamController.abort();
        effectAbortController.signal.addEventListener('abort', onEffectAbort, { once: true });
        let idleExpired = false;
        const armIdleWatchdog = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            idleExpired = true;
            streamController.abort();
          }, CODING_EVENT_STREAM_IDLE_TIMEOUT_MS);
        };
        try {
          const response = await api.openEvents(
            profile,
            activeSessionId,
            eventSequenceRef.current,
            streamController.signal,
          );
          if (!response.body) throw new Error('Coding event stream has no response body');
          armIdleWatchdog();
          reconnectAttempt = 0;
          await consumeEventStream(response.body, streamController.signal, (eventType, payload, sequence) => {
            if (disposed) return;
            if (sequence !== undefined) eventSequenceRef.current = Math.max(eventSequenceRef.current, sequence);
            if (eventType === 'snapshot' && isCodingPiSnapshot(payload)) {
              applySnapshot(payload);
              return;
            }
            if (eventType === 'error') {
              setError(stringValue(payload.message, 'Coding event stream failed'));
              return;
            }
            applyPiFrame(payload);
          }, armIdleWatchdog);
          if (disposed) return;
        } catch (nextError) {
          if (disposed || effectAbortController.signal.aborted) return;
          if (isAbortError(nextError) && !idleExpired) return;
          setError(errorMessage(nextError));
        } finally {
          effectAbortController.signal.removeEventListener('abort', onEffectAbort);
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = null;
        }
        if (disposed) return;
        const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
        reconnectAttempt += 1;
        await wait(delay);
      }
    };

    const applyPiFrame = (frame: HermesCodingPiJson) => {
      const frameType = stringValue(frame.type);
      if (frameType === 'available_commands_update') {
        const rawCommands = Array.isArray(frame.commands) ? frame.commands : [];
        setCommands(rawCommands.filter(isRecord));
        return;
      }
      if (frameType === 'prompt_result') {
        if (frame.agentInvoked === false) setStreaming(false);
        return;
      }
      if (frameType === 'message_start' || frameType === 'message_update' || frameType === 'message_end') {
        const message = normalizePiMessage(frame.message, `pi-${Date.now()}`);
        if (message) {
          const nextMessage = {
            ...message,
            streaming: frameType !== 'message_end',
          };
          setMessages((current) => upsertMessage(current, nextMessage));
        }
        if (frameType === 'message_end') setStreaming(false);
        else setStreaming(true);
        return;
      }
      if (frameType === 'agent_start' || frameType === 'turn_start') {
        setStreaming(true);
        return;
      }
      if (frameType === 'agent_end' || frameType === 'turn_end' || frameType === 'session_shutdown') {
        setStreaming(false);
        return;
      }
      if (frameType === 'tool_execution_start' || frameType === 'tool_execution_update' || frameType === 'tool_execution_end') {
        const toolCallId = stringValue(frame.toolCallId, `tool-${Date.now()}`);
        const toolName = stringValue(frame.toolName, 'tool');
        const detail = frameType === 'tool_execution_start'
          ? stringifyForDisplay(frame.args)
          : frameType === 'tool_execution_end'
            ? toolResultText(frame.result) || stringifyForDisplay(frame.result)
            : stringifyForDisplay(frame.partialResult);
        setActivities((current) => upsertActivity(current, {
          id: toolCallId,
          title: toolName,
          detail,
          status: frameType === 'tool_execution_start'
            ? 'running'
            : frameType === 'tool_execution_end'
              ? (frame.isError ? 'error' : 'done')
              : 'running',
          updatedAt: Date.now(),
          toolName,
          args: frame.args,
          result: frameType === 'tool_execution_end' ? frame.result : undefined,
          partialResult: frameType === 'tool_execution_update' ? frame.partialResult : undefined,
          intent: stringValue(frame.intent) || undefined,
        }));
        setStreaming(frameType !== 'tool_execution_end');
        return;
      }
      if (frameType === 'subagent_lifecycle' || frameType === 'subagent_progress' || frameType === 'subagent_event') {
        const payload = isRecord(frame.payload) ? frame.payload : frame;
        const subagentId = stringValue(payload.id, stringValue(payload.subagentId, `subagent-${Date.now()}`));
        const detail = stringifyForDisplay(payload.progress || payload.event || payload);
        setActivities((current) => upsertActivity(current, {
          id: `subagent-${subagentId}`,
          title: stringValue(payload.description, stringValue(payload.agent, 'Pi subagent')),
          detail,
          status: subagentActivityStatus(payload.status),
          updatedAt: Date.now(),
        }));
        if (frameType === 'subagent_lifecycle') void loadSnapshot(activeSessionIdRef.current);
        return;
      }
      if (frameType === 'host_tool_call') {
        const requestId = stringValue(frame.id);
        const toolName = stringValue(frame.toolName, 'host tool');
        setActivities((current) => upsertActivity(current, {
          id: `host-tool-${requestId || Date.now()}`,
          title: toolName,
          detail: `Pi requested a host tool, but no iOS host tool is registered.\n${stringifyForDisplay(frame.arguments)}`,
          status: 'error',
          updatedAt: Date.now(),
        }));
        if (requestId) {
          void sendHostFrame({
            type: 'host_tool_result',
            id: requestId,
            result: {
              content: [{ type: 'text', text: `Host tool "${toolName}" is not registered in Hermes iOS` }],
              details: {},
            },
            isError: true,
          });
        }
        return;
      }
      if (frameType === 'host_tool_cancel' || frameType === 'host_uri_cancel') {
        setActivities((current) => upsertActivity(current, {
          id: `host-cancel-${stringValue(frame.targetId, Date.now().toString())}`,
          title: 'Pi host request cancelled',
          detail: stringValue(frame.targetId),
          status: 'info',
          updatedAt: Date.now(),
        }));
        return;
      }
      if (frameType === 'host_uri_request') {
        const requestId = stringValue(frame.id);
        const url = stringValue(frame.url, 'unknown URI');
        setActivities((current) => upsertActivity(current, {
          id: `host-uri-${requestId || Date.now()}`,
          title: 'Pi URI host bridge',
          detail: `Pi requested ${stringValue(frame.operation, 'read')} for ${url}, but no mobile URI scheme is registered.`,
          status: 'error',
          updatedAt: Date.now(),
        }));
        if (requestId) {
          void sendHostFrame({
            type: 'host_uri_result',
            id: requestId,
            isError: true,
            error: 'No mobile Pi URI scheme is registered for this request',
          });
        }
        return;
      }
      if (frameType === 'notice' || frameType === 'command_output' || frameType === 'response') {
        const responseError = frameType === 'response' && frame.success === false;
        const detail = frameType === 'command_output'
          ? stringValue(frame.text)
          : frameType === 'notice'
            ? stringValue(frame.message)
            : responseError
              ? stringValue(frame.error, 'Pi command failed')
              : stringifyForDisplay(frame.data) || 'Pi command completed';
        if (detail) {
          setActivities((current) => upsertActivity(current, {
            id: `notice-${Date.now()}-${current.length}`,
            title: frameType === 'notice' ? 'Pi notice' : frameType === 'command_output' ? 'Command output' : 'Pi command',
            detail,
            status: responseError || frame.level === 'error' ? 'error' : 'info',
            updatedAt: Date.now(),
          }));
        }
        return;
      }
      if (frameType === 'extension_ui_request') {
        const requestId = stringValue(frame.id);
        if (requestId) {
          const method = stringValue(frame.method);
          if (method === 'select' || method === 'confirm' || method === 'input' || method === 'editor') {
            setPendingUiRequests((current) => upsertRequest(current, frame));
          } else if (method === 'cancel') {
            const targetId = stringValue(frame.targetId);
            setPendingUiRequests((current) => current.filter((request) => stringValue(request.id) !== targetId));
          } else if (method === 'set_editor_text') {
            setInput(stringValue(frame.text));
          } else if (method === 'setTitle') {
            const title = stringValue(frame.title);
            if (title) {
              setSessions((current) => current.map((session) => (
                session.id === activeSessionIdRef.current ? { ...session, title } : session
              )));
            }
          } else if (method === 'open_url') {
            const url = stringValue(frame.launchUrl, stringValue(frame.url));
            if (url) void Linking.openURL(url).catch(() => undefined);
            setActivities((current) => upsertActivity(current, {
              id: `extension-${requestId}`,
              title: 'Pi login',
              detail: url || stringValue(frame.instructions),
              status: 'info',
              updatedAt: Date.now(),
            }));
          } else if (method === 'notify') {
            const message = stringValue(frame.message);
            if (message) {
              setActivities((current) => upsertActivity(current, {
                id: `extension-${requestId}`,
                title: stringValue(frame.title, 'Pi extension'),
                detail: message,
                status: frame.notifyType === 'error' ? 'error' : 'info',
                updatedAt: Date.now(),
              }));
            }
          } else if (method === 'setStatus' || method === 'setWidget') {
            setActivities((current) => upsertActivity(current, {
              id: `extension-${requestId}`,
              title: method === 'setStatus' ? stringValue(frame.statusKey, 'Pi status') : stringValue(frame.widgetKey, 'Pi widget'),
              detail: method === 'setStatus' ? stringValue(frame.statusText) : stringifyForDisplay(frame.widgetLines),
              status: 'info',
              updatedAt: Date.now(),
            }));
          }
        }
        return;
      }
      if (frameType === 'session_info_update' || frameType === 'model_changed' || frameType === 'config_update') {
        void loadSnapshot(activeSessionIdRef.current);
      }
    };

    void loadSnapshot(activeSessionId);
    void consume();
    return () => {
      disposed = true;
      effectAbortController.abort();
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [activeSessionId, api, applySnapshot, enabled, fixtureMode, loadSnapshot, profile, sendHostFrame]);

  const selectSession = useCallback((sessionId: string) => {
    if (!sessionId || sessionId === activeSessionIdRef.current) return;
    sessionEpochRef.current += 1;
    eventSequenceRef.current = 0;
    setSnapshot(null);
    setMessages([]);
    setActivities([]);
    setAgentTranscripts({});
    setError(null);
    setActiveSessionId(sessionId);
  }, []);

  const createSession = useCallback(async (createInput: { name?: string; workspace?: string } = {}) => {
    if (!api || !enabled || fixtureMode) {
      setError('Coding/Pi requires a connected Pi service');
      return;
    }
    setLoading(true);
    try {
      const result = await api.createSession(profile, createInput);
      setSessions((current) => [result.session, ...current.filter((session) => session.id !== result.session.id)]);
      eventSequenceRef.current = 0;
      sessionEpochRef.current += 1;
      setActiveSessionId(result.session.id);
      applySnapshot(result.snapshot);
      setError(null);
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      notifyRef.current(message);
    } finally {
      setLoading(false);
    }
  }, [api, applySnapshot, enabled, fixtureMode, profile]);

  const sendCommand = useCallback(async (command: HermesCodingPiJson) => {
    if (!api || !enabled || fixtureMode || !activeSessionIdRef.current) return null;
    try {
      const result = await api.command(profile, activeSessionIdRef.current, command);
      const response = result.response;
      if (response.success === false) {
        const detail = stringValue(response.error, 'Pi command failed');
        setError(detail);
        notifyRef.current(detail);
      }
      if (command.type === 'abort' || command.type === 'abort_and_prompt') setStreaming(false);
      if (command.type === 'get_messages' || command.type === 'get_state' || command.type === 'get_available_commands') {
        void loadSnapshot(activeSessionIdRef.current);
      }
      if (command.type === 'get_subagent_messages' && response.success !== false) {
        const agentId = stringValue(command.subagentId, 'unknown-agent');
        const data = isRecord(response.data) ? response.data : response;
        const transcript = isRecord(data) && Array.isArray(data.entries)
          ? data.entries
          : isRecord(data) && Array.isArray(data.messages)
            ? data.messages
            : data;
        setAgentTranscripts((current) => ({
          ...current,
          [agentId]: stringifyForDisplay(transcript).slice(-20_000),
        }));
      }
      return result;
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      notifyRef.current(message);
      return null;
    }
  }, [api, enabled, fixtureMode, loadSnapshot, profile]);

  const send = useCallback(async (message = input) => {
    const normalized = message.trim();
    const sessionId = activeSessionIdRef.current;
    if (!normalized || !api || !enabled || fixtureMode || !sessionId) return;
    const optimisticId = `optimistic-${Date.now()}`;
    setInput('');
    setError(null);
    setMessages((current) => [...current, {
      id: optimisticId,
      role: 'user',
      text: normalized,
      timestamp: Date.now(),
    }]);
    setStreaming(true);
    try {
      const result = await api.prompt(profile, sessionId, normalized);
      if (!result.accepted) {
        const detail = stringValue(result.response.error, 'Pi rejected the prompt');
        setError(detail);
        notifyRef.current(detail);
        setStreaming(false);
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        setInput((current) => current || normalized);
      }
    } catch (nextError) {
      const detail = errorMessage(nextError);
      setError(detail);
      notifyRef.current(detail);
      setStreaming(false);
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setInput((current) => current || normalized);
    }
  }, [api, enabled, fixtureMode, input, profile]);

  const respondToUiRequest = useCallback(async (requestId: string, response: HermesCodingPiJson) => {
    await sendCommand({ ...response, type: 'extension_ui_response', id: requestId });
    setPendingUiRequests((current) => current.filter((request) => request.id !== requestId));
  }, [sendCommand]);

  const stop = useCallback(async (force = false) => {
    if (!api || !enabled || fixtureMode || !activeSessionIdRef.current) return;
    try {
      await api.stop(profile, activeSessionIdRef.current, force);
      setStreaming(false);
      await refresh();
    } catch (nextError) {
      const detail = errorMessage(nextError);
      setError(detail);
      notifyRef.current(detail);
    }
  }, [api, enabled, fixtureMode, profile, refresh]);

  const handoff = useCallback(async (targetNodeId: string, instructions?: string) => {
    if (!api || !enabled || fixtureMode || !activeSessionIdRef.current) return;
    try {
      await api.handoff(profile, activeSessionIdRef.current, targetNodeId, instructions);
      await refresh();
      notifyRef.current(`Pi handoff requested: ${targetNodeId}`);
    } catch (nextError) {
      const detail = errorMessage(nextError);
      setError(detail);
      notifyRef.current(detail);
    }
  }, [api, enabled, fixtureMode, profile, refresh]);

  const agentCommand = useCallback(async (
    command: HermesCodingPiAgentCommand,
    agentId: string,
    text?: string,
  ) => {
    if (!api || !enabled || fixtureMode || !activeSessionIdRef.current) return;
    try {
      const result = await api.agentCommand(profile, activeSessionIdRef.current, command, agentId, text);
      applySnapshot(result.snapshot);
      notifyRef.current(`Pi Agent ${command}: ${agentId}`);
    } catch (nextError) {
      const detail = errorMessage(nextError);
      setError(detail);
      notifyRef.current(detail);
    }
  }, [api, applySnapshot, enabled, fixtureMode, profile]);

  return {
    activeSession,
    activeSessionId,
    activities,
    agentTranscripts,
    agents,
    available,
    commands,
    error,
    input,
    loading,
    messages,
    nodes,
    pendingUiRequests,
    sessions,
    snapshot,
    streaming,
    setInput,
    refresh,
    createSession,
    selectSession,
    send,
    sendCommand,
    agentCommand,
    respondToUiRequest,
    handoff,
    stop,
  };
}

async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onFrame: (eventType: string, payload: HermesCodingPiJson, sequence?: number) => void,
  onActivity?: () => void,
): Promise<void> {
  let buffer = '';
  for await (const decoded of decodeSseTextStream(body, signal)) {
    onActivity?.();
    buffer += decoded;
    while (true) {
      const boundary = /\r?\n\r?\n/.exec(buffer);
      if (!boundary || boundary.index === undefined) break;
      const frameText = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      assertSseFrameWithinLimit(frameText.length, 'Hermes coding event stream');
      parseEventFrame(frameText, onFrame);
    }
    assertSseFrameWithinLimit(buffer.length, 'Hermes coding event stream');
  }
  if (buffer.trim()) parseEventFrame(buffer, onFrame);
}

function parseEventFrame(
  frameText: string,
  onFrame: (eventType: string, payload: HermesCodingPiJson, sequence?: number) => void,
): void {
  let eventType = 'message';
  let sequence: number | undefined;
  const data: string[] = [];
  for (const line of frameText.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : '';
    if (field === 'event') eventType = value;
    else if (field === 'id') sequence = numberValue(value);
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join('\n'));
  } catch {
    throw new Error('Hermes coding event stream returned invalid JSON');
  }
  if (!isRecord(parsed)) throw new Error('Hermes coding event stream returned an invalid frame');
  onFrame(eventType, parsed, sequence);
}

function upsertMessage(current: CodingPiMessage[], next: CodingPiMessage): CodingPiMessage[] {
  const index = current.findIndex((message) => message.id === next.id);
  if (index < 0) return [...current, next];
  return current.map((message, itemIndex) => itemIndex === index ? next : message);
}

function upsertActivity(current: CodingPiActivity[], next: CodingPiActivity): CodingPiActivity[] {
  const index = current.findIndex((activity) => activity.id === next.id);
  const existing = index < 0 ? undefined : current[index];
  const mergedNext: CodingPiActivity = existing
    ? {
        ...existing,
        ...next,
        toolName: next.toolName || existing.toolName,
        args: next.args !== undefined ? next.args : existing.args,
        result: next.result !== undefined ? next.result : existing.result,
        partialResult: next.partialResult !== undefined ? next.partialResult : existing.partialResult,
        intent: next.intent || existing.intent,
      }
    : next;
  const merged = index < 0
    ? [...current, mergedNext]
    : current.map((activity, itemIndex) => itemIndex === index ? mergedNext : activity);
  return merged.slice(-32);
}

function upsertRequest(current: HermesCodingPiJson[], next: HermesCodingPiJson): HermesCodingPiJson[] {
  const requestId = stringValue(next.id);
  if (!requestId) return current;
  const index = current.findIndex((request) => stringValue(request.id) === requestId);
  if (index < 0) return [...current, next].slice(-8);
  return current.map((request, itemIndex) => itemIndex === index ? next : request);
}

function isCodingPiSnapshot(value: HermesCodingPiJson): value is HermesCodingPiJson & HermesCodingPiSnapshot {
  return isRecord(value.session) && typeof value.session.id === 'string';
}

function stringifyForDisplay(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2) || '';
  } catch {
    return String(value);
  }
}

function subagentActivityStatus(value: unknown): CodingPiActivity['status'] {
  const status = stringValue(value).toLowerCase();
  if (status.includes('fail') || status.includes('error')) return 'error';
  if (status.includes('complete') || status.includes('done') || status.includes('success')) return 'done';
  if (status.includes('run') || status.includes('progress') || status.includes('start')) return 'running';
  return 'info';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
