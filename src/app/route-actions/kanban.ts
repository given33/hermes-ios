import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type { JsonRecord } from '../../api/cloud/transport';
import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  type HermesSwiftUIRouteAction,
  type HermesSwiftUIRouteActionPayload,
} from '../swiftui-route-contract';
import { isRecord, stringValue } from '../route-snapshots/support';
import {
  presentKanbanAttachment,
  uploadKanbanAttachmentUris,
} from './kanban-detail-files';

export type KanbanActionResult = 'reload' | 'none' | {
  kanbanDetailJSON?: string;
  message: string;
  reload?: boolean;
};

export interface KanbanDetailFenceState {
  generation: number;
  taskId: string;
}

export interface KanbanDetailFenceRequest {
  state: KanbanDetailFenceState;
  token?: number;
}

export function beginKanbanDetailRequest(
  state: KanbanDetailFenceState,
  action: string,
  taskId: string,
): KanbanDetailFenceRequest {
  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanBoardSwitch) {
    const generation = state.generation + 1;
    return {
      state: { generation, taskId: '' },
      token: generation,
    };
  }
  if (!kanbanActionReturnsDetail(action)) return { state };
  const generation = state.generation + 1;
  return {
    state: {
      generation,
      taskId: action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanTaskOpen
        ? taskId.trim()
        : (state.taskId || taskId.trim()),
    },
    token: generation,
  };
}

export function shouldClearKanbanDetail(
  state: KanbanDetailFenceState,
  token: number | undefined,
): boolean {
  return token !== undefined
    && token === state.generation
    && state.taskId === '';
}

export function shouldApplyKanbanDetail(
  state: KanbanDetailFenceState,
  token: number | undefined,
  detailJSON: string,
): boolean {
  if (token === undefined || token !== state.generation || !state.taskId) return false;
  try {
    const detail: unknown = JSON.parse(detailJSON);
    if (!isRecord(detail) || !isRecord(detail.task)) return false;
    return stringValue(detail.task.id) === state.taskId;
  } catch {
    return false;
  }
}

export function resetKanbanDetailFence(
  state: KanbanDetailFenceState,
): KanbanDetailFenceState {
  return { generation: state.generation + 1, taskId: '' };
}

/** Bridge native task controls to the upstream Kanban facade. */
export async function performKanbanAction(
  api: HermesCloudApi,
  action: HermesSwiftUIRouteAction,
  payload: HermesSwiftUIRouteActionPayload,
  profile: string,
  chinese: boolean,
): Promise<KanbanActionResult | undefined> {
  if (!isKanbanAction(action)) return undefined;
  if (payload.route !== 'kanban') return 'none';

  const taskId = payload.id?.trim() || '';
  const board = payload.fields?.board?.trim() || undefined;
  const reason = payload.detail?.trim() || payload.fields?.reason?.trim() || '';

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanCreate) {
    if (!payload.name && !payload.value) return 'none';
    const taskInput = {
      title: payload.name || payload.value || (chinese ? '新任务' : 'New task'),
      body: payload.detail || '',
    };
    const created = board
      ? await api.createKanbanTask(taskInput, board)
      : await api.createKanbanTask(taskInput);
    const taskRecord = isRecord(created.task) ? created.task : {};
    const createdTaskId = stringValue(taskRecord.id);
    if (createdTaskId && payload.targetId && payload.targetId !== 'triage') {
      await updateKanbanTaskOnBoard(
        api,
        createdTaskId,
        { status: payload.targetId },
        board,
      );
    }
    return 'reload';
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanUpdate) {
    if (!taskId) return 'none';
    await updateKanbanTaskOnBoard(api, taskId, {
      ...(payload.name ? { title: payload.name } : {}),
      ...(payload.detail !== undefined ? { body: payload.detail } : {}),
      ...(payload.targetId ? { status: payload.targetId } : {}),
    }, board);
    return 'reload';
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanMove) {
    if (!taskId) return 'none';
    await updateKanbanTaskOnBoard(api, taskId, {
      status: payload.targetId || payload.value,
      position: payload.position,
    }, board);
    return 'reload';
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanDelete) {
    if (!taskId) return 'none';
    await updateKanbanTaskOnBoard(api, taskId, { archived: true }, board);
    return 'reload';
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanTaskOpen) {
    if (!taskId) return 'none';
    const detail = await getEnrichedKanbanTask(api, taskId, board);
    return { kanbanDetailJSON: JSON.stringify(detail), message: '' };
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanCommentAdd) {
    const body = payload.detail?.trim() || payload.value?.trim() || '';
    if (!taskId || !body) return 'none';
    await api.addKanbanComment(
      taskId,
      body,
      payload.fields?.author?.trim() || profile,
      board,
    );
    return {
      kanbanDetailJSON: await refreshedTaskJSON(api, taskId, board, {}),
      message: chinese ? '评论已添加' : 'Comment added',
    };
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanAttachmentUpload) {
    if (!taskId || !payload.uris?.length) return 'none';
    await uploadKanbanAttachmentUris(api, taskId, payload.uris, {
      board,
      stagedImport: payload.fields?.stagedImport === 'true',
      uploadedBy: payload.fields?.author?.trim() || profile,
    });
    return {
      kanbanDetailJSON: await refreshedTaskJSON(api, taskId, board, {}),
      message: chinese
        ? `已上传 ${payload.uris.length} 个附件`
        : `${payload.uris.length} attachment${payload.uris.length === 1 ? '' : 's'} uploaded`,
    };
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanAttachmentDownload) {
    const attachmentId = payload.targetId?.trim() || payload.value?.trim() || '';
    if (!attachmentId) return 'none';
    await presentKanbanAttachment(api, attachmentId, payload.name?.trim() || '', {
      board,
      expectedBytes: payload.position,
    });
    return 'none';
  }

  if (
    action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRelationLink
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRelationUnlink
  ) {
    const targetId = payload.targetId?.trim() || payload.value?.trim() || '';
    if (!taskId || !targetId || targetId === taskId) return 'none';
    const targetIsParent = payload.fields?.relation === 'parent';
    const parentId = targetIsParent ? targetId : taskId;
    const childId = targetIsParent ? taskId : targetId;
    if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRelationLink) {
      await api.linkKanbanTasks(parentId, childId, board);
    } else {
      await api.unlinkKanbanTasks(parentId, childId, board);
    }
    return mutationResult(
      api,
      taskId,
      board,
      action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRelationLink
        ? (chinese ? '任务关系已创建' : 'Task relationship linked')
        : (chinese ? '任务关系已解除' : 'Task relationship unlinked'),
    );
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanDispatch) {
    const result = await api.dispatchKanban({
      board,
      dryRun: payload.fields?.dryRun === 'true',
      max: boundedInteger(payload.fields?.max, 1, 100),
    });
    return {
      message: resultMessage(result) || (chinese ? '已运行任务调度' : 'Task dispatch completed'),
      reload: true,
    };
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanBoardSwitch) {
    const slug = payload.targetId?.trim() || payload.value?.trim() || '';
    if (!slug) return 'none';
    const result = await api.switchKanbanBoard(slug);
    return {
      kanbanDetailJSON: '',
      message: resultMessage(result) || (chinese ? `已切换到看板 ${slug}` : `Switched to board ${slug}`),
      reload: true,
    };
  }

  if (!taskId) return 'none';

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanReassign) {
    const assignee = payload.targetId?.trim()
      || payload.value?.trim()
      || payload.fields?.profile?.trim()
      || '';
    if (!assignee) return 'none';
    const result = await api.reassignKanbanTask(
      taskId,
      assignee,
      payload.fields?.reclaim === 'true',
      board,
      reason,
    );
    return mutationResult(
      api,
      taskId,
      board,
      resultMessage(result) || (chinese ? `任务已分配给 ${assignee}` : `Task assigned to ${assignee}`),
    );
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanReclaim) {
    const result = await api.reclaimKanbanTask(taskId, reason, board);
    return mutationResult(
      api,
      taskId,
      board,
      resultMessage(result) || (chinese ? '任务已收回' : 'Task reclaimed'),
    );
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanSpecify) {
    const result = await api.specifyKanbanTask(
      taskId,
      { author: payload.fields?.author?.trim() || profile },
      board,
    );
    return mutationResult(
      api,
      taskId,
      board,
      resultMessage(result) || (chinese ? '任务规格已生成' : 'Task specification generated'),
    );
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanDecompose) {
    const result = await api.decomposeKanbanTask(
      taskId,
      { author: payload.fields?.author?.trim() || profile },
      board,
    );
    return mutationResult(
      api,
      taskId,
      board,
      resultMessage(result) || (chinese ? '任务已拆分' : 'Task decomposed'),
    );
  }

  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanTaskLog) {
    const log = await api.getKanbanTaskLog(taskId, {
      board,
      tail: boundedInteger(payload.fields?.tail, 1, 10_000) ?? 300,
    });
    return {
      kanbanDetailJSON: await refreshedTaskJSON(api, taskId, board, { worker_log: log }),
      message: chinese ? 'Worker 日志已加载' : 'Worker log loaded',
    };
  }

  const runId = payload.targetId?.trim() || payload.value?.trim() || '';
  if (!runId) return 'none';
  if (action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRunInspect) {
    const inspection = await api.inspectKanbanRun(runId, board);
    return {
      kanbanDetailJSON: await refreshedTaskJSON(api, taskId, board, { inspection }),
      message: chinese ? '运行状态已检查' : 'Run inspected',
    };
  }

  const result = await api.terminateKanbanRun(runId, reason, board);
  return mutationResult(
    api,
    taskId,
    board,
    resultMessage(result) || (chinese ? '运行已终止' : 'Run terminated'),
    { last_action: result },
  );
}

async function mutationResult(
  api: HermesCloudApi,
  taskId: string,
  board: string | undefined,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<KanbanActionResult> {
  return {
    kanbanDetailJSON: await refreshedTaskJSON(api, taskId, board, extra),
    message,
    reload: true,
  };
}

async function refreshedTaskJSON(
  api: HermesCloudApi,
  taskId: string,
  board: string | undefined,
  extra: Record<string, unknown>,
): Promise<string> {
  const detail = await getEnrichedKanbanTask(api, taskId, board).catch(() => undefined);
  return JSON.stringify({ task: { id: taskId }, ...(detail || {}), ...extra });
}

async function getEnrichedKanbanTask(
  api: HermesCloudApi,
  taskId: string,
  board: string | undefined,
): Promise<JsonRecord> {
  const detail = await api.getKanbanTask(taskId, { board });
  const links = isRecord(detail.links) ? detail.links : {};
  const parentIds = linkedTaskIds(links.parents);
  if (!parentIds.length) return detail;

  // Upstream embeds rich child_results but exposes parent dependencies as IDs.
  // Resolve those IDs through the same official task endpoint so native rows
  // remain useful, while bounding fan-out from a malformed graph response.
  const parentResults = await Promise.all(parentIds.slice(0, 64).map(async (parentId) => {
    const parent = await api.getKanbanTask(parentId, { board }).catch(() => undefined);
    return parent && isRecord(parent.task)
      ? parent.task
      : { id: parentId };
  }));
  return { ...detail, parent_results: parentResults };
}

function linkedTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of value) {
    const id = stringValue(entry);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function resultMessage(value: unknown): string {
  if (!isRecord(value)) return '';
  return stringValue(value.message) || stringValue(value.reason);
}

function boundedInteger(value: string | undefined, minimum: number, maximum: number): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function updateKanbanTaskOnBoard(
  api: HermesCloudApi,
  taskId: string,
  update: JsonRecord,
  board: string | undefined,
): Promise<JsonRecord> {
  return board
    ? api.updateKanbanTask(taskId, update, board)
    : api.updateKanbanTask(taskId, update);
}

function isKanbanAction(action: HermesSwiftUIRouteAction): boolean {
  return action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanCreate
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanUpdate
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanMove
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanDelete
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanTaskOpen
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanCommentAdd
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanAttachmentUpload
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanAttachmentDownload
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRelationLink
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRelationUnlink
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanDispatch
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanReassign
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanReclaim
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanSpecify
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanDecompose
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRunInspect
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRunTerminate
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanTaskLog
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanBoardSwitch;
}

function kanbanActionReturnsDetail(action: string): boolean {
  return action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanTaskOpen
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanCommentAdd
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanAttachmentUpload
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRelationLink
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRelationUnlink
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanReassign
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanReclaim
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanSpecify
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanDecompose
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRunInspect
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanRunTerminate
    || action === HERMES_SWIFTUI_ROUTE_ACTIONS.kanbanTaskLog;
}
