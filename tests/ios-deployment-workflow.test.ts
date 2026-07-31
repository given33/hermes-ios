import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('iOS unsigned builds accept only validated backend release events', () => {
  const workflow = read('.github/workflows/ios-unsigned.yml');
  assert.match(workflow, /repository_dispatch:/);
  assert.match(workflow, /hermes-backend-release/);
  assert.match(workflow, /BACKEND_COMMIT: \$\{\{ github\.event\.client_payload\.commit \}\}/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /backend_commit/);
  assert.match(workflow, /backend_version/);
  assert.match(workflow, /trigger/);
  assert.match(workflow, /run-name: Backend release/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'repository_dispatch' \}\}/);
});

test('production EAS builds fail closed and verify signed artifact output', () => {
  const workflow = read('.github/workflows/ios-production-eas.yml');
  const eas = read('eas.json');
  assert.match(workflow, /repository_dispatch:/);
  assert.match(workflow, /hermes-backend-release/);
  assert.match(workflow, /EXPO_TOKEN: \$\{\{ secrets\.EXPO_TOKEN \}\}/);
  assert.match(workflow, /EXPO_TOKEN is required for a signed production EAS build/);
  assert.match(workflow, /--profile production/);
  assert.match(workflow, /--non-interactive/);
  assert.match(workflow, /--wait/);
  assert.match(workflow, /--json/);
  assert.match(workflow, /EAS JSON did not contain a completed build artifact URL/);
  assert.match(workflow, /curl --fail --location --retry 3/);
  assert.match(workflow, /unzip -t/);
  assert.match(workflow, /verify-production-app\.mjs/);
  assert.match(workflow, /Hermes-Agent-production\.ipa\.sha256/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /run-name: Backend release/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'repository_dispatch' \}\}/);
  assert.match(eas, /"appVersionSource": "local"/);
  assert.match(eas, /"production": \{[\s\S]*"autoIncrement": true/);
});

test('the local EAS helper resolves Node portably and pins the CLI version', () => {
  const script = read('scripts/build-eas-preview.ps1');
  assert.doesNotMatch(script, /C:\\\\Users\\\\given/);
  assert.match(script, /Get-Command node/);
  assert.match(script, /pnpm dlx eas-cli@20\.5\.1/);
  assert.doesNotMatch(script, /pnpm exec eas /);
});
