export const FORBIDDEN_PRODUCTION_MARKERS = Object.freeze([
  'Mapped the customized WebUI route ownership',
  'Deployment is healthy. The gateway is listening',
  'Created a weekday schedule and configured Telegram delivery.',
  'iOS native migration plan',
  'Gateway deployment audit',
  'Hermes plugin compatibility',
  'Research digest automation',
  'ses_01JZ8K5A',
  'ses_01JZ6R2Q',
  'ses_01JYYT90',
  'ses_01JYW52P',
  'HMS-126',
  'HMS-129',
  'HMS-131',
  'HMS-138',
  'HMS-142',
  'HMS-145',
  'Complete frontend fixture routes',
  'Given iPhone 16 Pro',
  '@hermes_given_bot',
  'mcp.github.example',
  'sk-ant-...9wK2',
  '8312...AAHk',
  'Workspace backup',
  'Tasks Completed',
  'native-ios',
  'HERMES AGENT  v0.9.3',
]);

export const REQUIRED_PRODUCTION_MARKERS = Object.freeze([
  '/single/conversations',
  'HermesStandardMap',
  'hermes.native.conversations.v3',
]);

const FORBIDDEN_PERSISTENT_PATHS = Object.freeze([
  /(?:^|\/)(?:Documents|Library|Caches|tmp)(?:\/|$)/i,
  /\.(?:db|sqlite|sqlite3|realm|jsonl|ndjson|log|cache|store|archive)(?:-(?:shm|wal))?$/i,
  /(?:^|\/)(?:conversation|session|message|task|device|trajectory|location|health)[^/]*(?:cache|history|fixture|seed|sample|record|store|backup|export|data)[^/]*$/i,
]);

const RUNTIME_COLLECTION_NAMES = Object.freeze([
  'conversations',
  'sessions',
  'tasks',
  'devices',
  'messages',
  'runs',
  'trajectory',
  'trajectories',
  'health_samples',
  'location_history',
  'notifications',
]);

const SECRET_PATTERNS = Object.freeze([
  ['OpenAI-compatible API key', /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{19,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub access token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['Slack access token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
]);

const CREDENTIAL_ASSIGNMENTS = Object.freeze([
  /(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|password)\s*["']?\s*[:=]\s*["']([A-Za-z0-9+/_=.-]{20,})["']/gi,
  /<key>[^<]*(?:api.?key|access.?token|secret|password)[^<]*<\/key>\s*<string>([^<]{20,})<\/string>/gi,
]);

const RUNTIME_RECORD_PATTERNS = Object.freeze(
  RUNTIME_COLLECTION_NAMES.map((name) => new RegExp(
    `["']${name}["']\\s*:\\s*\\[\\s*\\{`,
    'gi',
  )),
);

export function verifyProductionBuffers(entries, fail, options = {}) {
  const allowedSecrets = (options.allowedSecrets || [])
    .filter((value) => typeof value === 'string' && value.length >= 16);
  const missing = new Set(REQUIRED_PRODUCTION_MARKERS);
  for (const { bytes, name } of entries) {
    const normalizedName = String(name || '').replaceAll('\\', '/');
    for (const pattern of FORBIDDEN_PERSISTENT_PATHS) {
      if (pattern.test(normalizedName)) {
        fail(`preloaded persistent runtime data found in production artifact: ${normalizedName}`);
      }
    }
    for (const marker of FORBIDDEN_PRODUCTION_MARKERS) {
      if (bytes.includes(Buffer.from(marker))) {
        fail(`preview fixture leaked into the production bundle: ${marker} (${name})`);
      }
    }
    let text = bytes.toString('utf8');
    for (const allowed of allowedSecrets) text = text.replaceAll(allowed, '[allowed-build-secret]');
    for (const pattern of RUNTIME_RECORD_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        fail(`persisted runtime data record leaked into production artifact: ${normalizedName}`);
      }
    }
    for (const [label, pattern] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) fail(`${label} leaked into production artifact: ${normalizedName}`);
    }
    for (const pattern of CREDENTIAL_ASSIGNMENTS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (isHighEntropyCredential(match[1] || '')) {
          fail(`high-entropy credential leaked into production artifact: ${normalizedName}`);
        }
      }
    }
    if (normalizedName.toLowerCase().endsWith('.json')) {
      verifyStructuredJson(bytes, normalizedName, fail);
    }
    for (const marker of missing) {
      if (bytes.includes(Buffer.from(marker))) missing.delete(marker);
    }
  }
  const firstMissing = missing.values().next().value;
  if (firstMissing) fail(`required production marker is missing: ${firstMissing}`);
}

function isHighEntropyCredential(value) {
  if (value.length < 20 || new Set(value).size < 10) return false;
  const frequencies = new Map();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) || 0) + 1);
  }
  const entropy = [...frequencies.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);
  return entropy >= 3.5;
}

function verifyStructuredJson(bytes, name, fail) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return;
  }
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      if (
        RUNTIME_COLLECTION_NAMES.includes(key.toLowerCase())
        && Array.isArray(child)
        && child.length > 0
      ) {
        fail(`persisted runtime data record leaked into production artifact: ${name}`);
      }
      pending.push(child);
    }
  }
}
