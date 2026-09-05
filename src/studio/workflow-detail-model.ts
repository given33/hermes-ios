import { createTwoFilesPatch, parsePatch } from 'diff';
import type { HermesChatActivity } from '../api/chat-view-model';

export interface ActivitySource { title: string; url: string; description: string }
export interface ActivityChange { patch: string; requested: boolean }
export interface ActivityDetails {
  fields: { key: string; value: string }[];
  sources: ActivitySource[];
  change?: ActivityChange;
  output: string;
}

const MAX_STRUCTURED_CHARS = 200_000;
const FIELD_KEYS = ['command', 'cmd', 'query', 'q', 'url', 'path', 'file_path', 'action', 'schedule', 'task', 'agent', 'profile'];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parse(text: string | undefined): unknown {
  if (!text || text.length > MAX_STRUCTURED_CHARS) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function activitySourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8_192) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

/** Decode known payload fields, retaining raw detail as a separately accessible fallback. */
export function activityDetails(activity: HermesChatActivity): ActivityDetails {
  const input = record(parse(activity.input));
  const parsedOutput = parse(activity.output);
  const output = record(parsedOutput);
  const fields = FIELD_KEYS.flatMap((key) => {
    const value = input?.[key];
    return typeof value === 'string' || typeof value === 'number'
      ? [{ key, value: String(value) }] : [];
  });
  for (const [key, value] of [['tool', activity.toolName || activity.name], ['agent', activity.agentName], ['model', activity.model],
    ['provider', activity.provider], ['call_id', activity.callId], ['parent_call_id', activity.parentCallId]]) {
    if (value && !fields.some((field) => field.key === key)) fields.push({ key: key!, value });
  }
  if (activity.files?.length) fields.push({ key: 'files', value: activity.files.join('\n') });
  const sources = new Map<string, ActivitySource>();
  const add = (item: unknown) => {
    const row = record(item);
    const url = activitySourceUrl(row?.url ?? row?.link ?? item);
    if (!url || sources.has(url)) return;
    sources.set(url, {
      url,
      title: typeof row?.title === 'string' ? row.title : new URL(url).hostname,
      description: typeof row?.snippet === 'string' ? row.snippet
        : typeof row?.description === 'string' ? row.description : '',
    });
  };
  // Only explicit source fields become links; arbitrary log strings remain text.
  const data = record(output?.data);
  const web = record(output?.web);
  for (const candidate of [parsedOutput, output?.results, output?.sources, data?.results,
    web?.results, input?.urls]) {
    if (Array.isArray(candidate)) candidate.forEach(add);
  }
  if (output?.url) add(output);
  if (input?.url) add(input.url);
  let change: ActivityChange | undefined;
  const patch = output?.diff ?? output?.patch;
  if (typeof patch === 'string' && patch.trim()) {
    change = { patch, requested: false };
  } else if (typeof input?.patch === 'string' && input.patch.trim()) {
    change = { patch: input.patch, requested: true };
  } else {
    const before = input?.old_text ?? input?.old_string;
    const after = input?.new_text ?? input?.new_string;
    if (typeof before === 'string' && typeof after === 'string'
      && before.length + after.length <= 40_000) {
      const path = typeof input?.path === 'string' ? input.path
        : typeof input?.file_path === 'string' ? input.file_path : 'file';
      const generated = createTwoFilesPatch(path, path, before, after, undefined, undefined,
        { timeout: 12, maxEditLength: 300 });
      if (generated) change = { patch: generated, requested: true };
    }
  }
  return {
    fields, sources: [...sources.values()], change,
    output: typeof output?.output === 'string' ? output.output
      : typeof output?.content === 'string' ? output.content
        : typeof output?.text === 'string' ? output.text : activity.output || '',
  };
}

export function activityStatusLabel(status: HermesChatActivity['status'], chinese: boolean): string {
  const labels = {
    queued: ['等待', 'Waiting'], running: ['执行中', 'Running'], completed: ['成功', 'Succeeded'],
    failed: ['失败', 'Failed'], cancelled: ['已取消', 'Cancelled'],
  };
  return labels[status][chinese ? 0 : 1];
}

export function activityDiffText(patch: string): string {
  if (patch.length > MAX_STRUCTURED_CHARS) return patch;
  try {
    const files = parsePatch(patch);
    if (!files.length || !files.some((file) => file.hunks.length)) return patch;
    return files.map((file) => [file.newFileName || file.oldFileName || '', ...file.hunks.flatMap((hunk) => [
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines,
    ])].join('\n')).join('\n\n');
  } catch { return patch; }
}
