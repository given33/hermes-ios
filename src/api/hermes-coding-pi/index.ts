import type { HermesApiClient } from '../HermesApiClient';
import { CODING_PI_ORIGIN } from '../../config';
import NetInfo from '@react-native-community/netinfo';
import type {
  HermesCodingPiCommandResponse,
  HermesCodingPiCollabLinks,
  HermesCodingPiConfig,
  HermesCodingPiCreateResponse,
  HermesCodingPiAgentCommand,
  HermesCodingPiAgentCommandResponse,
  HermesCodingPiJson,
  HermesCodingPiNode,
  HermesCodingPiPromptResponse,
  HermesCodingPiSessionListResponse,
  HermesCodingPiSnapshot,
  HermesCodingPiStopResponse,
} from './types';

const HERMES_CODING_PI_BASE = '/api/plugins/coding-pi';
const STANDALONE_CODING_PI_BASE = '/api/coding-pi';

export interface HermesCodingPiCreateInput {
  name?: string;
  workspace?: string;
  provider?: string;
  model?: string;
  args?: string[];
}

export class HermesCodingPiApi {
  private readonly client: HermesApiClient;
  private readonly standaloneOrigin: string;
  private activeStandaloneOrigin: string | null = null;
  private discoveryInFlight: Promise<string | null> | null = null;
  private coordinatorNodeId: string | null = null;
  private coordinatorConfigInFlight: Promise<HermesCodingPiConfig | null> | null = null;

  constructor(client: HermesApiClient) {
    this.client = client;
    this.standaloneOrigin = CODING_PI_ORIGIN.trim();
    this.activeStandaloneOrigin = this.standaloneOrigin || null;
  }

  async getConfig(): Promise<HermesCodingPiConfig> {
    try {
      const config = this.coordinatorNodeId && !this.activeStandaloneOrigin
        ? await this.client.request<HermesCodingPiConfig>(`${HERMES_CODING_PI_BASE}/config`)
        : await this.request<HermesCodingPiConfig>('/config');
      this.adoptCoordinatorConfig(config);
      return config;
    } catch (error) {
      // A stale LAN origin must not hide a healthy coordinator response. This
      // second probe is also how an app with no fixed Pi origin learns that a
      // logged-in local PC is currently connected through the reverse tunnel.
      const coordinatorConfig = await this.discoverCoordinatorConfig();
      if (coordinatorConfig) return coordinatorConfig;
      throw error;
    }
  }

  listSessions(profile: string): Promise<HermesCodingPiSessionListResponse> {
    return this.request<HermesCodingPiSessionListResponse>('/sessions', { profile });
  }

  createSession(profile: string, input: HermesCodingPiCreateInput = {}): Promise<HermesCodingPiCreateResponse> {
    return this.request<HermesCodingPiCreateResponse>('/sessions', {
      method: 'POST',
      profile,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  getSession(profile: string, sessionId: string): Promise<HermesCodingPiSnapshot> {
    return this.request<HermesCodingPiSnapshot>(`/sessions/${encodeURIComponent(sessionId)}`, { profile });
  }

  getCollabLinks(profile: string, sessionId: string): Promise<HermesCodingPiCollabLinks> {
    return this.request<{ collab: HermesCodingPiCollabLinks }>(`/sessions/${encodeURIComponent(sessionId)}/collab`, { profile })
      .then((result) => result.collab);
  }

  listNodes(): Promise<{ nodes: HermesCodingPiNode[]; local_node_id: string }> {
    return this.request<{ nodes: HermesCodingPiNode[]; local_node_id: string }>('/nodes');
  }

  handoff(profile: string, sessionId: string, targetNodeId: string, instructions?: string): Promise<HermesCodingPiJson> {
    return this.request<HermesCodingPiJson>(`/sessions/${encodeURIComponent(sessionId)}/handoff`, {
      method: 'POST',
      profile,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_node_id: targetNodeId, ...(instructions ? { instructions } : {}) }),
    });
  }

  prompt(
    profile: string,
    sessionId: string,
    message: string,
    options: { images?: unknown[]; streamingBehavior?: 'steer' | 'followUp' } = {},
  ): Promise<HermesCodingPiPromptResponse> {
    return this.request<HermesCodingPiPromptResponse>(`/sessions/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      profile,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        ...(options.images?.length ? { images: options.images } : {}),
        ...(options.streamingBehavior ? { streaming_behavior: options.streamingBehavior } : {}),
      }),
    });
  }

  command(profile: string, sessionId: string, command: HermesCodingPiJson): Promise<HermesCodingPiCommandResponse> {
    return this.request<HermesCodingPiCommandResponse>(`/sessions/${encodeURIComponent(sessionId)}/command`, {
      method: 'POST',
      profile,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
  }

  agentCommand(
    profile: string,
    sessionId: string,
    command: HermesCodingPiAgentCommand,
    agentId: string,
    text?: string,
  ): Promise<HermesCodingPiAgentCommandResponse> {
    return this.request<HermesCodingPiAgentCommandResponse>(`/sessions/${encodeURIComponent(sessionId)}/agent-command`, {
      method: 'POST',
      profile,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, agent_id: agentId, ...(text ? { text } : {}) }),
    });
  }

  stop(profile: string, sessionId: string, force = false): Promise<HermesCodingPiStopResponse> {
    return this.request<HermesCodingPiStopResponse>(`/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
      profile,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
  }

  openEvents(profile: string, sessionId: string, after: number, signal: AbortSignal): Promise<Response> {
    return this.openEventStream(`/sessions/${encodeURIComponent(sessionId)}/events`, {
      profile,
      query: { after },
      signal,
    });
  }

  private async request<T>(path: string, options: Parameters<HermesApiClient['request']>[1] = {}): Promise<T> {
    const standalone = this.activeStandaloneOrigin;
    if (!standalone) {
      return this.coordinatorNodeId
        ? this.requestThroughCoordinator<T>(path, options)
        : this.client.request<T>(`${HERMES_CODING_PI_BASE}${path}`, options);
    }
    try {
      return await this.client.forCompanionOrigin(standalone).request<T>(`${STANDALONE_CODING_PI_BASE}${path}`, options);
    } catch (error) {
      const discovered = await this.discoverLocalOrigin();
      if (discovered && discovered !== standalone) {
        return this.client.forCompanionOrigin(discovered).request<T>(`${STANDALONE_CODING_PI_BASE}${path}`, options);
      }
      const coordinatorConfig = await this.discoverCoordinatorConfig();
      if (coordinatorConfig?.remote_node_id) return this.requestThroughCoordinator<T>(path, options);
      throw error;
    }
  }

  private async openEventStream(path: string, options: Parameters<HermesApiClient['openEventStream']>[1]): Promise<Response> {
    const standalone = this.activeStandaloneOrigin;
    if (!standalone) return this.client.openEventStream(`${HERMES_CODING_PI_BASE}${path}`, options);
    try {
      return await this.client.forCompanionOrigin(standalone).openEventStream(`${STANDALONE_CODING_PI_BASE}${path}`, options);
    } catch (error) {
      const discovered = await this.discoverLocalOrigin();
      if (discovered && discovered !== standalone) {
        return this.client.forCompanionOrigin(discovered).openEventStream(`${STANDALONE_CODING_PI_BASE}${path}`, options);
      }
      const coordinatorConfig = await this.discoverCoordinatorConfig();
      if (coordinatorConfig?.remote_node_id) return this.openCoordinatorEventStream(path, options);
      throw error;
    }
  }

  private requestThroughCoordinator<T>(path: string, options: Parameters<HermesApiClient['request']>[1]): Promise<T> {
    if (!this.coordinatorNodeId) return this.client.request<T>(`${HERMES_CODING_PI_BASE}${path}`, options);
    const node = encodeURIComponent(this.coordinatorNodeId);
    return this.client.request<T>(
      `${HERMES_CODING_PI_BASE}/nodes/${node}/proxy${STANDALONE_CODING_PI_BASE}${path}`,
      options,
    );
  }

  private openCoordinatorEventStream(
    path: string,
    options: Parameters<HermesApiClient['openEventStream']>[1],
  ): Promise<Response> {
    if (!this.coordinatorNodeId) return this.client.openEventStream(`${HERMES_CODING_PI_BASE}${path}`, options);
    const node = encodeURIComponent(this.coordinatorNodeId);
    return this.client.openEventStream(
      `${HERMES_CODING_PI_BASE}/nodes/${node}/proxy${STANDALONE_CODING_PI_BASE}${path}`,
      options,
    );
  }

  private adoptCoordinatorConfig(config: HermesCodingPiConfig): void {
    const remoteNodeId = config.remote_node_id?.trim();
    if (remoteNodeId) {
      this.coordinatorNodeId = remoteNodeId;
    } else if (!this.activeStandaloneOrigin) {
      this.coordinatorNodeId = null;
    }
  }

  private async discoverCoordinatorConfig(): Promise<HermesCodingPiConfig | null> {
    if (this.coordinatorConfigInFlight) return this.coordinatorConfigInFlight;
    this.coordinatorConfigInFlight = this.client
      .request<HermesCodingPiConfig>(`${HERMES_CODING_PI_BASE}/config`)
      .then((config) => {
        this.adoptCoordinatorConfig(config);
        return config;
      })
      .catch(() => null)
      .finally(() => {
        this.coordinatorConfigInFlight = null;
      });
    return this.coordinatorConfigInFlight;
  }

  /**
   * A LAN address is a transport detail, not a Pi node identity. When a
   * router assigns a new address, probe the phone's current IPv4 subnet and
   * adopt the first healthy Pi service. This is only reachable for a local
   * HTTP origin; public HTTPS deployments continue using their stable origin.
   */
  private async discoverLocalOrigin(): Promise<string | null> {
    if (!this.standaloneOrigin || this.discoveryInFlight) return this.discoveryInFlight;
    this.discoveryInFlight = discoverPiOrigin(this.standaloneOrigin)
      .then((origin) => {
        if (origin) this.activeStandaloneOrigin = origin;
        return origin;
      })
      .finally(() => {
        this.discoveryInFlight = null;
      });
    return this.discoveryInFlight;
  }
}

async function discoverPiOrigin(seedOrigin: string): Promise<string | null> {
  let seed: URL;
  try {
    seed = new URL(seedOrigin);
  } catch {
    return null;
  }
  if (seed.protocol !== 'http:' || !isPrivateIpv4(seed.hostname)) return null;
  let state;
  try {
    state = await NetInfo.fetch();
  } catch {
    return null;
  }
  const details = state.details as { ipAddress?: string | null; subnet?: string | null } | null;
  const phoneIp = details?.ipAddress || '';
  if (!isPrivateIpv4(phoneIp)) return null;
  const ports = [seed.port || '8787', '8786'].filter((port, index, all) => all.indexOf(port) === index);
  const maxConcurrent = 24;
  for (const port of ports) {
    const candidates = subnetCandidates(phoneIp, details?.subnet || '255.255.255.0', port);
    const seedCandidate = `${phoneIp}:${port}`;
    const ordered = [`${seed.hostname}:${port}`, seedCandidate, ...candidates.filter((candidate) => candidate !== seedCandidate)];
    for (let offset = 0; offset < ordered.length; offset += maxConcurrent) {
      const batch = ordered.slice(offset, offset + maxConcurrent);
      const found = await Promise.all(batch.map((host) => probePiCandidate(host)));
      const match = found.find((origin): origin is string => Boolean(origin));
      if (match) return match;
    }
  }
  return null;
}

async function probePiCandidate(host: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);
  const origin = `http://${host}`;
  try {
    const response = await fetch(`${origin}/api/coding-pi/health`, { signal: controller.signal });
    if (response.ok) {
      const body = await response.json() as { runtime?: string };
      if (body.runtime === 'oh-my-pi-rpc') return origin.replace(/:\d+$/, `:${new URL(origin).port || '8787'}`);
    }
  } catch {
    // Try the bootstrap agent below; a stopped Pi service is expected here.
  } finally {
    clearTimeout(timeout);
  }

  const agentController = new AbortController();
  const agentTimeout = setTimeout(() => agentController.abort(), 700);
  try {
    const response = await fetch(`${origin}/health`, { signal: agentController.signal });
    if (!response.ok) return null;
    const body = await response.json() as { service?: string; service_origin?: string };
    if (body.service !== 'pi-node-agent') return null;
    const serviceOrigin = replaceLoopbackOrigin(body.service_origin || 'http://127.0.0.1:8787', host);
    try {
      await fetch(`${origin}/wake`, { method: 'POST' });
    } catch {
      return null;
    }
    // Bun/native addon startup can take several seconds on a cold Windows
    // login. Do not hand the caller an origin until the actual Pi API is
    // healthy; otherwise the first create-session request races the child
    // process and surfaces a misleading transient 422/connection error.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await wait(500);
      const healthController = new AbortController();
      const healthTimeout = setTimeout(() => healthController.abort(), 1_000);
      try {
        const serviceResponse = await fetch(`${serviceOrigin}/api/coding-pi/health`, { signal: healthController.signal });
        if (serviceResponse.ok) {
          const serviceBody = await serviceResponse.json() as { runtime?: string };
          if (serviceBody.runtime === 'oh-my-pi-rpc') return serviceOrigin;
        }
      } catch {
        // The child is still booting; keep the short bounded retry period.
      } finally {
        clearTimeout(healthTimeout);
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(agentTimeout);
  }
}

function replaceLoopbackOrigin(value: string, discoveredHost: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') {
      const hostName = discoveredHost.split(':')[0];
      url.hostname = hostName;
    }
    return url.origin;
  } catch {
    return `http://${discoveredHost.replace(/:\d+$/, '')}:8787`;
  }
}

function subnetCandidates(ip: string, subnet: string, port: string): string[] {
  const ipParts = parseIpv4(ip);
  const maskParts = parseIpv4(subnet);
  if (!ipParts || !maskParts) return [];
  const network = ipParts.map((part, index) => part & maskParts[index]);
  const broadcast = network.map((part, index) => part | (~maskParts[index] & 255));
  const result: string[] = [];
  for (let last = network[3] + 1; last < broadcast[3]; last += 1) {
    result.push(`${network[0]}.${network[1]}.${network[2]}.${last}:${port}`);
  }
  return result;
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split('.').map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts as [number, number, number, number]
    : null;
}

function isPrivateIpv4(value: string): boolean {
  const parts = parseIpv4(value);
  if (!parts) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export * from './types';
