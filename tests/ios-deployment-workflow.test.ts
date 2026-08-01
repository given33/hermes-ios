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
  assert.match(workflow, /run-name: Backend release \$\{\{ github\.event\.client_payload\.commit \|\| github\.sha \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /find "\$RUNNER_TEMP\/ipa\/Payload" -name _CodeSignature/);
  assert.match(workflow, /-name embedded\.mobileprovision -o -name CodeResources/);
  assert.match(workflow, /CFBundleExecutable/);
  assert.match(workflow, /chmod u\+x,go\+x/);
  assert.match(workflow, /verify-resignable-ipa\.mjs/);
  assert.match(workflow, /--bundle-id \"\$APP_BUNDLE_IDENTIFIER\"/);
  assert.doesNotMatch(workflow, /Publish the tagged release/);
  assert.doesNotMatch(workflow, /gh release (?:create|upload)/);
  assert.match(workflow, /Install locked dependencies with network retry/);
  assert.match(workflow, /pnpm install attempt \$\{attempt\}\/3 failed/);
  assert.match(workflow, /sleep \$\(\(attempt \* 10\)\)/);
});

test('production EAS builds fail closed and verify signed artifact output', () => {
  const workflow = read('.github/workflows/ios-production-eas.yml');
  const eas = read('eas.json');
  assert.match(workflow, /repository_dispatch:/);
  assert.match(workflow, /hermes-backend-release/);
  assert.match(workflow, /push:\s+branches:\s+- main/);
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /permissions:\s+contents: write/);
  assert.match(workflow, /HERMES_CI_BUILD_NUMBER: \$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /HERMES_CI_BUILD_NUMBER must be a positive iOS build number/);
  assert.match(workflow, /EXPO_TOKEN: \$\{\{ secrets\.EXPO_TOKEN \}\}/);
  assert.match(workflow, /EXPO_PROJECT_ID: \$\{\{ secrets\.EXPO_PROJECT_ID \}\}/);
  assert.match(workflow, /EXPO_TOKEN is required for a signed production EAS build/);
  assert.match(workflow, /EXPO_PROJECT_ID must be the UUID/);
  assert.match(workflow, /--profile production/);
  assert.match(workflow, /--non-interactive/);
  assert.match(workflow, /--wait/);
  assert.match(workflow, /--json/);
  assert.match(workflow, /EAS JSON did not contain a completed build artifact URL/);
  assert.match(workflow, /EAS app version mismatch/);
  assert.match(workflow, /EAS source commit mismatch/);
  assert.match(workflow, /EAS build number is invalid/);
  assert.match(workflow, /EAS build number mismatch/);
  assert.match(workflow, /curl --fail --location --retry 3/);
  assert.match(workflow, /unzip -t/);
  assert.match(workflow, /verify-production-app\.mjs/);
  assert.match(workflow, /codesign --verify --deep --strict --verbose=2/);
  assert.match(workflow, /verify_signed_bundle\(\)/);
  assert.match(workflow, /codesign --verify --strict --verbose=2/);
  assert.match(workflow, /find "\$APP_PATH" -type d \\\( -name '\*\.app' -o -name '\*\.appex' \\\)/);
  assert.match(workflow, /profile-\$\(printf '%s' "\$relative_bundle" \| shasum -a 256/);
  assert.match(workflow, /embedded\.mobileprovision/);
  assert.match(workflow, /security cms -D/);
  assert.match(workflow, /application-identifier/);
  assert.match(workflow, /com\.apple\.developer\.team-identifier/);
  assert.match(workflow, /Hermes-Agent-production\.ipa\.sha256/);
  assert.match(workflow, /hermes\.ios\.production-build\.v1/);
  assert.match(workflow, /Hermes-Agent-production-build\.json/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /run-name: Backend release signed/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /Install locked dependencies with network retry/);
  assert.match(workflow, /pnpm install attempt \$\{attempt\}\/3 failed/);
  assert.match(workflow, /sleep \$\(\(attempt \* 10\)\)/);
  assert.match(workflow, /name: Deduplicate backend release dispatch/);
  assert.match(workflow, /actions\/runs\?event=repository_dispatch/);
  assert.match(workflow, /Backend release signed /);
  assert.match(workflow, /should_build=false/);
  assert.match(workflow, /needs: dedupe/);
  assert.match(workflow, /Publish the signed production release/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /Hermes-Agent-production\.ipa/);
  assert.match(eas, /"appVersionSource": "local"/);
  assert.match(eas, /"production": \{[\s\S]*"autoIncrement": false/);
  assert.doesNotMatch(eas, /"autoIncrement": true/);
  const appConfig = read('app.config.js');
  assert.match(appConfig, /HERMES_CI_BUILD_NUMBER/);
  assert.match(appConfig, /buildNumber: ciBuildNumber/);
  assert.match(appConfig, /at most 18 digits/);
  assert.match(appConfig, /EXPO_PROJECT_ID/);
  assert.match(appConfig, /projectId: expoProjectId/);
  assert.match(appConfig, /EXPO_PROJECT_ID must be the UUID/);
});

test('unsigned IPA verifier protects third-party signing inputs', () => {
  const verifier = read('scripts/verify-resignable-ipa.mjs');
  assert.match(verifier, /unzip/);
  assert.match(verifier, /plutil/);
  assert.match(verifier, /Payload/);
  assert.match(verifier, /_CodeSignature/);
  assert.match(verifier, /embedded\.mobileprovision/);
  assert.match(verifier, /CodeResources/);
  assert.match(verifier, /symbolic link/);
  assert.match(verifier, /\.framework/);
  assert.match(verifier, /\.appex/);
  assert.match(verifier, /isStaticFrameworkArchive/);
  assert.match(verifier, /!<arch>/);
  assert.match(verifier, /watchapp\.watchkitextension/);
  assert.match(verifier, /nested app build version mismatch/);
});

test('all iOS workflows pin third-party actions to immutable commits', () => {
  const workflows = [
    read('.github/workflows/ci.yml'),
    read('.github/workflows/ios-unsigned.yml'),
    read('.github/workflows/ios-production-eas.yml'),
  ];
  for (const workflow of workflows) {
    for (const line of workflow.split(/\r?\n/)) {
      if (line.includes('uses:')) {
        assert.match(line, /uses:\s+[^@]+@[0-9a-f]{40}/, line);
      }
    }
  }
});

test('the local EAS helper resolves Node portably and pins the CLI version', () => {
  const script = read('scripts/build-eas-preview.ps1');
  assert.doesNotMatch(script, /C:\\\\Users\\\\given/);
  assert.match(script, /Get-Command node/);
  assert.match(script, /pnpm dlx eas-cli@20\.5\.1/);
  assert.doesNotMatch(script, /pnpm exec eas /);
});
