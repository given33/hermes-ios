import type { HermesSwiftUISystemSnapshot } from '../swiftui-route-contract';
import { isFreshObservation } from '../../api/managed-node-status';
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
  const managedConfigured = managed.configured === true;
  const managedNodes = Array.isArray(managed.nodes) ? managed.nodes.filter(isRecord) : [];
  const nodeSnapshots = managedNodes.map((node) => {
    const metrics = isRecord(node.metrics) ? node.metrics : {};
    const memoryTotal = numberValue(metrics.memory_total_bytes);
    const memoryAvailable = numberValue(metrics.memory_available_bytes);
    const gatewayState = stringValue(node.gateway_state);
    const metricsAvailable = node.metrics_available === true;
    const recoveryState = stringValue(node.recovery_state);
    const gatewayOnline = isFreshObservation(node)
      && node.online === true
      && ['active', 'online', 'ready', 'running'].includes(gatewayState.toLowerCase());
    return {
      id: stringValue(node.id),
      label: stringValue(node.label) || stringValue(node.id),
      cpu: metricsAvailable ? numberValue(metrics.cpu_percent) : 0,
      memory: metricsAvailable ? numberValue(metrics.memory_percent) : 0,
      disk: metricsAvailable ? numberValue(metrics.disk_percent) : 0,
      memoryLabel: metricsAvailable
        ? formatBytes(Math.max(0, memoryTotal - memoryAvailable))
        : '-',
      uptimeLabel: metricsAvailable
        ? formatDuration(numberValue(metrics.uptime_seconds), localizer)
        : '-',
      activeTasks: String(node.active_tasks ?? '-'),
      gatewayOnline,
      metricsAvailable,
      gatewayState,
      version: stringValue(node.version) || stringValue(node.gateway_version),
      observedAt: stringValue(node.observed_at),
      metricsSource: stringValue(node.metrics_source),
      recoveryState,
    };
  }).filter((node) => node.id);
  const primaryNode = nodeSnapshots.find((node) => node.id === 'dbb3') || nodeSnapshots[0];
  const memory = isRecord(stats.memory) ? stats.memory : {};
  const disk = isRecord(stats.disk) ? stats.disk : {};
  const gateway = isRecord(status.gateway) ? status.gateway : {};
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
    // turn a missing DBB3/WSL heartbeat back into "online".
    gatewayOnline: primaryNode?.gatewayOnline ?? (managedConfigured ? false : Boolean(
      status.online
        ?? status.gateway_online
        ?? status.gateway_running
        ?? gateway.running
        ?? status.running,
    )),
    metricsAvailable: primaryNode?.metricsAvailable ?? !managedConfigured,
    nodes: nodeSnapshots,
    operationMessage: stringValue(root.operation_message) || undefined,
  };
}
