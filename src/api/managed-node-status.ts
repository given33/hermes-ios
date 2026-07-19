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
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const sources = Array.isArray(source.sources) ? source.sources.filter(isRecord) : [];
  return ['dbb3', 'wsl'].map((id): ManagedNodeGatewayStatus => {
    const value = nodes.find((entry) => (
      isRecord(entry) && stringField(entry, 'id').toLowerCase() === id
    ));
    if (!isRecord(value)) {
      const directSource = sources.find(
        (entry) => stringField(entry, 'id').toLowerCase() === id,
      );
      return {
        id,
        label: id.toUpperCase(),
        state: directSource?.online === false ? 'offline' : 'unknown',
      };
    }

    const observedAt = stringField(value, 'observed_at');
    if (!isFreshObservation(value, now)) {
      return {
        id,
        label: stringField(value, 'label') || id.toUpperCase(),
        state: observedAt ? 'offline' : 'unknown',
        version: versionField(value),
      };
    }

    const gatewayState = stringField(value, 'gateway_state').toLowerCase();
    const nodeOnline = value.online === true;
    const gatewayOnline = ['active', 'online', 'ready', 'running'].includes(gatewayState);
    return {
      id,
      label: stringField(value, 'label') || id.toUpperCase(),
      state: nodeOnline && gatewayOnline
        ? 'online'
        : nodeOnline
          ? 'degraded'
          : 'offline',
      version: versionField(value),
    };
  });
}

export function isFreshObservation(value: JsonRecord, now = Date.now()): boolean {
  if (value.fresh === false) return false;
  const raw = value.observed_at;
  const observedAt = typeof raw === 'number'
    ? raw
    : typeof raw === 'string'
      ? Date.parse(raw)
      : Number.NaN;
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

function versionField(value: JsonRecord): string | undefined {
  return stringField(value, 'version') || stringField(value, 'gateway_version') || undefined;
}

function stringField(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
