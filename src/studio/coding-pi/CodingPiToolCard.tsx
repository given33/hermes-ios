import * as Clipboard from 'expo-clipboard';
import { ChevronDown, CircleAlert, Copy, FileCode2, Globe2, ListChecks, Search, Terminal } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Text, View } from 'react-native';

import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { CodingPiOfficialToolDetails, isOfficialToolRenderer } from './CodingPiOfficialToolDetails';
import {
  isRecord,
  stringifyPiValue,
  stringValue,
  toolResultText,
  type CodingPiActivity,
} from './coding-pi-model';

/**
 * Native equivalent of the official collab-web ToolCard chrome.
 *
 * The Pi tool name, arguments, partial output, result content and details all
 * stay JSON-compatible with the untouched upstream renderer. The native body
 * intentionally uses Hermes controls and typography while retaining the same
 * collapsed-summary -> expanded-inspection interaction for every known Pi
 * tool, with a tolerant structured fallback for new tools.
 */
export function CodingPiToolCard({
  activity,
  compact,
  isChinese,
  onOpenAgent,
}: {
  activity: CodingPiActivity;
  compact: boolean;
  isChinese: boolean;
  onOpenAgent?(agentId: string): void;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<{ data: string; mimeType: string } | null>(null);
  const name = stringValue(activity.toolName, activity.title || 'tool');
  // Match the official ToolView contract: the model's compact `i` argument
  // is an intent label, not a renderer argument, and must still be shown when
  // the event did not carry a separate `intent` field.
  const normalizedActivity = useMemo(() => {
    const normalized = normalizeToolArgs(activity.args);
    return {
      ...activity,
      args: normalized.args,
      intent: activity.intent?.trim() || normalized.intent,
    };
  }, [activity]);
  const xdev = useMemo(() => executeXdevDispatch(normalizedActivity), [normalizedActivity]);
  const renderedName = xdev ? xdev.tool : name;
  const renderedActivity = xdev
    ? {
        ...normalizedActivity,
        args: xdev.args,
        detail: toolResultText(xdev.result) || activity.detail,
        result: xdev.result,
        title: xdev.tool,
        toolName: xdev.tool,
      }
    : normalizedActivity;
  const summary = useMemo(() => toolSummary(renderedName, renderedActivity.args, renderedActivity.result, renderedActivity.detail), [renderedActivity.args, renderedActivity.detail, renderedActivity.result, renderedName]);
  const failed = activity.status === 'error' || (isRecord(activity.result) && activity.result.isError === true);
  const running = activity.status === 'running';
  const statusColor = failed
    ? tokens.colors.destructive
    : running
      ? tokens.colors.warning
      : activity.status === 'info'
        ? tokens.colors.textTertiary
        : tokens.colors.success;
  const icon = toolIcon(renderedName, statusColor);
  const copyValue = toolInspectionText(renderedActivity, isChinese);
  const copy = async () => {
    if (!copyValue.trim()) return;
    await Clipboard.setStringAsync(copyValue);
  };

  return (
    <View style={{
      backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.035),
      borderColor: failed ? multiplyAlpha(tokens.colors.destructive, 0.45) : tokens.colors.border,
      borderRadius: 9,
      borderWidth: 1,
      marginVertical: 2,
      overflow: 'hidden',
    }}>
      <IOSPressable
        accessibilityLabel={`${renderedName} ${running ? 'running' : failed ? 'error' : 'complete'}`}
        haptic="selection"
        onPress={() => setOpen((current) => !current)}
        style={{ alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: compact ? 30 : 34, paddingHorizontal: 9, paddingVertical: 6 }}
      >
        {running ? <ActivityIndicator color={statusColor} size="small" /> : <View style={{ backgroundColor: statusColor, borderRadius: 5, height: 9, width: 9 }} />}
        {icon}
        <Text numberOfLines={1} style={{ color: tokens.colors.foreground, fontFamily: 'HermesGoogle-IBMPlexSans-600-Normal', fontSize: compact ? 10 : 11, maxWidth: compact ? 86 : 120 }}>
          {xdev ? `xd://${renderedName}` : renderedName}
        </Text>
        <Text numberOfLines={1} style={{ color: tokens.colors.textSecondary, flex: 1, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 10 }}>
          {summary}
        </Text>
        <ChevronDown color={tokens.colors.textTertiary} size={13} style={open ? { transform: [{ rotate: '180deg' }] } : undefined} />
      </IOSPressable>

      {open ? (
        <View style={{ borderTopColor: tokens.colors.border, borderTopWidth: 1, padding: 9 }}>
          {activity.intent ? (
            <InspectionSection label="Intent" labelZh="意图" text={activity.intent} tone="secondary" />
          ) : null}
          <NativeToolDetails
            activity={renderedActivity}
            failed={failed}
            image={image}
            isChinese={isChinese}
            name={renderedName}
            onOpenAgent={onOpenAgent}
            onOpenImage={setImage}
            running={running}
          />
          <IOSPressable
            accessibilityLabel={isChinese ? '复制工具详情' : 'Copy tool detail'}
            onPress={() => { void copy(); }}
            style={{ alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 5, marginTop: 7, paddingVertical: 3 }}
          >
            <Copy color={tokens.colors.textTertiary} size={12} />
            <Text style={{ color: tokens.colors.textTertiary, fontSize: 10 }}>{isChinese ? '复制' : 'Copy'}</Text>
          </IOSPressable>
        </View>
      ) : null}
      {running && activity.result === undefined && activity.partialResult !== undefined ? <PartialOutput text={toolResultText(activity.partialResult) || stringifyPiValue(activity.partialResult)} /> : null}
      <Modal animationType="fade" onRequestClose={() => setImage(null)} transparent visible={image !== null}>
        <IOSPressable onPress={() => setImage(null)} style={{ alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.86)', flex: 1, justifyContent: 'center', padding: 18 }}>
          {image ? <Image resizeMode="contain" source={{ uri: `data:${image.mimeType};base64,${image.data}` }} style={{ height: '90%', width: '100%' }} /> : null}
        </IOSPressable>
      </Modal>
    </View>
  );
}

interface ToolField {
  label: string;
  labelZh: string;
  text: string;
  tone?: 'error' | 'normal' | 'running' | 'secondary';
}

function executeXdevDispatch(activity: CodingPiActivity): { tool: string; args: Record<string, unknown>; result: unknown } | null {
  const name = stringValue(activity.toolName, activity.title || 'tool');
  if (name !== 'write' || activity.status === 'error' || (isRecord(activity.result) && activity.result.isError === true) || !isRecord(activity.result) || !isRecord(activity.result.details)) return null;
  const xdev = activity.result.details.xdev;
  if (!isRecord(xdev) || xdev.mode !== 'execute' || typeof xdev.tool !== 'string') return null;
  const args = normalizeToolArgs(isRecord(xdev.args) ? xdev.args : {}).args;
  return {
    args: isRecord(args) ? args : {},
    result: {
      ...activity.result,
      details: xdev.inner,
    },
    tool: xdev.tool,
  };
}

function normalizeToolArgs(raw: unknown): { args: unknown; intent?: string } {
  if (!isRecord(raw)) return { args: raw };
  const intent = typeof raw.i === 'string' ? raw.i.trim() || undefined : undefined;
  if (!Object.prototype.hasOwnProperty.call(raw, 'i')) return { args: raw, intent };
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (key !== 'i') args[key] = value;
  return { args, intent };
}

function NativeToolDetails({
  activity,
  failed,
  image,
  isChinese,
  name,
  onOpenAgent,
  onOpenImage,
  running,
}: {
  activity: CodingPiActivity;
  failed: boolean;
  image: { data: string; mimeType: string } | null;
  isChinese: boolean;
  name: string;
  onOpenAgent?(agentId: string): void;
  onOpenImage(image: { data: string; mimeType: string }): void;
  running: boolean;
}) {
  const { tokens } = useTheme();
  const fields = nativeToolFields(name, activity.args, activity.result, activity.detail);
  const output = toolResultText(activity.result) || activity.detail;
  const images = toolResultImages(activity.result);
  const agentIds = nativeAgentIds(name, activity.args, activity.result);
  const hasOfficialRenderer = isOfficialToolRenderer(name);
  return (
    <View style={{ gap: 1 }}>
      {hasOfficialRenderer ? (
        <CodingPiOfficialToolDetails
          args={activity.args}
          detail={activity.detail}
          failed={failed}
          isChinese={isChinese}
          name={name}
          onOpenAgent={onOpenAgent}
          result={activity.result}
          running={running}
        />
      ) : fields.map((field, index) => <InspectionSection key={`${field.label}-${index}`} {...field} tone={field.tone || 'normal'} />)}
      {!hasOfficialRenderer && !running && output ? <InspectionSection label={failed ? 'Error' : 'Output'} labelZh={failed ? '错误' : '输出'} text={output} tone={failed ? 'error' : 'normal'} /> : null}
      {running && !activity.partialResult && activity.detail ? <InspectionSection label="Status" labelZh="状态" text={activity.detail} tone="running" /> : null}
      {images.length > 0 ? <ToolImageGrid images={images} isChinese={isChinese} onOpenImage={onOpenImage} /> : null}
      {agentIds.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
          {agentIds.map((agentId) => (
            <IOSPressable
              disabled={!onOpenAgent}
              key={agentId}
              onPress={() => onOpenAgent?.(agentId)}
              pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.primary, 0.18) }}
              style={{ backgroundColor: multiplyAlpha(tokens.colors.primary, 0.1), borderColor: multiplyAlpha(tokens.colors.primary, 0.4), borderRadius: 5, borderWidth: 1, opacity: onOpenAgent ? 1 : 0.65, paddingHorizontal: 6, paddingVertical: 4 }}
            >
              <Text style={{ color: tokens.colors.primary, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 9 }}>{`↗ ${agentId.replaceAll('.', '›')}`}</Text>
            </IOSPressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PartialOutput({ text }: { text: string }) {
  const { tokens } = useTheme();
  const clipped = text.length > 2_048 ? `…${text.slice(-2_048)}` : text;
  if (!clipped.trim()) return null;
  return <View style={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.02), borderTopColor: tokens.colors.border, borderTopWidth: 1, paddingHorizontal: 9, paddingVertical: 7 }}><Text style={{ color: tokens.colors.textTertiary, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 10, lineHeight: 15 }}>{clipped}</Text></View>;
}

function ToolImageGrid({ images, isChinese, onOpenImage }: { images: Array<{ data: string; mimeType: string }>; isChinese: boolean; onOpenImage(image: { data: string; mimeType: string }): void }) {
  const { tokens } = useTheme();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 7 }}><Text style={{ color: tokens.colors.textTertiary, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 9, textTransform: 'uppercase', width: '100%' }}>{isChinese ? '图片结果' : 'Images'}</Text>{images.map((item, index) => <IOSPressable accessibilityLabel={`${isChinese ? '打开结果图片' : 'Open result image'} ${index + 1}`} key={`${item.mimeType}-${index}`} onPress={() => onOpenImage(item)} style={{ backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, borderRadius: 5, borderWidth: 1, overflow: 'hidden' }}><Image resizeMode="contain" source={{ uri: `data:${item.mimeType};base64,${item.data}` }} style={{ height: 100, width: 138 }} /></IOSPressable>)}</View>;
}

function nativeToolFields(name: string, args: unknown, result: unknown, detail: string): ToolField[] {
  const value = stripInternalArgs(isRecord(args) ? args : {});
  const normalized = name.toLowerCase();
  const details = isRecord(result) && isRecord(result.details) ? result.details : null;
  const fields: ToolField[] = [];
  const add = (label: string, labelZh: string, text: unknown, tone: ToolField['tone'] = 'normal') => {
    if (isRecord(text) && Object.keys(text).length === 0) return;
    const valueText = stringifyPiValue(text);
    if (valueText.trim()) fields.push({ label, labelZh, text: valueText, tone });
  };
  const path = stringValue(value.file_path, stringValue(value.path, stringValue(value.file, stringValue(value.filePath))));
  switch (normalized) {
    case 'bash': {
      add('Command', '命令', value.command ?? detail);
      add('Working directory', '工作目录', value.cwd);
      add('Environment', '环境变量', value.env);
      add('Options', '选项', pickRecord(value, ['timeout', 'head', 'tail', 'pty', 'async']));
      add('Execution', '执行结果', details && pickRecord(details, ['exitCode', 'wallTimeMs', 'timeoutSeconds', 'requestedTimeoutSeconds', 'async']), details?.exitCode && details.exitCode !== 0 ? 'error' : 'secondary');
      break;
    }
    case 'read':
      add('Path', '路径', path || value.query);
      add('Range', '范围', pickRecord(value, ['from', 'to', 'line_start', 'line_end', 'sel']));
      break;
    case 'write':
      add('Path', '路径', path);
      add('Content', '内容', value.content);
      add('Diagnostics', '诊断', details?.diagnostics, isRecord(details?.diagnostics) && details.diagnostics.errored === true ? 'error' : 'secondary');
      add('Write result', '写入结果', details && pickRecord(details, ['madeExecutable', 'bytesWritten', 'linesWritten']), 'secondary');
      break;
    case 'edit':
    case 'apply_patch':
      add('Path / edits', '路径 / 修改', value.input ?? value._input ?? value.edits ?? path);
      add('Diff', '差异', details?.diff ?? details?.displayContent);
      add('Edit result', '修改结果', details && pickRecord(details, ['filesChanged', 'linesAdded', 'linesRemoved', 'applied']), 'secondary');
      break;
    case 'ast_edit':
      add('Paths', '路径', value.paths);
      add('Operations', '操作', value.ops);
      add('Edit result', '修改结果', details, 'secondary');
      break;
    case 'ast_grep':
      add('Pattern', '模式', value.pat);
      add('Scope', '范围', pickRecord(value, ['paths', 'path', 'glob', 'sel', 'lang', 'skip']));
      add('Search result', '搜索结果', details && pickRecord(details, ['matchCount', 'fileCount', 'filesSearched', 'scopePath', 'limitReached', 'parseErrors']), 'secondary');
      break;
    case 'grep':
    case 'search':
      add('Pattern', '模式', value.pattern ?? value.query);
      add('Scope', '范围', pickRecord(value, ['path', 'paths', 'glob', 'ignore', 'maxResults', 'caseSensitive']));
      add('Search result', '搜索结果', details && pickRecord(details, ['matchCount', 'fileCount', 'filesSearched', 'limitReached']), 'secondary');
      break;
    case 'glob':
    case 'find':
      add('Pattern', '模式', value.pattern ?? value.glob ?? value.path ?? value.paths);
      add('Options', '选项', pickRecord(value, ['cwd', 'limit', 'ignore']));
      break;
    case 'fetch':
      add('URL', '网址', value.url ?? value.path);
      add('Request', '请求', pickRecord(value, ['method', 'headers', 'raw', 'timeout']));
      add('Response', '响应', details && pickRecord(details, ['status', 'statusCode', 'contentType', 'truncated', 'bytes']), 'secondary');
      break;
    case 'web_search':
      add('Query', '查询', value.query);
      add('Search options', '搜索选项', pickRecord(value, ['recency', 'limit', 'num_search_results']));
      add('Provider / usage', '提供商 / 用量', details && pickRecord(details, ['response', 'error']), 'secondary');
      break;
    case 'browser':
    case 'puppeteer':
      add('Action', '操作', pickRecord(value, ['action', 'name', 'url', 'all', 'kill']));
      add('Browser result', '浏览器结果', details, 'secondary');
      break;
    case 'task':
      add('Agent / resume', 'Agent / 恢复', pickRecord(value, ['agent', 'resume']));
      add('Context', '上下文', value.context);
      add('Tasks', '任务', value.tasks ?? pickRecord(value, ['id', 'description', 'assignment', 'isolated']));
      add('Agent results', 'Agent 结果', details, 'secondary');
      break;
    case 'ask':
      add('Questions', '问题', value.questions ?? pickRecord(value, ['question', 'options', 'multi', 'recommended']));
      add('Answers', '回答', details, 'secondary');
      break;
    case 'todo':
      add('Operations', '操作', value.ops ?? pickRecord(value, ['op', 'task', 'phase', 'items', 'list']));
      add('Todo board', '任务看板', details, 'secondary');
      break;
    case 'goal':
      add('Goal', '目标', pickRecord(value, ['op', 'objective', 'token_budget']));
      add('Goal state', '目标状态', details, 'secondary');
      break;
    case 'eval':
    case 'js':
    case 'python':
    case 'notebook':
      add('Code', '代码', value.code ?? value.cells ?? value.input ?? value.source);
      add('Runtime', '运行环境', pickRecord(value, ['language', 'timeout', 'reset']));
      break;
    case 'lsp':
    case 'debug':
      add('Request', '请求', value);
      break;
    case 'generate_image':
      add('Image request', '图片请求', value);
      break;
    case 'inspect_image':
      add('Image', '图片', pickRecord(value, ['path', 'url']));
      break;
    case 'github':
    case 'report_tool_issue':
    case 'resolve':
    case 'reject':
    case 'propose':
    case 'irc':
    case 'hub':
    case 'job':
    case 'await':
    case 'poll':
    case 'cancel_job':
    case 'recall':
    case 'reflect':
    case 'retain':
    case 'yield':
      add('Arguments', '参数', value);
      break;
    default:
      add('Input', '输入', value);
      break;
  }
  if (fields.length === 0 && detail) add('Details', '详情', detail, 'secondary');
  return fields;
}

function stripInternalArgs(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) if (key !== 'i') result[key] = item;
  return result;
}

function pickRecord(value: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) if (value[key] !== undefined) result[key] = value[key];
  return result;
}

function toolResultImages(result: unknown): Array<{ data: string; mimeType: string }> {
  const images: Array<{ data: string; mimeType: string }> = [];
  const content = isRecord(result) && Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (isRecord(item) && item.type === 'image' && typeof item.data === 'string') images.push({ data: item.data, mimeType: stringValue(item.mimeType, 'image/png') });
  }
  const details = isRecord(result) && isRecord(result.details) ? result.details : null;
  if (details && Array.isArray(details.images)) {
    for (const item of details.images) if (isRecord(item) && typeof item.data === 'string') images.push({ data: item.data, mimeType: stringValue(item.mimeType, 'image/png') });
  }
  return images;
}

function nativeAgentIds(name: string, args: unknown, result: unknown): string[] {
  if (name.toLowerCase() !== 'task' || !isRecord(args) && !isRecord(result)) return [];
  const ids: string[] = [];
  const add = (value: unknown) => { if (typeof value === 'string' && value.trim() && !ids.includes(value)) ids.push(value); };
  const value = isRecord(args) ? args : {};
  add(value.id);
  if (Array.isArray(value.tasks)) for (const item of value.tasks) if (isRecord(item)) add(item.id);
  const details = isRecord(result) && isRecord(result.details) ? result.details : null;
  for (const key of ['results', 'progress']) if (details && Array.isArray(details[key])) for (const item of details[key]) if (isRecord(item)) add(item.id);
  return ids.slice(0, 12);
}

function InspectionSection({
  label,
  labelZh,
  text,
  tone,
}: {
  label: string;
  labelZh: string;
  text: string;
  tone: 'error' | 'normal' | 'running' | 'secondary';
}) {
  const { tokens } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (!text.trim()) return null;
  const maxLength = 4_096;
  const clamped = text.length > maxLength && !expanded ? `${text.slice(0, maxLength)}\n…` : text;
  return (
    <View style={{ marginBottom: 7 }}>
      <Text style={{ color: tone === 'error' ? tokens.colors.destructive : tone === 'running' ? tokens.colors.warning : tokens.colors.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text selectable style={{ color: tone === 'error' ? tokens.colors.destructive : tone === 'secondary' ? tokens.colors.textSecondary : tokens.colors.foreground, fontFamily: 'HermesTerminal-JetBrainsMono-400-Normal', fontSize: 10, lineHeight: 15, marginTop: 3 }}>
        {clamped}
      </Text>
      {text.length > maxLength ? (
        <IOSPressable onPress={() => setExpanded((current) => !current)} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
          <Text style={{ color: tokens.colors.primary, fontSize: 10 }}>{expanded ? labelZh === '输入' ? '收起' : 'Collapse' : labelZh === '输入' ? '展开' : 'Expand'}</Text>
        </IOSPressable>
      ) : null}
    </View>
  );
}

function toolIcon(name: string, color: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes('browser') || normalized === 'fetch' || normalized === 'github') return <Globe2 color={color} size={13} />;
  if (normalized.includes('grep') || normalized === 'search' || normalized === 'glob' || normalized === 'find' || normalized === 'web_search') return <Search color={color} size={13} />;
  if (normalized === 'write' || normalized === 'edit' || normalized === 'apply_patch' || normalized === 'ast_edit') return <FileCode2 color={color} size={13} />;
  if (normalized === 'todo' || normalized === 'goal') return <ListChecks color={color} size={13} />;
  if (normalized === 'ask' || normalized === 'resolve' || normalized === 'reject' || normalized === 'propose') return <CircleAlert color={color} size={13} />;
  return <Terminal color={color} size={13} />;
}

function toolSummary(name: string, args: unknown, result: unknown, detail: string): string {
  const value = stripInternalArgs(isRecord(args) ? args : {});
  const normalized = name.toLowerCase();
  const path = stringValue(value.file_path, stringValue(value.path, stringValue(value.file, stringValue(value.filePath))));
  const resultRecord = isRecord(result) ? result : {};
  const resultDetails = isRecord(resultRecord.details) ? resultRecord.details : {};
  if (normalized === 'bash') return oneLine(stringValue(value.command, detail) || '…');
  if (normalized === 'read') return oneLine([path || stringValue(value.query, detail), formatRange(value)].filter(Boolean).join(' '));
  if (normalized === 'write') return oneLine([path || '…', lineCount(value.content) > 1 ? `${lineCount(value.content)} lines` : ''].filter(Boolean).join(' '));
  if (normalized === 'edit' || normalized === 'apply_patch') return oneLine([path, opCount(value), diffStat(stringValue(resultDetails.diff, stringValue(resultDetails.displayContent)))].filter(Boolean).join(' ') || stringValue(value.input, detail));
  if (normalized === 'ast_edit') return oneLine([path || stringValue(value.paths), `${Array.isArray(value.ops) ? value.ops.length : 0} ops`, resultDetails.totalReplacements !== undefined ? `${resultDetails.totalReplacements} replacements` : ''].filter(Boolean).join(' '));
  if (normalized === 'ast_grep') return oneLine([firstValue(value.pat), firstValue(value.paths) || stringValue(value.path), stringValue(value.lang)].filter(Boolean).join(' '));
  if (normalized === 'grep' || normalized === 'search') return oneLine([stringValue(value.pattern, stringValue(value.query, detail)), 'in', stringValue(value.path, stringValue(value.paths))].filter(Boolean).join(' '));
  if (normalized === 'glob' || normalized === 'find') return oneLine(stringValue(value.pattern, stringValue(value.glob, stringValue(value.path, stringValue(value.paths, detail)))));
  if (normalized === 'fetch') return oneLine([stringValue(value.url, stringValue(value.path, detail)), stringValue(value.method).toUpperCase() !== 'GET' ? stringValue(value.method).toUpperCase() : ''].filter(Boolean).join(' '));
  if (normalized === 'web_search') return oneLine([stringValue(value.query, detail), stringValue(value.recency)].filter(Boolean).join(' '));
  if (normalized === 'browser' || normalized === 'puppeteer') return oneLine([stringValue(value.action, stringValue(resultDetails.action, '?')), stringValue(value.name, stringValue(resultDetails.name, 'main')), stringValue(value.url, stringValue(resultDetails.url))].filter(Boolean).join(' '));
  if (normalized === 'task') {
    const tasks = Array.isArray(value.tasks) ? value.tasks.filter(isRecord) : [];
    const first = tasks[0] || value;
    return oneLine([stringValue(value.agent), stringValue(value.resume) ? `resume ${value.resume}` : '', stringValue(first.description, stringValue(first.id, stringValue(value.description, detail))), tasks.length > 1 ? `${tasks.length} tasks` : ''].filter(Boolean).join(' '));
  }
  if (normalized === 'ask') return oneLine(stringValue(value.question, firstValue(value.questions, detail)));
  if (normalized === 'todo') return oneLine([stringValue(value.op, stringValue(value.action, 'update')), stringValue(value.task, stringValue(value.phase, firstValue(value.items, detail)))].filter(Boolean).join(' '));
  if (normalized === 'goal') return oneLine([stringValue(value.op, stringValue(resultDetails.op, '')), stringValue(value.objective, detail)].filter(Boolean).join(' '));
  if (normalized === 'lsp' || normalized === 'debug') return oneLine([stringValue(value.action, 'request'), path, stringValue(value.symbol, stringValue(value.query))].filter(Boolean).join(' '));
  if (normalized === 'generate_image') return oneLine([stringValue(value.subject, detail), stringValue(value.aspect_ratio)].filter(Boolean).join(' '));
  if (normalized === 'inspect_image') return oneLine(stringValue(value.path, stringValue(value.url, detail)));
  if (normalized === 'github' || normalized === 'irc' || normalized === 'hub' || normalized === 'job' || normalized === 'await' || normalized === 'poll' || normalized === 'cancel_job' || normalized === 'resolve' || normalized === 'reject' || normalized === 'propose') return oneLine([stringValue(value.op, stringValue(value.action, name)), stringValue(value.to, stringValue(value.repo, stringValue(value.reason, stringValue(value.query, detail))))].filter(Boolean).join(' '));
  if (normalized === 'recall' || normalized === 'reflect') return oneLine(stringValue(value.query, detail));
  if (normalized === 'retain') return oneLine([Array.isArray(value.items) ? `${value.items.length} memories` : '', firstValue(value.items, detail)].filter(Boolean).join(' '));
  if (normalized === 'yield') return oneLine(stringifyPiValue(value.data ?? value));
  return oneLine(toolResultText(result) || detail || stringifyPiValue(args));
}

function toolInputText(name: string, args: unknown): string {
  const value = stripInternalArgs(isRecord(args) ? args : {});
  const normalized = name.toLowerCase();
  const preferred = normalized === 'bash'
    ? value.command
    : normalized === 'fetch'
      ? value.url
      : normalized === 'web_search'
        ? value.query
        : normalized === 'read' || normalized === 'write'
          ? value.path ?? value.file_path
        : undefined;
  return preferred !== undefined ? stringifyPiValue(preferred) : stringifyPiValue(value);
}

function toolInspectionText(activity: CodingPiActivity, isChinese: boolean): string {
  const sections = [
    activity.intent ? `${isChinese ? '意图' : 'Intent'}\n${activity.intent}` : '',
    activity.args !== undefined ? `${isChinese ? '输入' : 'Input'}\n${toolInputText(stringValue(activity.toolName, activity.title), activity.args)}` : '',
    activity.result !== undefined ? `${isChinese ? '输出' : 'Output'}\n${toolResultText(activity.result)}` : '',
    activity.detail ? `${isChinese ? '详情' : 'Detail'}\n${activity.detail}` : '',
  ];
  return sections.filter(Boolean).join('\n\n');
}

function oneLine(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}…` : normalized;
}

function formatRange(value: Record<string, unknown>): string {
  const from = stringValue(value.from, stringValue(value.line_start));
  const to = stringValue(value.to, stringValue(value.line_end));
  const sel = stringValue(value.sel);
  return sel || (from || to ? `(${from || '?'}-${to || '?'})` : '');
}

function lineCount(value: unknown): number {
  return typeof value === 'string' && value.length > 0 ? value.split('\n').length : 0;
}

function opCount(value: Record<string, unknown>): string {
  if (Array.isArray(value.edits)) return `${value.edits.length} ops`;
  if (typeof value.input === 'string') return `${Math.max(0, value.input.split(/\r?\n/).filter((line) => line.trim()).length)} ops`;
  return '';
}

function diffStat(diff: string): string {
  if (!diff) return '';
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++;
    if (line.startsWith('-')) removed++;
  }
  return added || removed ? `+${added}/-${removed}` : '';
}

function firstValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string');
    return typeof first === 'string' ? first : fallback;
  }
  return fallback;
}
