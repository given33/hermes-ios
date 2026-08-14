export type HostedComponentLifecycle =
  | 'declared'
  | 'waiting'
  | 'activating'
  | 'active'
  | 'quiescing'
  | 'leaving'
  | 'unloading'
  | 'recovering'
  | 'failed'
  | 'completed'
  | 'unknown';

export type HostedProviderStatus =
  | 'registering'
  | 'active'
  | 'draining'
  | 'unhealthy'
  | 'removed'
  | 'unknown';

export interface HostedComponentProjection {
  componentId: string;
  parentComponentId?: string;
  roleStage: string;
  lifecycle: HostedComponentLifecycle;
  providerRefs: string[];
  dependencyState: Record<string, unknown>;
  effectScopeId?: string;
  planNodeId?: string;
  artifactRefs: string[];
  contractRevision?: string;
  policySnapshotHash?: string;
  lastCursor: number;
  lastEventId: string;
  legacy: boolean;
  terminal: boolean;
}

export interface HostedProviderProjection {
  providerId: string;
  status: HostedProviderStatus;
  health?: string;
  generation?: number;
  lastCursor: number;
}

export type HostedSubagentStatus =
  | 'queued'
  | 'running'
  | 'steering'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export interface HostedSubagentTranscriptEntry {
  eventId: string;
  cursor: number;
  occurredAt: number;
  kind: string;
  text: string;
}

export interface HostedSubagentProjection {
  subagentId: string;
  parentId?: string;
  name?: string;
  goal?: string;
  model?: string;
  profile?: string;
  status: HostedSubagentStatus;
  runningSeconds?: number;
  acceptingSteer: boolean;
  transcript: HostedSubagentTranscriptEntry[];
  transcriptCursor: number;
  partialResult?: string;
  controlStatus?: 'steer_queued' | 'stop_requested' | 'none';
  lastCursor: number;
  lastEventId: string;
  terminal: boolean;
}

export type HostedTrajectoryRecordKind =
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'tool'
  | 'subagent'
  | 'compaction';

export type HostedTrajectoryRecordStatus = 'running' | 'complete' | 'error' | 'aborted';

export interface HostedTrajectoryRecord {
  index: number;
  eventId: string;
  cursor: number;
  turn: number;
  step?: number;
  kind: HostedTrajectoryRecordKind;
  event: string;
  summary: string;
  occurredAt: number;
  durationMs?: number;
  status: HostedTrajectoryRecordStatus;
  callId?: string;
  metadata: Record<string, unknown>;
}

export interface HostedTrajectoryTurn {
  index: number;
  id: string;
  status: 'running' | 'complete' | 'error' | 'aborted';
  records: number;
  steps: number;
  startedAt?: number;
  completedAt?: number;
}

export interface HostedTrajectoryProjection {
  schemaVersion: 1;
  detailLevel: 'summary';
  records: HostedTrajectoryRecord[];
  turns: HostedTrajectoryTurn[];
  stats: {
    turns: number;
    records: number;
    toolCalls: number;
    failedTools: number;
    subagents: number;
    compactions: number;
  };
}

export interface HostedRuntimeProjection {
  turnId: string;
  accountGeneration: string;
  components: Record<string, HostedComponentProjection>;
  providers: Record<string, HostedProviderProjection>;
  subagents: Record<string, HostedSubagentProjection>;
  trajectory: HostedTrajectoryProjection;
  seenEventIds: string[];
  lastCursor: number;
  terminal: boolean;
  hasGap: boolean;
  resetRequired: boolean;
}
