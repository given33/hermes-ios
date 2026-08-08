import { Check } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import {
  isRecord,
  numberValue,
  stringifyPiValue,
  stringValue,
  toolResultText,
} from './coding-pi-model';

/**
 * Native translations of the complete collab-web tool renderer registry. The
 * wire data is intentionally unmodified; these components only translate the
 * official renderer's semantic rows, badges, code/diff blocks, result state,
 * image metadata, and diagnostics into Hermes typography and controls.
 */
const OFFICIAL_TOOL_RENDERERS = new Set([
  'ask', 'ast_edit', 'ast_grep', 'bash', 'browser', 'puppeteer', 'debug', 'edit', 'apply_patch',
  'eval', 'js', 'python', 'notebook', 'fetch', 'glob', 'find', 'generate_image', 'github', 'goal',
  'inspect_image', 'hub', 'irc', 'job', 'await', 'poll', 'cancel_job', 'lsp', 'recall', 'reflect',
  'retain', 'read', 'report_tool_issue', 'resolve', 'reject', 'propose', 'grep', 'search', 'task',
  'todo', 'web_search', 'write', 'yield',
]);

export function isOfficialToolRenderer(name: string): boolean {
  return OFFICIAL_TOOL_RENDERERS.has(name.toLowerCase());
}

export function CodingPiOfficialToolDetails({
  args,
  detail,
  failed,
  isChinese,
  name,
  onOpenAgent,
  result,
  running = false,
}: {
  args: unknown;
  detail: string;
  failed: boolean;
  isChinese: boolean;
  name: string;
  onOpenAgent?(agentId: string): void;
  result: unknown;
  running?: boolean;
}): ReactNode | null {
  switch (name.toLowerCase()) {
    case 'bash':
      return <NativeBashDetails args={args} detail={detail} failed={failed} result={result} running={running} />;
    case 'read':
      return <NativeReadDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'write':
      return <NativeWriteDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'edit':
    case 'apply_patch':
      return <NativeEditDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'ast_edit':
      return <NativeAstEditDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'ast_grep':
      return <NativeAstGrepDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'grep':
    case 'search':
      return <NativeGrepDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'glob':
    case 'find':
      return <NativeGlobDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'fetch':
      return <NativeFetchDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'browser':
    case 'puppeteer':
      return <NativeBrowserDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'eval':
    case 'js':
    case 'python':
    case 'notebook':
      return <NativeEvalDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'generate_image':
      return <NativeGenerateImageDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'inspect_image':
      return <NativeInspectImageDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'goal':
      return <NativeGoalDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'github':
      return <NativeGithubDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'hub':
      return <NativeHubDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'job':
    case 'await':
    case 'poll':
    case 'cancel_job':
      return <NativeJobDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'lsp':
    case 'debug':
      return <NativeLspDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'irc':
      return <NativeIrcDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'recall':
    case 'reflect':
    case 'retain':
      return <NativeMemoryDetails args={args} detail={detail} failed={failed} result={result} name={name} />;
    case 'report_tool_issue':
      return <NativeReportIssueDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'resolve':
    case 'reject':
    case 'propose':
      return <NativeResolveDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'web_search':
      return <NativeWebSearchDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'yield':
      return <NativeYieldDetails args={args} detail={detail} failed={failed} result={result} />;
    case 'task':
      return <NativeTaskDetails args={args} detail={detail} failed={failed} isChinese={isChinese} onOpenAgent={onOpenAgent} result={result} />;
    case 'todo':
      return <NativeTodoDetails args={args} detail={detail} failed={failed} isChinese={isChinese} result={result} />;
    case 'ask':
      return <NativeAskDetails args={args} detail={detail} failed={failed} isChinese={isChinese} result={result} />;
    default:
      return null;
  }
}

function NativeSection({
  title,
  titleZh,
  text,
  tone = 'normal',
}: {
  title: string;
  titleZh: string;
  text: string;
  tone?: 'error' | 'normal' | 'muted' | 'warning';
}) {
  const { tokens } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (!text.trim()) return null;
  const limit = 3_200;
  const shown = text.length > limit && !expanded ? `${text.slice(0, limit)}\n…` : text;
  const color = tone === 'error'
    ? tokens.colors.destructive
    : tone === 'warning'
      ? tokens.colors.warning
      : tone === 'muted'
        ? tokens.colors.textSecondary
        : tokens.colors.foreground;
  return (
    <View style={{ marginBottom: 7 }}>
      <Text style={{ color: tone === 'error' ? tokens.colors.destructive : tokens.colors.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' }}>
        {title}
      </Text>
      <Text selectable style={{ color, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 10, lineHeight: 15, marginTop: 3 }}>
        {shown}
      </Text>
      {text.length > limit ? (
        <IOSPressable onPress={() => setExpanded((value) => !value)} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
          <Text style={{ color: tokens.colors.primary, fontSize: 10 }}>{expanded ? titleZh === '输入' ? '收起' : 'Collapse' : titleZh === '输入' ? '展开' : 'Expand'}</Text>
        </IOSPressable>
      ) : null}
    </View>
  );
}

function NativeRow({
  children,
  label,
}: {
  children: ReactNode;
  label?: ReactNode;
}) {
  const { tokens } = useTheme();
  return (
    <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 7, paddingVertical: 3 }}>
      {label !== undefined ? <Text style={{ color: tokens.colors.textTertiary, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 9, minWidth: 70 }}>{label}</Text> : null}
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

function NativeBadge({
  children,
  tone = 'normal',
}: {
  children: ReactNode;
  tone?: 'accent' | 'error' | 'ok' | 'warning' | 'normal';
}) {
  const { tokens } = useTheme();
  const color = tone === 'error'
    ? tokens.colors.destructive
    : tone === 'warning'
      ? tokens.colors.warning
      : tone === 'ok'
        ? tokens.colors.success
        : tone === 'accent'
          ? tokens.colors.primary
          : tokens.colors.textSecondary;
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: multiplyAlpha(color, 0.12), borderColor: multiplyAlpha(color, 0.42), borderRadius: 5, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 3 }}>
      <Text style={{ color, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 9 }}>{children}</Text>
    </View>
  );
}

function ToolOutput({ result, title, tone }: { result: unknown; title: string; tone?: 'error' | 'normal' }) {
  const text = toolResultText(result);
  return text ? <NativeSection title={title} titleZh={title} text={text} tone={tone} /> : null;
}

interface TaskItemView {
  id: string | null;
  description: string | null;
  assignment: string | null;
  isolated: boolean;
}

function taskItems(args: Record<string, unknown>): TaskItemView[] {
  if (Array.isArray(args.tasks)) {
    return args.tasks.filter(isRecord).map((item) => ({
      id: nullableString(item.id),
      description: nullableString(item.description),
      assignment: nullableString(item.assignment),
      isolated: item.isolated === true,
    }));
  }
  const item = {
    id: nullableString(args.id),
    description: nullableString(args.description),
    assignment: nullableString(args.assignment),
    isolated: args.isolated === true,
  };
  return item.id || item.description || item.assignment ? [item] : [];
}

function taskLabel(id: string): string {
  return id.includes('.') ? id.split('.').join('›') : id;
}

function agentLink(id: string, onOpenAgent?: (agentId: string) => void): ReactNode {
  const label = taskLabel(id);
  if (!onOpenAgent) return <NativeBadge tone="accent">{label}</NativeBadge>;
  return (
    <IOSPressable onPress={() => onOpenAgent(id)} style={{ alignSelf: 'flex-start' }}>
      <NativeBadge tone="accent">{`↗ ${label}`}</NativeBadge>
    </IOSPressable>
  );
}

function taskResultStatus(value: Record<string, unknown>): { label: string; tone: 'ok' | 'error' | 'warning' } {
  if (value.aborted === true) return { label: 'aborted', tone: 'error' };
  if (numberValue(value.exitCode) === 0) return stringValue(value.error) ? { label: 'merge failed', tone: 'warning' } : { label: 'done', tone: 'ok' };
  return { label: 'failed', tone: 'error' };
}

function formatTaskDuration(value: unknown): string {
  const milliseconds = numberValue(value);
  if (milliseconds === undefined) return '';
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatTaskCount(value: unknown): string {
  const count = numberValue(value);
  if (count === undefined) return '';
  return count >= 1_000 ? `${(count / 1_000).toFixed(1)}k` : String(Math.round(count));
}

function NativeTaskDetails({ args, detail, failed, isChinese, onOpenAgent, result }: { args: unknown; detail: string; failed: boolean; isChinese: boolean; onOpenAgent?: (agentId: string) => void; result: unknown }) {
  const { tokens } = useTheme();
  const value = isRecord(args) ? args : {};
  const details = isRecord(result) && isRecord(result.details) ? result.details : null;
  const tasks = taskItems(value);
  const results = details && Array.isArray(details.results) ? details.results.filter(isRecord) : [];
  const progress = details && Array.isArray(details.progress) ? details.progress.filter(isRecord) : [];
  const orderedResults = [...results].sort((left, right) => (numberValue(left.durationMs) ?? 0) - (numberValue(right.durationMs) ?? 0));
  const counts = results.reduce<Record<string, number>>((summary, item) => {
    const status = taskResultStatus(item).label;
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, {});
  return (
    <View style={{ gap: 3 }}>
      {stringValue(value.resume) ? <NativeBadge>{`resume ${value.resume}`}</NativeBadge> : null}
      {stringValue(value.context) ? <NativeSection title="context" titleZh="上下文" text={stringValue(value.context)} tone="muted" /> : null}
      {tasks.length > 0 ? (
        <View style={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.025), borderColor: tokens.colors.border, borderRadius: 7, borderWidth: 1, marginBottom: 5, padding: 7 }}>
          {tasks.map((task, index) => (
            <View key={task.id || index} style={{ borderBottomColor: tokens.colors.border, borderBottomWidth: index === tasks.length - 1 ? 0 : 1, paddingVertical: 4 }}>
              <NativeRow label={task.id ? agentLink(task.id, onOpenAgent) : <NativeBadge tone="accent">{`#${index + 1}`}</NativeBadge>}>
                <View style={{ gap: 4 }}>
                  {task.isolated ? <NativeBadge>isolated</NativeBadge> : null}
                  {task.description ? <Text style={bodyText(tokens)}>{task.description}</Text> : null}
                </View>
              </NativeRow>
              {task.assignment ? <NativeSection title="assignment" titleZh="分配" text={task.assignment} tone="muted" /> : null}
            </View>
          ))}
        </View>
      ) : null}
      {orderedResults.length > 0 ? (
        <View style={{ gap: 4 }}>
          {orderedResults.map((item, index) => <NativeTaskResult key={nullableString(item.id) || index} item={item} onOpenAgent={onOpenAgent} />)}
          <View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingTop: 3 }}>
            {counts.done ? <NativeBadge tone="ok">{`${counts.done} succeeded`}</NativeBadge> : null}
            {counts['merge failed'] ? <NativeBadge tone="warning">{`${counts['merge failed']} merge failed`}</NativeBadge> : null}
            {counts.failed ? <NativeBadge tone="error">{`${counts.failed} failed`}</NativeBadge> : null}
            {counts.aborted ? <NativeBadge tone="error">{`${counts.aborted} aborted`}</NativeBadge> : null}
            {formatTaskDuration(details?.totalDurationMs) ? <Text style={mutedText(tokens)}>{formatTaskDuration(details?.totalDurationMs)}</Text> : null}
          </View>
        </View>
      ) : null}
      {orderedResults.length === 0 && progress.length > 0 ? progress.map((item, index) => <NativeTaskProgress key={nullableString(item.id) || index} item={item} onOpenAgent={onOpenAgent} />) : null}
      {orderedResults.length === 0 && progress.length === 0 ? <ToolOutput result={result} title={failed ? (isChinese ? '错误' : 'Error') : 'Output'} tone={failed ? 'error' : 'normal'} /> : null}
      {!tasks.length && !results.length && !progress.length && detail && !toolResultText(result) ? <NativeSection title="details" titleZh="详情" text={detail} tone="muted" /> : null}
    </View>
  );
}

function NativeTaskResult({ item, onOpenAgent }: { item: Record<string, unknown>; onOpenAgent?: (agentId: string) => void }) {
  const { tokens } = useTheme();
  const status = taskResultStatus(item);
  const stats = [
    numberValue(item.tokens) !== undefined ? `${formatTaskCount(item.tokens)} tok` : '',
    numberValue(item.requests) !== undefined ? `${formatTaskCount(item.requests)} req` : '',
    formatTaskDuration(item.durationMs),
    stringValue(item.resolvedModel),
  ].filter(Boolean);
  const output = stringValue(item.output);
  const firstLine = output.split(/\r?\n/, 1)[0]?.trim() || '';
  const warning = firstLine.startsWith('SYSTEM WARNING:') ? firstLine : '';
  const cleanOutput = warning ? output.slice(firstLine.length).trim() : output;
  return (
    <View style={{ backgroundColor: multiplyAlpha(useTheme().tokens.colors.foreground, 0.025), borderColor: useTheme().tokens.colors.border, borderRadius: 7, borderWidth: 1, padding: 7 }}>
      <NativeRow label={agentLink(nullableString(item.id) || 'agent', onOpenAgent)}>
        <View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          <NativeBadge tone={status.tone}>{status.label}</NativeBadge>
          {item.truncated === true ? <NativeBadge tone="warning">truncated</NativeBadge> : null}
          {stringValue(item.description) ? <Text style={bodyText(tokens)}>{stringValue(item.description)}</Text> : null}
          {stats.length ? <Text style={mutedText(tokens)}>{stats.join(' · ')}</Text> : null}
        </View>
      </NativeRow>
      {warning ? <NativeSection title="warning" titleZh="警告" text={warning} tone="warning" /> : null}
      {item.aborted === true && stringValue(item.abortReason) ? <NativeSection title="abort reason" titleZh="中止原因" text={stringValue(item.abortReason)} tone="error" /> : null}
      {cleanOutput ? <NativeSection title="output" titleZh="输出" text={cleanOutput} tone={status.tone === 'error' ? 'error' : 'normal'} /> : null}
      {stringValue(item.error) && item.aborted !== true ? <NativeSection title={status.label === 'merge failed' ? 'merge error' : 'error'} titleZh="错误" text={stringValue(item.error)} tone={status.tone === 'warning' ? 'warning' : 'error'} /> : null}
      {stringValue(item.patchPath) ? <Text style={mutedText(tokens)}>{`patch: ${item.patchPath}`}</Text> : null}
      {!stringValue(item.patchPath) && stringValue(item.branchName) ? <Text style={mutedText(tokens)}>{`branch: ${item.branchName}`}</Text> : null}
    </View>
  );
}

function NativeTaskProgress({ item, onOpenAgent }: { item: Record<string, unknown>; onOpenAgent?: (agentId: string) => void }) {
  const { tokens } = useTheme();
  const status = stringValue(item.status, 'running');
  const bits = [
    numberValue(item.toolCount) !== undefined ? `${formatTaskCount(item.toolCount)} tools` : '',
    numberValue(item.tokens) !== undefined ? `${formatTaskCount(item.tokens)} tok` : '',
    formatTaskDuration(item.durationMs),
  ].filter(Boolean);
  return (
    <NativeRow label={agentLink(nullableString(item.id) || 'agent', onOpenAgent)}>
      <View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        <NativeBadge tone={status === 'running' ? 'accent' : status === 'failed' || status === 'aborted' ? 'error' : 'ok'}>{status}</NativeBadge>
        {stringValue(item.description) ? <Text style={bodyText(tokens)}>{stringValue(item.description)}</Text> : null}
        {stringValue(item.lastIntent, stringValue(item.currentTool)) ? <Text style={mutedText(tokens)}>{stringValue(item.lastIntent, stringValue(item.currentTool))}</Text> : null}
        {bits.length ? <Text style={mutedText(tokens)}>{bits.join(' · ')}</Text> : null}
      </View>
    </NativeRow>
  );
}

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned';

function NativeTodoDetails({ args, detail, failed, isChinese, result }: { args: unknown; detail: string; failed: boolean; isChinese: boolean; result: unknown }) {
  const { tokens } = useTheme();
  const value = isRecord(args) ? args : {};
  const ops = Array.isArray(value.ops) ? value.ops : typeof value.op === 'string' ? [value] : [];
  const details = isRecord(result) && isRecord(result.details) ? result.details : null;
  const phases = details && Array.isArray(details.phases) && !failed ? details.phases : null;
  return (
    <View style={{ gap: 4 }}>
      {ops.length > 0 ? <View style={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.025), borderColor: tokens.colors.border, borderRadius: 7, borderWidth: 1, padding: 7 }}>{ops.map((entry, index) => <NativeTodoOp key={index} entry={entry} />)}</View> : null}
      {phases ? <View style={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.025), borderColor: tokens.colors.border, borderRadius: 7, borderWidth: 1, padding: 8 }}>{phases.map((phase, index) => <NativeTodoPhase key={index} phase={phase} index={index} />)}</View> : null}
      {!phases ? <ToolOutput result={result} title={failed ? (isChinese ? '错误' : 'Error') : 'Output'} tone={failed ? 'error' : 'normal'} /> : null}
      {!ops.length && !phases && !toolResultText(result) && detail ? <NativeSection title="details" titleZh="详情" text={detail} tone="muted" /> : null}
    </View>
  );
}

function NativeTodoOp({ entry }: { entry: unknown }) {
  const { tokens } = useTheme();
  if (!isRecord(entry)) return null;
  const parts: string[] = [];
  if (stringValue(entry.task)) parts.push(stringValue(entry.task));
  if (stringValue(entry.phase)) parts.push(stringValue(entry.phase));
  if (Array.isArray(entry.items) && entry.items.length) parts.push(`${entry.items.length} item${entry.items.length === 1 ? '' : 's'}`);
  if (Array.isArray(entry.list) && entry.list.length) {
    const taskCount = entry.list.filter(isRecord).reduce((count, phase) => count + (Array.isArray(phase.items) ? phase.items.length : 0), 0);
    parts.push(`${entry.list.length} phase${entry.list.length === 1 ? '' : 's'} · ${taskCount} tasks`);
  }
  return <NativeRow label={<NativeBadge>{stringValue(entry.op, 'update')}</NativeBadge>}><Text style={bodyText(tokens)}>{parts.join(' · ') || 'update'}</Text></NativeRow>;
}

function NativeTodoPhase({ phase, index }: { phase: unknown; index: number }) {
  const { tokens } = useTheme();
  if (!isRecord(phase)) return null;
  return (
    <View>
      <Text style={{ color: tokens.colors.foreground, fontFamily: 'HermesGoogle-IBMPlexSans-700-Normal', fontSize: 11, marginTop: index === 0 ? 0 : 8 }}>{`${roman(index + 1)}. ${stringValue(phase.name)}`}</Text>
      {Array.isArray(phase.tasks) ? phase.tasks.filter(isRecord).map((task, taskIndex) => {
        const status = normalizeTodoStatus(task.status);
        return <View key={taskIndex} style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 7, paddingLeft: 5, paddingTop: 6 }}><Text style={{ color: todoStatusColor(status, tokens), fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 11, width: 14 }}>{status === 'completed' ? '✓' : status === 'in_progress' ? '→' : status === 'abandoned' ? '✕' : '○'}</Text><Text style={{ color: status === 'completed' ? tokens.colors.textSecondary : tokens.colors.foreground, flex: 1, fontFamily: 'HermesGoogle-IBMPlexSans-400-Normal', fontSize: 11, lineHeight: 15, textDecorationLine: status === 'completed' ? 'line-through' : 'none' }}>{stringValue(task.content)}</Text></View>;
      }) : null}
    </View>
  );
}

function normalizeTodoStatus(value: unknown): TodoStatus {
  return value === 'completed' || value === 'in_progress' || value === 'abandoned' ? value : 'pending';
}

function todoStatusColor(status: TodoStatus, tokens: ReturnType<typeof useTheme>['tokens']): string {
  return status === 'completed' ? tokens.colors.success : status === 'in_progress' ? tokens.colors.primary : status === 'abandoned' ? tokens.colors.destructive : tokens.colors.textTertiary;
}

function roman(value: number): string {
  const pairs: Array<[number, string]> = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let output = '';
  let remaining = value;
  for (const [unit, symbol] of pairs) while (remaining >= unit) { output += symbol; remaining -= unit; }
  return output;
}

interface AskQuestion {
  id: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  multi: boolean;
  recommended?: number;
}

interface AskAnswer {
  id?: string;
  selectedOptions: string[];
  customInput?: string;
  timedOut?: boolean;
}

function normalizeAskOptions(value: unknown): Array<{ label: string; description?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return [{ label: entry }];
    if (!isRecord(entry) || !stringValue(entry.label)) return [];
    return [{ label: stringValue(entry.label), ...(stringValue(entry.description) ? { description: stringValue(entry.description) } : {}) }];
  });
}

function normalizeAskQuestions(value: unknown): AskQuestion[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    id: stringValue(entry.id, '?'),
    question: stringValue(entry.question),
    options: normalizeAskOptions(entry.options),
    multi: entry.multi === true,
    recommended: numberValue(entry.recommended),
  }));
}

function askQuestions(value: Record<string, unknown>): AskQuestion[] {
  const many = normalizeAskQuestions(value.questions);
  if (many.length) return many;
  if (!stringValue(value.question)) return [];
  return [{ id: '?', question: stringValue(value.question), options: normalizeAskOptions(value.options), multi: value.multi === true, recommended: numberValue(value.recommended) }];
}

function askAnswer(value: Record<string, unknown>): AskAnswer {
  const selectedOptions = Array.isArray(value.selectedOptions) ? value.selectedOptions.filter((item): item is string => typeof item === 'string').map(stripRecommended) : [];
  return { id: nullableString(value.id) || undefined, selectedOptions, customInput: nullableString(value.customInput) || undefined, timedOut: value.timedOut === true };
}

function askAnswers(details: Record<string, unknown> | null): AskAnswer[] | null {
  if (!details) return null;
  if (Array.isArray(details.results)) {
    const values = details.results.filter(isRecord).map(askAnswer);
    return values.length ? values : null;
  }
  return details.selectedOptions !== undefined || details.customInput !== undefined ? [askAnswer(details)] : null;
}

function NativeAskDetails({ args, detail, failed, isChinese, result }: { args: unknown; detail: string; failed: boolean; isChinese: boolean; result: unknown }) {
  const value = isRecord(args) ? args : {};
  const details = isRecord(result) && isRecord(result.details) ? result.details : null;
  const answers = askAnswers(details);
  let questions = askQuestions(value);
  if (!questions.length && details) {
    const source = Array.isArray(details.results) ? details.results : [details];
    questions = source.filter(isRecord).filter((entry) => stringValue(entry.question)).map((entry) => ({ id: stringValue(entry.id, '?'), question: stringValue(entry.question), options: normalizeAskOptions(entry.options), multi: entry.multi === true }));
  }
  return (
    <View style={{ gap: 5 }}>
      {questions.map((question, index) => {
        const answer = answers ? answers.find((item) => item.id && item.id === question.id) || answers[index] : undefined;
        return <NativeAskQuestion answer={answer} key={`${question.id}-${index}`} question={question} />;
      })}
      {!questions.length && !result ? <NativeSection title="questions" titleZh="问题" text={isChinese ? '[缺少 questions 参数]' : '[invalid questions]'} tone="error" /> : null}
      {!answers ? <ToolOutput result={result} title={failed ? (isChinese ? '错误' : 'Error') : 'Output'} tone={failed ? 'error' : 'normal'} /> : null}
      {!questions.length && !answers && !toolResultText(result) && detail ? <NativeSection title="details" titleZh="详情" text={detail} tone="muted" /> : null}
    </View>
  );
}

function NativeAskQuestion({ answer, question }: { answer?: AskAnswer; question: AskQuestion }) {
  const { tokens } = useTheme();
  const selected = new Set(answer?.selectedOptions);
  return (
    <View style={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.025), borderColor: tokens.colors.border, borderRadius: 7, borderWidth: 1, padding: 7 }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        <Text style={bodyText(tokens)}>{question.id !== '?' ? `[${question.id}] ` : ''}{question.question || '[invalid question]'}</Text>
        {question.multi ? <NativeBadge>multi</NativeBadge> : null}
      </View>
      {question.options.map((option, index) => {
        const isSelected = selected.has(stripRecommended(option.label));
        const marker = question.multi ? (isSelected ? '■' : '□') : isSelected ? '●' : '○';
        return <View key={index} style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 7, paddingLeft: 4, paddingTop: 5 }}><Text style={{ color: isSelected ? tokens.colors.success : tokens.colors.textTertiary, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 11, width: 14 }}>{marker}</Text><View style={{ flex: 1 }}><View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}><Text style={{ color: answer && !isSelected ? tokens.colors.textSecondary : tokens.colors.foreground, fontFamily: 'HermesGoogle-IBMPlexSans-400-Normal', fontSize: 11 }}>{option.label}</Text>{index === question.recommended ? <NativeBadge tone="accent">recommended</NativeBadge> : null}</View>{option.description ? <Text style={mutedText(tokens)}>{`— ${option.description}`}</Text> : null}</View></View>;
      })}
      {answer?.customInput !== undefined ? <NativeRow label={<Check color={tokens.colors.success} size={12} />}><Text style={{ color: tokens.colors.success, fontFamily: 'HermesGoogle-IBMPlexSans-400-Normal', fontSize: 11 }}>{answer.customInput}</Text></NativeRow> : null}
      {answer && answer.selectedOptions.length === 0 && answer.customInput === undefined ? <NativeRow label="—"><Text style={{ color: tokens.colors.warning, fontFamily: 'HermesGoogle-IBMPlexSans-400-Normal', fontSize: 10 }}>{'no selection'}</Text></NativeRow> : null}
      {answer?.timedOut ? <NativeSection title="timeout" titleZh="超时" text="auto-selected after timeout — not a user choice" tone="warning" /> : null}
    </View>
  );
}

function stripRecommended(value: string): string {
  const suffix = ' (Recommended)';
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

function nullableString(value: unknown): string | null {
  const result = stringValue(value).trim();
  return result || null;
}

function bodyText(tokens: ReturnType<typeof useTheme>['tokens']) {
  return { color: tokens.colors.foreground, fontFamily: 'HermesGoogle-IBMPlexSans-400-Normal', fontSize: 10, lineHeight: 15 } as const;
}

function mutedText(tokens: ReturnType<typeof useTheme>['tokens']) {
  return { color: tokens.colors.textSecondary, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 9, lineHeight: 14 } as const;
}

type OfficialToolProps = {
  args: unknown;
  detail: string;
  failed: boolean;
  result: unknown;
  running?: boolean;
};

type OfficialRow = {
  label: string;
  value: unknown;
  tone?: 'error' | 'normal' | 'muted' | 'warning';
};

function officialRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function officialResultDetails(result: unknown): Record<string, unknown> {
  const value = officialRecord(result);
  return isRecord(value.details) ? value.details : {};
}

function officialValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return stringifyPiValue(value);
}

function officialList(value: unknown): string {
  if (!Array.isArray(value)) return officialValue(value);
  return value.map((item) => officialValue(item)).filter(Boolean).join(', ');
}

function officialPick(value: Record<string, unknown>, keys: readonly string[]): unknown {
  const picked: Record<string, unknown> = {};
  for (const key of keys) if (value[key] !== undefined) picked[key] = value[key];
  return Object.keys(picked).length ? picked : undefined;
}

function officialRows(value: Record<string, unknown>, keys: readonly [string, string][]): OfficialRow[] {
  return keys.map(([label, key]) => ({ label, value: value[key] })).filter((row) => officialValue(row.value).trim());
}

function officialResultRows(details: Record<string, unknown>, keys: readonly [string, string][]): OfficialRow[] {
  return officialRows(details, keys);
}

function NativeOfficialFrame({ children }: { children: ReactNode }) {
  return <View style={{ gap: 3 }}>{children}</View>;
}

function NativeOfficialRows({ rows }: { rows: OfficialRow[] }) {
  const { tokens } = useTheme();
  const visible = rows.filter((row) => officialValue(row.value).trim());
  if (!visible.length) return null;
  return (
    <View style={{ gap: 1 }}>
      {visible.map((row) => (
        <NativeRow key={row.label} label={row.label}>
          <Text selectable style={row.tone === 'error' ? { ...bodyText(tokens), color: tokens.colors.destructive } : row.tone === 'warning' ? { ...bodyText(tokens), color: tokens.colors.warning } : row.tone === 'muted' ? mutedText(tokens) : bodyText(tokens)}>
            {officialValue(row.value)}
          </Text>
        </NativeRow>
      ))}
    </View>
  );
}

function NativeOfficialBadges({ items }: { items: Array<{ label: string; tone?: 'accent' | 'error' | 'ok' | 'warning' | 'normal' }> }) {
  const visible = items.filter((item) => item.label.trim());
  if (!visible.length) return null;
  return <View style={{ alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingVertical: 2 }}>{visible.map((item) => <NativeBadge key={`${item.label}-${item.tone || 'normal'}`} tone={item.tone}>{item.label}</NativeBadge>)}</View>;
}

function NativeOfficialOutput({ detail, failed, result, running = false }: OfficialToolProps) {
  if (running && !toolResultText(result)) return detail ? <NativeSection title="status" titleZh="status" text={detail} tone="warning" /> : null;
  return <ToolOutput result={result} title={failed ? 'Error' : 'Output'} tone={failed ? 'error' : 'normal'} />;
}

function NativeOfficialInput({ label, value, tone = 'muted' }: { label: string; value: unknown; tone?: 'error' | 'normal' | 'muted' | 'warning' }) {
  const text = officialValue(value);
  return text.trim() ? <NativeSection title={label} titleZh={label} text={text} tone={tone} /> : null;
}

function NativeBashDetails({ args, detail, failed, result, running }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  const command = officialValue(value.command) || detail;
  const exitCode = details.exitCode ?? details.code ?? value.exitCode;
  return (
    <NativeOfficialFrame>
      <NativeOfficialInput label="$" value={command} tone="normal" />
      <NativeOfficialRows rows={[
        { label: 'cwd', value: value.cwd },
        { label: 'env', value: value.env },
        { label: 'timeout', value: value.timeout ?? value.timeoutSeconds ?? value.requestedTimeoutSeconds },
        { label: 'head / tail', value: officialPick(value, ['head', 'tail']) },
      ]} />
      <NativeOfficialBadges items={[
        { label: value.pty === true ? 'pty' : '' },
        { label: value.async === true ? 'async' : '' },
        { label: value.background === true ? 'background' : '' },
        { label: exitCode !== undefined ? `exit ${officialValue(exitCode)}` : '', tone: Number(exitCode) === 0 ? 'ok' : exitCode !== undefined ? 'error' : 'normal' },
        { label: details.timedOut === true ? 'timed out' : '', tone: 'warning' },
      ]} />
      <NativeOfficialRows rows={officialResultRows(details, [['wall time', 'wallTimeMs'], ['requested timeout', 'requestedTimeoutSeconds'], ['job', 'jobId'], ['artifact', 'artifactPath']])} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} running={running} />
    </NativeOfficialFrame>
  );
}

function NativeReadDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  const path = value.file_path ?? value.path ?? value.file ?? value.filePath ?? value.query;
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'path', value: path },
        { label: 'selection', value: value.sel ?? officialPick(value, ['from', 'to', 'line_start', 'line_end']) },
        { label: 'resolved', value: details.resolvedPath ?? details.path },
        { label: 'language', value: details.language ?? details.lang },
      ]} />
      <NativeOfficialBadges items={[
        { label: details.conflict === true ? 'path conflict' : '', tone: 'warning' },
        { label: details.elided === true ? 'elided' : '', tone: 'warning' },
        { label: details.truncated === true ? 'truncated' : '', tone: 'warning' },
        { label: details.missing === true ? 'missing' : '', tone: 'error' },
      ]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeWriteDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  const path = value.file_path ?? value.path ?? value.file ?? value.filePath;
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'path', value: path },
        { label: 'mode', value: value.mode ?? value.encoding },
        { label: 'diagnostics', value: details.diagnostics ?? details.messages },
      ]} />
      <NativeOfficialBadges items={[
        { label: details.executable === true || value.executable === true ? 'executable' : '', tone: 'accent' },
        { label: details.created === true ? 'created' : '' },
        { label: details.overwritten === true ? 'overwritten' : '' },
        { label: details.truncated === true ? 'truncated' : '', tone: 'warning' },
      ]} />
      <NativeOfficialInput label="content" value={value.content ?? value.text ?? value.input} tone="normal" />
      <NativeOfficialInput label="diagnostics" value={details.diagnostics ?? details.messages} tone="warning" />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeEditDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  const diff = details.diff ?? details.displayContent ?? value.diff ?? value.patch ?? value.input;
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'path', value: value.file_path ?? value.path ?? value.file ?? value.filePath ?? value.paths },
        { label: 'operations', value: value.edits ?? value.operations ?? value.ops },
        { label: 'files', value: details.files ?? details.fileCount },
      ]} />
      <NativeOfficialBadges items={[
        { label: details.applied === true ? 'applied' : '' , tone: 'ok' },
        { label: details.conflict === true ? 'conflict' : '', tone: 'warning' },
        { label: details.truncated === true ? 'truncated' : '', tone: 'warning' },
      ]} />
      <NativeOfficialInput label="diff" value={diff} tone={failed ? 'error' : 'normal'} />
      <NativeOfficialInput label="diagnostics" value={details.diagnostics ?? details.messages} tone="warning" />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeAstEditDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'paths', value: value.path ?? value.paths ?? value.file_path },
        { label: 'language', value: value.lang ?? value.language },
        { label: 'operations', value: value.ops ?? value.edits },
        { label: 'replacements', value: details.totalReplacements ?? details.replacements },
      ]} />
      <NativeOfficialBadges items={[{ label: details.conflict === true ? 'conflict' : '', tone: 'warning' }, { label: details.truncated === true ? 'truncated' : '', tone: 'warning' }]} />
      <NativeOfficialInput label="diff" value={details.diff ?? details.displayContent ?? value.input} tone={failed ? 'error' : 'normal'} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeAstGrepDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialInput label="pattern" value={value.pattern ?? value.pat ?? value.query} tone="normal" />
      <NativeOfficialRows rows={[
        { label: 'language', value: value.lang ?? value.language },
        { label: 'paths', value: value.paths ?? value.path },
        { label: 'limit', value: value.limit ?? value.maxResults },
        { label: 'matches', value: details.matchCount ?? details.matches ?? details.count },
      ]} />
      <NativeOfficialBadges items={[{ label: details.truncated === true ? 'truncated' : '', tone: 'warning' }, { label: details.missing === true ? 'missing' : '', tone: 'error' }]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeGrepDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialInput label="pattern" value={value.pattern ?? value.query} tone="normal" />
      <NativeOfficialRows rows={[
        { label: 'paths', value: value.paths ?? value.path ?? value.cwd },
        { label: 'flags', value: officialPick(value, ['caseSensitive', 'literal', 'glob', 'ignoreCase', 'include']) },
        { label: 'matches', value: details.matchCount ?? details.matches ?? details.count },
        { label: 'files', value: details.fileCount ?? details.files },
      ]} />
      <NativeOfficialBadges items={[{ label: details.truncated === true || details.limitReached === true ? 'truncated' : '', tone: 'warning' }, { label: details.missing === true ? 'missing' : '', tone: 'error' }]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeGlobDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialInput label="glob" value={value.pattern ?? value.glob ?? value.path ?? value.paths} tone="normal" />
      <NativeOfficialRows rows={[
        { label: 'cwd', value: value.cwd },
        { label: 'limit', value: value.limit ?? value.maxResults },
        { label: 'ignore', value: value.ignore },
        { label: 'files', value: details.fileCount ?? details.count ?? details.files },
      ]} />
      <NativeOfficialBadges items={[
        { label: value.hidden === true ? 'hidden files' : '' },
        { label: value.gitignore === false ? 'gitignore off' : '' },
        { label: details.truncated === true || details.limitReached === true ? 'truncated' : '', tone: 'warning' },
        { label: details.missing === true ? 'missing' : '', tone: 'error' },
      ]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeFetchDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialInput label="url" value={value.url ?? value.path} tone="normal" />
      <NativeOfficialRows rows={[
        { label: 'method', value: String(value.method ?? 'GET').toUpperCase() },
        { label: 'headers', value: value.headers },
        { label: 'timeout', value: value.timeout },
        { label: 'final url', value: details.finalUrl ?? details.url },
        { label: 'content type', value: details.contentType },
        { label: 'status', value: details.status ?? details.statusCode },
      ]} />
      <NativeOfficialBadges items={[{ label: value.raw === true ? 'raw' : '' }, { label: details.truncated === true ? 'truncated' : '', tone: 'warning' }, { label: details.via ? `via ${officialValue(details.via)}` : '' }]} />
      <NativeOfficialInput label="notes" value={details.notes} tone="muted" />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeBrowserDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'action', value: value.action ?? details.action },
        { label: 'tab', value: value.name ?? value.tab ?? details.name ?? details.tab },
        { label: 'url', value: value.url ?? details.url },
        { label: 'target', value: value.target ?? details.target ?? details.app },
        { label: 'viewport', value: value.viewport ?? details.viewport },
      ]} />
      <NativeOfficialBadges items={[{ label: value.all === true ? 'all tabs' : '' }, { label: value.kill === true ? 'kill' : '', tone: 'warning' }, { label: details.status ? officialValue(details.status) : '' }]} />
      <NativeOfficialInput label="javascript" value={value.code ?? value.script ?? value.js} tone="normal" />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeEvalDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  const cells = value.cells ?? value.code ?? value.input ?? value.source;
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'language', value: value.language ?? value.lang },
        { label: 'timeout', value: value.timeout },
        { label: 'reset', value: value.reset },
        { label: 'cells', value: Array.isArray(cells) ? cells.length : undefined },
      ]} />
      <NativeOfficialInput label="code" value={cells} tone="normal" />
      <NativeOfficialInput label="notice" value={details.notice} tone="muted" />
      <NativeOfficialBadges items={[{ label: details.cancelled === true ? 'cancelled' : '', tone: 'warning' }, { label: details.timedOut === true ? 'timed out' : '', tone: 'warning' }]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeGenerateImageDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  const promptFields = officialPick(value, ['subject', 'action', 'scene', 'composition', 'lighting', 'style', 'text', 'prompt']);
  return (
    <NativeOfficialFrame>
      <NativeOfficialInput label="prompt" value={promptFields ?? detail} tone="normal" />
      <NativeOfficialRows rows={[
        { label: 'aspect / size', value: officialPick(value, ['aspect_ratio', 'aspectRatio', 'size', 'width', 'height']) },
        { label: 'provider / model', value: officialPick(value, ['provider', 'model']) },
        { label: 'changes', value: value.changes },
        { label: 'input paths', value: value.input_paths ?? value.inputPaths },
        { label: 'revised prompt', value: details.revisedPrompt ?? details.prompt },
        { label: 'saved paths', value: details.savedPaths ?? details.paths },
      ]} />
      <NativeOfficialBadges items={[{ label: details.images && Array.isArray(details.images) ? `${details.images.length} images` : '' }, { label: details.truncated === true ? 'truncated' : '', tone: 'warning' }]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeInspectImageDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'target', value: value.path ?? value.url ?? value.image },
        { label: 'question', value: value.question ?? value.prompt },
        { label: 'model', value: value.model },
        { label: 'mime', value: value.mimeType ?? details.mimeType },
      ]} />
      <NativeOfficialInput label="inspection" value={details.description ?? details.analysis ?? details.answer} tone="normal" />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeGoalDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'operation', value: value.op ?? details.op },
        { label: 'objective', value: value.objective ?? details.objective },
        { label: 'status', value: details.status ?? value.status },
        { label: 'token budget', value: value.token_budget ?? details.tokenBudget },
        { label: 'tokens', value: details.tokens ?? details.tokenUsage },
        { label: 'time', value: details.elapsedMs ?? details.durationMs },
      ]} />
      <NativeOfficialBadges items={[{ label: details.status === 'completed' ? 'complete' : '' , tone: 'ok' }, { label: details.status === 'failed' ? 'failed' : '', tone: 'error' }]} />
      <NativeOfficialInput label="report" value={details.report ?? details.result} tone={failed ? 'error' : 'normal'} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeGithubDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'operation', value: value.op ?? value.action },
        { label: 'repository', value: value.repo ?? value.repository },
        { label: 'branch', value: value.branch ?? value.base ?? value.head },
        { label: 'query', value: value.query ?? value.search },
        { label: 'issue / PR', value: value.issue ?? value.pull ?? value.pr },
        { label: 'run / watch', value: value.run ?? value.watch },
        { label: 'status', value: details.status ?? details.state },
      ]} />
      <NativeOfficialBadges items={[{ label: details.checks ? `${officialList(details.checks)} checks` : '' }, { label: details.jobs ? `${officialList(details.jobs)} jobs` : '' }, { label: details.failed === true ? 'failed' : '', tone: 'error' }]} />
      <NativeOfficialInput label="details" value={details.details ?? details.checkouts ?? details.runs} tone="muted" />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeHubDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[{ label: 'operation', value: value.op ?? value.action }, { label: 'tool', value: value.tool ?? value.name }, { label: 'target', value: value.target ?? value.agent }, { label: 'job', value: details.jobId ?? details.id }]} />
      <NativeOfficialInput label="dispatch" value={value.args ?? value.input ?? details.request} tone="normal" />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeJobDetails({ args, detail, failed, result }: OfficialToolProps) {
  const { tokens } = useTheme();
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  const jobs = Array.isArray(details.jobs) ? details.jobs : [];
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[{ label: 'operation', value: value.op ?? value.action }, { label: 'job id', value: value.jobId ?? value.id }, { label: 'label', value: value.label }, { label: 'status', value: details.status ?? value.status }]} />
      {jobs.length ? <View style={{ gap: 3 }}>{jobs.filter(isRecord).map((job, index) => <View key={String(job.id ?? index)} style={{ borderBottomColor: tokens.colors.border, borderBottomWidth: index === jobs.length - 1 ? 0 : 1, paddingVertical: 4 }}><NativeOfficialRows rows={[{ label: 'job', value: job.id ?? job.type }, { label: 'status', value: job.status }, { label: 'duration', value: job.durationMs }, { label: 'preview', value: job.preview }]} /></View>)}</View> : null}
      <NativeOfficialBadges items={[{ label: details.failedCount ? `${officialValue(details.failedCount)} failed` : '', tone: 'error' }, { label: details.runningCount ? `${officialValue(details.runningCount)} running` : '', tone: 'accent' }]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeLspDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[
        { label: 'action', value: value.action ?? value.op },
        { label: 'file', value: value.file ?? value.path },
        { label: 'line / column', value: officialPick(value, ['line', 'column']) },
        { label: 'symbol / query', value: value.symbol ?? value.query },
        { label: 'new name', value: value.newName ?? value.new_name },
        { label: 'server / timeout', value: officialPick(value, ['server', 'timeout']) },
      ]} />
      <NativeOfficialInput label="payload" value={value.payload ?? value.data} tone="muted" />
      <NativeOfficialInput label="diagnostics" value={details.diagnostics ?? details.messages ?? details.locations} tone={failed ? 'error' : 'warning'} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeIrcDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[{ label: 'operation', value: value.op ?? value.action }, { label: 'to / channel', value: value.to ?? value.channel }, { label: 'message', value: value.message ?? value.text }, { label: 'wait', value: value.wait ?? value.timeout }]} />
      <NativeOfficialRows rows={[{ label: 'receipt', value: details.receipt ?? details.sent }, { label: 'peers', value: details.peers }, { label: 'unread', value: details.unread }, { label: 'messages', value: details.messages ?? details.inbox }]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeMemoryDetails({ args, detail, failed, result, name }: OfficialToolProps & { name: string }) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[{ label: 'operation', value: name }, { label: 'query', value: value.query }, { label: 'as of', value: value.asOf ?? value.as_of }, { label: 'context', value: value.context }]} />
      <NativeOfficialInput label="entries / memories" value={details.entries ?? details.memories ?? details.items} tone="normal" />
      <NativeOfficialBadges items={[{ label: details.count !== undefined ? `${officialValue(details.count)} entries` : '' }, { label: details.confirmed === true ? 'confirmed' : '', tone: 'ok' }, { label: details.failedSilently === true ? 'failed silently' : '', tone: 'warning' }]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeReportIssueDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[{ label: 'tool', value: value.tool ?? value.name }, { label: 'description', value: value.description }, { label: 'issue', value: value.issue ?? value.problem }]} />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeResolveDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[{ label: 'operation', value: value.op ?? value.action }, { label: 'transition', value: value.transition ?? details.transition }, { label: 'source', value: value.source ?? details.source }, { label: 'label / title', value: value.label ?? value.title }, { label: 'reason', value: value.reason ?? details.reason }]} />
      <NativeOfficialInput label="plan" value={value.plan ?? details.plan} tone="normal" />
      <NativeOfficialInput label="extra" value={value.extra ?? details.extra} tone="muted" />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeWebSearchDetails({ args, detail, failed, result }: OfficialToolProps) {
  const { tokens } = useTheme();
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  const sources = Array.isArray(details.sources) ? details.sources : [];
  return (
    <NativeOfficialFrame>
      <NativeOfficialRows rows={[{ label: 'query', value: value.query }, { label: 'recency', value: value.recency }, { label: 'limit', value: value.limit ?? value.num_search_results }, { label: 'provider / model', value: officialPick(value, ['provider', 'model']) }, { label: 'count', value: details.count ?? sources.length }]} />
      <NativeOfficialBadges items={[{ label: details.authenticated === true ? 'authenticated' : '' }, { label: details.usage ? `usage ${officialValue(details.usage)}` : '' }]} />
      {sources.length ? <View style={{ gap: 3 }}>{sources.filter(isRecord).map((source, index) => <NativeRow key={String(source.url ?? source.title ?? index)} label={`${index + 1}`}><Text selectable style={bodyText(tokens)}>{[source.title, source.domain, source.age].map(officialValue).filter(Boolean).join(' · ') || officialValue(source.url)}</Text></NativeRow>)}</View> : null}
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}

function NativeYieldDetails({ args, detail, failed, result }: OfficialToolProps) {
  const value = officialRecord(args);
  const details = officialResultDetails(result);
  return (
    <NativeOfficialFrame>
      <NativeOfficialInput label="data" value={value.data ?? value} tone="normal" />
      <NativeOfficialInput label="result details" value={details} tone="muted" />
      <NativeOfficialOutput args={args} detail={detail} failed={failed} result={result} />
    </NativeOfficialFrame>
  );
}
