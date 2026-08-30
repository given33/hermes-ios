import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { HermesCloudApi } from '../src/api/HermesCloudApi';
import {
  loadHermesSwiftUIRouteSnapshot,
  performHermesSwiftUIRouteAction,
} from '../src/app/hermes-route-data';
import {
  HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
  isHermesSwiftUIRouteSnapshot,
} from '../src/app/swiftui-route-contract';
import {
  MAX_BACKUP_DOWNLOAD_BYTES,
  presentBackup,
  waitForActionCompletion,
  writeValidatedBackup,
} from '../src/app/route-actions/presentation';

class MemoryBackupFile {
  private firstBytes: number[] = [];
  private writtenBytes = 0;
  createCalls = 0;
  deleted = false;
  exists = false;

  get size(): number { return this.writtenBytes; }

  create(): void {
    this.createCalls += 1;
    this.exists = true;
  }

  delete(): void {
    this.deleted = true;
    this.exists = false;
    this.firstBytes = [];
    this.writtenBytes = 0;
  }

  open() {
    return {
      close: () => undefined,
      readBytes: (length: number) => Uint8Array.from(this.firstBytes.slice(0, length)),
    };
  }

  writableStream(): WritableStream<Uint8Array<ArrayBufferLike>> {
    return new WritableStream({
      write: (chunk) => {
        for (const byte of chunk) {
          if (this.firstBytes.length < 4) this.firstBytes.push(byte);
        }
        this.writtenBytes += chunk.byteLength;
      },
    });
  }
}

test('model snapshots expose editable MoA and allowlisted credential-pool metadata', async () => {
  const metadataProfiles: unknown[][] = [];
  const api = {
    loadRoute: async () => ({
      auxiliary: {},
      moa: { enabled: true, default_preset: 'balanced', presets: { balanced: { models: ['a'] } } },
      models: [],
    }),
    getProviderOauth: async (...args: unknown[]) => {
      metadataProfiles.push(['oauth', ...args]);
      return { providers: ['anthropic'] };
    },
    getCustomProviderEndpoints: async () => ({ endpoints: [] }),
    getCredentialPool: async (...args: unknown[]) => {
      metadataProfiles.push(['pool', ...args]);
      return ({
      providers: [{
        provider: 'anthropic',
        entries: [{
          api_key: 'sk-must-not-cross-the-bridge',
          auth_type: 'api_key',
          has_refresh: false,
          id: 'credential-1',
          index: 1,
          label: 'Primary',
          last_status: 'healthy',
          priority: 10,
          refresh_token: 'refresh-must-not-cross-the-bridge',
          request_count: 42,
          source: 'pool',
          token_preview: 'sk-...1234',
        }],
      }],
      secret: 'top-level-secret',
      });
    },
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'models', 'hk-worker');
  assert.deepEqual(metadataProfiles, [
    ['oauth', 'hk-worker'],
    ['pool', 'hk-worker'],
  ]);
  assert.deepEqual(JSON.parse(snapshot.modelMoaJSON || ''), {
    enabled: true,
    default_preset: 'balanced',
    presets: { balanced: { models: ['a'] } },
  });
  const pool = snapshot.credentialPoolJSON || '';
  assert.match(pool, /"provider":"anthropic"/);
  assert.match(pool, /"request_count":42/);
  assert.doesNotMatch(pool, /sk-must-not-cross|refresh-must-not-cross|top-level-secret/);
});

test('JSON bridge fields reject non-string payloads before native decoding', () => {
  assert.equal(isHermesSwiftUIRouteSnapshot({
    version: HERMES_SWIFTUI_ROUTE_SNAPSHOT_VERSION,
    route: 'models',
    credentialPoolJSON: { api_key: 'must never cross' },
  }), false);
});

test('MCP editor snapshot comes from the official full config rather than redacted list summaries', async () => {
  const api = {
    loadRoute: async () => ({
      servers: { servers: [{ name: 'filesystem', command: 'npx', env: { TOKEN: '***' } }] },
    }),
    getConfig: async () => ({
      config: {
        mcp_servers: {
          filesystem: {
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/srv/work'],
            command: 'npx',
            env: { TOKEN: '${FILESYSTEM_TOKEN}' },
          },
        },
      },
    }),
  } as unknown as HermesCloudApi;

  const snapshot = await loadHermesSwiftUIRouteSnapshot(api, 'mcp', 'hk-worker');
  assert.deepEqual(JSON.parse(snapshot.mcpServersJSON || ''), {
    mcpServers: {
      filesystem: {
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/srv/work'],
        command: 'npx',
        env: { TOKEN: '${FILESYSTEM_TOKEN}' },
      },
    },
  });
});

test('native management actions call the official bot, MoA, MCP, OAuth, and credential APIs', async () => {
  const calls: unknown[][] = [];
  const api = {
    addCredentialPoolEntry: async (...args: unknown[]) => { calls.push(['credential-add', ...args]); return {}; },
    cancelProviderOauth: async (...args: unknown[]) => { calls.push(['oauth-cancel', ...args]); return {}; },
    clearBotAsset: async (...args: unknown[]) => { calls.push(['bot-clear', ...args]); return {}; },
    deleteModelCredential: async (...args: unknown[]) => { calls.push(['oauth-disconnect', ...args]); return { ok: true }; },
    removeCredentialPoolEntry: async (...args: unknown[]) => { calls.push(['credential-delete', ...args]); return {}; },
    replaceMcpServers: async (...args: unknown[]) => { calls.push(['mcp-replace', ...args]); return { ok: true }; },
    saveMoaModels: async (...args: unknown[]) => { calls.push(['moa-save', ...args]); return {}; },
  } as unknown as HermesCloudApi;

  await performHermesSwiftUIRouteAction(api, {
    action: 'bot.avatar.clear', payload: { route: 'bots', id: 'coder' },
  }, 'default');
  await performHermesSwiftUIRouteAction(api, {
    action: 'model.moa.save', payload: { route: 'models', detail: '{"enabled":true}' },
  }, 'hk-worker');
  await performHermesSwiftUIRouteAction(api, {
    action: 'mcp.replace',
    payload: { route: 'mcp', detail: '{"mcpServers":{"docs":{"type":"stdio","command":"npx"}}}' },
  }, 'hk-worker');
  await performHermesSwiftUIRouteAction(api, {
    action: 'provider.oauth.cancel', payload: { route: 'models', value: 'oauth-session-1' },
  }, 'hk-worker');
  const disconnected = await performHermesSwiftUIRouteAction(api, {
    action: 'provider.oauth.disconnect', payload: { route: 'models', id: 'anthropic' },
  }, 'hk-worker', 'en');
  await performHermesSwiftUIRouteAction(api, {
    action: 'credential.pool.add',
    payload: { route: 'models', id: 'anthropic', name: 'Primary', detail: 'one-time-secret' },
  }, 'hk-worker');
  await performHermesSwiftUIRouteAction(api, {
    action: 'credential.pool.delete',
    payload: { route: 'models', id: 'anthropic', position: 2 },
  }, 'hk-worker');

  assert.deepEqual(calls, [
    ['bot-clear', 'coder', 'avatar'],
    ['moa-save', { enabled: true }, 'hk-worker'],
    ['mcp-replace', { docs: { transport: 'stdio', command: 'npx' } }, 'hk-worker'],
    ['oauth-cancel', 'oauth-session-1', 'hk-worker'],
    ['oauth-disconnect', 'anthropic', 'hk-worker'],
    ['credential-add', 'anthropic', 'one-time-secret', 'Primary', 'hk-worker'],
    ['credential-delete', 'anthropic', 2, 'hk-worker'],
  ]);
  assert.deepEqual(disconnected, { message: 'anthropic disconnected', reload: true });
  await assert.rejects(() => performHermesSwiftUIRouteAction(api, {
    action: 'mcp.replace', payload: { route: 'mcp', detail: '{"mcpServers":{"bad":42}}' },
  }, 'default'), /Every MCP server/);
});

test('backup presentation streams a bounded ZIP directly to disk and deletes invalid files', async () => {
  const validTarget = new MemoryBackupFile();
  const valid = new Response(new Uint8Array([0x50, 0x4b, 0x05, 0x06]), {
    headers: { 'Content-Length': '4', 'Content-Type': 'application/zip' },
  });
  assert.equal(await writeValidatedBackup(valid, validTarget), 4);
  assert.equal(validTarget.size, 4);

  const invalidTarget = new MemoryBackupFile();
  await assert.rejects(
    () => writeValidatedBackup(new Response('not zip', {
      headers: { 'Content-Type': 'application/zip' },
    }), invalidTarget),
    /invalid ZIP/,
  );
  assert.equal(invalidTarget.deleted, true);

  let bodyRead = false;
  const oversized = {
    get body() {
      bodyRead = true;
      throw new Error('oversized response body must not be read');
    },
    headers: new Headers({
      'Content-Length': String(MAX_BACKUP_DOWNLOAD_BYTES + 1),
      'Content-Type': 'application/zip',
    }),
  } as unknown as Response;
  const oversizedTarget = new MemoryBackupFile();
  await assert.rejects(() => writeValidatedBackup(oversized, oversizedTarget), /64 MB/);
  assert.equal(bodyRead, false);
  assert.equal(oversizedTarget.createCalls, 0);
  assert.equal(oversizedTarget.exists, false);
});

test('backup presentation never downloads a status belonging to another process', async () => {
  for (const statusPid of [undefined, 404]) {
    let downloads = 0;
    const api = {
      consumeBackup: async () => {
        downloads += 1;
        return undefined;
      },
      getActionStatus: async () => ({
        exit_code: 0,
        ...(statusPid === undefined ? {} : { pid: statusPid }),
        running: false,
      }),
    } as unknown as HermesCloudApi;
    await assert.rejects(
      () => presentBackup(api, '/backups/expected.zip', 'en', 101),
      /did not identify|different backup process/,
    );
    assert.equal(downloads, 0);
  }
});

test('background operation presentation waits for the requested process result', async () => {
  const statuses = [
    { exit_code: null, lines: ['starting'], pid: 101, running: true },
    { exit_code: 0, lines: ['starting', 'all checks passed'], pid: 101, running: false },
  ];
  const api = {
    getActionStatus: async () => statuses.shift() || {},
  } as unknown as HermesCloudApi;
  assert.equal(await waitForActionCompletion(api, 'doctor', 101, {
    attempts: 2,
    pollIntervalMs: 0,
  }), 'starting\nall checks passed');

  const stale = {
    getActionStatus: async () => ({ exit_code: 0, lines: ['old result'], pid: 99, running: false }),
  } as unknown as HermesCloudApi;
  await assert.rejects(
    () => waitForActionCompletion(stale, 'doctor', 101, { attempts: 1, pollIntervalMs: 0 }),
    /different doctor process/,
  );

  const failed = {
    getActionStatus: async () => ({ exit_code: 2, lines: ['failed'], pid: 101, running: false }),
  } as unknown as HermesCloudApi;
  await assert.rejects(
    () => waitForActionCompletion(failed, 'security-audit', 101, { attempts: 1, pollIntervalMs: 0 }),
    /failed \(exit 2\)/,
  );
});

test('native source exposes visible OAuth lifecycle controls and cleanup-safe backup sharing', () => {
  const pages = readFileSync('modules/hermes-ios-controls/ios/HermesSwiftUIPages.swift', 'utf8');
  const hook = readFileSync('src/app/useHermesSwiftUIRouteData.ts', 'utf8');
  const actions = readFileSync('src/app/hermes-route-data.ts', 'utf8');
  const providerOauthActions = readFileSync('src/app/route-actions/provider-oauth.ts', 'utf8');
  const presentation = readFileSync('src/app/route-actions/presentation.ts', 'utf8');
  assert.match(pages, /pendingProviderOauth/);
  assert.match(pages, /\.providerOauthCancel/);
  assert.match(pages, /\.providerOauthDisconnect/);
  assert.match(pages, /hermes-provider-oauth-disconnect-/);
  assert.match(pages, /provider\.status\.loggedIn && provider\.disconnectable == true/);
  assert.match(pages, /\.botAvatarClear/);
  assert.match(pages, /\.mcpReplace/);
  assert.match(pages, /\.modelMoaSave/);
  assert.match(pages, /SecureField\(chinese \? "新密钥"/);
  assert.doesNotMatch(pages, /entry\.tokenPreview/);
  assert.match(hook, /providerOauthPollRef\.current !== pending/);
  assert.match(hook, /pending\.cancelled = true/);
  assert.match(hook, /pollProviderOauth\(provider, sessionId, profile\)/);
  assert.match(hook, /providerOauthPollRef\.current\.cancelled = true;[\s\S]*\}, \[api, profile, routeId\]\);/);
  assert.match(hook, /const oauthLifecycle = lifecycleEpoch\.current;[\s\S]*if \(!oauthIsCurrent\(\)\) return;[\s\S]*await reload\(\);/);
  assert.match(hook, /lifecycleEpoch\.current \+= 1;[\s\S]*\[api, cacheOwner, localStore, profile, reload, routeId\]/);
  assert.match(actions, /performProviderOauthAction/);
  assert.match(providerOauthActions, /api\.cancelProviderOauth/);
  assert.match(providerOauthActions, /api\.deleteModelCredential\(provider, profile\)/);
  assert.match(actions, /await presentBackup\(api, archive, locale, pid\)/);
  assert.match(presentation, /api\.consumeBackup\([\s\S]*writeValidatedBackup/);
  assert.doesNotMatch(presentation, /api\.downloadBackup\(archive\)/);
  assert.match(presentation, /finally \{[\s\S]*target\.exists[\s\S]*target\.delete\(\)/);
});
