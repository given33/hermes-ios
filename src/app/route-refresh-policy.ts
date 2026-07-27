// Foreground refresh cadence for the SwiftUI route data controller.
//
// The controller used to poll every route on a fixed timer (and skills/mcp at
// a fixed 2 s), so an untouched screen kept paying the full radio + snapshot
// cost forever. This policy keeps the tight cadence exactly while it buys
// something — an installation actually progressing, a payload that is still
// changing — and stretches it geometrically while the payload proves idle.
// Any observed change (or a foreground/user action, which the controller
// resets with initialRouteRefreshDelay) snaps back to the base cadence, so
// activity is picked up at the old latency and idle screens stop re-fetching
// identical data four times a minute.

export const MAX_IDLE_REFRESH_MS = 60_000;

// Terminal states mirror HermesSwiftUIPages.localizedInstallationState;
// anything unknown is treated as active so a new server state keeps the
// tight cadence instead of silently stalling install progress.
const TERMINAL_INSTALLATION_STATES = new Set(['completed', 'failed', 'cancelled']);

export interface RouteRefreshInput {
  /** Default foreground cadence (FOREGROUND_REFRESH_MS in the controller). */
  baseDelayMs: number;
  /** Tight cadence used while a managed installation is progressing. */
  installationDelayMs: number;
  /** True for the skills/mcp routes, which surface managed installations. */
  installationRoute: boolean;
  /** True when the encoded snapshot differs from the previous tick. */
  payloadChanged: boolean;
  /**
   * Routes whose tick also drives local staleness rendering (system health
   * expiry) never back off; stretching their timer would stretch how long a
   * dead node keeps looking alive.
   */
  pinned: boolean;
  previousDelayMs: number;
  routeDataJson: string;
}

export function initialRouteRefreshDelay(
  routeId: string,
  baseDelayMs: number,
  installationDelayMs: number,
  routeDataJson = '',
): number {
  if (
    (routeId === 'skills' || routeId === 'mcp')
    && hasActiveManagedInstallation(routeDataJson)
  ) {
    return installationDelayMs;
  }
  return baseDelayMs;
}

export function nextRouteRefreshDelay(input: RouteRefreshInput): number {
  if (input.installationRoute && hasActiveManagedInstallation(input.routeDataJson)) {
    return input.installationDelayMs;
  }
  if (input.pinned || input.payloadChanged) return input.baseDelayMs;
  const previous = Math.max(input.previousDelayMs, input.baseDelayMs);
  return Math.min(previous * 2, Math.max(input.baseDelayMs, MAX_IDLE_REFRESH_MS));
}

export function hasActiveManagedInstallation(routeDataJson: string): boolean {
  if (!routeDataJson) return false;
  try {
    const snapshot: unknown = JSON.parse(routeDataJson);
    if (!isRecord(snapshot) || !Array.isArray(snapshot.installations)) return false;
    return snapshot.installations.some((operation) => {
      if (!isRecord(operation)) return false;
      const states = [
        operation.state,
        ...(Array.isArray(operation.targets)
          ? operation.targets.map((target) => (isRecord(target) ? target.state : ''))
          : []),
      ];
      return states.some((state) => (
        typeof state === 'string'
        && state.trim() !== ''
        && !TERMINAL_INSTALLATION_STATES.has(state.trim().toLowerCase())
      ));
    });
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
