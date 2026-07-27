import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Behavioural pin for audit finding C2: production UI lives in `src/studio/`;
// only fixture modules and their empty production replacements remain under
// `src/preview/`. This executes the Metro resolver so a source-only rewrite
// that breaks the production swap still fails.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireCjs = createRequire(import.meta.url);

interface MetroResolutionContext {
  resolveRequest(
    context: MetroResolutionContext,
    moduleName: string,
    platform: string | null,
  ): unknown;
}

const metroConfig = requireCjs(resolve(projectRoot, 'metro.config.js')) as {
  resolver: {
    resolveRequest(
      context: MetroResolutionContext,
      moduleName: string,
      platform: string | null,
    ): unknown;
  };
};

/** Runs the real resolver and reports which module the chain was asked for. */
function resolvedTarget(moduleName: string): string {
  let target = '';
  const context: MetroResolutionContext = {
    resolveRequest(_context, chainedModuleName) {
      target = chainedModuleName;
      return { filePath: chainedModuleName, type: 'sourceFile' };
    },
  };
  metroConfig.resolver.resolveRequest(context, moduleName, 'ios');
  return target.replaceAll('\\', '/');
}

function withFrontendPreviewFlag<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.EXPO_PUBLIC_FRONTEND_PREVIEW;
  if (value === undefined) delete process.env.EXPO_PUBLIC_FRONTEND_PREVIEW;
  else process.env.EXPO_PUBLIC_FRONTEND_PREVIEW = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_FRONTEND_PREVIEW;
    else process.env.EXPO_PUBLIC_FRONTEND_PREVIEW = previous;
  }
}

const FIXTURE_SWAPS: readonly (readonly [request: string, production: string])[] = [
  ['./preview-fixtures', 'src/preview/production-fixtures.ts'],
  ['../preview/preview-fixtures', 'src/preview/production-fixtures.ts'],
  ['./chat-fixture-simulator', 'src/preview/production-chat-simulator.ts'],
  ['./preview-localization', 'src/i18n/production-preview-localization.ts'],
  ['./PreviewAutomationPages', 'src/preview/production-route-stubs.tsx'],
  ['./PreviewCorePages', 'src/preview/production-route-stubs.tsx'],
  ['./PreviewPluginPages', 'src/preview/production-route-stubs.tsx'],
  ['./PreviewSettingsPages', 'src/preview/production-route-stubs.tsx'],
  ['./HermesStudioSettingsPage', 'src/preview/production-route-stubs.tsx'],
  // Windows path separators must not defeat the route-stub swap.
  ['.\\PreviewCorePages', 'src/preview/production-route-stubs.tsx'],
];

const SHIPPED_STUDIO_MODULES: readonly string[] = [
  '../studio/FrontendPreviewApp',
  '../studio/PreviewChatPage',
  '../studio/PreviewMemoryPage',
  '../studio/PreviewPrimitives',
  '../studio/ReasoningSection',
  '../studio/WorkflowTimeline',
  '../studio/workflow-timeline-model',
  '../studio/in-flight-action-gate',
  '../studio/frontend-preview-contract',
];

test('production bundles swap every fixture module family for its empty production twin', () => {
  withFrontendPreviewFlag(undefined, () => {
    for (const [request, production] of FIXTURE_SWAPS) {
      const target = resolvedTarget(request);
      assert.ok(
        target.endsWith(production),
        `expected ${request} -> ${production}, got ${target}`,
      );
    }
  });
  // The workflow env var is the only opt-in; any other value still ships stubs.
  withFrontendPreviewFlag('0', () => {
    assert.ok(resolvedTarget('./preview-fixtures').endsWith('src/preview/production-fixtures.ts'));
    assert.ok(resolvedTarget('./PreviewCorePages').endsWith('src/preview/production-route-stubs.tsx'));
  });
});

test('production bundles keep Studio product modules un-swapped', () => {
  withFrontendPreviewFlag(undefined, () => {
    for (const request of SHIPPED_STUDIO_MODULES) {
      assert.equal(
        resolvedTarget(request),
        request,
        `${request} is Studio product code and must not be replaced in production bundles`,
      );
    }
  });
});

test('the explicit frontend-preview flag restores fixture modules for design walkthroughs', () => {
  withFrontendPreviewFlag('1', () => {
    for (const [request] of FIXTURE_SWAPS) {
      const passthrough = request.replaceAll('\\', '/');
      assert.equal(resolvedTarget(request), passthrough);
    }
    for (const request of SHIPPED_STUDIO_MODULES) {
      assert.equal(resolvedTarget(request), request);
    }
  });
});
