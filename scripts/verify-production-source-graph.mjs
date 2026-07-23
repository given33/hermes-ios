#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const projectRoot = resolve(process.argv[2] || process.cwd());
const entry = resolve(projectRoot, 'src/app/HermesNativeApp.tsx');
const productionFixtures = resolve(projectRoot, 'src/preview/production-fixtures.ts');
const productionRoutes = resolve(projectRoot, 'src/preview/production-route-stubs.tsx');
const productionLocalization = resolve(
  projectRoot,
  'src/i18n/production-preview-localization.ts',
);
const previewRoot = resolve(projectRoot, 'src/preview');
const productionPreviewAllowlist = new Set(
  [
    'FrontendPreviewApp.tsx',
    'PreviewChatPage.tsx',
    'PreviewPrimitives.tsx',
    'frontend-preview-contract.ts',
    'in-flight-action-gate.ts',
    'production-fixtures.ts',
    'production-route-stubs.tsx',
  ].map((fileName) => resolve(previewRoot, fileName)),
);
const previewRouteModule = /(?:^|\/)Preview(?:Automation|Core|Plugin|Settings)Pages$/;
const sourceExtensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
const importPattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;

for (const required of [entry, productionFixtures, productionRoutes, productionLocalization]) {
  if (!existsSync(required)) fail(`required production source is missing: ${relative(projectRoot, required)}`);
}
const metro = readFileSync(resolve(projectRoot, 'metro.config.js'), 'utf8');
for (const marker of [
  "EXPO_PUBLIC_FRONTEND_PREVIEW !== '1'",
  'production-fixtures.ts',
  'production-route-stubs.tsx',
  'production-preview-localization.ts',
]) {
  if (!metro.includes(marker)) fail(`production Metro alias is missing: ${marker}`);
}

const visited = new Set();
const pending = [entry];
while (pending.length) {
  const current = pending.pop();
  if (!current || visited.has(current)) continue;
  visited.add(current);
  const source = readFileSync(current, 'utf8');
  if (/PREVIEW_[A-Z0-9_]+\s*=\s*\[\s*\{/m.test(source)) {
    fail(`non-empty preview record is reachable from production entry: ${relative(projectRoot, current)}`);
  }
  importPattern.lastIndex = 0;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] || match[2] || match[3] || '';
    const target = resolveProductionImport(current, specifier);
    if (!target) continue;
    const normalized = relative(projectRoot, target).replaceAll('\\', '/');
    if (isWithin(previewRoot, target) && !productionPreviewAllowlist.has(target)) {
      fail(`unapproved preview module is reachable from production entry: ${normalized}`);
    }
    if (
      /(?:^|\/)(?!production-)[^/]*fixture[^/]*\.(?:[cm]?[jt]sx?)$/i.test(normalized)
      || /\/preview-fixtures\.(?:ts|tsx|js|jsx)$/i.test(normalized)
      || /\/Preview(?:Automation|Core|Plugin|Settings)Pages\.(?:ts|tsx|js|jsx)$/i.test(normalized)
    ) {
      fail(`fixture module is reachable from production entry: ${normalized}`);
    }
    pending.push(target);
  }
}

console.log(`Hermes production source graph is fixture-free (${visited.size} modules checked).`);

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== '' && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
}

function resolveProductionImport(importer, specifier) {
  const normalized = specifier.replaceAll('\\', '/');
  if (normalized === './preview-fixtures' || normalized.endsWith('/preview-fixtures')) {
    return productionFixtures;
  }
  if (previewRouteModule.test(normalized)) return productionRoutes;
  if (normalized === './preview-localization' || normalized.endsWith('/preview-localization')) {
    return productionLocalization;
  }
  if (!normalized.startsWith('.')) return null;
  const base = resolve(dirname(importer), normalized);
  for (const extension of sourceExtensions) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function fail(message) {
  console.error(`production-source verification failed: ${message}`);
  process.exit(1);
}
