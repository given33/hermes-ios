import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HERMES_STUDIO_BSL_1_1 } from '../src/legal/third-party-notices';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(projectRoot, path), 'utf8');

test('the Hermes Studio runtime asset is minimal, pinned, and carries its BSL notice', () => {
  const asset = readFileSync(
    resolve(projectRoot, 'assets/third-party/hermes-studio/logo.png'),
  );
  const avatar = read('src/components/studio/StudioOfficialAvatar.tsx');
  const license = read('assets/third-party/hermes-studio/LICENSE');
  const notice = read('assets/third-party/hermes-studio/NOTICE.md');
  const runtimeNotice = read('src/legal/third-party-notices.ts');
  const account = read('src/auth/AccountPage.tsx');
  const gitignore = read('.gitignore');
  const tsconfig = JSON.parse(read('tsconfig.json')) as { exclude?: string[] };

  assert.equal(
    createHash('sha256').update(asset).digest('hex'),
    'b4523eb680f86e02a144e7297f1f5c8e86559400f4fab20d3d5110d602b8255f',
  );
  assert.match(avatar, /assets\/third-party\/hermes-studio\/logo\.png/);
  assert.doesNotMatch(avatar, /vendor\/hermes-studio-ui/);
  assert.match(license, /Business Source License 1\.1/);
  assert.match(license, /Commercial use[\s\S]*requires a separate commercial license/);
  assert.match(license, /Change Date:\s+2029-05-10/);
  assert.match(notice, /Only this runtime image is retained/);
  assert.match(notice, /does not state a trademark grant/);
  assert.match(runtimeNotice, /Business Source License 1\.1/);
  assert.match(runtimeNotice, /EKKOLearnAI/);
  assert.match(runtimeNotice, /2029-05-10/);
  assert.equal(HERMES_STUDIO_BSL_1_1.trim(), license.trim());
  assert.match(account, /第三方授权/);
  assert.match(account, /HERMES_STUDIO_BSL_1_1/);
  assert.match(gitignore, /^\/vendor\/hermes-studio-ui\/$/m);
  assert.ok(!tsconfig.exclude?.includes('vendor/hermes-studio-ui'));
});
