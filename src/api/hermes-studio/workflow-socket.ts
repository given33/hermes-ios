import { io, type Socket } from 'socket.io-client';

import type { HermesApiClient } from '../HermesApiClient';
import type {
  HermesStudioWorkflowRecord,
  HermesStudioWorkflowRuntimeStatus,
} from './types';

interface WorkflowSocketAck<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface HermesStudioWorkflowSocketOptions {
  profile?: string | null;
}

export class HermesStudioWorkflowSocketApi {
  private socket: Socket | null = null;
  private socketProfile = '';
  private readonly desiredSubscriptions = new Map<string, {
    profile: string;
    workflowId: string | null;
  }>();
  private replayInFlight: Promise<void> | null = null;
  private socketEpoch = 0;

  constructor(private readonly client: HermesApiClient) {}

  async connect(options: HermesStudioWorkflowSocketOptions = {}): Promise<Socket> {
    const profile = options.profile || 'default';
    if (this.socket && this.socketProfile === profile) return this.socket;
    this.socketEpoch += 1;
    this.desiredSubscriptions.clear();
    this.socket?.disconnect();
    const endpoint = new URL('/workflow', `${this.client.baseUrl}/`).toString();
    let authUnavailable = false;
    const socket = io(endpoint, {
      autoConnect: false,
      // Socket.IO invokes an auth callback for every namespace handshake,
      // including reconnects. Fetching here avoids the reconnect_attempt
      // race where the manager starts a handshake before an async token
      // refresh has completed.
      auth: (callback) => {
        void this.client.getAccessTokenForRealtime()
          .then((token) => {
            authUnavailable = false;
            callback({ token });
          })
          .catch(() => {
            // An expired/temporarily unavailable session must not become an
            // infinite empty-token reconnect loop. The caller can invoke
            // connect again after auth recovery.
            authUnavailable = true;
            callback({ token: '' });
          });
      },
      query: { profile },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      timeout: 30_000,
    });
    // Socket.IO creates a new server-side subscription for every transport
    // connection. Re-apply the official workflow subscription after the
    // socket's `connect` event so a mobile network handoff cannot leave the
    // page silently stuck on its last status snapshot.
    socket.on('connect', () => {
      if (this.socket !== socket) return;
      void this.replaySubscriptions(socket).catch(() => undefined);
    });
    socket.on('connect_error', () => {
      if (!authUnavailable || this.socket !== socket) return;
      socket.io.opts.reconnection = false;
      socket.disconnect();
      this.socket = null;
      this.socketProfile = '';
    });
    this.socket = socket;
    this.socketProfile = profile;
    socket.connect();
    return socket;
  }

  disconnect(): void {
    this.socketEpoch += 1;
    this.socket?.disconnect();
    this.socket = null;
    this.socketProfile = '';
    this.desiredSubscriptions.clear();
    this.replayInFlight = null;
  }

  async listWorkflows(profile?: string | null): Promise<HermesStudioWorkflowRecord[]> {
    const data = await this.emitWithAck<{ profile?: string | null }, { workflows: HermesStudioWorkflowRecord[] }>(
      'workflows.list',
      profile ? { profile } : {},
      profile,
    );
    return data.workflows;
  }

  subscribe(workflowId?: string | null, profile?: string | null): Promise<HermesStudioWorkflowRuntimeStatus[]> {
    const normalizedProfile = profile || this.socketProfile || 'default';
    const normalizedWorkflowId = workflowId || null;
    return this.emitWithAck<{ workflowId?: string | null }, { statuses: HermesStudioWorkflowRuntimeStatus[] }>(
      'workflow.status.subscribe',
      normalizedWorkflowId ? { workflowId: normalizedWorkflowId } : {},
      normalizedProfile,
    ).then((data) => {
      this.desiredSubscriptions.set(
        this.subscriptionKey(normalizedProfile, normalizedWorkflowId),
        { profile: normalizedProfile, workflowId: normalizedWorkflowId },
      );
      return data.statuses;
    });
  }

  unsubscribe(workflowId?: string | null, profile?: string | null): Promise<void> {
    const normalizedProfile = profile || this.socketProfile || 'default';
    const normalizedWorkflowId = workflowId || null;
    return this.emitWithAck<{ workflowId?: string | null }, { ok: true }>(
      'workflow.status.unsubscribe',
      normalizedWorkflowId ? { workflowId: normalizedWorkflowId } : {},
      normalizedProfile,
    ).then(() => {
      this.desiredSubscriptions.delete(
        this.subscriptionKey(normalizedProfile, normalizedWorkflowId),
      );
    });
  }

  onStatus(handler: (status: HermesStudioWorkflowRuntimeStatus) => void): () => void {
    const socket = this.socket;
    if (!socket) return () => undefined;
    socket.on('workflow.status.updated', handler);
    return () => socket.off('workflow.status.updated', handler);
  }

  onError(handler: (error: { workflowId: string; runId: string | null; error: string }) => void): () => void {
    const socket = this.socket;
    if (!socket) return () => undefined;
    socket.on('workflow.status.error', handler);
    return () => socket.off('workflow.status.error', handler);
  }

  private async emitWithAck<TRequest, TResponse>(
    event: string,
    request: TRequest,
    profile?: string | null,
  ): Promise<TResponse> {
    const socket = await this.connect({ profile });
    return new Promise((resolve, reject) => {
      socket.timeout(30_000).emit(
        event,
        request,
        (error: Error | null, response: WorkflowSocketAck<TResponse>) => {
          if (error) {
            reject(error);
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || `${event} failed`));
            return;
          }
          resolve(response.data as TResponse);
        },
      );
    });
  }

  private subscriptionKey(profile: string, workflowId: string | null): string {
    return `${profile}\u0000${workflowId || '*'}`;
  }

  private replaySubscriptions(socket: Socket): Promise<void> {
    if (this.replayInFlight) return this.replayInFlight;
    const epoch = this.socketEpoch;
    const replay = (async () => {
      for (const subscription of this.desiredSubscriptions.values()) {
        if (this.socket !== socket || this.socketEpoch !== epoch || !socket.connected) return;
        await new Promise<void>((resolve, reject) => {
          socket.timeout(30_000).emit(
            'workflow.status.subscribe',
            subscription.workflowId ? { workflowId: subscription.workflowId } : {},
            (error: Error | null, response?: WorkflowSocketAck<unknown>) => {
              if (error) {
                reject(error);
                return;
              }
              if (!response?.ok) {
                reject(new Error(response?.error || 'workflow.status.subscribe failed during replay'));
                return;
              }
              resolve();
            },
          );
        });
      }
    })();
    this.replayInFlight = replay;
    const clearReplay = () => {
      // An overlapping profile switch may already have started another
      // replay. Do not let the old promise clear the new one.
      if (this.replayInFlight === replay) this.replayInFlight = null;
    };
    void replay.then(clearReplay, clearReplay);
    return replay;
  }
}
