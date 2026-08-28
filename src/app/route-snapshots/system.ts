import type { HermesSwiftUISystemSnapshot } from '../swiftui-route-contract';
import { managedNodeGatewayStatuses } from '../../api/managed-node-status';
import {
  formatBytes,
  formatDuration,
  isRecord,
  numberValue,
  stringValue,
  type HermesRouteLocalizer,
} from './support';

export function systemSnapshot(source: unknown, localizer: HermesRouteLocalizer): HermesSwiftUISystemSnapshot {
  const root = isRecord(source) ? source : {};
  const status = isRecord(root.status) ? root.status : {};
  const stats = isRecord(root.stats) ? root.stats : {};
  const managed = isRecord(root.managedNodes) ? root.managedNodes : {};
  const managedConfigured = booleanValue(managed.configured) === true;
  const managedNodesValue = managed.nodes ?? managed.items ?? managed.managed_nodes ?? managed.managedNodes;
  const managedNodes = Array.isArray(managedNodesValue) ? managedNodesValue.filter(isRecord) : [];
  const gatewayStatuses = new Map(
    managedNodeGatewayStatuses(managed).map((node) => [node.id, node]),
  );
  const nodeSnapshots = managedNodes.map((node) => {
    const metrics = isRecord(node.metrics)
      ? node.metrics
      : isRecord(node.telemetry)
        ? node.telemetry
        : {};
    const id = firstString(node, ['id', 'node_id', 'nodeId']).toLowerCase();
    const normalizedGateway = gatewayStatuses.get(id);
    const memoryTotal = firstNumber(metrics, ['memory_total_bytes', 'memoryTotalBytes']);
    const memoryAvailable = firstNumber(metrics, ['memory_available_bytes', 'memoryAvailableBytes']);
    const gatewayState = firstString(node, ['gateway_state', 'gatewayState', 'state', 'status']);
    const metricsAvailable = booleanValue(
      node.metrics_available ?? node.metricsAvailable,
    ) === true;
    const recoveryState = firstString(node, ['recovery_state', 'recoveryState']);
    const gatewayOnline = normalizedGateway?.state === 'online';
    return {
      id,
      label: firstString(node, ['label', 'display_name', 'displayName', 'name']) || id.toUpperCase(),
      cpu: metricsAvailable ? firstNumber(metrics, ['cpu_percent', 'cpuPercent']) : 0,
      memory: metricsAvailable ? firstNumber(metrics, ['memory_percent', 'memoryPercent']) : 0,
      disk: metricsAvailable ? firstNumber(metrics, ['disk_percent', 'diskPercent']) : 0,
      memoryLabel: metricsAvailable
        ? formatBytes(Math.max(0, memoryTotal - memoryAvailable))
        : '-',
      uptimeLabel: metricsAvailable
        ? formatDuration(firstNumber(metrics, ['uptime_seconds', 'uptimeSeconds']), localizer)
        : '-',
      activeTasks: String(node.active_tasks ?? node.activeTasks ?? '-'),
      gatewayOnline,
      metricsAvailable,
      gatewayState: gatewayState || normalizedGateway?.state || '',
      version: firstString(node, ['version', 'gateway_version', 'gatewayVersion']),
      observedAt: stringish(node.observed_at ?? node.observedAt),
      metricsSource: firstString(node, ['metrics_source', 'metricsSource']),
      recoveryState,
    };
  }).filter((node) => node.id);
  const primaryNode = nodeSnapshots.find((node) => node.id === 'dbb3') || nodeSnapshots[0];
  const memory = isRecord(stats.memory) ? stats.memory : {};
  const disk = isRecord(stats.disk) ? stats.disk : {};
  const gateway = isRecord(status.gateway) ? status.gateway : {};
  const health = isRecord(root.health) ? root.health : {};
  const egress = isRecord(root.egress) ? root.egress : {};
  const updateCheck = isRecord(root.updateCheck) ? root.updateCheck : {};
  const updateReceipt = isRecord(root.updateReceipt) ? root.updateReceipt : {};
  return {
    cpu: primaryNode?.cpu ?? numberValue(stats.cpu_percent ?? stats.cpu),
    memory: primaryNode?.memory ?? numberValue(stats.memory_percent ?? memory.percent),
    disk: primaryNode?.disk ?? numberValue(stats.disk_percent ?? disk.percent),
    memoryLabel: primaryNode?.memoryLabel || stringValue(stats.memory_label)
      || formatBytes(numberValue(stats.memory_bytes ?? memory.used)),
    uptimeLabel: primaryNode?.uptimeLabel || stringValue(stats.uptime)
      || formatDuration(numberValue(stats.uptime_seconds), localizer),
    activeTasks: primaryNode?.activeTasks || String(
      stats.active_tasks
        ?? status.active_tasks
        ?? status.active_sessions
        ?? '-',
    ),
    // Once managed-node monitoring is configured, an empty/stale node list is
    // an unavailable observation. Never let the older aggregate status flag
    // turn a missing DBB3/WSL/HK heartbeat back into "online".
    gatewayOnline: primaryNode?.gatewayOnline ?? (managedConfigured ? false : Boolean(
      booleanValue(
        status.online
          ?? status.gateway_online
          ?? status.gatewayOnline
          ?? status.gateway_running
          ?? status.gatewayRunning
          ?? gateway.running
          ?? status.running,
      ),
    )),
    metricsAvailable: primaryNode?.metricsAvailable ?? !managedConfigured,
    nodes: nodeSnapshots,
    operationMessage: stringValue(root.operation_message) || undefined,
    healthLabel: stringValue(health.message) || stringValue(health.status)
      || (health.ok === true ? 'healthy' : health.ok === false ? 'unhealthy' : undefined),
    egressLabel: stringValue(egress.text) || stringValue(egress.status) || undefined,
    updateAvailable: typeof updateCheck.update_available === 'boolean'
      ? updateCheck.update_available
      : typeof updateCheck.available === 'boolean' ? updateCheck.available : undefined,
    updateVersion: stringValue(updateCheck.version) || stringValue(updateCheck.latest_version)
      || stringValue(updateCheck.latestVersion) || undefined,
    updateReceipt: stringValue(updateReceipt.status) || stringValue(updateReceipt.message)
      || undefined,
  };
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'online', 'running', 'active', 'healthy', 'ok'].includes(normalized)) return true;
  if (['false', 'no', '0', 'offline', 'failed', 'error'].includes(normalized)) return false;
  return undefined;
}

function stringish(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}
