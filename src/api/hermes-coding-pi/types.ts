export type HermesCodingPiJson = Record<string, unknown>;

export type HermesCodingPiSessionStatus = 'running' | 'stopped' | 'error' | string;

export interface HermesCodingPiCollabLinks {
  proto: number;
  room_id: string;
  persistent: boolean;
  link: string;
  view_link: string;
  web_link: string;
  web_view_link: string;
  permissions?: {
    personal?: string;
    share?: string;
    guest_protocol?: string;
  };
}

export interface HermesCodingPiNode {
  node_id: string;
  label: string;
  kind: string;
  endpoint?: string | null;
  workspaces?: string[];
  capabilities?: string[];
  status?: string;
  last_seen?: number | null;
  local?: boolean;
}

export interface HermesCodingPiSession {
  id: string;
  title: string;
  preview: string;
  profile: string;
  workspace: string;
  provider?: string | null;
  model?: string | null;
  created_at: number;
  updated_at: number;
  status: HermesCodingPiSessionStatus;
  last_error?: string | null;
  collab?: HermesCodingPiCollabLinks | null;
}

export interface HermesCodingPiConfig {
  ok: boolean;
  enabled: boolean;
  available: boolean;
  runtime: string;
  host?: 'standalone' | 'hermes-plugin' | string;
  source_repository?: string | null;
  source_ref?: string | null;
  root?: string;
  cli?: string;
  bun?: string;
  workspace?: string;
  provider?: string | null;
  model?: string | null;
  commands?: string[];
  error?: string;
  node_id?: string;
  remote_node_id?: string | null;
  remote?: boolean;
  nodes?: HermesCodingPiNode[];
}

export interface HermesCodingPiSnapshot {
  session: HermesCodingPiSession;
  state: HermesCodingPiJson | null;
  messages: unknown;
  commands: HermesCodingPiJson | null;
  subagents?: HermesCodingPiJson | null;
  sequence: number;
}

export interface HermesCodingPiSessionListResponse {
  sessions: HermesCodingPiSession[];
}

export interface HermesCodingPiCreateResponse {
  session: HermesCodingPiSession;
  snapshot: HermesCodingPiSnapshot;
}

export interface HermesCodingPiPromptResponse {
  accepted: boolean;
  response: HermesCodingPiJson;
  session: HermesCodingPiSession;
}

export interface HermesCodingPiCommandResponse {
  response: HermesCodingPiJson;
  session: HermesCodingPiSession;
}

export type HermesCodingPiAgentCommand = 'chat' | 'kill' | 'revive';

export interface HermesCodingPiAgentCommandResponse {
  accepted: boolean;
  session: HermesCodingPiSession;
  snapshot: HermesCodingPiSnapshot;
}

export interface HermesCodingPiStopResponse {
  session: HermesCodingPiSession;
}

export interface HermesCodingPiEvent {
  sequence: number;
  frame: HermesCodingPiJson;
}

export interface HermesCodingPiSnapshotEvent {
  snapshot: HermesCodingPiSnapshot;
}
