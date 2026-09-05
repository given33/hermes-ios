import { truncateByCodePoints } from '../api/text-clamp';
import {
  messageDurationMs,
  messageIsRunning,
  messageStatusLabel,
  type HermesChatActivity,
  type HermesChatViewMessage,
} from '../api/chat-view-model';

export type TimelinePhaseTone = 'cancelled' | 'failed' | 'ok' | 'running';

export interface TimelinePhaseChip {
  label: string;
  tone: TimelinePhaseTone;
}

export interface TimelineEntryLiveState {
  id: string;
  running: boolean;
}

/**
 * Collapse bookkeeping for the per-turn activity timeline. `pinnedIds` are
 * entries the user toggled by hand; automatic expansion of the in-flight step
 * (and automatic collapse once it settles) never overrides a pinned entry.
 */
export interface TimelineCollapseState {
  autoExpandedIds: readonly string[];
  expandedIds: readonly string[];
  pinnedIds: readonly string[];
}

export type TimelineCollapseAction =
  | { id: string; type: 'toggle' }
  | { entries: readonly TimelineEntryLiveState[]; type: 'sync' };

export interface WorkflowTimelineEntry {
  activities: readonly HermesChatActivity[];
  id: string;
  kind: 'group' | 'step';
}

export interface ClampedActivityText {
  clamped: boolean;
  hiddenLineCount: number;
  text: string;
}

export const ACTIVITY_TEXT_CLAMP = {
  maxCharacters: 1_600,
  maxLines: 24,
} as const;

const TIMELINE_GROUP_MIN_RUN = 3;

export function createTimelineCollapseState(): TimelineCollapseState {
  return { autoExpandedIds: [], expandedIds: [], pinnedIds: [] };
}

export function timelineCollapseReducer(
  state: TimelineCollapseState,
  action: TimelineCollapseAction,
): TimelineCollapseState {
  if (action.type === 'toggle') {
    const expanded = state.expandedIds.includes(action.id);
    return {
      autoExpandedIds: state.autoExpandedIds.filter((id) => id !== action.id),
      expandedIds: expanded
        ? state.expandedIds.filter((id) => id !== action.id)
        : [...state.expandedIds, action.id],
      pinnedIds: state.pinnedIds.includes(action.id)
        ? state.pinnedIds
        : [...state.pinnedIds, action.id],
    };
  }
  const runningIds = new Set(
    action.entries.filter(({ running }) => running).map(({ id }) => id),
  );
  // A previously auto-expanded step collapses again the moment it stops
  // running (or leaves the timeline); user-pinned entries are never touched.
  const autoExpandedIds = state.autoExpandedIds.filter((id) => runningIds.has(id));
  let expandedIds = state.expandedIds.filter((id) => (
    !state.autoExpandedIds.includes(id) || autoExpandedIds.includes(id)
  ));
  const nextAutoExpandedIds = [...autoExpandedIds];
  for (const entry of action.entries) {
    if (!entry.running || state.pinnedIds.includes(entry.id)) continue;
    if (!expandedIds.includes(entry.id)) expandedIds = [...expandedIds, entry.id];
    if (!nextAutoExpandedIds.includes(entry.id)) nextAutoExpandedIds.push(entry.id);
  }
  if (
    sameIdList(state.autoExpandedIds, nextAutoExpandedIds)
    && sameIdList(state.expandedIds, expandedIds)
  ) return state;
  return {
    autoExpandedIds: nextAutoExpandedIds,
    expandedIds,
    pinnedIds: state.pinnedIds,
  };
}

export function isTimelineEntryExpanded(
  state: TimelineCollapseState,
  id: string,
): boolean {
  return state.expandedIds.includes(id);
}

export function activityIsRunning(activity: HermesChatActivity): boolean {
  return activity.status === 'queued' || activity.status === 'running';
}

/**
 * Folds consecutive completed steps of the same tool into one group entry so
 * long repetitive stretches (e.g. many file reads) collapse to a single line.
 * Running, queued, failed, and cancelled steps always stay individual.
 */
export function groupTimelineActivities(
  activities: readonly HermesChatActivity[],
): WorkflowTimelineEntry[] {
  const entries: WorkflowTimelineEntry[] = [];
  let run: HermesChatActivity[] = [];
  const flush = () => {
    if (run.length >= TIMELINE_GROUP_MIN_RUN) {
      entries.push({
        activities: run,
        id: `group:${run[0].id}:${run[run.length - 1].id}`,
        kind: 'group',
      });
    } else {
      for (const activity of run) {
        entries.push({ activities: [activity], id: activity.id, kind: 'step' });
      }
    }
    run = [];
  };
  for (const activity of activities) {
    const groupable = activity.status === 'completed';
    if (!groupable) {
      flush();
      entries.push({ activities: [activity], id: activity.id, kind: 'step' });
      continue;
    }
    if (run.length && timelineGroupKey(run[0]) !== timelineGroupKey(activity)) {
      flush();
    }
    run.push(activity);
  }
  flush();
  return entries;
}

export function timelineEntryLiveStates(
  entries: readonly WorkflowTimelineEntry[],
): TimelineEntryLiveState[] {
  return entries.map((entry) => ({
    id: entry.id,
    running: entry.activities.some(activityIsRunning),
  }));
}

/**
 * The one-line summary argument for a collapsed step: the command for
 * terminal tools, the path for file tools, the query for search/browser
 * tools, and the most specific available text otherwise.
 */
export function activityPrimaryDetail(activity: HermesChatActivity): string {
  const input = activity.input?.trim() || '';
  const structured = parseRecord(input);
  const category = activity.category.toLowerCase();
  const tool = `${activity.toolName || ''} ${activity.name}`.toLowerCase();
  if (category === 'schedule') {
    return [pickString(structured, ['action']), pickString(structured, ['schedule', 'name', 'job_id'])]
      .filter(Boolean).join(' · ') || firstNonEmptyLine(activity.preview || activity.name);
  }
  if (category === 'subagent') {
    return firstNonEmptyLine(pickString(structured, ['task', 'prompt', 'agent', 'profile']) || activity.preview || activity.name);
  }
  if (category === 'command' || /(?:terminal|shell|exec|command)/.test(tool)) {
    return firstNonEmptyLine(
      pickString(structured, ['command', 'cmd', 'script'])
      || input
      || activity.detail
      || activity.preview,
    );
  }
  if (category === 'file' || category === 'edit' || /(?:file|write|edit|patch)/.test(tool)) {
    return firstNonEmptyLine(
      pickString(structured, ['path', 'file_path', 'filePath', 'file', 'filename', 'target'])
      || input
      || activity.detail
      || activity.preview,
    );
  }
  if (
    category === 'search'
    || category === 'browser'
    || /(?:search|browser|web|query|fetch)/.test(tool)
  ) {
    return firstNonEmptyLine(
      pickString(structured, ['query', 'pattern', 'q', 'url', 'keyword'])
      || input
      || activity.detail
      || activity.preview,
    );
  }
  const preview = activity.preview === activity.name ? '' : activity.preview;
  return firstNonEmptyLine(input || activity.detail || preview || activity.output || '');
}

export function clampActivityText(
  value: string,
  limits: { maxCharacters: number; maxLines: number } = ACTIVITY_TEXT_CLAMP,
): ClampedActivityText {
  const text = value.trimEnd();
  const lines = text.split('\n');
  let clampedText = lines.slice(0, limits.maxLines).join('\n');
  if (clampedText.length > limits.maxCharacters) {
    clampedText = truncateByCodePoints(clampedText, limits.maxCharacters);
    const lastBreak = clampedText.lastIndexOf('\n');
    if (lastBreak > limits.maxCharacters / 2) clampedText = clampedText.slice(0, lastBreak);
  }
  if (clampedText.length >= text.length) {
    return { clamped: false, hiddenLineCount: 0, text };
  }
  return {
    clamped: true,
    hiddenLineCount: Math.max(1, lines.length - clampedText.split('\n').length),
    text: clampedText.trimEnd(),
  };
}

export function activityElapsedLabel(
  activity: HermesChatActivity,
  now = Date.now(),
): string {
  if (activityIsRunning(activity) && activity.startedAt) {
    return formatDurationLabel(Math.max(0, now - activity.startedAt));
  }
  if (activity.duration) return activity.duration;
  if ((activity.durationMs || 0) > 0) return formatDurationLabel(activity.durationMs || 0);
  if (activity.startedAt && activity.completedAt) {
    return formatDurationLabel(Math.max(0, activity.completedAt - activity.startedAt));
  }
  return '';
}

export function timelineGroupElapsedLabel(
  activities: readonly HermesChatActivity[],
): string {
  const total = activities.reduce((sum, activity) => {
    if ((activity.durationMs || 0) > 0) return sum + (activity.durationMs || 0);
    if (activity.startedAt && activity.completedAt) {
      return sum + Math.max(0, activity.completedAt - activity.startedAt);
    }
    return sum;
  }, 0);
  return formatDurationLabel(total);
}

/**
 * The phase chip for one assistant turn. While the turn runs it surfaces the
 * persisted runtime phase (thinking/executing/reconnecting for direct chat,
 * the collaboration stage verb otherwise); terminal turns show the final
 * status.
 */
export function turnPhaseChip(
  message: Pick<
    HermesChatViewMessage,
    'activities' | 'roleStage' | 'status' | 'timingLabel'
  >,
  chinese: boolean,
): TimelinePhaseChip {
  if (messageIsRunning(message)) {
    return {
      label: message.timingLabel?.trim() || runningStageLabel(message.roleStage, chinese),
      tone: 'running',
    };
  }
  const label = messageStatusLabel(message.status, chinese)
    || (chinese ? '已完成' : 'Completed');
  const status = (message.status || '').toLowerCase();
  if (status === 'failed' || status === 'error') return { label, tone: 'failed' };
  if (status === 'cancelled' || status === 'canceled' || status === 'stopped') {
    return { label, tone: 'cancelled' };
  }
  return { label, tone: 'ok' };
}

export function firstTokenLabel(
  message: Pick<HermesChatViewMessage, 'createdAt' | 'firstTokenAt' | 'modelStartedAt' | 'startedAt'>,
  chinese: boolean,
): string {
  const baseline = message.modelStartedAt || message.startedAt || message.createdAt || 0;
  const firstTokenAt = message.firstTokenAt || 0;
  if (!baseline || firstTokenAt <= baseline) return '';
  const elapsed = formatDurationLabel(firstTokenAt - baseline);
  if (!elapsed) return '';
  return chinese ? `首字 ${elapsed}` : `First token ${elapsed}`;
}

/**
 * Compact timing line beside the phase chip: first-token boundary while
 * available, then the live elapsed time for a running turn or the terminal
 * elapsed time once the turn settles.
 */
export function turnTimingLine(
  message: Pick<
    HermesChatViewMessage,
    'activities' | 'completedAt' | 'createdAt' | 'durationMs' | 'firstTokenAt' | 'modelStartedAt'
    | 'startedAt' | 'status' | 'updatedAt'
  >,
  chinese: boolean,
  now = Date.now(),
): string {
  const parts: string[] = [];
  const firstToken = firstTokenLabel(message, chinese);
  if (firstToken) parts.push(firstToken);
  const elapsed = formatDurationLabel(messageDurationMs(message, now));
  if (elapsed) {
    parts.push(messageIsRunning(message)
      ? elapsed
      : chinese ? `全程 ${elapsed}` : `Total ${elapsed}`);
  }
  return parts.join(' · ');
}

export function reasoningPreviewLine(text: string, running = false): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  // A running reasoning stream previews its newest thought; a settled one
  // previews its first line, matching the collapsed-by-default contract.
  return running ? lines[lines.length - 1] : lines[0];
}

export function reasoningElapsedLabel(
  activities: readonly HermesChatActivity[],
  now = Date.now(),
): string {
  const startTimes = activities
    .map(({ startedAt }) => startedAt || 0)
    .filter((value) => value > 0);
  if (!startTimes.length) return '';
  const running = activities.some(activityIsRunning);
  const endTimes = activities.map(({ completedAt, startedAt }) => (
    completedAt || startedAt || 0
  ));
  const end = running ? now : Math.max(...endTimes);
  return formatDurationLabel(Math.max(0, end - Math.min(...startTimes)));
}

export function formatDurationLabel(milliseconds: number): string {
  if (milliseconds <= 0) return '';
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1_000)} s`;
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function runningStageLabel(
  stage: HermesChatViewMessage['roleStage'],
  chinese: boolean,
): string {
  switch (stage) {
    case 'dispatcher': return chinese ? '正在规划' : 'Planning';
    case 'worker': return chinese ? '正在执行' : 'Executing';
    case 'reviewer': return chinese ? '正在审阅' : 'Reviewing';
    case 'reporter': return chinese ? '正在汇报' : 'Reporting';
    case 'supervisor': return chinese ? '正在监督' : 'Supervising';
    default: return chinese ? '正在思考' : 'Thinking';
  }
}

function timelineGroupKey(activity: HermesChatActivity): string {
  return `${activity.category.toLowerCase()} ${(activity.toolName || activity.name).toLowerCase()}`;
}

function sameIdList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function firstNonEmptyLine(value: string | undefined): string {
  if (!value) return '';
  return value
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function pickString(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseRecord(value: string): Record<string, unknown> | null {
  if (!value.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
