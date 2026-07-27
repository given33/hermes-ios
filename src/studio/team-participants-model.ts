import type { HermesChatAvatarRole } from '../api/chat-view-model';

/**
 * Pure mapping from persisted hosted-workflow events to the group-chat team
 * roster. Mirrors the server contract in plugins/collaboration/dashboard:
 * participants[] carries stable identity (id/role/display_name/node/
 * avatar_seed) and every stage event carries member_id. Live states are
 * derived only from persisted events, never invented client side.
 */

export type TeamMemberRole = 'manager' | 'reporter' | 'reviewer' | 'supervisor' | 'worker';

export type TeamMemberLiveState =
  | 'done'
  | 'executing'
  | 'failed'
  | 'idle'
  | 'reporting'
  | 'reviewing'
  | 'thinking'
  | 'typing';

/** Server participants[] entry exactly as persisted by the dashboard plugin. */
export interface TeamParticipantIdentity {
  avatar_seed?: string;
  display_name?: string;
  id?: string;
  joined_at?: number;
  node?: string;
  role?: string;
}

/** Structural subset of HermesChatViewMessage consumed by the roster. */
export interface TeamTimelineEvent {
  completedAt?: number;
  content?: string;
  createdAt?: number;
  durationMs?: number;
  firstTokenAt?: number;
  id?: string;
  memberId?: string;
  name?: string;
  profile?: string;
  rawRoleStage?: string;
  role?: string;
  roleStage?: string;
  startedAt?: number;
  status?: string;
  updatedAt?: number;
}

export interface TeamRosterEntry {
  avatarRole: HermesChatAvatarRole;
  avatarSeed: string;
  displayName: string;
  elapsedMs: number;
  id: string;
  joinedAt?: number;
  lastEventAt?: number;
  node: string;
  reworkRounds: number;
  role: TeamMemberRole;
  state: TeamMemberLiveState;
}

const MANAGER_MEMBER_ID = 'dbb3-manager';

const MEMBER_NODES: Record<string, string> = {
  [MANAGER_MEMBER_ID]: 'dbb3',
  'dbb3-worker': 'dbb3',
  'pc-worker': 'wsl',
  default: 'main',
  reviewer: 'dbb3',
  supervisor: 'dbb3',
};

const HOSTED_STAGE_BASES = new Set([
  'dispatch',
  'dispatcher',
  'manager_handoff',
  'manager_planning',
  'reporter',
  'reviewer',
  'supervisor',
  'worker',
  'workflow',
]);

const RUNNING_STATUSES = new Set(['queued', 'running', 'starting', 'streaming']);
const FAILED_STATUSES = new Set(['blocked', 'cancelled', 'canceled', 'failed', 'stopped']);

function stageBase(stage: string): string {
  return stage.trim().toLowerCase().split(/[.:]/, 1)[0] || '';
}

function eventStageBase(event: TeamTimelineEvent): string {
  return stageBase(event.rawRoleStage || '') || stageBase(event.roleStage || '');
}

/** Whether one timeline entry belongs to the hosted agent team (not user/chat). */
export function isHostedTeamEvent(event: TeamTimelineEvent): boolean {
  if ((event.role || 'assistant') === 'user') return false;
  if ((event.memberId || '').trim() && event.roleStage !== 'chat') return true;
  const base = eventStageBase(event);
  return HOSTED_STAGE_BASES.has(base) || base.startsWith('manager');
}

/** Canonical member id for one event; mirrors the server hosted_member_id. */
export function teamMemberIdForEvent(event: TeamTimelineEvent): string {
  const explicit = (event.memberId || '').trim();
  if (explicit) return explicit;
  const profile = (event.profile || '').trim().toLowerCase();
  const base = eventStageBase(event);
  if (
    profile === MANAGER_MEMBER_ID
    || profile === 'dispatcher'
    || profile === 'manager'
    || base.startsWith('manager')
    || base === 'dispatch'
    || base === 'dispatcher'
    || base === 'workflow'
  ) {
    return MANAGER_MEMBER_ID;
  }
  if (base === 'worker') {
    // Single-worker turns use the bare "worker" stage; the profile names the lane.
    return profile || stageSegment(event, 1) || 'dbb3-worker';
  }
  if (base === 'reviewer') return 'reviewer';
  if (base === 'supervisor') return profile || 'supervisor';
  if (base === 'reporter') return profile || 'default';
  return profile;
}

function stageSegment(event: TeamTimelineEvent, index: number): string {
  const raw = (event.rawRoleStage || '').trim().toLowerCase();
  if (!raw) return '';
  const segment = raw.split(':')[index] || '';
  return /^rework$|^\d+$/.test(segment) ? '' : segment;
}

export function teamMemberRoleFor(memberId: string, stageHint = ''): TeamMemberRole {
  const normalized = memberId.trim().toLowerCase();
  if (normalized === MANAGER_MEMBER_ID || normalized === 'dispatcher') return 'manager';
  if (/supervis/.test(normalized)) return 'supervisor';
  if (/review/.test(normalized)) return 'reviewer';
  if (/worker/.test(normalized)) return 'worker';
  const base = stageBase(stageHint);
  if (base === 'worker') return 'worker';
  if (base === 'reviewer') return 'reviewer';
  if (base === 'supervisor') return 'supervisor';
  return 'reporter';
}

export function teamMemberAvatarRole(memberId: string, role: TeamMemberRole): HermesChatAvatarRole {
  if (role === 'manager') return 'dispatcher';
  if (role === 'worker') {
    return /pc|wsl|windows|local/.test(memberId) ? 'pc-worker' : 'dbb3-worker';
  }
  return role;
}

function defaultDisplayName(memberId: string, role: TeamMemberRole, isChinese: boolean): string {
  const zh: Record<string, string> = {
    [MANAGER_MEMBER_ID]: 'Hermes 调度员',
    'dbb3-worker': 'DBB3 执行员',
    'pc-worker': 'PC/WSL 执行员',
    default: 'Hermes 汇报员',
    reviewer: 'Hermes 审阅员',
    supervisor: 'Hermes 监督者',
  };
  const en: Record<string, string> = {
    [MANAGER_MEMBER_ID]: 'Hermes Manager',
    'dbb3-worker': 'DBB3 Worker',
    'pc-worker': 'PC/WSL Worker',
    default: 'Hermes Reporter',
    reviewer: 'Hermes Reviewer',
    supervisor: 'Hermes Supervisor',
  };
  const names = isChinese ? zh : en;
  if (names[memberId]) return names[memberId];
  if (role === 'worker') return memberId || (isChinese ? '执行员' : 'Worker');
  return memberId || 'Hermes';
}

function eventStartAt(event: TeamTimelineEvent): number {
  return event.startedAt || event.createdAt || 0;
}

function eventEndAt(event: TeamTimelineEvent, now: number): number {
  if (RUNNING_STATUSES.has((event.status || '').toLowerCase())) return now;
  return event.completedAt || event.updatedAt || eventStartAt(event);
}

/**
 * Highest rework round one event belongs to; 0 for first-pass work. A
 * `rework-request:N` rejection is produced by the review round before the
 * Nth rework, so it counts toward round N-1.
 */
export function eventReworkRound(event: TeamTimelineEvent): number {
  const raw = (event.rawRoleStage || '').toLowerCase();
  const request = raw.match(/rework-request:(\d+)/);
  if (request) return Math.max(0, Number(request[1]) - 1);
  const match = raw.match(/rework:(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** Badge value: how many rework rounds this member has been through. */
export function eventReworkBadge(event: TeamTimelineEvent): number {
  const raw = (event.rawRoleStage || '').toLowerCase();
  const match = raw.match(/rework(?:-request)?:(\d+)/);
  return match ? Number(match[1]) : 0;
}

function memberLiveState(
  role: TeamMemberRole,
  events: readonly TeamTimelineEvent[],
): TeamMemberLiveState {
  if (!events.length) return 'idle';
  const latest = events[events.length - 1];
  const status = (latest.status || 'completed').toLowerCase();
  if (FAILED_STATUSES.has(status)) return 'failed';
  if (!RUNNING_STATUSES.has(status)) return 'done';
  if (status === 'queued') return 'typing';
  if (role === 'worker') return 'executing';
  if (role === 'reviewer') return 'reviewing';
  if (role === 'reporter') return 'reporting';
  // Manager and supervisor: typing while their message streams, thinking before.
  return latest.firstTokenAt || (latest.content || '').trim() ? 'typing' : 'thinking';
}

/**
 * Per-member elapsed time. Events of one stage and rework round share a
 * wall-clock segment (opening/progress/handoff snapshots reuse the same
 * started_at), so elapsed sums stage segments instead of double counting.
 */
function memberElapsedMs(events: readonly TeamTimelineEvent[], now: number): number {
  const segments = new Map<string, { end: number; start: number }>();
  for (const event of events) {
    const start = eventStartAt(event);
    if (!start) continue;
    const key = `${eventStageBase(event) || event.roleStage || ''}:${eventReworkRound(event)}`;
    const end = Math.max(start, eventEndAt(event, now));
    const segment = segments.get(key);
    if (!segment) {
      segments.set(key, { end, start });
      continue;
    }
    segment.start = Math.min(segment.start, start);
    segment.end = Math.max(segment.end, end);
  }
  let total = 0;
  for (const segment of segments.values()) total += segment.end - segment.start;
  return total;
}

/**
 * Later events with the same id replace earlier snapshots (the SSE stream and
 * fixtures both publish running snapshots that a terminal event supersedes).
 */
function collapseEventsById(events: readonly TeamTimelineEvent[]): TeamTimelineEvent[] {
  const order: string[] = [];
  const byId = new Map<string, TeamTimelineEvent>();
  let anonymous = 0;
  for (const event of events) {
    const key = event.id || `anonymous-${anonymous++}`;
    const existing = byId.get(key);
    if (existing) {
      byId.set(key, { ...existing, ...event });
    } else {
      byId.set(key, event);
      order.push(key);
    }
  }
  return order.map((key) => byId.get(key) as TeamTimelineEvent);
}

export function teamRoster({
  events,
  isChinese = true,
  now = Date.now(),
  participants = [],
}: {
  events: readonly TeamTimelineEvent[];
  isChinese?: boolean;
  now?: number;
  participants?: readonly TeamParticipantIdentity[];
}): TeamRosterEntry[] {
  const byMember = new Map<string, TeamTimelineEvent[]>();
  const discoveredOrder: string[] = [];
  const sorted = collapseEventsById(events)
    .filter(isHostedTeamEvent)
    .sort((left, right) => eventStartAt(left) - eventStartAt(right));
  for (const event of sorted) {
    const memberId = teamMemberIdForEvent(event);
    if (!memberId) continue;
    const bucket = byMember.get(memberId);
    if (bucket) {
      bucket.push(event);
    } else {
      byMember.set(memberId, [event]);
      discoveredOrder.push(memberId);
    }
  }

  // Server join order is authoritative; event-only members follow it.
  const order: string[] = [];
  const identities = new Map<string, TeamParticipantIdentity>();
  for (const participant of participants) {
    const id = (participant.id || '').trim();
    if (!id || identities.has(id)) continue;
    identities.set(id, participant);
    order.push(id);
  }
  for (const memberId of discoveredOrder) {
    if (!identities.has(memberId)) {
      identities.set(memberId, {});
      order.push(memberId);
    }
  }

  return order.map((memberId) => {
    const identity = identities.get(memberId) || {};
    const memberEvents = byMember.get(memberId) || [];
    const stageHint = memberEvents.length
      ? memberEvents[memberEvents.length - 1].rawRoleStage
        || memberEvents[memberEvents.length - 1].roleStage
        || ''
      : '';
    const role = (identity.role as TeamMemberRole)
      || teamMemberRoleFor(memberId, stageHint);
    const latest = memberEvents[memberEvents.length - 1];
    return {
      avatarRole: teamMemberAvatarRole(memberId, role),
      avatarSeed: identity.avatar_seed || `hermes-member-${memberId}`,
      // The server roster ships Chinese display names; English rendering
      // falls back to the localized defaults for the same member id.
      displayName: identity.display_name && !isChinese
        ? defaultDisplayName(memberId, role, false)
        : identity.display_name || defaultDisplayName(memberId, role, isChinese),
      elapsedMs: memberElapsedMs(memberEvents, now),
      id: memberId,
      joinedAt: identity.joined_at || undefined,
      lastEventAt: latest
        ? latest.updatedAt || latest.completedAt || eventStartAt(latest) || undefined
        : undefined,
      node: identity.node || MEMBER_NODES[memberId] || 'main',
      reworkRounds: memberEvents.reduce(
        (rounds, event) => Math.max(rounds, eventReworkBadge(event)),
        0,
      ),
      role,
      state: memberLiveState(role, memberEvents),
    };
  });
}

export function teamMemberRoleLabel(role: TeamMemberRole, isChinese: boolean): string {
  if (!isChinese) {
    return {
      manager: 'Manager',
      reporter: 'Reporter',
      reviewer: 'Reviewer',
      supervisor: 'Supervisor',
      worker: 'Worker',
    }[role];
  }
  return {
    manager: '调度',
    reporter: '汇报',
    reviewer: '审阅',
    supervisor: '监督',
    worker: '执行',
  }[role];
}

export function teamMemberStateLabel(state: TeamMemberLiveState, isChinese: boolean): string {
  if (!isChinese) {
    return {
      done: 'Done',
      executing: 'Executing',
      failed: 'Failed',
      idle: 'Standby',
      reporting: 'Reporting',
      reviewing: 'Reviewing',
      thinking: 'Thinking',
      typing: 'Typing',
    }[state];
  }
  return {
    done: '已完成',
    executing: '执行中',
    failed: '已失败',
    idle: '待命',
    reporting: '汇报中',
    reviewing: '审阅中',
    thinking: '思考中',
    typing: '正在输入',
  }[state];
}

export function teamNodeLabel(node: string): string {
  const normalized = node.trim().toLowerCase();
  if (normalized === 'dbb3') return 'DBB3';
  if (normalized === 'wsl') return 'WSL';
  if (normalized === 'main') return 'Main';
  return node.toUpperCase();
}

export function formatTeamElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}
