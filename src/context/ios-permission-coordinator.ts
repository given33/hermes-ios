import type {
  IOSAuthorizationState,
  IOSContextCapabilities,
} from '../../modules/hermes-ios-context';

export const IOS_PERMISSION_ORDER = [
  'location',
  'motion',
  'health',
  'calendar',
  'reminders',
  'screenTime',
  'notification',
] as const;

export type IOSPermissionKey = typeof IOS_PERMISSION_ORDER[number];
export type IOSPermissionPhase = 'idle' | 'requesting' | 'ready' | 'paused';

export interface IOSPermissionSnapshot {
  current: IOSPermissionKey | null;
  errors: Partial<Record<IOSPermissionKey, string>>;
  locationAlways: boolean;
  locationPrecise: boolean;
  permissions: Record<IOSPermissionKey, IOSAuthorizationState>;
  phase: IOSPermissionPhase;
}

export interface IOSPermissionRuntime {
  getCapabilities(): Promise<IOSContextCapabilities>;
  getLocationAuthorization(): Promise<IOSAuthorizationState>;
  getLocationAuthorizationDetails(): Promise<Record<string, unknown>>;
  requestLocationAuthorization(): Promise<IOSAuthorizationState>;
  requestPreciseLocation(): Promise<boolean>;
  getMotionAuthorization(): Promise<IOSAuthorizationState>;
  requestMotionAuthorization(): Promise<IOSAuthorizationState>;
  getHealthAuthorization(): Promise<IOSAuthorizationState>;
  requestHealthAuthorization(): Promise<IOSAuthorizationState>;
  getCalendarAuthorization(): Promise<IOSAuthorizationState>;
  requestCalendarAuthorization(): Promise<IOSAuthorizationState>;
  getReminderAuthorization(): Promise<IOSAuthorizationState>;
  requestReminderAuthorization(): Promise<IOSAuthorizationState>;
  getScreenTimeCapabilities(): Promise<Record<string, unknown>>;
  requestScreenTimeAuthorization(): Promise<IOSAuthorizationState>;
  getNotificationAuthorization(): Promise<IOSAuthorizationState>;
  requestNotificationAuthorization(): Promise<IOSAuthorizationState>;
}

export type IOSPermissionProgress = (snapshot: IOSPermissionSnapshot) => void;

const INITIAL_PERMISSIONS = Object.fromEntries(
  IOS_PERMISSION_ORDER.map((key) => [key, 'notDetermined']),
) as Record<IOSPermissionKey, IOSAuthorizationState>;

interface CachedPermissionRun {
  listeners: Set<IOSPermissionProgress>;
  promise: Promise<IOSPermissionSnapshot>;
  snapshot: IOSPermissionSnapshot;
  settled: boolean;
}

const permissionRuns = new Map<string, CachedPermissionRun>();

export function initialIOSPermissionSnapshot(): IOSPermissionSnapshot {
  return {
    current: null,
    errors: {},
    locationAlways: false,
    locationPrecise: false,
    permissions: { ...INITIAL_PERMISSIONS },
    phase: 'idle',
  };
}

/**
 * A single account-scoped run is shared by APNs registration and the native
 * collector provider. This prevents parent/child effects from presenting two
 * authorization prompts at once after authentication.
 */
export function ensureIOSPermissions(
  ownerScope: string,
  runtime: IOSPermissionRuntime,
  onProgress?: IOSPermissionProgress,
  forceRefresh = false,
): Promise<IOSPermissionSnapshot> {
  const key = ownerScope.trim() || 'anonymous';
  const existing = permissionRuns.get(key);
  if (existing && (!forceRefresh || !existing.settled)) {
    if (onProgress) {
      publishToListener(onProgress, existing.snapshot);
      if (!existing.settled) existing.listeners.add(onProgress);
    }
    return existing.promise.finally(() => {
      if (onProgress) existing.listeners.delete(onProgress);
    });
  }

  const cached: CachedPermissionRun = {
    listeners: new Set(onProgress ? [onProgress] : []),
    promise: Promise.resolve(initialIOSPermissionSnapshot()),
    snapshot: initialIOSPermissionSnapshot(),
    settled: false,
  };
  cached.promise = coordinateIOSPermissions(runtime, (snapshot) => {
    cached.snapshot = cloneSnapshot(snapshot);
    for (const listener of cached.listeners) publishToListener(listener, snapshot);
  }).finally(() => {
    cached.settled = true;
    cached.listeners.clear();
  });
  permissionRuns.set(key, cached);
  return cached.promise;
}

export function clearIOSPermissionRun(ownerScope: string): void {
  const key = ownerScope.trim() || 'anonymous';
  if (permissionRuns.get(key)?.settled) permissionRuns.delete(key);
}

export async function coordinateIOSPermissions(
  runtime: IOSPermissionRuntime,
  onProgress?: IOSPermissionProgress,
): Promise<IOSPermissionSnapshot> {
  let snapshot = initialIOSPermissionSnapshot();
  const publish = (next: IOSPermissionSnapshot) => {
    snapshot = next;
    onProgress?.(cloneSnapshot(next));
  };
  let capabilities: IOSContextCapabilities;
  try {
    capabilities = await runtime.getCapabilities();
  } catch (error) {
    const message = errorMessage(error);
    publish({
      ...snapshot,
      errors: Object.fromEntries(IOS_PERMISSION_ORDER.map((key) => [key, message])),
      permissions: Object.fromEntries(
        IOS_PERMISSION_ORDER.map((key) => [key, 'unavailable']),
      ) as Record<IOSPermissionKey, IOSAuthorizationState>,
      phase: 'ready',
    });
    return snapshot;
  }

  for (const key of IOS_PERMISSION_ORDER) {
    publish({ ...snapshot, current: key, phase: 'requesting' });
    try {
      const result = await resolvePermission(key, runtime, capabilities);
      publish({
        ...snapshot,
        ...(key === 'location' ? {
          locationAlways: result.locationAlways,
          locationPrecise: result.locationPrecise,
        } : {}),
        permissions: { ...snapshot.permissions, [key]: result.authorization },
      });
      // A system sheet is still awaiting a decision. Stop here so another
      // permission sheet is never queued over it; foreground retry resumes.
      if (result.authorization === 'notDetermined') {
        publish({ ...snapshot, current: key, phase: 'paused' });
        return snapshot;
      }
    } catch (error) {
      publish({
        ...snapshot,
        errors: { ...snapshot.errors, [key]: errorMessage(error) },
        permissions: { ...snapshot.permissions, [key]: 'unavailable' },
      });
    }
    await allowSystemSheetToDismiss();
  }

  publish({ ...snapshot, current: null, phase: 'ready' });
  return snapshot;
}

export function canCollectIOSPermission(
  snapshot: IOSPermissionSnapshot,
  key: IOSPermissionKey,
): boolean {
  const state = snapshot.permissions[key];
  if (key === 'location') {
    return snapshot.locationAlways && (state === 'authorized' || state === 'limited');
  }
  // Provisional notifications are deliverable, while EventKit write-only
  // access cannot be used by the calendar/reminder collectors.
  if (key === 'notification') return state === 'authorized' || state === 'limited';
  // HealthKit hides per-type read grants. "limited" means authorization was
  // requested and collectors should attempt each query without claiming that
  // every requested type was granted.
  if (key === 'health') return state === 'authorized' || state === 'limited';
  return state === 'authorized';
}

export function canStartIOSCollection(snapshot: IOSPermissionSnapshot): boolean {
  if (snapshot.phase === 'ready') return true;
  // An unresolved location sheet must keep the account-scoped native queue
  // closed. A later unrelated sheet may pause without disabling collectors
  // whose own authorization has already been granted.
  return snapshot.phase === 'paused' && snapshot.current !== 'location';
}

async function resolvePermission(
  key: IOSPermissionKey,
  runtime: IOSPermissionRuntime,
  capabilities: IOSContextCapabilities,
): Promise<{
  authorization: IOSAuthorizationState;
  locationAlways: boolean;
  locationPrecise: boolean;
}> {
  const plain = (authorization: IOSAuthorizationState) => ({
    authorization,
    locationAlways: false,
    locationPrecise: false,
  });

  switch (key) {
    case 'location': {
      if (!capabilities.location) return plain('unavailable');
      let authorization = normalizeAuthorization(await runtime.getLocationAuthorization());
      let details: Record<string, unknown> = await runtime
        .getLocationAuthorizationDetails()
        .catch(() => ({} as Record<string, unknown>));
      const alwaysBefore = details['always'] === true;
      if (authorization === 'notDetermined'
        || ((authorization === 'authorized' || authorization === 'limited') && !alwaysBefore)) {
        authorization = normalizeAuthorization(await runtime.requestLocationAuthorization());
        details = await runtime
          .getLocationAuthorizationDetails()
          .catch((): Record<string, unknown> => details);
      }
      const locationAllowed = authorization === 'authorized' || authorization === 'limited';
      const locationAlways = details['always'] === true;
      let locationPrecise = details['accuracy'] === 'full';
      if (locationAllowed && !locationPrecise) {
        locationPrecise = await runtime.requestPreciseLocation().catch(() => false);
        details = await runtime
          .getLocationAuthorizationDetails()
          .catch((): Record<string, unknown> => details);
        locationPrecise = locationPrecise || details['accuracy'] === 'full';
      }
      if (locationAllowed && (!locationAlways || !locationPrecise)) authorization = 'limited';
      return { authorization, locationAlways, locationPrecise };
    }
    case 'motion': {
      if (!capabilities.motion) return plain('unavailable');
      let authorization = normalizeAuthorization(await runtime.getMotionAuthorization());
      if (authorization === 'notDetermined') {
        authorization = normalizeAuthorization(await runtime.requestMotionAuthorization());
      }
      return plain(authorization);
    }
    case 'health': {
      if (!capabilities.health) return plain('unavailable');
      let authorization = normalizeAuthorization(await runtime.getHealthAuthorization());
      if (authorization === 'notDetermined') {
        authorization = normalizeAuthorization(await runtime.requestHealthAuthorization());
      }
      return plain(authorization);
    }
    case 'calendar': {
      if (!capabilities.calendar) return plain('unavailable');
      let authorization = normalizeAuthorization(await runtime.getCalendarAuthorization());
      if (authorization === 'notDetermined') {
        authorization = normalizeAuthorization(await runtime.requestCalendarAuthorization());
      }
      return plain(authorization);
    }
    case 'reminders': {
      if (!capabilities.reminders) return plain('unavailable');
      let authorization = normalizeAuthorization(await runtime.getReminderAuthorization());
      if (authorization === 'notDetermined') {
        authorization = normalizeAuthorization(await runtime.requestReminderAuthorization());
      }
      return plain(authorization);
    }
    case 'screenTime': {
      if (!capabilities.screenTime) return plain('unavailable');
      const screenTime = await runtime.getScreenTimeCapabilities();
      let authorization = normalizeAuthorization(screenTime['status']);
      if (authorization === 'notDetermined') {
        authorization = normalizeAuthorization(await runtime.requestScreenTimeAuthorization());
      }
      return plain(authorization);
    }
    case 'notification': {
      if (!capabilities.apns) return plain('unavailable');
      let authorization = normalizeAuthorization(await runtime.getNotificationAuthorization());
      if (authorization === 'notDetermined') {
        authorization = normalizeAuthorization(await runtime.requestNotificationAuthorization());
      }
      return plain(authorization);
    }
  }
}

function normalizeAuthorization(value: unknown): IOSAuthorizationState {
  switch (value) {
    case 'authorized':
    case 'denied':
    case 'limited':
    case 'notDetermined':
    case 'restricted':
    case 'unavailable':
      return value;
    case 'approved': return 'authorized';
    case 'provisional':
    case 'writeOnly': return 'limited';
    case 'entitlement-required': return 'unavailable';
    default: return 'unavailable';
  }
}

function cloneSnapshot(snapshot: IOSPermissionSnapshot): IOSPermissionSnapshot {
  return {
    ...snapshot,
    errors: { ...snapshot.errors },
    permissions: { ...snapshot.permissions },
  };
}

function publishToListener(
  listener: IOSPermissionProgress,
  snapshot: IOSPermissionSnapshot,
): void {
  try {
    listener(cloneSnapshot(snapshot));
  } catch {
    // A rendering subscriber must never interrupt the native authorization run.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function allowSystemSheetToDismiss(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250));
}
