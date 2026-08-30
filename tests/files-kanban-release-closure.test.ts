import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { HermesCloudApi } from '../src/api/HermesCloudApi';
import { performHermesSwiftUIRouteAction } from '../src/app/hermes-route-data';
import {
  ACCOUNT_FILES_PAGE_LIMIT,
  accountFilesPageQuery,
  loadAccountFilesPage,
} from '../src/app/route-actions/account-files-page';
import {
  KANBAN_ATTACHMENT_MAX_BYTES,
  validateKanbanAttachmentSize,
} from '../src/app/route-actions/kanban-detail-files';
import {
  beginKanbanDetailRequest,
  resetKanbanDetailFence,
  shouldApplyKanbanDetail,
  shouldClearKanbanDetail,
} from '../src/app/route-actions/kanban';

test('Files search and continuation parameters stay server-side and bounded', async () => {
  const calls: unknown[] = [];
  const api = {
    getAllAccountFiles: async (query: unknown) => {
      calls.push(query);
      return {
        files: [{
          id: 'file-51',
          name: '香港 report.pdf',
          sha256: 'abc',
          mime_type: 'application/pdf',
          extension: 'pdf',
          file_type: 'document',
          size: 512,
          source: 'model_output',
          status: 'available',
          created_at: 1_700_000_000_000,
          updated_at: 1_700_000_000_000,
          download_url: '/files/file-51',
        }],
        total: 73,
        limit: 25,
        offset: 50,
      };
    },
  } as unknown as HermesCloudApi;

  const envelope = await loadAccountFilesPage(api, {
    route: 'files',
    requestId: 'files-request-2',
    fields: {
      q: ' report ',
      source: 'model_output',
      dateFrom: '2026-08-30',
      dateTo: '2026-08-30',
      limit: '25',
      offset: '50',
    },
  }, 'en');

  assert.deepEqual(calls, [{
    keyword: 'report',
    source: 'model_output',
    dateFrom: '2026-08-30',
    dateTo: '2026-08-30',
    limit: 25,
    offset: 50,
  }]);
  assert.equal(envelope.requestId, 'files-request-2');
  assert.equal(envelope.files[0]?.id, 'file-51');
  assert.equal(envelope.nextOffset, 51);
  assert.equal(envelope.hasMore, true);
  assert.equal(envelope.total, 73);
});

test('Files page query rejects unsupported filters and clamps pagination', () => {
  assert.deepEqual(accountFilesPageQuery({
    route: 'files',
    fields: {
      limit: '9999',
      offset: '-8',
      source: 'server-path',
    },
  }), { limit: 200, offset: 0 });
  assert.equal(ACCOUNT_FILES_PAGE_LIMIT, 50);
});

test('Files query action returns a request-correlated server page', async () => {
  const calls: unknown[] = [];
  const api = {
    getAllAccountFiles: async (query: unknown) => {
      calls.push(query);
      return { files: [], limit: 50, offset: 100, total: 101 };
    },
  } as unknown as HermesCloudApi;

  const result = await performHermesSwiftUIRouteAction(api, {
    action: 'files.query',
    payload: {
      route: 'files',
      requestId: 'files-page-3',
      fields: { q: 'invoice', limit: '50', offset: '100' },
    },
  }, 'ios-worker', 'en');

  assert.deepEqual(calls, [{ keyword: 'invoice', limit: 50, offset: 100 }]);
  assert.equal(typeof result, 'object');
  const page = JSON.parse(typeof result === 'object' ? result.accountFilesJSON || '{}' : '{}');
  assert.equal(page.requestId, 'files-page-3');
  assert.equal(page.offset, 100);
  assert.equal(page.total, 101);
  assert.equal(page.hasMore, false);
});

test('Kanban attachment policy matches the official 25 MB backend cap', () => {
  validateKanbanAttachmentSize(KANBAN_ATTACHMENT_MAX_BYTES, 'report.pdf');
  assert.throws(
    () => validateKanbanAttachmentSize(KANBAN_ATTACHMENT_MAX_BYTES + 1, 'report.pdf'),
    /25 MB or smaller/,
  );
  assert.throws(() => validateKanbanAttachmentSize(0, 'empty.txt'), /empty or unavailable/);
});

test('Kanban comment and attachment actions use official APIs and refresh detail', async () => {
  const calls: unknown[][] = [];
  const api = {
    addKanbanComment: async (...args: unknown[]) => {
      calls.push(['comment', ...args]);
      return { comment: { id: 1 } };
    },
    uploadKanbanTaskAttachment: async (...args: unknown[]) => {
      const [taskId, body, filename, author, board] = args as [string, Blob, string, string, string];
      calls.push(['upload', taskId, await body.text(), filename, author, board]);
      return { attachment: { id: 7 } };
    },
    getKanbanTask: async (...args: unknown[]) => {
      calls.push(['detail', ...args]);
      if (args[0] === 'task-0') {
        return { task: { id: 'task-0', title: 'Parent', status: 'done' } };
      }
      return {
        task: { id: 'task-1', title: 'Release' },
        comments: [{ id: 1, body: 'ready' }],
        attachments: [{ id: 7, filename: 'report.txt', size: 5 }],
        links: { parents: ['task-0'], children: ['task-2'] },
        child_results: [{ id: 'task-2', title: 'Child', status: 'doing' }],
      };
    },
  } as unknown as HermesCloudApi;

  const commentResult = await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.comment.add',
    payload: {
      route: 'kanban',
      id: 'task-1',
      detail: ' ready ',
      fields: { author: 'dispatcher', board: 'hong-kong' },
    },
  }, 'ios-worker', 'en');
  const uploadResult = await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.attachment.upload',
    payload: {
      route: 'kanban',
      id: 'task-1',
      uris: ['data:text/plain,hello'],
      fields: { author: 'dispatcher', board: 'hong-kong' },
    },
  }, 'ios-worker', 'en');

  assert.deepEqual(calls, [
    ['comment', 'task-1', 'ready', 'dispatcher', 'hong-kong'],
    ['detail', 'task-1', { board: 'hong-kong' }],
    ['detail', 'task-0', { board: 'hong-kong' }],
    ['upload', 'task-1', 'hello', 'plain,hello', 'dispatcher', 'hong-kong'],
    ['detail', 'task-1', { board: 'hong-kong' }],
    ['detail', 'task-0', { board: 'hong-kong' }],
  ]);
  for (const result of [commentResult, uploadResult]) {
    const detail = JSON.parse(typeof result === 'object' ? result.kanbanDetailJSON || '{}' : '{}');
    assert.deepEqual(detail.links, { parents: ['task-0'], children: ['task-2'] });
    assert.deepEqual(detail.parent_results, [{ id: 'task-0', title: 'Parent', status: 'done' }]);
    assert.equal(detail.attachments[0].id, 7);
  }
});

test('Kanban relationship actions preserve parent-child direction and refresh detail', async () => {
  const calls: unknown[][] = [];
  const api = {
    linkKanbanTasks: async (...args: unknown[]) => { calls.push(['link', ...args]); return {}; },
    unlinkKanbanTasks: async (...args: unknown[]) => { calls.push(['unlink', ...args]); return {}; },
    getKanbanTask: async (...args: unknown[]) => {
      calls.push(['detail', ...args]);
      return { task: { id: args[0], title: 'Current' }, links: { parents: [], children: [] } };
    },
  } as unknown as HermesCloudApi;

  await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.relation.link',
    payload: {
      route: 'kanban', id: 'current', targetId: 'parent', fields: { relation: 'parent', board: 'hk' },
    },
  }, 'hk-worker', 'en');
  await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.relation.unlink',
    payload: {
      route: 'kanban', id: 'current', targetId: 'child', fields: { relation: 'child', board: 'hk' },
    },
  }, 'hk-worker', 'en');

  assert.deepEqual(calls, [
    ['link', 'parent', 'current', 'hk'],
    ['detail', 'current', { board: 'hk' }],
    ['unlink', 'current', 'child', 'hk'],
    ['detail', 'current', { board: 'hk' }],
  ]);
});

test('Kanban board management actions use the canonical board and orchestration APIs', async () => {
  const calls: unknown[][] = [];
  const api = {
    createKanbanBoard: async (...args: unknown[]) => {
      calls.push(['create-board', ...args]);
      return { board: { slug: 'hong-kong' }, current: 'hong-kong' };
    },
    updateKanbanBoard: async (...args: unknown[]) => {
      calls.push(['update-board', ...args]);
      return { board: { slug: args[0] } };
    },
    deleteKanbanBoard: async (...args: unknown[]) => {
      calls.push(['delete-board', ...args]);
      return { result: 'archived' };
    },
    exportKanbanBoard: async (...args: unknown[]) => {
      calls.push(['export-board', ...args]);
      return { archive: '/srv/hermes/exports/hk.tar.gz' };
    },
    importKanbanBoard: async (...args: unknown[]) => {
      calls.push(['import-board', ...args]);
      return { board: 'hong-kong-copy' };
    },
    setKanbanOrchestration: async (...args: unknown[]) => {
      calls.push(['orchestration', ...args]);
      return { ok: true };
    },
  } as unknown as HermesCloudApi;

  const created = await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.board.create',
    payload: {
      route: 'kanban',
      name: 'Hong Kong',
      value: 'hong-kong',
      detail: 'HK worker board',
      enabled: true,
      fields: {
        icon: 'network',
        color: '#22c55e',
        defaultWorkdir: '/srv/hermes/hk',
        projectId: 'project-hk',
      },
    },
  }, 'dispatcher', 'en');
  await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.board.update',
    payload: {
      route: 'kanban', id: 'hong-kong', name: 'HK Workers', detail: '',
    },
  }, 'dispatcher', 'en');
  const archived = await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.board.delete',
    payload: { route: 'kanban', id: 'hong-kong', enabled: false },
  }, 'dispatcher', 'en');
  const deleted = await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.board.delete',
    payload: { route: 'kanban', id: 'old-board', enabled: true },
  }, 'dispatcher', 'en');
  const exported = await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.board.export',
    payload: {
      route: 'kanban',
      id: 'hong-kong',
      value: '/srv/hermes/exports/hk.tar.gz',
      fields: { attachments: 'true', logs: 'false' },
    },
  }, 'dispatcher', 'en');
  const imported = await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.board.import',
    payload: {
      route: 'kanban',
      name: 'hong-kong-copy',
      value: '/srv/hermes/exports/hk.tar.gz',
      enabled: true,
    },
  }, 'dispatcher', 'en');
  await performHermesSwiftUIRouteAction(api, {
    action: 'kanban.orchestration.update',
    payload: {
      route: 'kanban',
      fields: {
        orchestratorProfile: 'dispatcher',
        defaultAssignee: 'hk-worker',
        autoDecompose: 'true',
        autoPromoteChildren: 'false',
      },
    },
  }, 'dispatcher', 'en');

  assert.deepEqual(calls, [
    ['create-board', {
      slug: 'hong-kong',
      name: 'Hong Kong',
      description: 'HK worker board',
      icon: 'network',
      color: '#22c55e',
      default_workdir: '/srv/hermes/hk',
      project_id: 'project-hk',
      switch: true,
    }],
    ['update-board', 'hong-kong', { name: 'HK Workers', description: '' }],
    ['delete-board', 'hong-kong', false],
    ['delete-board', 'old-board', true],
    ['export-board', 'hong-kong', {
      output: '/srv/hermes/exports/hk.tar.gz', attachments: true, logs: false,
    }],
    ['import-board', '/srv/hermes/exports/hk.tar.gz', 'hong-kong-copy', true],
    ['orchestration', {
      orchestrator_profile: 'dispatcher',
      default_assignee: 'hk-worker',
      auto_decompose: true,
      auto_promote_children: false,
    }],
  ]);
  assert.equal(typeof created === 'object' ? created.kanbanDetailJSON : undefined, '');
  assert.equal(typeof archived === 'object' ? archived.kanbanDetailJSON : undefined, '');
  assert.match(typeof deleted === 'object' ? deleted.message : '', /deleted/);
  assert.match(typeof exported === 'object' ? exported.message : '', /\/srv\/hermes\/exports\/hk\.tar\.gz/);
  assert.match(typeof imported === 'object' ? imported.message : '', /hong-kong-copy/);
});

test('Kanban detail fence rejects late task and same-task responses', () => {
  let state = { generation: 0, taskId: '' };
  const taskA = beginKanbanDetailRequest(state, 'kanban.task.open', 'task-a');
  state = taskA.state;
  const taskB = beginKanbanDetailRequest(state, 'kanban.task.open', 'task-b');
  state = taskB.state;

  assert.equal(shouldApplyKanbanDetail(
    state,
    taskA.token,
    JSON.stringify({ task: { id: 'task-a' } }),
  ), false);
  assert.equal(shouldApplyKanbanDetail(
    state,
    taskB.token,
    JSON.stringify({ task: { id: 'task-b' } }),
  ), true);

  const olderMutation = beginKanbanDetailRequest(state, 'kanban.comment.add', 'task-b');
  state = olderMutation.state;
  const newerMutation = beginKanbanDetailRequest(state, 'kanban.relation.link', 'task-b');
  state = newerMutation.state;
  assert.equal(shouldApplyKanbanDetail(
    state,
    olderMutation.token,
    JSON.stringify({ task: { id: 'task-b' } }),
  ), false);
  assert.equal(shouldApplyKanbanDetail(
    state,
    newerMutation.token,
    JSON.stringify({ task: { id: 'task-b' } }),
  ), true);
  assert.equal(shouldApplyKanbanDetail(
    resetKanbanDetailFence(state),
    newerMutation.token,
    JSON.stringify({ task: { id: 'task-b' } }),
  ), false);

  const boardSwitch = beginKanbanDetailRequest(state, 'kanban.board.switch', '');
  state = boardSwitch.state;
  assert.equal(shouldClearKanbanDetail(state, boardSwitch.token), true);
  const openedAfterSwitch = beginKanbanDetailRequest(state, 'kanban.task.open', 'task-c');
  state = openedAfterSwitch.state;
  assert.equal(shouldClearKanbanDetail(state, boardSwitch.token), false);

  for (const action of ['kanban.board.create', 'kanban.board.delete', 'kanban.board.import']) {
    const management = beginKanbanDetailRequest(state, action, '');
    state = management.state;
    assert.equal(shouldClearKanbanDetail(state, management.token), true);
  }
});

test('native release surfaces expose server Files paging and complete Kanban detail controls', () => {
  const filesPage = readFileSync(
    'modules/hermes-ios-controls/ios/HermesSwiftUIAccountFilesPage.swift',
    'utf8',
  );
  const pages = readFileSync('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift', 'utf8');
  const kanbanFiles = readFileSync('src/app/route-actions/kanban-detail-files.ts', 'utf8');
  assert.match(filesPage, /\.fileQuery/);
  assert.match(filesPage, /fields\["q"\] = keyword/);
  assert.match(filesPage, /"limit": String\(hermesAccountFilesPageLimit\)/);
  assert.match(filesPage, /"offset": String\(max\(0, offset\)\)/);
  assert.match(filesPage, /requestPage\(offset: nextOffset\)/);
  assert.match(filesPage, /page\.requestId != requestId/);
  assert.match(pages, /\.kanbanCommentAdd/);
  assert.match(pages, /\.kanbanAttachmentUpload/);
  assert.match(pages, /\.kanbanAttachmentDownload/);
  assert.match(pages, /\.kanbanRelationLink/);
  assert.match(pages, /\.kanbanRelationUnlink/);
  assert.match(pages, /\.kanbanBoardCreate/);
  assert.match(pages, /\.kanbanBoardUpdate/);
  assert.match(pages, /\.kanbanBoardDelete/);
  assert.match(pages, /\.kanbanBoardExport/);
  assert.match(pages, /\.kanbanBoardImport/);
  assert.match(pages, /\.kanbanOrchestrationUpdate/);
  assert.match(pages, /Delete Permanently/);
  assert.match(pages, /Server archive path/);
  assert.match(pages, /Dispatcher profile/);
  assert.match(pages, /Default worker/);
  assert.match(pages, /relationshipsSection\(detail\)/);
  assert.match(pages, /parent_results/);
  assert.match(pages, /child_results/);
  assert.match(pages, /row\["kind"\]/);
  assert.match(pages, /onNavigate\([\s\S]*?id: target\.id/);
  assert.match(pages, /onNavigate: \{ target in[\s\S]*?\.kanbanTaskOpen[\s\S]*?id: target\.id/);
  assert.match(kanbanFiles, /temporaryPlaintextFile/);
  assert.match(kanbanFiles, /writeBoundedDownload/);
  assert.match(kanbanFiles, /maximumBytes: KANBAN_ATTACHMENT_MAX_BYTES/);
  assert.match(kanbanFiles, /presentQuickLook/);
  assert.match(kanbanFiles, /finally \{[\s\S]*target\.exists[\s\S]*target\.delete\(\)/);
});
