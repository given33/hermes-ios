import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HermesExtensionsCloudApi,
  mergeManagedMcpServers,
  mergeManagedSkills,
  type ManagedResourceCatalog,
  type ManagedResourceRecord,
} from '../src/api/cloud/extensions';
import {
  ManagedResourceCatalogController,
  managedResourceCatalogKey,
  purgeManagedResourceCatalog,
} from '../src/api/managed-resource-catalog';
import { ConversationLocalStore } from '../src/api/conversation-local-store';
import type { HermesCloudTransport } from '../src/api/cloud/transport';

class MemoryStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function catalog(kind: 'mcp' | 'skill'): ManagedResourceCatalog {
  return {
    account_generation: 'generation-1',
    cursor: 4,
    diagnostics: [{ code: 'resource_name_collision', name: 'weather', kind }],
    events: [],
    has_more: false,
    resources: [{
      resource_id: `resource-${kind}`,
      kind,
      name: 'weather',
      source_type: 'git',
      source_uri: 'https://example.invalid/weather',
      source_ref: 'main',
      resolved_commit_or_version: 'abc123',
      content_hash: 'sha256',
      scope: 'account',
      target_nodes: ['server', 'dbb3', 'wsl'],
      loaded_nodes: ['server', 'dbb3'],
      aggregate_state: 'verified',
      node_receipts: {
        server: { receipt_schema: 1 },
        dbb3: { receipt_schema: 1 },
        wsl: { receipt_schema: 1 },
      },
      policy_version: 'managed-source-v2',
      tree_sha: '',
      tools: [],
      permissions: [],
      last_verified_at: 'now',
      rollback_available: true,
      enabled: true,
      trust_state: 'approved',
      health: 'healthy',
      conflicts: [],
      installed_at: 'now',
      updated_at: 'now',
      operation_id: 'operation-1',
    }],
  };
}

function resource(name: string, operationId = `operation-${name}`): ManagedResourceRecord {
  return {
    ...catalog('skill').resources[0],
    name,
    operation_id: operationId,
    resource_id: `resource-${name}`,
  };
}

function catalogPage(
  generation: string,
  cursor: number,
  resources: ManagedResourceRecord[],
  options: Partial<ManagedResourceCatalog> = {},
): ManagedResourceCatalog {
  return {
    account_generation: generation,
    cursor,
    diagnostics: [],
    events: [],
    has_more: false,
    resources,
    ...options,
  };
}

test('managed skill projection exposes node health and collision state', () => {
  const skills = mergeManagedSkills([], catalog('skill'));
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'weather');
  assert.match(String(skills[0].description), /loaded: server, dbb3/);
  assert.match(String(skills[0].description), /name collision/);
});

test('managed MCP projection replaces stale same-name rows with account catalog state', () => {
  const servers = mergeManagedMcpServers({
    servers: [{ name: 'weather', status: 'unknown', enabled: false }],
  }, catalog('mcp'));
  const rows = servers.servers as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].enabled, true);
  assert.equal(rows[0].status, 'healthy');
});

test('unverified managed receipts are diagnostic only and never shown as installed', () => {
  const pending = catalog('skill');
  pending.resources[0] = {
    ...pending.resources[0],
    aggregate_state: 'partial',
    enabled: false,
    health: 'degraded',
  };

  assert.deepEqual(mergeManagedSkills([], pending), []);
  assert.deepEqual(
    (mergeManagedMcpServers({ servers: [] }, {
      ...pending,
      resources: [{ ...pending.resources[0], kind: 'mcp' }],
    }).servers as unknown[]),
    [],
  );
});

test('managed resource cursor survives restart and consumes another-device events incrementally', async () => {
  const storage = new MemoryStorage();
  const owner = 'https://example.test|owner@example.test';
  const first = new ManagedResourceCatalogController(storage);
  first.bindOwner(owner);
  const requested: number[] = [];
  await first.refresh(async (cursor) => {
    requested.push(cursor);
    return catalogPage('generation-1', 4, [resource('weather')]);
  });

  const restarted = new ManagedResourceCatalogController(storage);
  restarted.bindOwner(owner);
  const refreshed = await restarted.refresh(async (cursor) => {
    requested.push(cursor);
    return catalogPage('generation-1', 5, [resource('weather'), resource('calendar')], {
      events: [{ cursor: 5, resource: resource('calendar'), created_at: 'now' }],
    });
  });

  assert.deepEqual(requested, [0, 4]);
  assert.deepEqual(refreshed.resources.map(({ name }) => name), ['weather', 'calendar']);
  assert.equal(refreshed.events[0].cursor, 5);
  const persisted = JSON.parse(storage.values.get(managedResourceCatalogKey(owner)) || '{}');
  assert.equal(persisted.accountGeneration, 'generation-1');
  assert.equal(persisted.cursor, 5);
});

test('future cursor reset replaces the projection and resumes from the authoritative cursor', async () => {
  const storage = new MemoryStorage();
  const owner = 'future-cursor-owner';
  const controller = new ManagedResourceCatalogController(storage);
  controller.bindOwner(owner);
  await controller.refresh(async () => catalogPage('generation-1', 20, [resource('old')]));

  const reset = await controller.refresh(async (cursor) => {
    assert.equal(cursor, 20);
    return catalogPage('generation-1', 3, [resource('current')], {
      reset_cursor: true,
      reset_reason: 'future_cursor',
    });
  });
  assert.equal(reset.cursor, 3);
  assert.equal(reset.reset_cursor, true);
  assert.deepEqual(reset.resources.map(({ name }) => name), ['current']);

  await controller.refresh(async (cursor) => {
    assert.equal(cursor, 3);
    return catalogPage('generation-1', 3, [resource('current')]);
  });
});

test('account generation replacement drops old resources and stale in-flight owners cannot persist', async () => {
  const storage = new MemoryStorage();
  const owner = 'replacement-owner';
  const controller = new ManagedResourceCatalogController(storage);
  controller.bindOwner(owner);
  await controller.refresh(async () => catalogPage('generation-old', 8, [resource('old')]));

  let releaseOld: (() => void) | undefined;
  let markOldStarted: (() => void) | undefined;
  const oldStarted = new Promise<void>((resolve) => { markOldStarted = resolve; });
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  const stale = controller.refresh(async () => {
    markOldStarted?.();
    await oldGate;
    return catalogPage('generation-old', 9, [resource('stale')]);
  });
  await oldStarted;
  controller.bindOwner('new-owner');
  releaseOld?.();
  await assert.rejects(stale, /account lifecycle changed/);
  assert.equal(storage.values.has(managedResourceCatalogKey('new-owner')), false);

  controller.bindOwner(owner);
  const replacement = await controller.refresh(async (cursor) => {
    assert.equal(cursor, 8);
    return catalogPage('generation-new', 1, [resource('new')], {
      reset_cursor: true,
      reset_reason: 'future_cursor',
    });
  });
  assert.equal(replacement.account_generation, 'generation-new');
  assert.deepEqual(replacement.resources.map(({ name }) => name), ['new']);
});

test('managed resource refresh drains event pages without replaying cursor zero', async () => {
  const controller = new ManagedResourceCatalogController(new MemoryStorage());
  controller.bindOwner('paged-owner');
  const requested: number[] = [];
  const result = await controller.refresh(async (cursor) => {
    requested.push(cursor);
    if (cursor === 0) {
      return catalogPage('generation-1', 2, [resource('first')], {
        events: [{ cursor: 2, resource: resource('first'), created_at: 'first' }],
        has_more: true,
      });
    }
    return catalogPage('generation-1', 4, [resource('first'), resource('second')], {
      events: [{ cursor: 4, resource: resource('second'), created_at: 'second' }],
    });
  });
  assert.deepEqual(requested, [0, 2]);
  assert.deepEqual(result.events.map(({ cursor }) => cursor), [2, 4]);
  assert.equal(result.cursor, 4);
});

test('terminal installation state is observed before the same reload refreshes its resource catalog', async () => {
  let installationObserved = false;
  const transport = {
    async request(path: string) {
      if (path === '/api/skills' || path === '/api/tools/toolsets') return [];
      if (path === '/api/plugins/collaboration/managed-installations') {
        installationObserved = true;
        return { operations: [{ id: 'operation-1', state: 'completed' }] };
      }
      if (path === '/api/plugins/collaboration/managed-resources') {
        assert.equal(installationObserved, true);
        return catalogPage('generation-1', 1, [resource('installed-now')]);
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  } as unknown as HermesCloudTransport;
  const api = new HermesExtensionsCloudApi(
    transport,
    new ManagedResourceCatalogController(new MemoryStorage()),
  );
  api.bindManagedResourceOwner('immediate-refresh-owner');

  const result = await api.getSkills('default');

  assert.equal(result.skills[0].name, 'installed-now');
  assert.equal(result.resourceCatalog.cursor, 1);
});

test('skills aggregation preserves healthy sources when peers and catalog fail', async () => {
  const transport = {
    async request(path: string) {
      if (path === '/api/skills') throw new Error('skills unavailable');
      if (path === '/api/tools/toolsets') return [{ name: 'healthy-toolset' }];
      if (path === '/api/plugins/collaboration/managed-installations') {
        return { operations: [{ id: 'operation-1' }] };
      }
      if (path === '/api/plugins/collaboration/managed-resources') {
        throw new Error('catalog unavailable');
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  } as unknown as HermesCloudTransport;
  const api = new HermesExtensionsCloudApi(
    transport,
    new ManagedResourceCatalogController(new MemoryStorage()),
  );
  api.bindManagedResourceOwner('degraded-owner');

  const result = await api.getSkills('default');

  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.toolsets, [{ name: 'healthy-toolset' }]);
  assert.deepEqual(result.installations.operations, [{ id: 'operation-1' }]);
  assert.deepEqual(result.resourceCatalog.resources, []);
});

test('MCP aggregation preserves healthy sources when peers and catalog fail', async () => {
  const transport = {
    async request(path: string) {
      if (path === '/api/mcp/servers') return { servers: [{ name: 'healthy-server' }] };
      if (path === '/api/mcp/catalog') throw new Error('MCP catalog unavailable');
      if (path === '/api/plugins/collaboration/managed-installations') {
        throw new Error('installations unavailable');
      }
      if (path === '/api/plugins/collaboration/managed-resources') {
        throw new Error('resource catalog unavailable');
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  } as unknown as HermesCloudTransport;
  const api = new HermesExtensionsCloudApi(
    transport,
    new ManagedResourceCatalogController(new MemoryStorage()),
  );
  api.bindManagedResourceOwner('degraded-mcp-owner');

  const result = await api.getMcp('default');

  assert.deepEqual(result.servers, { servers: [{ name: 'healthy-server' }] });
  assert.deepEqual(result.catalog, {});
  assert.deepEqual(result.installations.operations, []);
  assert.deepEqual(result.resourceCatalog.resources, []);
});

test('account cleanup removes only that owner resource cursor and projection', async () => {
  const storage = new MemoryStorage();
  const firstOwner = new ManagedResourceCatalogController(storage);
  firstOwner.bindOwner('owner-a');
  await firstOwner.refresh(async () => catalogPage('generation-a', 1, [resource('a')]));
  const secondOwner = new ManagedResourceCatalogController(storage);
  secondOwner.bindOwner('owner-b');
  await secondOwner.refresh(async () => catalogPage('generation-b', 2, [resource('b')]));

  await purgeManagedResourceCatalog('owner-a', storage);

  assert.equal(storage.values.has(managedResourceCatalogKey('owner-a')), false);
  assert.equal(storage.values.has(managedResourceCatalogKey('owner-b')), true);
});

test('account purge wins a forced interleaving with an old catalog setItem', async () => {
  let releaseWrite: (() => void) | undefined;
  let markWriteStarted: (() => void) | undefined;
  const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
  const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const storage = new class extends MemoryStorage {
    pauseNextWrite = true;

    override async setItem(key: string, value: string): Promise<void> {
      if (this.pauseNextWrite && key === managedResourceCatalogKey('catalog-race-owner')) {
        this.pauseNextWrite = false;
        markWriteStarted?.();
        await writeGate;
      }
      await super.setItem(key, value);
    }
  }();
  const owner = 'catalog-race-owner';
  const controller = new ManagedResourceCatalogController(storage);
  controller.bindOwner(owner);

  const staleRefresh = controller.refresh(async () => (
    catalogPage('generation-old', 1, [resource('stale')])
  ));
  await writeStarted;
  const purge = purgeManagedResourceCatalog(owner, storage);
  releaseWrite?.();
  const [staleResult] = await Promise.allSettled([staleRefresh, purge]);

  assert.equal(staleResult.status, 'rejected');
  assert.equal(storage.values.has(managedResourceCatalogKey(owner)), false);

  await new ConversationLocalStore(storage).activate(owner);
  const fresh = await controller.refresh(async () => (
    catalogPage('generation-new', 1, [resource('fresh')])
  ));
  assert.deepEqual(fresh.resources.map(({ name }) => name), ['fresh']);
  assert.equal(
    JSON.parse(storage.values.get(managedResourceCatalogKey(owner)) || '{}')
      .accountGeneration,
    'generation-new',
  );
});

test('an authenticated catalog response without an account generation fails closed', async () => {
  const controller = new ManagedResourceCatalogController(new MemoryStorage());
  controller.bindOwner('authenticated-owner');
  await assert.rejects(
    controller.refresh(async () => catalogPage('', 0, [])),
    /account generation is missing/,
  );
});
