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

  constructor(private readonly client: HermesApiClient) {}

  async connect(options: HermesStudioWorkflowSocketOptions = {}): Promise<Socket> {
    const profile = options.profile || 'default';
    if (this.socket && this.socketProfile === profile) return this.socket;
    this.socket?.disconnect();
    const token = await this.client.getAccessTokenForRealtime();
    const endpoint = new URL('/workflow', `${this.client.baseUrl}/`).toString();
    const socket = io(endpoint, {
      autoConnect: false,
      auth: { token },
      query: { profile },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      timeout: 30_000,
    });
    socket.on('reconnect_attempt', () => {
      void this.client.getAccessTokenForRealtime()
        .then((nextToken) => {
          const currentAuth = socket.auth && typeof socket.auth === 'object' ? socket.auth : {};
          socket.auth = { ...currentAuth, token: nextToken };
        })
        .catch(() => undefined);
    });
    this.socket = socket;
    this.socketProfile = profile;
    socket.connect();
    return socket;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.socketProfile = '';
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
    return this.emitWithAck<{ workflowId?: string | null }, { statuses: HermesStudioWorkflowRuntimeStatus[] }>(
      'workflow.status.subscribe',
      workflowId ? { workflowId } : {},
      profile,
    ).then((data) => data.statuses);
  }

  unsubscribe(workflowId?: string | null, profile?: string | null): Promise<void> {
    return this.emitWithAck<{ workflowId?: string | null }, { ok: true }>(
      'workflow.status.unsubscribe',
      workflowId ? { workflowId } : {},
      profile,
    ).then(() => undefined);
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
}
