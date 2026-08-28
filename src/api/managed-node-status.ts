export const MANAGED_NODE_FRESHNESS_MS = 60_000;
export const MANAGED_NODE_FUTURE_SKEW_MS = 30_000;

export type ManagedNodeGatewayState =
  | 'online'
  | 'offline'
  | 'degraded'
  | 'unknown';

export interface ManagedNodeGatewayStatus {
  id: string;
  label: string;
  state: ManagedNodeGatewayState;
  version?: string;
}

type JsonRecord = Record<string, unknown>;

export function managedNodeGatewayStatuses(
  source: JsonRecord,
  now = Date.now(),
): ManagedNodeGatewayStatus[] {
  const nodes = arrayField(source, ['nodes', 'items', 'managed_nodes', 'managedNodes']);
  const sources = arrayField(source, ['sources', 'monitors']).filter(isRecord);
  // Keep the four-member fabric visible on every authenticated surface:
  // server/dispatcher is represented separately, while these are the three
  // independently deployable worker nodes.
  return ['dbb3', 'wsl', 'hk'].map((id): ManagedNodeGatewayStatus => {
    const value = nodes.find((entry) => (
      isRecord(entry) && nodeId(entry) === id
    ));
    if (!isRecord(value)) {
      const directSource = sources.find(
        (entry) => nodeId(entry) === id,
      );
      const targetState = managedTargetState(sources, id);
      return {
        id,
        label: id.toUpperCase(),
        // The server answered but has no node entry and no recovery target
        // for this id: the node is not configured or not reporting. Treat it
        // as offline instead of leaving the UI stuck on "checking" forever.
        state: booleanFieldAny(directSource, ['online', 'is_online', 'isOnline']) === false || targetState === 'unknown'
          ? 'offline'
          : targetState,
      };
    }

    if (!isFreshObservation(value, now)) {
      return {
        id,
        label: stringFieldAny(value, ['label', 'display_name', 'displayName', 'name']) || id.toUpperCase(),
        // No observation timestamp means the relay never produced a status
        // payload for this node; fail closed to offline rather than checking.
        state: 'offline',
        version: versionField(value),
      };
    }

    const gatewayState = stringFieldAny(value, [
      'gateway_state',
      'gatewayState',
      'state',
      'status',
    ]).toLowerCase();
    const nodeOnline = booleanFieldAny(value, [
      'online',
      'is_online',
      'isOnline',
      'reachable',
    ]) === true;
    const gatewayOnline = ['active', 'online', 'ready', 'running', 'healthy', 'ok'].includes(gatewayState);
    return {
      id,
      label: stringFieldAny(value, ['label', 'display_name', 'displayName', 'name']) || id.toUpperCase(),
      state: nodeOnline && gatewayOnline
        ? 'online'
        : nodeOnline
          ? 'degraded'
          : 'offline',
      version: versionField(value),
    };
  });
}

function managedTargetState(
  sources: readonly JsonRecord[],
  id: string,
): ManagedNodeGatewayState {
  for (const source of sources) {
    const recovery = isRecord(source.recovery)
      ? source.recovery
      : isRecord(source.recovery_state)
        ? source.recovery_state
        : {};
    const targetStates = isRecord(recovery.target_states)
      ? recovery.target_states
      : isRecord(recovery.targetStates)
        ? recovery.targetStates
        : isRecord(source.target_states)
          ? source.target_states
          : isRecord(source.targetStates)
            ? source.targetStates
            : {};
    const targetKey = Object.keys(targetStates).find((key) => key.toLowerCase() === id);
    const target = targetKey ? targetStates[targetKey] : undefined;
    if (target === true) return 'online';
    if (target === false) return 'offline';
    const targetRecord = isRecord(target) ? target : {};
    if (booleanField(targetRecord, 'online') === true) return 'online';
    if (booleanField(targetRecord, 'online') === false) return 'offline';
    const state = (
      typeof target === 'string'
        ? target
        : stringField(targetRecord, 'state') || stringField(targetRecord, 'status')
    ).toLowerCase();
    if (['active', 'online', 'ready', 'running', 'healthy', 'ok', 'success'].includes(state)) return 'online';
    if (['degraded', 'partial', 'warning'].includes(state)) return 'degraded';
    if (['error', 'failed', 'offline', 'timeout', 'unreachable'].includes(state)) return 'offline';
  }
  return 'unknown';
}

export function isFreshObservation(value: JsonRecord, now = Date.now()): boolean {
  if (booleanFieldAny(value, ['fresh', 'is_fresh', 'isFresh']) === false) return false;
  const observedAt = parseObservationTimestamp(firstField(value, [
    'observed_at',
    'observedAt',
    'sampled_at',
    'sampledAt',
    'heartbeat_at',
    'heartbeatAt',
    'last_heartbeat_at',
    'lastHeartbeatAt',
    'checked_at',
    'checkedAt',
    'updated_at',
    'updatedAt',
    'timestamp',
  ]));
  if (!Number.isFinite(observedAt)) return false;
  const age = now - observedAt;
  return age >= -MANAGED_NODE_FUTURE_SKEW_MS && age <= MANAGED_NODE_FRESHNESS_MS;
}

export function expireSystemRouteData(
  dataJson: string,
  lastSuccessfulReloadAt: number,
  now = Date.now(),
): string {
  let root: unknown;
  try {
    root = JSON.parse(dataJson);
  } catch {
    return dataJson;
  }
  if (!isRecord(root) || !isRecord(root.system)) return dataJson;
  const system = root.system;
  const reloadAge = now - lastSuccessfulReloadAt;
  const serverFresh = lastSuccessfulReloadAt > 0
    && reloadAge >= -MANAGED_NODE_FUTURE_SKEW_MS
    && reloadAge <= MANAGED_NODE_FRESHNESS_MS;
  const nodes = Array.isArray(system.nodes) ? system.nodes : [];
  const nextNodes = nodes.map((source) => {
    if (!isRecord(source)) return source;
    const fresh = serverFresh
      && isFreshObservation({ observed_at: source.observedAt }, now);
    return source.gatewayOnline === true && !fresh
      ? { ...source, gatewayOnline: false }
      : source;
  });
  const primary = nextNodes.find((node) => (
    isRecord(node) && stringField(node, 'id').toLowerCase() === 'dbb3'
  )) || nextNodes.find(isRecord);
  const gatewayOnline = serverFresh
    && (isRecord(primary) ? primary.gatewayOnline === true : system.gatewayOnline === true);
  if (gatewayOnline === system.gatewayOnline && nextNodes.every((node, index) => node === nodes[index])) {
    return dataJson;
  }
  return JSON.stringify({
    ...root,
    system: {
      ...system,
      gatewayOnline,
      nodes: nextNodes,
    },
  });
}

function parseObservationTimestamp(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return normalizeEpoch(raw);
  if (typeof raw !== 'string') return Number.NaN;
  const value = raw.trim();
  if (!value) return Number.NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return normalizeEpoch(numeric);
  return Date.parse(value);
}

function normalizeEpoch(value: number): number {
  // Relay implementations commonly expose Unix seconds while the native
  // route uses JavaScript milliseconds. Treat values below 1e11 as seconds.
  return Math.abs(value) < 100_000_000_000 ? value * 1_000 : value;
}

function firstField(record: JsonRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function booleanField(record: JsonRecord | undefined, key: string): boolean | undefined {
  return booleanFieldAny(record, [key]);
}

function booleanFieldAny(
  record: JsonRecord | undefined,
  keys: readonly string[],
): boolean | undefined {
  if (!record) return undefined;
  const value = firstField(record, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  return undefined;
}

/*
 * Keep this helper deliberately narrow: the managed-node API uses snake_case,
 * while a few native route snapshots use camelCase aliases.
 */
function stringField(record: JsonRecord, key: string): string {
  return stringFieldAny(record, [key]);
}

function stringFieldAny(record: JsonRecord, keys: readonly string[]): string {
  const value = firstField(record, keys);
  return typeof value === 'string' ? value.trim() : '';
}

function versionField(value: JsonRecord): string | undefined {
  return stringFieldAny(value, ['version', 'gateway_version', 'gatewayVersion']) || undefined;
}

function arrayField(record: JsonRecord, keys: readonly string[]): unknown[] {
  const value = firstField(record, keys);
  return Array.isArray(value) ? value : [];
}

function nodeId(value: JsonRecord): string {
  return stringFieldAny(value, ['id', 'node_id', 'nodeId']).toLowerCase();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
