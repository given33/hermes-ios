import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import {
  CheckCircle2,
  CalendarClock,
  ChevronLeft,
  CircleAlert,
  GitBranch,
  GitCommitHorizontal,
  Menu,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Square,
  Trash2,
  Upload,
  Download,
  Workflow,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Share, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { HermesApiClient } from '../../api/HermesApiClient';
import { hermesStudioApiFor } from '../../api/hermes-api-registry';
import type {
  HermesStudioWorkflowImportPreview,
  HermesStudioWorkflowRuntimeStatus,
  HermesStudioWorkflowRecord,
  HermesStudioWorkflowRunEdgeEvaluation,
  HermesStudioWorkflowRunLoopEpoch,
  HermesStudioWorkflowRunNodeSession,
  HermesStudioWorkflowRunRecord,
} from '../../api/hermes-studio';
import { numberValue } from '../../api/hermes-studio';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { NativeButton } from '../../components/ui/NativeButton';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { StudioOfficialAvatar } from '../../components/studio/StudioOfficialAvatar';
import { multiplyAlpha } from '../../design/control-contracts';
import { useTheme } from '../../design/ThemeProvider';
import { PreviewModal, PreviewText, PreviewToggle } from '../PreviewPrimitives';
import { HermesStudioWorkflowSchedules } from './HermesStudioWorkflowSchedules';

export interface HermesStudioWorkflowPageProps {
  client?: HermesApiClient;
  compact?: boolean;
  fixtureMode?: boolean;
  locale?: 'en' | 'zh';
  notify(message: string): void;
  onOpenNavigation?(): void;
  profile?: string;
}

type WorkflowNodeRecord = Record<string, unknown>;

interface EditNodeState {
  id: string;
  title: string;
  agent: string;
  profile: string;
  provider: string;
  model: string;
  apiMode: string;
  reasoningEffort: string;
  input: string;
  skills: string;
  approvalRequired: boolean;
  join: 'all' | 'any';
}

interface EdgeEditorState {
  id: string | null;
  source: string;
  target: string;
  route: 'success' | 'failure' | 'always';
  conditionPath: string;
  operator: string;
  conditionValue: string;
  feedback: boolean;
  maxIterations: string;
  loopId: string;
}

const EMPTY_EDGE_EDITOR: EdgeEditorState = {
  id: null,
  source: '',
  target: '',
  route: 'success',
  conditionPath: '',
  operator: 'equals',
  conditionValue: '',
  feedback: false,
  maxIterations: '3',
  loopId: '',
};

export function HermesStudioWorkflowPage({
  client,
  compact = false,
  fixtureMode = false,
  locale = 'zh',
  notify,
  onOpenNavigation,
  profile = 'default',
}: HermesStudioWorkflowPageProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const isChinese = locale === 'zh';
  const api = useMemo(() => client ? hermesStudioApiFor(client) : null, [client]);
  const [workflows, setWorkflows] = useState<HermesStudioWorkflowRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [runs, setRuns] = useState<HermesStudioWorkflowRunRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runInput, setRunInput] = useState('');
  const [startNodeIdsInput, setStartNodeIdsInput] = useState('');
  const [timeoutMinutes, setTimeoutMinutes] = useState('30');
  const [createOpen, setCreateOpen] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowSettingsOpen, setWorkflowSettingsOpen] = useState(false);
  const [workflowNameDraft, setWorkflowNameDraft] = useState('');
  const [workflowWorkspaceDraft, setWorkflowWorkspaceDraft] = useState('');
  const [deleteWorkflowId, setDeleteWorkflowId] = useState<string | null>(null);
  const [editNode, setEditNode] = useState<EditNodeState | null>(null);
  const [savingNode, setSavingNode] = useState(false);
  const [edgeEditor, setEdgeEditor] = useState<EdgeEditorState | null>(null);
  const [savingEdge, setSavingEdge] = useState(false);
  const [running, setRunning] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<HermesStudioWorkflowRuntimeStatus | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  const [importPreview, setImportPreview] = useState<HermesStudioWorkflowImportPreview | null>(null);
  const [importDocument, setImportDocument] = useState('');
  const [importing, setImporting] = useState(false);
  const [compactDetailOpen, setCompactDetailOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [workflowCapability, setWorkflowCapability] = useState<'unknown' | 'available' | 'missing'>('unknown');

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedId) || null;

  const refreshRuns = useCallback(async (workflowId = selectedId) => {
    if (!workflowId) {
      setRuns([]);
      return;
    }
    if (!api) {
      setRuns(fixtureRuns(workflowId));
      return;
    }
    setRunsLoading(true);
    try {
      setRuns(await api.workflows.listRuns(workflowId, 100));
    } catch (reason) {
      setError(errorMessage(reason, isChinese));
    } finally {
      setRunsLoading(false);
    }
  }, [api, isChinese, selectedId]);

  const refresh = useCallback(async () => {
    if (!api) {
      const fixture = fixtureWorkflows(profile);
      setWorkflowCapability('available');
      setWorkflows(fixture);
      setSelectedId((current) => fixture.some((workflow) => workflow.id === current) ? current : fixture[0]?.id || '');
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const capability = await api.workflows.probe(profile);
      if (!capability.available) {
        setWorkflowCapability('missing');
        setWorkflows([]);
        setSelectedId('');
        setError(isChinese
          ? 'Hermes Studio 工作流服务未部署'
          : 'Hermes Studio workflow service is not deployed');
        return;
      }
      const next = capability.workflows;
      setWorkflowCapability('available');
      setWorkflows(next);
      setSelectedId((current) => next.some((workflow) => workflow.id === current) ? current : next[0]?.id || '');
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason, isChinese));
    } finally {
      setLoading(false);
    }
  }, [api, isChinese, profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshRuns(selectedId);
  }, [refreshRuns, selectedId]);

  useEffect(() => {
    if (!api || !selectedId) return undefined;
    const timer = setInterval(() => { void refreshRuns(selectedId); }, 5_000);
    return () => clearInterval(timer);
  }, [api, refreshRuns, selectedId]);

  useEffect(() => {
    if (!api || workflowCapability !== 'available') return undefined;
    let disposed = false;
    let removeStatusListener: () => void = () => undefined;
    let removeErrorListener: () => void = () => undefined;
    void api.workflowSocket.connect({ profile }).then(() => {
      if (disposed) return;
      removeStatusListener = api.workflowSocket.onStatus((status) => {
        if (status.workflowId !== selectedId) return;
        setRuntimeStatus(status);
        if (status.run) {
          setRuns((current) => {
            const withoutCurrent = current.filter((run) => run.id !== status.run?.id);
            return status.run ? [status.run, ...withoutCurrent] : current;
          });
        }
      });
      removeErrorListener = api.workflowSocket.onError((statusError) => {
        if (statusError.workflowId === selectedId && statusError.error) setError(statusError.error);
      });
      void api.workflowSocket.subscribe(selectedId || null, profile)
        .then((statuses) => {
          if (!disposed) setRuntimeStatus(statuses.find((status) => status.workflowId === selectedId) || null);
        })
        .catch((reason) => {
          if (!disposed && selectedId) setError(errorMessage(reason, isChinese));
        });
    }).catch((reason) => {
      if (!disposed && selectedId) setError(errorMessage(reason, isChinese));
    });
    return () => {
      disposed = true;
      removeStatusListener();
      removeErrorListener();
      api.workflowSocket.disconnect();
    };
  }, [api, isChinese, profile, selectedId, workflowCapability]);

  const createWorkflow = useCallback(async () => {
    const name = workflowName.trim();
    if (!name) return;
    const node = defaultWorkflowNode(profile, name);
    try {
      const workflow = api
        ? await api.workflows.create({
            name,
            profile,
            nodes: [node],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          })
        : {
            id: `preview-workflow-${Date.now().toString(36)}`,
            name,
            profile,
            workspace: null,
            nodes: [node],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            created_at: Date.now(),
            updated_at: Date.now(),
          } satisfies HermesStudioWorkflowRecord;
      setWorkflows((current) => [workflow, ...current]);
      setSelectedId(workflow.id);
      if (compact) setCompactDetailOpen(true);
      setCreateOpen(false);
      setWorkflowName('');
      notify(isChinese ? '工作流已创建' : 'Workflow created');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, compact, isChinese, notify, profile, workflowName]);

  const openWorkflowSettings = useCallback(() => {
    if (!selectedWorkflow) return;
    setWorkflowNameDraft(selectedWorkflow.name);
    setWorkflowWorkspaceDraft(selectedWorkflow.workspace || '');
    setWorkflowSettingsOpen(true);
  }, [selectedWorkflow]);

  const saveWorkflowSettings = useCallback(async () => {
    if (!selectedWorkflow || !workflowNameDraft.trim()) return;
    try {
      const patch = {
        name: workflowNameDraft.trim(),
        workspace: workflowWorkspaceDraft.trim() || null,
      };
      const next = api
        ? await api.workflows.update(selectedWorkflow.id, patch)
        : { ...selectedWorkflow, ...patch, updated_at: Date.now() };
      setWorkflows((current) => current.map((workflow) => workflow.id === next.id ? next : workflow));
      setWorkflowSettingsOpen(false);
      notify(isChinese ? '工作流设置已保存' : 'Workflow settings saved');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, isChinese, notify, selectedWorkflow, workflowNameDraft, workflowWorkspaceDraft]);

  const exportWorkflow = useCallback(async () => {
    if (!selectedWorkflow) return;
    try {
      const document = api
        ? await api.workflows.export(selectedWorkflow.id)
        : { format: 'hermes-studio.workflow', version: 1, definition: {
            name: selectedWorkflow.name,
            nodes: selectedWorkflow.nodes,
            edges: selectedWorkflow.edges,
            viewport: selectedWorkflow.viewport,
          } };
      await Share.share({
        title: selectedWorkflow.name,
        message: JSON.stringify(document, null, 2),
      });
      notify(isChinese ? '工作流定义已导出' : 'Workflow definition exported');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, isChinese, notify, selectedWorkflow]);

  const importWorkflow = useCallback(async () => {
    if (!api) {
      notify(isChinese ? '预览模式不连接 Hermes Studio 导入服务' : 'Preview mode has no Hermes Studio import service');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ['application/json', 'text/json'],
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      setImporting(true);
      const document = await new ExpoFile(result.assets[0].uri).text();
      const preview = await api.workflows.previewImport(document, profile);
      setImportDocument(document);
      setImportPreview(preview);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    } finally {
      setImporting(false);
    }
  }, [api, isChinese, notify, profile]);

  const confirmWorkflowImport = useCallback(async () => {
    if (!api || !importPreview) return;
    setImporting(true);
    try {
      const workflow = await api.workflows.confirmImport(importPreview.token, profile);
      setWorkflows((current) => [workflow, ...current.filter((item) => item.id !== workflow.id)]);
      setSelectedId(workflow.id);
      setImportPreview(null);
      setImportDocument('');
      notify(isChinese ? '工作流已导入' : 'Workflow imported');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    } finally {
      setImporting(false);
    }
  }, [api, importPreview, isChinese, notify, profile]);

  const cancelWorkflowImport = useCallback(async () => {
    if (api && importPreview) await api.workflows.cancelImport(importPreview.token, profile).catch(() => undefined);
    setImportPreview(null);
    setImportDocument('');
  }, [api, importPreview, profile]);

  const addNode = useCallback(async () => {
    if (!selectedWorkflow) return;
    const node = defaultWorkflowNode(profile, `${isChinese ? 'Agent 节点' : 'Agent node'} ${selectedWorkflow.nodes.length + 1}`);
    const nodes = [...selectedWorkflow.nodes, node];
    try {
      const next = api
        ? await api.workflows.update(selectedWorkflow.id, { nodes })
        : { ...selectedWorkflow, nodes, updated_at: Date.now() };
      setWorkflows((current) => current.map((workflow) => workflow.id === next.id ? next : workflow));
      notify(isChinese ? '已添加 Agent 节点' : 'Agent node added');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, isChinese, notify, profile, selectedWorkflow]);

  const saveNode = useCallback(async () => {
    if (!selectedWorkflow || !editNode) return;
    setSavingNode(true);
    try {
      const nodes = selectedWorkflow.nodes.map((rawNode, index) => {
        const node = asRecord(rawNode) || {};
        if (stringValue(node.id, `node-${index}`) !== editNode.id) return rawNode;
        const data = asRecord(node.data) || {};
        return {
          ...node,
          data: {
            ...data,
            title: editNode.title.trim() || editNode.id,
            agent: editNode.agent.trim() || 'hermes',
            profile: editNode.profile.trim() || profile,
            provider: editNode.provider.trim(),
            model: editNode.model.trim(),
            apiMode: editNode.apiMode.trim(),
            reasoningEffort: editNode.reasoningEffort.trim() || 'default',
            input: editNode.input,
            skills: editNode.skills.split(',').map((skill) => skill.trim()).filter(Boolean),
            approvalRequired: editNode.approvalRequired,
            orchestration: { ...(asRecord(data.orchestration) || {}), join: editNode.join },
          },
        };
      });
      const next = api
        ? await api.workflows.update(selectedWorkflow.id, { nodes })
        : { ...selectedWorkflow, nodes, updated_at: Date.now() };
      setWorkflows((current) => current.map((workflow) => workflow.id === next.id ? next : workflow));
      setEditNode(null);
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    } finally {
      setSavingNode(false);
    }
  }, [api, editNode, isChinese, notify, profile, selectedWorkflow]);

  const openEdgeEditor = useCallback((rawEdge?: unknown) => {
    if (!selectedWorkflow) return;
    const edge = asRecord(rawEdge) || {};
    const data = asRecord(edge.data) || {};
    const orchestration = asRecord(data.orchestration) || {};
    const condition = asRecord(orchestration.condition) || {};
    const feedback = asRecord(orchestration.feedback) || {};
    setEdgeEditor({
      id: stringValue(edge.id) || null,
      source: stringValue(edge.source, selectedWorkflow.nodes[0] ? nodeIdAt(selectedWorkflow.nodes[0], 0) : ''),
      target: stringValue(edge.target, selectedWorkflow.nodes[1] ? nodeIdAt(selectedWorkflow.nodes[1], 1) : ''),
      route: routeValue(orchestration.route),
      conditionPath: stringValue(condition.path),
      operator: stringValue(condition.operator, 'equals'),
      conditionValue: condition.value === undefined ? '' : serializeConditionValue(condition.value),
      feedback: Boolean(feedback.maxIterations),
      maxIterations: String(numberValue(feedback.maxIterations, 3)),
      loopId: stringValue(feedback.loopId),
    });
  }, [selectedWorkflow]);

  const saveEdge = useCallback(async () => {
    if (!selectedWorkflow || !edgeEditor) return;
    if (!edgeEditor.source || !edgeEditor.target || edgeEditor.source === edgeEditor.target) {
      notify(isChinese ? '连线需要不同的起点和终点' : 'An edge needs different source and target nodes');
      return;
    }
    const nodeIds = new Set(selectedWorkflow.nodes.map((node, index) => nodeIdAt(node, index)));
    if (!nodeIds.has(edgeEditor.source) || !nodeIds.has(edgeEditor.target)) {
      notify(isChinese ? '起点或终点节点不存在' : 'The source or target node does not exist');
      return;
    }
    if (edgeEditor.feedback && (!Number.isInteger(Number(edgeEditor.maxIterations)) || Number(edgeEditor.maxIterations) < 1 || Number(edgeEditor.maxIterations) > 100)) {
      notify(isChinese ? '循环最大迭代次数必须是 1 到 100' : 'Loop max iterations must be an integer from 1 to 100');
      return;
    }
    setSavingEdge(true);
    try {
      const orchestration: Record<string, unknown> = { route: edgeEditor.route };
      if (edgeEditor.conditionPath.trim()) {
        const conditionValue = parseConditionValue(edgeEditor.conditionValue);
        orchestration.condition = {
          path: edgeEditor.conditionPath.trim(),
          operator: edgeEditor.operator.trim() || 'equals',
          ...(conditionValue === undefined ? {} : { value: conditionValue }),
        };
      }
      if (edgeEditor.feedback) {
        orchestration.feedback = {
          maxIterations: Number(edgeEditor.maxIterations),
          ...(edgeEditor.loopId.trim() ? { loopId: edgeEditor.loopId.trim() } : {}),
        };
      }
      const nextEdges = [...selectedWorkflow.edges];
      const nextEdge = {
        id: edgeEditor.id || `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        source: edgeEditor.source,
        target: edgeEditor.target,
        type: edgeEditor.feedback ? 'workflow-self-loop' : 'smoothstep',
        data: { orchestration },
      };
      const existingIndex = nextEdges.findIndex((rawEdge) => stringValue(asRecord(rawEdge)?.id) === edgeEditor.id);
      if (existingIndex >= 0) nextEdges[existingIndex] = nextEdge;
      else nextEdges.push(nextEdge);
      const next = api
        ? await api.workflows.update(selectedWorkflow.id, { edges: nextEdges })
        : { ...selectedWorkflow, edges: nextEdges, updated_at: Date.now() };
      setWorkflows((current) => current.map((workflow) => workflow.id === next.id ? next : workflow));
      setEdgeEditor(null);
      notify(isChinese ? '工作流连线已保存' : 'Workflow edge saved');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    } finally {
      setSavingEdge(false);
    }
  }, [api, edgeEditor, isChinese, notify, selectedWorkflow]);

  const deleteEdge = useCallback(async (edgeId: string) => {
    if (!selectedWorkflow) return;
    const edges = selectedWorkflow.edges.filter((rawEdge) => stringValue(asRecord(rawEdge)?.id) !== edgeId);
    try {
      const next = api
        ? await api.workflows.update(selectedWorkflow.id, { edges })
        : { ...selectedWorkflow, edges, updated_at: Date.now() };
      setWorkflows((current) => current.map((workflow) => workflow.id === next.id ? next : workflow));
      notify(isChinese ? '连线已删除' : 'Edge deleted');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, isChinese, notify, selectedWorkflow]);

  const runWorkflow = useCallback(async () => {
    if (!selectedWorkflow) return;
    if (!selectedWorkflow.nodes.length) {
      notify(isChinese ? '请先添加至少一个 Agent 节点' : 'Add at least one Agent node first');
      return;
    }
    setRunning(true);
    try {
      if (api) {
        const start_node_ids = startNodeIdsInput.split(',').map((value) => value.trim()).filter(Boolean);
        const timeout_ms = Math.max(1, Number(timeoutMinutes) || 30) * 60_000;
        await api.workflows.run(selectedWorkflow.id, {
          ...(start_node_ids.length ? { start_node_ids } : {}),
          input: runInput.trim() || null,
          timeout_ms,
        });
        notify(isChinese ? '工作流已开始，切换页面不会停止它' : 'Workflow started; switching pages will not stop it');
        await refreshRuns(selectedWorkflow.id);
      } else {
        const run = fixtureRunningRun(selectedWorkflow);
        setRuns((current) => [run, ...current]);
        notify(isChinese ? '预览工作流已开始' : 'Preview workflow started');
        setTimeout(() => {
          setRuns((current) => current.map((item) => item.id === run.id ? { ...item, status: 'completed', finished_at: Date.now() } : item));
        }, 900);
      }
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    } finally {
      setRunning(false);
    }
  }, [api, isChinese, notify, refreshRuns, runInput, selectedWorkflow, startNodeIdsInput, timeoutMinutes]);

  const stopRun = useCallback(async (run: HermesStudioWorkflowRunRecord) => {
    if (!selectedWorkflow) return;
    try {
      if (api) await api.workflows.stopRun(selectedWorkflow.id, run.id);
      setRuns((current) => current.map((item) => item.id === run.id ? { ...item, status: 'canceled', finished_at: Date.now() } : item));
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, isChinese, notify, selectedWorkflow]);

  const toggleRunDetails = useCallback(async (run: HermesStudioWorkflowRunRecord) => {
    if (expandedRunId === run.id) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(run.id);
    if (!api || run.node_sessions?.length || run.edge_evaluations?.length || run.loop_epochs?.length) return;
    setSelectedRunLoading(true);
    try {
      const detailed = await api.workflows.getRun(run.workflow_id || selectedWorkflow?.id || '', run.id);
      setRuns((current) => current.map((item) => item.id === detailed.id ? detailed : item));
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
    } finally {
      setSelectedRunLoading(false);
    }
  }, [api, expandedRunId, isChinese, selectedWorkflow]);

  const approveWorkflowNode = useCallback(async (run: HermesStudioWorkflowRunRecord, session: HermesStudioWorkflowRunNodeSession, approved: boolean) => {
    if (!selectedWorkflow || !api) return;
    try {
      await api.workflows.approveNode(selectedWorkflow.id, run.id, session.node_id, approved, session.execution_id || undefined);
      await refreshRuns(selectedWorkflow.id);
      notify(approved
        ? (isChinese ? '已批准工作流节点' : 'Workflow node approved')
        : (isChinese ? '已拒绝工作流节点' : 'Workflow node rejected'));
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, isChinese, notify, refreshRuns, selectedWorkflow]);

  const rerunFromNode = useCallback(async (run: HermesStudioWorkflowRunRecord, session: HermesStudioWorkflowRunNodeSession) => {
    if (!selectedWorkflow || !api) return;
    try {
      await api.workflows.rerunFromNode(selectedWorkflow.id, run.id, session.node_id, {
        timeout_ms: Math.max(1, Number(timeoutMinutes) || 30) * 60_000,
      });
      await refreshRuns(selectedWorkflow.id);
      notify(isChinese ? '已从该节点重新运行' : 'Rerun started from this node');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, isChinese, notify, refreshRuns, selectedWorkflow, timeoutMinutes]);

  const deleteRun = useCallback(async (run: HermesStudioWorkflowRunRecord) => {
    if (!selectedWorkflow) return;
    try {
      if (api) await api.workflows.deleteRun(selectedWorkflow.id, run.id);
      setRuns((current) => current.filter((item) => item.id !== run.id));
      if (expandedRunId === run.id) setExpandedRunId(null);
      notify(isChinese ? '运行记录已删除' : 'Run history deleted');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, expandedRunId, isChinese, notify, selectedWorkflow]);

  const deleteWorkflow = useCallback(async (workflowId: string) => {
    try {
      if (api) await api.workflows.delete(workflowId);
      const next = workflows.filter((workflow) => workflow.id !== workflowId);
      setWorkflows(next);
      setSelectedId((current) => current === workflowId ? next[0]?.id || '' : current);
      setDeleteWorkflowId(null);
      notify(isChinese ? '工作流已删除' : 'Workflow deleted');
    } catch (reason) {
      const message = errorMessage(reason, isChinese);
      setError(message);
      notify(message);
    }
  }, [api, isChinese, notify, workflows]);

  if (api && workflowCapability !== 'available') {
    const capabilityMissing = workflowCapability === 'missing';
    return (
      <View style={[styles.root, { backgroundColor: tokens.colors.background, paddingBottom: insets.bottom }]}>
        <View style={[styles.header, compact && styles.headerCompact, { borderBottomColor: tokens.colors.border }]}>
          <View style={styles.headerTitleRow}>
            <IOSPressable accessibilityLabel={isChinese ? '返回导航' : 'Open navigation'} onPress={onOpenNavigation} style={styles.navigationButton}>
              <Menu color={tokens.colors.foreground} size={20} />
            </IOSPressable>
            <StudioOfficialAvatar size={compact ? 25 : 30} />
            <View style={styles.headerTitleCopy}>
              <Text numberOfLines={1} style={[styles.title, { color: tokens.colors.foreground }]}>{isChinese ? 'Hermes Studio 工作流' : 'Hermes Studio workflows'}</Text>
              <Text numberOfLines={1} style={[styles.subtitle, { color: tokens.colors.textTertiary }]}>
                {capabilityMissing
                  ? isChinese ? '服务未连接' : 'Service unavailable'
                  : isChinese ? '正在检测服务' : 'Checking service'}
              </Text>
            </View>
          </View>
          <IOSPressable accessibilityLabel={isChinese ? '重新检测工作流服务' : 'Retry workflow service check'} onPress={() => { setWorkflowCapability('unknown'); void refresh(); }} style={styles.headerIconButton}>
            <RefreshCw color={tokens.colors.foreground} size={18} />
          </IOSPressable>
        </View>
        <View style={styles.unavailableState}>
          {capabilityMissing ? <CircleAlert color={tokens.colors.warning} size={34} /> : <RefreshCw color={tokens.colors.textSecondary} size={28} />}
          <Text style={[styles.detailTitle, { color: tokens.colors.foreground, textAlign: 'center' }]}>
            {capabilityMissing
              ? isChinese ? 'Hermes Studio 工作流服务未部署' : 'Hermes Studio workflow service is not deployed'
              : isChinese ? '正在检测 Hermes Studio 工作流服务' : 'Checking Hermes Studio workflow service'}
          </Text>
          {capabilityMissing ? (
            <>
              <Text style={[styles.emptyDetailText, { color: tokens.colors.textSecondary }]}>{isChinese ? '当前 Hermes Agent 没有提供 /api/hermes/workflows。请先部署 Hermes Studio 服务，再重试。' : 'This Hermes Agent does not provide /api/hermes/workflows. Deploy the Hermes Studio service, then retry.'}</Text>
              <NativeButton onPress={() => { setWorkflowCapability('unknown'); void refresh(); }} prefix={<RefreshCw />}>
                {isChinese ? '重新检测' : 'Retry detection'}
              </NativeButton>
            </>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}> 
      <View
        style={[
          styles.header,
          compact && styles.headerCompact,
          {
            borderBottomColor: tokens.colors.border,
            minHeight: compact ? 52 + insets.top : undefined,
            paddingTop: compact ? insets.top + 7 : undefined,
          },
        ]}
      > 
        {compact ? (
          <IOSPressable
            accessibilityLabel={compactDetailOpen ? (isChinese ? '返回工作流列表' : 'Back to workflows') : (isChinese ? '返回导航' : 'Open navigation')}
            hitSlop={8}
            onPress={() => {
              if (compactDetailOpen) setCompactDetailOpen(false);
              else onOpenNavigation?.();
            }}
            style={styles.navigationButton}
          >
            {compactDetailOpen
              ? <ChevronLeft color={tokens.colors.foreground} size={21} strokeWidth={1.8} />
              : <Menu color={tokens.colors.foreground} size={19} strokeWidth={1.8} />}
          </IOSPressable>
        ) : null}
        <View style={[styles.headerTitleRow, compact && styles.headerTitleRowCompact]}>
          <StudioOfficialAvatar size={28} variant="studio" />
          <View style={styles.headerTitleCopy}>
            <Text numberOfLines={1} style={[styles.title, { color: tokens.colors.foreground }]}>
              {isChinese ? 'Hermes Studio 工作流' : 'Hermes Studio Workflows'}
            </Text>
            {!compact ? (
            <Text style={[styles.subtitle, { color: tokens.colors.textTertiary }]}> 
              {isChinese ? '可视化 Agent 编排 · 独立运行历史' : 'Visual Agent orchestration · independent run history'}
            </Text>
            ) : null}
          </View>
        </View>
        {compact ? (
          <View style={[styles.headerActions, styles.headerActionsCompact]}>
            <IOSPressable
              accessibilityLabel={isChinese ? '导入工作流' : 'Import workflow'}
              disabled={importing}
              onPress={() => { void importWorkflow(); }}
              style={styles.headerIconButton}
            >
              <Upload color={tokens.colors.textSecondary} size={16} />
            </IOSPressable>
            <IOSPressable
              accessibilityLabel={isChinese ? '导出工作流' : 'Export workflow'}
              disabled={!selectedWorkflow}
              onPress={() => { void exportWorkflow(); }}
              style={styles.headerIconButton}
            >
              <Download color={tokens.colors.textSecondary} size={16} />
            </IOSPressable>
            <IOSPressable
              accessibilityLabel={isChinese ? '刷新工作流' : 'Refresh workflows'}
              onPress={() => { void refresh(); }}
              style={styles.headerIconButton}
            >
              <RefreshCw color={tokens.colors.textSecondary} size={16} />
            </IOSPressable>
            <IOSPressable
              accessibilityLabel={isChinese ? '新建工作流' : 'Create workflow'}
              onPress={() => setCreateOpen(true)}
              style={styles.headerIconButton}
            >
              <Plus color={tokens.colors.foreground} size={18} />
            </IOSPressable>
          </View>
        ) : null}
        {!compact ? (
        <View style={styles.headerActions}>
          <NativeButton disabled={importing} ghost onPress={() => { void importWorkflow(); }} prefix={<Upload />} size="sm">
            {isChinese ? '导入' : 'Import'}
          </NativeButton>
          <NativeButton disabled={!selectedWorkflow} ghost onPress={() => { void exportWorkflow(); }} prefix={<Download />} size="sm">
            {isChinese ? '导出' : 'Export'}
          </NativeButton>
          <NativeButton ghost onPress={() => { void refresh(); }} prefix={<RefreshCw />} size="sm">
            {isChinese ? '刷新' : 'Refresh'}
          </NativeButton>
          <NativeButton onPress={() => setCreateOpen(true)} prefix={<Plus />} size="sm">
            {isChinese ? '新建工作流' : 'New workflow'}
          </NativeButton>
        </View>
        ) : null}
      </View>

      <View style={[styles.workspace, compact && styles.workspaceCompact]}>
        {(!compact || !compactDetailOpen) ? (
        <View style={[styles.workflowList, compact && styles.workflowListCompact, { backgroundColor: tokens.colors.card, borderRightColor: tokens.colors.border }]}> 
          <View style={styles.listLabelRow}>
            <Text style={[styles.sectionLabel, { color: tokens.colors.textTertiary }]}>
              {isChinese ? `工作流 · ${workflows.length}` : `Workflows · ${workflows.length}`}
            </Text>
            {loading ? <RefreshCw color={tokens.colors.textTertiary} size={13} /> : null}
          </View>
          <ScrollView contentContainerStyle={styles.workflowListContent} showsVerticalScrollIndicator={false}>
            {workflows.map((workflow) => (
              <IOSPressable
                key={workflow.id}
                onPress={() => {
                  setSelectedId(workflow.id);
                  if (compact) setCompactDetailOpen(true);
                }}
                pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.primary, 0.12) }}
                style={[styles.workflowItem, {
                  backgroundColor: selectedId === workflow.id ? multiplyAlpha(tokens.colors.primary, 0.12) : 'transparent',
                  borderColor: selectedId === workflow.id ? multiplyAlpha(tokens.colors.primary, 0.3) : tokens.colors.border,
                }]}
              >
                <Workflow color={tokens.colors.primary} size={16} />
                <View style={styles.workflowItemCopy}>
                  <Text numberOfLines={1} style={[styles.workflowItemTitle, { color: tokens.colors.foreground }]}>{workflow.name}</Text>
                  <Text style={[styles.workflowItemMeta, { color: tokens.colors.textTertiary }]}>
                    {workflow.nodes.length} {isChinese ? '节点' : 'nodes'} · {workflow.edges.length} {isChinese ? '连线' : 'edges'}
                  </Text>
                </View>
              </IOSPressable>
            ))}
            {!workflows.length && !loading ? (
              <View style={styles.emptyList}>
                <GitBranch color={tokens.colors.textTertiary} size={22} />
                <Text style={[styles.emptyListText, { color: tokens.colors.textSecondary }]}>
                  {isChinese ? '还没有工作流' : 'No workflows yet'}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
        ) : null}

        {(!compact || compactDetailOpen) ? (
        <ScrollView contentContainerStyle={[styles.detail, compact && styles.detailCompact]} style={styles.detailScroll} showsVerticalScrollIndicator={false}>
          {error ? <Text style={[styles.error, { color: tokens.colors.destructive }]}>{error}</Text> : null}
          {selectedWorkflow ? (
            <>
              <View style={styles.detailHeader}>
                <View style={styles.detailTitleCopy}>
                  <Text style={[styles.detailTitle, { color: tokens.colors.foreground }]}>{selectedWorkflow.name}</Text>
                  <Text style={[styles.detailMeta, { color: tokens.colors.textTertiary }]}>
                    {selectedWorkflow.profile} · {selectedWorkflow.nodes.length} {isChinese ? '个 Agent 节点' : 'Agent nodes'} · {selectedWorkflow.workspace || (isChinese ? '未设置工作区' : 'No workspace')}
                  </Text>
                </View>
                <IOSPressable
                  accessibilityLabel={isChinese ? '工作流设置' : 'Workflow settings'}
                  hitSlop={8}
                  onPress={openWorkflowSettings}
                  style={styles.iconButton}
                >
                  <Settings2 color={tokens.colors.textSecondary} size={16} />
                </IOSPressable>
                <IOSPressable
                  accessibilityLabel={isChinese ? '删除工作流' : 'Delete workflow'}
                  hitSlop={8}
                  onPress={() => setDeleteWorkflowId(selectedWorkflow.id)}
                  style={styles.iconButton}
                >
                  <Trash2 color={tokens.colors.textTertiary} size={16} />
                </IOSPressable>
                <IOSPressable
                  accessibilityLabel={isChinese ? '工作流定时调度' : 'Workflow schedules'}
                  hitSlop={8}
                  onPress={() => setSchedulesOpen(true)}
                  style={styles.iconButton}
                >
                  <CalendarClock color={tokens.colors.textSecondary} size={16} />
                </IOSPressable>
              </View>

              <View style={[styles.runtimeCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}> 
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionTitleRow}>
                    <CircleAlert color={statusColor(runtimeStatus?.status || 'idle')} size={15} />
                    <Text style={[styles.cardTitle, { color: tokens.colors.foreground }]}>{isChinese ? '实时运行状态' : 'Live runtime status'}</Text>
                  </View>
                  <Text style={[styles.runtimeStatus, { color: statusColor(runtimeStatus?.status || 'idle') }]}>
                    {runtimeStatus?.status || (isChinese ? '空闲' : 'Idle')}
                  </Text>
                </View>
                <Text style={[styles.runtimeMeta, { color: tokens.colors.textTertiary }]}> 
                  {runtimeStatus?.runId
                    ? `${isChinese ? '运行' : 'Run'} ${runtimeStatus.runId.slice(-8)} · ${isChinese ? '服务端实时同步' : 'Server-sourced live status'}`
                    : (isChinese ? '工作流运行由 Hermes Studio 服务端持有，切换会话不会停止任务。' : 'Runs are owned by Hermes Studio; switching sessions does not stop them.')}
                </Text>
              </View>

              <View style={[styles.sectionCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}> 
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionTitleRow}>
                    <GitCommitHorizontal color={tokens.colors.primary} size={16} />
                    <Text style={[styles.cardTitle, { color: tokens.colors.foreground }]}>{isChinese ? '画布节点' : 'Canvas nodes'}</Text>
                  </View>
                  <View style={styles.sectionActions}>
                    <NativeButton ghost onPress={() => { void openEdgeEditor(); }} prefix={<GitBranch />} size="sm">
                      {isChinese ? '添加连线' : 'Add edge'}
                    </NativeButton>
                    <NativeButton ghost onPress={() => { void addNode(); }} prefix={<Plus />} size="sm">
                      {isChinese ? '添加节点' : 'Add node'}
                    </NativeButton>
                  </View>
                </View>
                <View style={styles.nodeGrid}>
                  {selectedWorkflow.nodes.map((rawNode, index) => {
                    const node = asRecord(rawNode) || {};
                    const nodeId = stringValue(node.id, `node-${index + 1}`);
                    const data = asRecord(node.data) || {};
                    const nodeTitle = stringValue(data.title, nodeId);
                    const agent = stringValue(data.agent, 'hermes');
                    const input = stringValue(data.input, '');
                    return (
                      <View key={nodeId} style={[styles.nodeCard, { borderColor: tokens.colors.border, backgroundColor: tokens.colors.background }]}> 
                        <View style={styles.nodeCardHeader}>
                          <View style={styles.nodeBadge}>
                            <GitBranch color={tokens.colors.primary} size={14} />
                            <Text style={[styles.nodeBadgeText, { color: tokens.colors.primary }]}>{agent}</Text>
                          </View>
                          <IOSPressable
                            accessibilityLabel={isChinese ? '编辑工作流节点' : 'Edit workflow node'}
                            hitSlop={7}
                            onPress={() => setEditNode({
                              id: nodeId,
                              title: nodeTitle,
                              agent,
                              profile: stringValue(data.profile, selectedWorkflow.profile),
                              provider: stringValue(data.provider),
                              model: stringValue(data.model),
                              apiMode: stringValue(data.apiMode),
                              reasoningEffort: stringValue(data.reasoningEffort, 'default'),
                              input,
                              skills: Array.isArray(data.skills) ? data.skills.filter((skill): skill is string => typeof skill === 'string').join(', ') : '',
                              approvalRequired: data.approvalRequired === true,
                              join: asRecord(data.orchestration)?.join === 'any' ? 'any' : 'all',
                            })}
                            style={styles.iconButton}
                          >
                            <Settings2 color={tokens.colors.textTertiary} size={14} />
                          </IOSPressable>
                        </View>
                        <Text style={[styles.nodeTitle, { color: tokens.colors.foreground }]}>{nodeTitle}</Text>
                        <Text numberOfLines={3} style={[styles.nodeInput, { color: tokens.colors.textSecondary }]}>
                          {input || (isChinese ? '未设置节点输入，运行时使用上游结果。' : 'No node input; runtime uses the upstream result.')}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                {selectedWorkflow.edges.length ? (
                  <View style={[styles.edgeStrip, { borderTopColor: tokens.colors.border }]}> 
                    <Text style={[styles.edgeLabel, { color: tokens.colors.textTertiary }]}>{isChinese ? '连线' : 'Edges'}</Text>
                    {selectedWorkflow.edges.map((rawEdge, index) => {
                      const edge = asRecord(rawEdge) || {};
                      const orchestration = asRecord(asRecord(edge.data)?.orchestration) || {};
                      return (
                        <View key={stringValue(edge.id, `edge-${index}`)} style={styles.edgeRow}>
                          <View style={styles.edgeCopy}>
                            <Text style={[styles.edgeText, { color: tokens.colors.textSecondary }]}> 
                              {stringValue(edge.source, '?')} → {stringValue(edge.target, '?')}
                            </Text>
                            <Text style={[styles.edgeMeta, { color: tokens.colors.textTertiary }]}> 
                              {routeLabel(stringValue(orchestration.route, 'success'), isChinese)}
                              {asRecord(orchestration.condition)?.path ? ` · ${stringValue(asRecord(orchestration.condition)?.path)}` : ''}
                              {asRecord(orchestration.feedback)?.maxIterations ? ` · ${isChinese ? '循环' : 'loop'} ×${String(asRecord(orchestration.feedback)?.maxIterations)}` : ''}
                            </Text>
                          </View>
                          <IOSPressable accessibilityLabel={isChinese ? '编辑连线' : 'Edit edge'} onPress={() => openEdgeEditor(edge)} style={styles.smallIconButton}>
                            <Settings2 color={tokens.colors.textTertiary} size={14} />
                          </IOSPressable>
                          <IOSPressable accessibilityLabel={isChinese ? '删除连线' : 'Delete edge'} onPress={() => { void deleteEdge(stringValue(edge.id)); }} style={styles.smallIconButton}>
                            <Trash2 color={tokens.colors.destructive} size={14} />
                          </IOSPressable>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>

              <View style={[styles.sectionCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}> 
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionTitleRow}>
                    <Play color={tokens.colors.primary} size={16} />
                    <Text style={[styles.cardTitle, { color: tokens.colors.foreground }]}>{isChinese ? '运行工作流' : 'Run workflow'}</Text>
                  </View>
                  <Text style={[styles.independentLabel, { color: tokens.colors.success }]}>{isChinese ? '可后台运行' : 'Runs in background'}</Text>
                </View>
                <TextInput
                  multiline
                  onChangeText={setRunInput}
                  placeholder={isChinese ? '本次运行输入（可选）' : 'Input for this run (optional)'}
                  placeholderTextColor={tokens.colors.textTertiary}
                  style={[styles.runInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
                  value={runInput}
                />
                <TextInput
                  onChangeText={setStartNodeIdsInput}
                  placeholder={isChinese ? '起始节点 ID（可选，逗号分隔）' : 'Start node IDs (optional, comma separated)'}
                  placeholderTextColor={tokens.colors.textTertiary}
                  style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
                  value={startNodeIdsInput}
                />
                <TextInput
                  keyboardType="number-pad"
                  onChangeText={setTimeoutMinutes}
                  placeholder={isChinese ? '单次运行超时（分钟）' : 'Run timeout (minutes)'}
                  placeholderTextColor={tokens.colors.textTertiary}
                  style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
                  value={timeoutMinutes}
                />
                <Text style={[styles.runHint, { color: tokens.colors.textTertiary }]}> 
                  {isChinese
                    ? '超时会写入服务端 deadline；停止、审批、重新运行和历史证据都由 Hermes Studio 维护。'
                    : 'The timeout becomes a server deadline; Hermes Studio owns stop, approval, rerun, and evidence history.'}
                </Text>
                <NativeButton disabled={running} loading={running} onPress={() => { void runWorkflow(); }} prefix={<Play />}>
                  {isChinese ? '开始运行' : 'Start run'}
                </NativeButton>
              </View>

              <View style={[styles.sectionCard, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}> 
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionTitleRow}>
                    <RotateCcw color={tokens.colors.primary} size={16} />
                    <Text style={[styles.cardTitle, { color: tokens.colors.foreground }]}>{isChinese ? '运行历史' : 'Run history'}</Text>
                  </View>
                  {runsLoading ? <RefreshCw color={tokens.colors.textTertiary} size={13} /> : null}
                </View>
                {runs.map((run) => (
                  <View key={run.id}>
                    <View style={[styles.runRow, { borderTopColor: tokens.colors.border }]}> 
                      <View style={styles.runStatusIcon}>
                        {run.status === 'completed' ? <CheckCircle2 color={statusColor(run.status)} size={17} /> : run.status === 'failed' ? <CircleAlert color={statusColor(run.status)} size={17} /> : <Pause color={statusColor(run.status)} size={17} />}
                      </View>
                      <View style={styles.runCopy}>
                        <Text style={[styles.runTitle, { color: tokens.colors.foreground }]}>{run.status}</Text>
                        <Text style={[styles.runMeta, { color: tokens.colors.textTertiary }]}> 
                          {formatTime(run.created_at)} · {run.id.slice(-8)}
                          {run.requested_timeout_ms ? ` · ${Math.round(run.requested_timeout_ms / 60_000)}m` : ''}
                        </Text>
                        {run.error ? <Text numberOfLines={2} style={[styles.runError, { color: tokens.colors.destructive }]}>{run.error}</Text> : null}
                      </View>
                      <View style={styles.runActions}>
                        <NativeButton ghost onPress={() => { void toggleRunDetails(run); }} size="sm">
                          {expandedRunId === run.id ? (isChinese ? '收起' : 'Hide') : (isChinese ? '证据' : 'Evidence')}
                        </NativeButton>
                        {run.status === 'queued' || run.status === 'running' ? (
                          <NativeButton ghost onPress={() => { void stopRun(run); }} prefix={<Square />} size="sm">
                            {isChinese ? '停止' : 'Stop'}
                          </NativeButton>
                        ) : null}
                        <NativeButton ghost onPress={() => { void deleteRun(run); }} prefix={<Trash2 />} size="icon" />
                      </View>
                    </View>
                    {expandedRunId === run.id ? (
                      <View style={[styles.evidencePanel, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border }]}> 
                        {selectedRunLoading ? <PreviewText variant="tiny">{isChinese ? '读取运行证据…' : 'Loading run evidence…'}</PreviewText> : null}
                        <RunEvidence
                          isChinese={isChinese}
                          onApprove={(session) => { void approveWorkflowNode(run, session, true); }}
                          onReject={(session) => { void approveWorkflowNode(run, session, false); }}
                          onRerun={(session) => { void rerunFromNode(run, session); }}
                          run={run}
                          statusColor={statusColor}
                        />
                      </View>
                    ) : null}
                  </View>
                ))}
                {!runs.length ? <Text style={[styles.noRuns, { color: tokens.colors.textTertiary }]}>{isChinese ? '暂无运行记录' : 'No run history yet'}</Text> : null}
              </View>
            </>
          ) : (
            <View style={styles.emptyDetail}>
              <Workflow color={tokens.colors.textTertiary} size={30} />
              <Text style={[styles.detailTitle, { color: tokens.colors.foreground }]}>{isChinese ? '选择一个工作流' : 'Select a workflow'}</Text>
              <Text style={[styles.emptyDetailText, { color: tokens.colors.textSecondary }]}>{isChinese ? '工作流和运行记录都来自 Hermes Studio。' : 'Workflows and run history come from Hermes Studio.'}</Text>
            </View>
          )}
        </ScrollView>
        ) : null}
      </View>

      <PreviewModal onClose={() => setCreateOpen(false)} open={createOpen} title={isChinese ? '新建工作流' : 'Create workflow'}>
        <PreviewText variant="muted">{isChinese ? '创建一个 Hermes Studio Agent 节点，可继续添加节点并编辑输入。' : 'Create a Hermes Studio Agent node, then add nodes and edit their inputs.'}</PreviewText>
        <TextInput
          autoFocus
          onChangeText={setWorkflowName}
          placeholder={isChinese ? '工作流名称' : 'Workflow name'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={workflowName}
        />
        <NativeButton disabled={!workflowName.trim()} onPress={() => { void createWorkflow(); }} prefix={<Plus />}>
          {isChinese ? '创建' : 'Create'}
        </NativeButton>
      </PreviewModal>

      <PreviewModal
        onClose={() => setEditNode(null)}
        open={Boolean(editNode)}
        title={isChinese ? '编辑 Agent 节点' : 'Edit Agent node'}
      >
        <TextInput
          onChangeText={(title) => setEditNode((current) => current ? { ...current, title } : current)}
          placeholder={isChinese ? '节点标题' : 'Node title'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={editNode?.title || ''}
        />
        <TextInput
          onChangeText={(agent) => setEditNode((current) => current ? { ...current, agent } : current)}
          placeholder={isChinese ? 'Agent 类型（hermes / ekko / codex / claude）' : 'Agent kind (hermes / ekko / codex / claude)'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={editNode?.agent || ''}
        />
        <TextInput
          onChangeText={(profileValue) => setEditNode((current) => current ? { ...current, profile: profileValue } : current)}
          placeholder="Profile"
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={editNode?.profile || ''}
        />
        <View style={styles.nodeEditorGrid}>
          <TextInput
            onChangeText={(provider) => setEditNode((current) => current ? { ...current, provider } : current)}
            placeholder="Provider"
            placeholderTextColor={tokens.colors.textTertiary}
            style={[styles.modalInput, styles.gridInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
            value={editNode?.provider || ''}
          />
          <TextInput
            onChangeText={(model) => setEditNode((current) => current ? { ...current, model } : current)}
            placeholder="Model"
            placeholderTextColor={tokens.colors.textTertiary}
            style={[styles.modalInput, styles.gridInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
            value={editNode?.model || ''}
          />
        </View>
        <View style={styles.nodeEditorGrid}>
          <TextInput
            onChangeText={(apiMode) => setEditNode((current) => current ? { ...current, apiMode } : current)}
            placeholder={isChinese ? 'API 模式' : 'API mode'}
            placeholderTextColor={tokens.colors.textTertiary}
            style={[styles.modalInput, styles.gridInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
            value={editNode?.apiMode || ''}
          />
          <TextInput
            onChangeText={(reasoningEffort) => setEditNode((current) => current ? { ...current, reasoningEffort } : current)}
            placeholder={isChinese ? '推理强度' : 'Reasoning effort'}
            placeholderTextColor={tokens.colors.textTertiary}
            style={[styles.modalInput, styles.gridInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
            value={editNode?.reasoningEffort || ''}
          />
        </View>
        <TextInput
          onChangeText={(skills) => setEditNode((current) => current ? { ...current, skills } : current)}
          placeholder={isChinese ? 'Skills（逗号分隔）' : 'Skills (comma separated)'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={editNode?.skills || ''}
        />
        <TextInput
          multiline
          onChangeText={(input) => setEditNode((current) => current ? { ...current, input } : current)}
          placeholder={isChinese ? '节点输入 / 指令' : 'Node input / instruction'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, styles.modalInputLarge, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={editNode?.input || ''}
        />
        <PreviewToggle
          accessibilityLabel={isChinese ? '节点完成后需要审批' : 'Require approval after node'}
          onChange={(approvalRequired) => setEditNode((current) => current ? { ...current, approvalRequired } : current)}
          value={Boolean(editNode?.approvalRequired)}
        />
        <Text style={[styles.toggleLabel, { color: tokens.colors.textSecondary }]}> 
          {isChinese ? '节点完成后需要人工审批' : 'Require human approval after this node'}
        </Text>
        <View style={styles.inlineButtons}>
          <NativeButton ghost onPress={() => setEditNode((current) => current ? { ...current, join: 'all' } : current)} size="sm">
            {`join: all${editNode?.join === 'all' ? ' ✓' : ''}`}
          </NativeButton>
          <NativeButton ghost onPress={() => setEditNode((current) => current ? { ...current, join: 'any' } : current)} size="sm">
            {`join: any${editNode?.join === 'any' ? ' ✓' : ''}`}
          </NativeButton>
        </View>
        <NativeButton disabled={!editNode || savingNode} loading={savingNode} onPress={() => { void saveNode(); }} prefix={<Settings2 />}>
          {isChinese ? '保存节点' : 'Save node'}
        </NativeButton>
      </PreviewModal>

      <PreviewModal
        onClose={() => setWorkflowSettingsOpen(false)}
        open={workflowSettingsOpen}
        title={isChinese ? '工作流设置' : 'Workflow settings'}
      >
        <PreviewText variant="muted">{isChinese ? '工作流设置、工作区和历史均来自 Hermes Studio。' : 'Workflow settings, workspace, and history are provided by Hermes Studio.'}</PreviewText>
        <TextInput
          onChangeText={setWorkflowNameDraft}
          placeholder={isChinese ? '工作流名称' : 'Workflow name'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={workflowNameDraft}
        />
        <TextInput
          onChangeText={setWorkflowWorkspaceDraft}
          placeholder={isChinese ? '工作区路径（可选）' : 'Workspace path (optional)'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={workflowWorkspaceDraft}
        />
        <Text style={[styles.runHint, { color: tokens.colors.textTertiary }]}>{isChinese ? `Profile：${selectedWorkflow?.profile || profile} · 支持节点级 Agent / Provider / Model 设置。` : `Profile: ${selectedWorkflow?.profile || profile} · Node-level Agent / Provider / Model settings are supported.`}</Text>
        <NativeButton disabled={!workflowNameDraft.trim()} onPress={() => { void saveWorkflowSettings(); }} prefix={<Save />}>
          {isChinese ? '保存工作流设置' : 'Save workflow settings'}
        </NativeButton>
      </PreviewModal>

      <PreviewModal
        onClose={() => setEdgeEditor(null)}
        open={Boolean(edgeEditor)}
        title={edgeEditor?.id ? (isChinese ? '编辑工作流连线' : 'Edit workflow edge') : (isChinese ? '添加工作流连线' : 'Add workflow edge')}
      >
        <PreviewText variant="muted">{isChinese ? '连线支持 success / failure / always 路由、条件判断以及有界反馈循环。字段直接对应 Hermes Studio 最新工作流编排契约。' : 'Edges support success / failure / always routes, conditions, and bounded feedback loops from the latest Hermes Studio orchestration contract.'}</PreviewText>
        <TextInput
          onChangeText={(source) => setEdgeEditor((current) => current ? { ...current, source } : current)}
          placeholder={isChinese ? '起点节点 ID' : 'Source node ID'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={edgeEditor?.source || ''}
        />
        <TextInput
          onChangeText={(target) => setEdgeEditor((current) => current ? { ...current, target } : current)}
          placeholder={isChinese ? '终点节点 ID' : 'Target node ID'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={edgeEditor?.target || ''}
        />
        <View style={styles.inlineButtons}>
          {(['success', 'failure', 'always'] as const).map((route) => (
            <NativeButton ghost key={route} onPress={() => setEdgeEditor((current) => current ? { ...current, route } : current)} size="sm">
              {`${route}${edgeEditor?.route === route ? ' ✓' : ''}`}
            </NativeButton>
          ))}
        </View>
        <TextInput
          onChangeText={(conditionPath) => setEdgeEditor((current) => current ? { ...current, conditionPath } : current)}
          placeholder={isChinese ? '条件路径（留空表示只按路由）例如 output / error / outputJson.status' : 'Condition path (blank for route only): output / error / outputJson.status'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={edgeEditor?.conditionPath || ''}
        />
        <TextInput
          onChangeText={(operator) => setEdgeEditor((current) => current ? { ...current, operator } : current)}
          placeholder={isChinese ? '条件运算符（equals / contains / exists 等）' : 'Condition operator (equals / contains / exists)'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={edgeEditor?.operator || ''}
        />
        <TextInput
          onChangeText={(conditionValue) => setEdgeEditor((current) => current ? { ...current, conditionValue } : current)}
          placeholder={isChinese ? '条件值（可填 JSON，如 "APPROVED"、42、true）' : 'Condition value (JSON: "APPROVED", 42, true)'}
          placeholderTextColor={tokens.colors.textTertiary}
          style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
          value={edgeEditor?.conditionValue || ''}
        />
        <PreviewToggle
          accessibilityLabel={isChinese ? '启用反馈循环' : 'Enable feedback loop'}
          onChange={(feedback) => setEdgeEditor((current) => current ? { ...current, feedback } : current)}
          value={Boolean(edgeEditor?.feedback)}
        />
        <Text style={[styles.toggleLabel, { color: tokens.colors.textSecondary }]}>{isChinese ? '这是有界反馈循环' : 'This is a bounded feedback loop'}</Text>
        {edgeEditor?.feedback ? (
          <>
            <TextInput
              keyboardType="number-pad"
              onChangeText={(maxIterations) => setEdgeEditor((current) => current ? { ...current, maxIterations } : current)}
              placeholder={isChinese ? '最大迭代次数（1-100）' : 'Max iterations (1-100)'}
              placeholderTextColor={tokens.colors.textTertiary}
              style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
              value={edgeEditor.maxIterations}
            />
            <TextInput
              onChangeText={(loopId) => setEdgeEditor((current) => current ? { ...current, loopId } : current)}
              placeholder={isChinese ? '循环 ID（可选）' : 'Loop ID (optional)'}
              placeholderTextColor={tokens.colors.textTertiary}
              style={[styles.modalInput, { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, color: tokens.colors.foreground }]}
              value={edgeEditor.loopId}
            />
          </>
        ) : null}
        <NativeButton disabled={!edgeEditor || savingEdge} loading={savingEdge} onPress={() => { void saveEdge(); }} prefix={<Save />}>
          {isChinese ? '保存连线' : 'Save edge'}
        </NativeButton>
      </PreviewModal>

      <PreviewModal
        onClose={() => { void cancelWorkflowImport(); }}
        open={Boolean(importPreview)}
        title={isChinese ? '确认导入工作流' : 'Confirm workflow import'}
      >
        <PreviewText variant="muted">{isChinese ? '先预览再确认，避免把错误的节点或连线写入 Hermes Studio。' : 'Preview before confirming so invalid nodes or edges are not written to Hermes Studio.'}</PreviewText>
        <Text style={[styles.importSummary, { color: tokens.colors.foreground }]}> 
          {importPreview ? `${importPreview.summary.name} · ${importPreview.summary.nodes} ${isChinese ? '个节点' : 'nodes'} · ${importPreview.summary.edges} ${isChinese ? '条连线' : 'edges'}` : ''}
        </Text>
        <Text style={[styles.runHint, { color: tokens.colors.textTertiary }]}>{isChinese ? `文档大小：${importDocument.length} 字符 · 摘要校验：${importPreview?.digest || ''}` : `Document size: ${importDocument.length} chars · Digest: ${importPreview?.digest || ''}`}</Text>
        <View style={styles.inlineButtons}>
          <NativeButton ghost onPress={() => { void cancelWorkflowImport(); }} size="sm">{isChinese ? '取消' : 'Cancel'}</NativeButton>
          <NativeButton disabled={importing} loading={importing} onPress={() => { void confirmWorkflowImport(); }} prefix={<CheckCircle2 />} size="sm">{isChinese ? '确认导入' : 'Confirm import'}</NativeButton>
        </View>
      </PreviewModal>

      <HermesStudioWorkflowSchedules
        client={client}
        isChinese={isChinese}
        notify={notify}
        onClose={() => setSchedulesOpen(false)}
        open={schedulesOpen}
        profile={profile}
        workflow={selectedWorkflow}
      />

      <ConfirmDialog
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        confirmLabel={isChinese ? '删除' : 'Delete'}
        description={isChinese ? '删除后工作流定义和 Hermes Studio 运行历史都会移除。' : 'The workflow definition and Hermes Studio run history will be removed.'}
        destructive
        onCancel={() => setDeleteWorkflowId(null)}
        onConfirm={() => { if (deleteWorkflowId) void deleteWorkflow(deleteWorkflowId); }}
        open={Boolean(deleteWorkflowId)}
        title={isChinese ? '删除工作流？' : 'Delete workflow?'}
      />
    </View>
  );

  function statusColor(status: string): string {
    if (status === 'completed') return tokens.colors.success;
    if (status === 'failed' || status === 'approval_rejected') return tokens.colors.destructive;
    if (status === 'running' || status === 'queued' || status === 'blocked') return tokens.colors.warning;
    return tokens.colors.textTertiary;
  }
}

function RunEvidence({
  isChinese,
  onApprove,
  onReject,
  onRerun,
  run,
  statusColor,
}: {
  isChinese: boolean;
  onApprove(session: HermesStudioWorkflowRunNodeSession): void;
  onReject(session: HermesStudioWorkflowRunNodeSession): void;
  onRerun(session: HermesStudioWorkflowRunNodeSession): void;
  run: HermesStudioWorkflowRunRecord;
  statusColor(status: string): string;
}) {
  const { tokens } = useTheme();
  const sessions = run.node_sessions || [];
  const edges = run.edge_evaluations || [];
  const loops = run.loop_epochs || [];
  if (!sessions.length && !edges.length && !loops.length) {
    return <Text style={[styles.noRuns, { color: tokens.colors.textTertiary }]}>{isChinese ? '服务端尚未返回节点执行证据。' : 'The server has not returned node execution evidence yet.'}</Text>;
  }
  return (
    <View style={styles.evidenceContent}>
      <Text style={[styles.evidenceTitle, { color: tokens.colors.foreground }]}>{isChinese ? '节点会话' : 'Node sessions'}</Text>
      {sessions.map((session) => (
        <View key={session.id} style={[styles.evidenceRow, { borderColor: tokens.colors.border }]}> 
          <View style={styles.evidenceCopy}>
            <Text style={[styles.evidenceNode, { color: tokens.colors.foreground }]}>{session.node_id} · {session.agent}</Text>
            <Text style={[styles.evidenceMeta, { color: tokens.colors.textTertiary }]}> 
              {session.status} · #{session.execution_id.slice(-8)}{session.error ? ` · ${session.error}` : ''}
            </Text>
          </View>
          {session.status === 'blocked' || session.status === 'pending_approval' ? (
            <View style={styles.inlineButtons}>
              <NativeButton ghost onPress={() => onReject(session)} size="sm">{isChinese ? '拒绝' : 'Reject'}</NativeButton>
              <NativeButton onPress={() => onApprove(session)} size="sm">{isChinese ? '批准' : 'Approve'}</NativeButton>
            </View>
          ) : session.status === 'completed' || session.status === 'failed' ? (
            <NativeButton ghost onPress={() => onRerun(session)} size="sm">{isChinese ? '重跑' : 'Rerun'}</NativeButton>
          ) : null}
        </View>
      ))}
      {edges.length ? (
        <>
          <Text style={[styles.evidenceTitle, { color: tokens.colors.foreground }]}>{isChinese ? '路径判断' : 'Edge evaluations'}</Text>
          {edges.map((edge) => <EdgeEvidence key={edge.id} edge={edge} isChinese={isChinese} statusColor={statusColor} />)}
        </>
      ) : null}
      {loops.length ? (
        <>
          <Text style={[styles.evidenceTitle, { color: tokens.colors.foreground }]}>{isChinese ? '循环事件' : 'Loop epochs'}</Text>
          {loops.map((loop) => (
            <Text key={loop.id} style={[styles.evidenceMeta, { color: tokens.colors.textSecondary }]}> 
              {loop.loop_id} · {isChinese ? '第' : 'iteration '}{loop.iteration}{isChinese ? '轮' : ''} · {loop.status}{loop.exit_reason ? ` · ${loop.exit_reason}` : ''}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}

function EdgeEvidence({
  edge,
  isChinese,
  statusColor,
}: {
  edge: HermesStudioWorkflowRunEdgeEvaluation;
  isChinese: boolean;
  statusColor(status: string): string;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.evidenceRow, { borderColor: tokens.colors.border }]}> 
      <View style={styles.evidenceCopy}>
        <Text style={[styles.evidenceNode, { color: tokens.colors.foreground }]}>{edge.source_node_id} → {edge.target_node_id}</Text>
        <Text style={[styles.evidenceMeta, { color: tokens.colors.textTertiary }]}> 
          {routeLabel(edge.route, isChinese)} · {edge.status} · {edge.reason || (isChinese ? '已完成路径判断' : 'Evaluated')}
        </Text>
      </View>
      <Text style={[styles.evidenceStatus, { color: statusColor(edge.status === 'taken' ? 'completed' : edge.status === 'error' ? 'failed' : 'idle') }]}>{edge.status}</Text>
    </View>
  );
}

const styles = {
  root: { flex: 1 },
  header: { alignItems: 'center' as const, borderBottomWidth: 1, flexDirection: 'row' as const, justifyContent: 'space-between' as const, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
  headerCompact: { paddingHorizontal: 10, paddingVertical: 7 },
  headerTitleRow: { alignItems: 'center' as const, flex: 1, flexDirection: 'row' as const, gap: 9, minWidth: 0 },
  headerTitleRowCompact: { gap: 7 },
  headerTitleCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700' as const },
  subtitle: { fontSize: 10, marginTop: 2 },
  headerActions: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 5, marginLeft: 10 },
  headerActionsCompact: { flexShrink: 0, gap: 1, marginLeft: 4 },
  headerIconButton: { alignItems: 'center' as const, borderRadius: 8, justifyContent: 'center' as const, minHeight: 30, minWidth: 30 },
  navigationButton: { alignItems: 'center' as const, borderRadius: 8, justifyContent: 'center' as const, minHeight: 32, minWidth: 30, marginRight: 2 },
  workspace: { flex: 1, flexDirection: 'row' as const, minHeight: 0 },
  workspaceCompact: { flexDirection: 'column' as const },
  workflowList: { borderRightWidth: 1, minWidth: 220, paddingHorizontal: 10, paddingTop: 12, width: 260 },
  workflowListCompact: { borderRightWidth: 0, minWidth: 0, paddingHorizontal: 14, width: '100%' as const },
  listLabelRow: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingHorizontal: 4 },
  sectionLabel: { fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.8, textTransform: 'uppercase' as const },
  workflowListContent: { gap: 7, paddingBottom: 20, paddingTop: 9 },
  workflowItem: { alignItems: 'center' as const, borderRadius: 9, borderWidth: 1, flexDirection: 'row' as const, gap: 8, minHeight: 50, paddingHorizontal: 9, paddingVertical: 8 },
  workflowItemCopy: { flex: 1, minWidth: 0 },
  workflowItemTitle: { fontSize: 12, fontWeight: '600' as const },
  workflowItemMeta: { fontSize: 10, marginTop: 3 },
  emptyList: { alignItems: 'center' as const, gap: 7, paddingVertical: 34 },
  emptyListText: { fontSize: 11 },
  detailScroll: { flex: 1, minWidth: 0 },
  detail: { gap: 12, minWidth: 0, padding: 16, paddingBottom: 34 },
  detailCompact: { paddingHorizontal: 14, paddingTop: 14 },
  error: { fontSize: 11 },
  detailHeader: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  detailTitleCopy: { flex: 1, minWidth: 0 },
  detailTitle: { fontSize: 18, fontWeight: '700' as const },
  detailMeta: { fontSize: 11, marginTop: 3 },
  iconButton: { alignItems: 'center' as const, borderRadius: 8, justifyContent: 'center' as const, minHeight: 30, minWidth: 30 },
  smallIconButton: { alignItems: 'center' as const, borderRadius: 7, justifyContent: 'center' as const, minHeight: 28, minWidth: 28 },
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  runtimeCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  sectionHeaderRow: { alignItems: 'center' as const, flexDirection: 'row' as const, flexWrap: 'wrap' as const, justifyContent: 'space-between' as const, marginBottom: 10, minWidth: 0, rowGap: 6 },
  sectionTitleRow: { alignItems: 'center' as const, flexDirection: 'row' as const, flexShrink: 1, gap: 7, minWidth: 0 },
  sectionActions: { alignItems: 'center' as const, flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 5 },
  cardTitle: { fontSize: 13, fontWeight: '700' as const },
  runtimeStatus: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  runtimeMeta: { fontSize: 10, lineHeight: 15 },
  independentLabel: { fontSize: 10, fontWeight: '600' as const },
  nodeGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 9 },
  nodeCard: { borderRadius: 9, borderWidth: 1, minWidth: 190, padding: 10, width: 245 },
  nodeCardHeader: { alignItems: 'center' as const, flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  nodeBadge: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 5 },
  nodeBadgeText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  nodeTitle: { fontSize: 13, fontWeight: '700' as const, marginTop: 9 },
  nodeInput: { fontSize: 11, lineHeight: 16, marginTop: 6 },
  edgeStrip: { borderTopWidth: 1, gap: 4, marginTop: 12, paddingTop: 9 },
  edgeRow: { alignItems: 'center' as const, flexDirection: 'row' as const, gap: 4, minHeight: 35 },
  edgeCopy: { flex: 1, minWidth: 0 },
  edgeLabel: { fontSize: 10, fontWeight: '700' as const },
  edgeText: { fontSize: 11 },
  edgeMeta: { fontSize: 10, marginTop: 2 },
  runInput: { borderRadius: 8, borderWidth: 1, fontSize: 12, lineHeight: 17, marginBottom: 9, maxHeight: 90, minHeight: 42, paddingHorizontal: 10, paddingVertical: 8 },
  runHint: { fontSize: 10, lineHeight: 15, marginTop: 7 },
  runRow: { alignItems: 'center' as const, borderTopWidth: 1, flexDirection: 'row' as const, gap: 8, minHeight: 58, paddingVertical: 8 },
  runStatusIcon: { alignItems: 'center' as const, justifyContent: 'center' as const, width: 22 },
  runCopy: { flex: 1, minWidth: 0 },
  runTitle: { fontSize: 12, fontWeight: '700' as const, textTransform: 'capitalize' as const },
  runMeta: { fontSize: 10, marginTop: 2 },
  runError: { fontSize: 10, marginTop: 3 },
  runActions: { alignItems: 'center' as const, flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 3 },
  evidencePanel: { borderRadius: 9, borderWidth: 1, gap: 8, marginBottom: 8, padding: 9 },
  evidenceContent: { gap: 7 },
  evidenceTitle: { fontSize: 11, fontWeight: '700' as const, marginTop: 3 },
  evidenceRow: { alignItems: 'center' as const, borderRadius: 7, borderWidth: 1, flexDirection: 'row' as const, gap: 8, minHeight: 40, paddingHorizontal: 7, paddingVertical: 5 },
  evidenceCopy: { flex: 1, minWidth: 0 },
  evidenceNode: { fontSize: 10, fontWeight: '700' as const },
  evidenceMeta: { fontSize: 9, lineHeight: 13, marginTop: 2 },
  evidenceStatus: { fontSize: 9, fontWeight: '700' as const },
  noRuns: { fontSize: 11, paddingVertical: 10 },
  emptyDetail: { alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: 320, padding: 28 },
  emptyDetailText: { fontSize: 12, marginTop: 6, textAlign: 'center' as const },
  unavailableState: { alignItems: 'center' as const, flex: 1, gap: 12, justifyContent: 'center' as const, padding: 28 },
  modalInput: { borderRadius: 8, borderWidth: 1, fontSize: 13, marginTop: 10, minHeight: 40, paddingHorizontal: 10, paddingVertical: 8 },
  modalInputLarge: { minHeight: 100, textAlignVertical: 'top' as const },
  nodeEditorGrid: { flexDirection: 'row' as const, gap: 7 },
  gridInput: { flex: 1, minWidth: 0 },
  inlineButtons: { alignItems: 'center' as const, flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  toggleLabel: { fontSize: 10, marginTop: -4 },
  importSummary: { fontSize: 14, fontWeight: '700' as const, marginTop: 10 },
};

function errorMessage(reason: unknown, isChinese: boolean): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  return isChinese ? 'Hermes Studio 工作流暂时不可用' : 'Hermes Studio workflows are temporarily unavailable';
}

function defaultWorkflowNode(profile: string, title: string): Record<string, unknown> {
  return {
    id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'agent',
    position: { x: 0, y: 0 },
    dragHandle: '.node-header',
    style: { width: '360px', height: '300px' },
    data: {
      title,
      agent: 'hermes',
      profile,
      provider: '',
      model: '',
      apiMode: '',
      reasoningEffort: 'default',
      input: '',
      skills: [],
      images: [],
      approvalRequired: false,
      orchestration: { join: 'all' },
    },
  };
}

function fixtureWorkflows(profile: string): HermesStudioWorkflowRecord[] {
  const firstNode = { ...defaultWorkflowNode(profile, 'Plan release'), id: 'preview-node-1' };
  return [{
    id: 'preview-workflow',
    name: 'Release checklist',
    profile,
    workspace: null,
    nodes: [
      firstNode,
      { ...defaultWorkflowNode(profile, 'Review risks'), id: 'preview-node-2', position: { x: 420, y: 0 } },
    ],
    edges: [{ id: 'preview-edge-1', source: 'preview-node-1', target: 'preview-node-2' }],
    viewport: { x: 0, y: 0, zoom: 1 },
    created_at: Date.now() - 86_400_000,
    updated_at: Date.now() - 65_000,
  }];
}

function fixtureRuns(workflowId: string): HermesStudioWorkflowRunRecord[] {
  return [{
    id: 'preview-run-1',
    workflow_id: workflowId,
    profile: 'default',
    workspace: null,
    start_node_ids: [],
    status: 'completed',
    snapshot_nodes: [],
    snapshot_edges: [],
    started_at: Date.now() - 70_000,
    finished_at: Date.now() - 65_000,
    created_at: Date.now() - 70_000,
    error: null,
    node_sessions: [],
  }];
}

function fixtureRunningRun(workflow: HermesStudioWorkflowRecord): HermesStudioWorkflowRunRecord {
  return {
    ...fixtureRuns(workflow.id)[0],
    id: `preview-run-${Date.now().toString(36)}`,
    status: 'running',
    created_at: Date.now(),
    started_at: Date.now(),
    finished_at: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function formatTime(value: number): string {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function nodeIdAt(rawNode: unknown, index: number): string {
  return stringValue(asRecord(rawNode)?.id, `node-${index + 1}`);
}

function routeValue(value: unknown): EdgeEditorState['route'] {
  return value === 'failure' || value === 'always' ? value : 'success';
}

function serializeConditionValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseConditionValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function routeLabel(route: string, isChinese: boolean): string {
  if (route === 'failure') return isChinese ? '失败路由' : 'failure route';
  if (route === 'always') return isChinese ? '始终路由' : 'always route';
  return isChinese ? '成功路由' : 'success route';
}
