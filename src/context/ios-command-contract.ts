export function predictedDepartureTimestamp(
  payload: Record<string, unknown>,
): number | null {
  const value = Object.prototype.hasOwnProperty.call(payload, 'timestamp')
    ? payload.timestamp
    : payload.departureAt ?? payload.departure_at;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('timestamp is required');
}

/**
 * The device-side policy envelope is intentionally small and serializable so
 * the backend can attach it to a command without coupling to Swift types.
 * Unknown actions default to read-only/no-confirmation and are still audited.
 */
export type IOSNativeActionRisk = 'read' | 'write' | 'destructive';
export type IOSNativeActionConfirmation = 'none' | 'required';

export interface IOSNativeActionMetadata {
  action_id: string;
  capability: string;
  action: string;
  risk: IOSNativeActionRisk;
  permission: string | null;
  confirmation: IOSNativeActionConfirmation;
  max_attempts: number;
  audit_kind: 'ios-action-audit';
}

export interface IOSNativeActionCommandLike {
  capability: string;
  action: string;
  payload?: Record<string, unknown>;
  action_metadata?: Partial<IOSNativeActionMetadata> | null;
}

const NATIVE_ACTION_POLICIES: Record<string, Partial<IOSNativeActionMetadata>> = {
  'ios-clipboard:read': {
    risk: 'read',
    confirmation: 'none',
  },
  'ios-clipboard:get': {
    risk: 'read',
    confirmation: 'none',
  },
  'ios-clipboard:write': {
    risk: 'write',
    confirmation: 'required',
  },
  'ios-clipboard:set': {
    risk: 'write',
    confirmation: 'required',
  },
  'ios-calendar:create': {
    risk: 'write',
    confirmation: 'required',
    permission: 'calendar',
  },
  'ios-calendar:calendars': { risk: 'read', confirmation: 'none', permission: 'calendar' },
  'ios-calendar:freebusy': { risk: 'read', confirmation: 'none', permission: 'calendar' },
  'ios-calendar:update': { risk: 'write', confirmation: 'required', permission: 'calendar' },
  'ios-calendar:delete': { risk: 'destructive', confirmation: 'required', permission: 'calendar' },
  'ios-reminders:create': {
    risk: 'write',
    confirmation: 'required',
    permission: 'reminders',
  },
  'ios-reminders:update': { risk: 'write', confirmation: 'required', permission: 'reminders' },
  'ios-reminders:complete': { risk: 'write', confirmation: 'required', permission: 'reminders' },
  'ios-reminders:delete': { risk: 'destructive', confirmation: 'required', permission: 'reminders' },
  'ios-notes:share-text': {
    risk: 'write',
    confirmation: 'required',
  },
  'ios-notification:schedule': {
    risk: 'write',
    confirmation: 'required',
    permission: 'notification',
  },
  'ios-notification:send': {
    risk: 'write',
    confirmation: 'required',
    permission: 'notification',
  },
  'ios-device:delete-account-data': {
    risk: 'destructive',
    confirmation: 'required',
  },
  'ios-contacts:list': { risk: 'read', confirmation: 'none', permission: 'contacts' },
  'ios-contacts:search': { risk: 'read', confirmation: 'none', permission: 'contacts' },
  'ios-contacts:create': { risk: 'write', confirmation: 'required', permission: 'contacts' },
  'ios-photos:list': { risk: 'read', confirmation: 'none', permission: 'photos' },
  'ios-photos:search': { risk: 'read', confirmation: 'none', permission: 'photos' },
  'ios-photos:capture': { risk: 'write', confirmation: 'required', permission: 'camera' },
  'ios-photos:scan': { risk: 'write', confirmation: 'required', permission: 'camera' },
  'ios-media:get': { risk: 'read', confirmation: 'none', permission: 'media' },
  'ios-media:control': { risk: 'write', confirmation: 'required', permission: 'media' },
  'ios-media:play': { risk: 'write', confirmation: 'required', permission: 'media' },
  'ios-media:resume': { risk: 'write', confirmation: 'required', permission: 'media' },
  'ios-media:pause': { risk: 'write', confirmation: 'required', permission: 'media' },
  'ios-media:next': { risk: 'write', confirmation: 'required', permission: 'media' },
  'ios-media:previous': { risk: 'write', confirmation: 'required', permission: 'media' },
  'ios-media:stop': { risk: 'write', confirmation: 'required', permission: 'media' },
  'ios-bluetooth:state': { risk: 'read', confirmation: 'none', permission: 'bluetooth' },
  'ios-bluetooth:scan': { risk: 'read', confirmation: 'none', permission: 'bluetooth' },
  'ios-nfc:scan': { risk: 'read', confirmation: 'required', permission: 'nfc' },
  'ios-homekit:list': { risk: 'read', confirmation: 'none', permission: 'homekit' },
  'ios-homekit:get': { risk: 'read', confirmation: 'none', permission: 'homekit' },
  'ios-homekit:set': { risk: 'write', confirmation: 'required', permission: 'homekit' },
  'ios-health-write:authorize': { risk: 'write', confirmation: 'required', permission: 'health' },
  'ios-health-write:write': { risk: 'write', confirmation: 'required', permission: 'health' },
  'ios-health-write:batch': { risk: 'write', confirmation: 'required', permission: 'health' },
  'ios-health-write:delete': { risk: 'destructive', confirmation: 'required', permission: 'health' },
  'ios-photos:ocr': { risk: 'read', confirmation: 'none', permission: 'photos' },
  'ios-photos:albums': { risk: 'read', confirmation: 'none', permission: 'photos' },
  'ios-photos:near': { risk: 'read', confirmation: 'none', permission: 'photos' },
  'ios-photos:export': { risk: 'read', confirmation: 'none', permission: 'photos' },
  'ios-photos:favorite': { risk: 'write', confirmation: 'required', permission: 'photos' },
  'ios-photos:delete': { risk: 'destructive', confirmation: 'required', permission: 'photos' },
  'ios-photos:album-create': { risk: 'write', confirmation: 'required', permission: 'photos' },
  'ios-photos:album-add': { risk: 'write', confirmation: 'required', permission: 'photos' },
  'ios-photos:import': { risk: 'write', confirmation: 'required', permission: 'photos' },
  'ios-vision:analyze': { risk: 'read', confirmation: 'none', permission: 'photos' },
  'ios-media:search': { risk: 'read', confirmation: 'none', permission: 'media' },
  'ios-media:play-search': { risk: 'write', confirmation: 'required', permission: 'media' },
  'ios-media:volume': { risk: 'write', confirmation: 'required', permission: 'media' },
  'ios-bluetooth:connect': { risk: 'write', confirmation: 'required', permission: 'bluetooth' },
  'ios-bluetooth:disconnect': { risk: 'write', confirmation: 'required', permission: 'bluetooth' },
  'ios-bluetooth:services': { risk: 'read', confirmation: 'none', permission: 'bluetooth' },
  'ios-bluetooth:read': { risk: 'read', confirmation: 'none', permission: 'bluetooth' },
  'ios-bluetooth:write': { risk: 'write', confirmation: 'required', permission: 'bluetooth' },
  'ios-bluetooth:notify': { risk: 'read', confirmation: 'none', permission: 'bluetooth' },
  'ios-nfc:write': { risk: 'write', confirmation: 'required', permission: 'nfc' },
  'ios-homekit:search': { risk: 'read', confirmation: 'none', permission: 'homekit' },
  'ios-homekit:scenes': { risk: 'read', confirmation: 'none', permission: 'homekit' },
  'ios-homekit:trigger': { risk: 'write', confirmation: 'required', permission: 'homekit' },
  'ios-device:open-url': { risk: 'write', confirmation: 'required', permission: 'device' },
};

const NATIVE_READ_ACTIONS = new Set([
  'get', 'latest', 'list', 'current', 'refresh', 'read', 'today', 'snapshot',
  'history', 'capabilities', 'evaluate', 'server', 'query', 'plan',
]);

export function nativeActionMetadata(
  command: IOSNativeActionCommandLike,
): IOSNativeActionMetadata {
  const key = `${command.capability}:${command.action}`;
  const policy = NATIVE_ACTION_POLICIES[key] || {};
  const supplied = command.action_metadata || {};
  const suppliedRisk = supplied.risk === 'read' || supplied.risk === 'write' || supplied.risk === 'destructive'
    ? supplied.risk
    : undefined;
  const inferredRisk = NATIVE_READ_ACTIONS.has(command.action.toLowerCase())
    ? 'read'
    : 'destructive';
  const hasKnownPolicy = Object.keys(policy).length > 0;
  const risk = hasKnownPolicy
    ? policy.risk || suppliedRisk || inferredRisk
    : inferredRisk;
  const suppliedConfirmation = supplied.confirmation === 'required' || supplied.confirmation === 'none'
    ? supplied.confirmation
    : undefined;
  // A server-supplied policy may add a confirmation requirement, but cannot
  // downgrade a device-known write/destructive action to no-confirmation.
  const confirmation = policy.confirmation === 'required' || (!hasKnownPolicy && inferredRisk === 'destructive')
    ? 'required'
    : suppliedConfirmation || 'none';
  const maxAttempts = Number.isInteger(supplied.max_attempts)
    && Number(supplied.max_attempts) > 0
    ? Math.min(10, Number(supplied.max_attempts))
    : 3;
  return {
    action_id: typeof supplied.action_id === 'string' && supplied.action_id.trim()
      ? supplied.action_id.trim()
      : `ios.${command.capability}.${command.action}`,
    capability: command.capability,
    action: command.action,
    risk,
    permission: policy.permission || (typeof supplied.permission === 'string'
      ? supplied.permission
      : null),
    confirmation,
    max_attempts: maxAttempts,
    audit_kind: 'ios-action-audit',
  };
}

export function hasIOSNativeActionConfirmation(
  command: IOSNativeActionCommandLike,
): boolean {
  const payload = command.payload || {};
  return payload.confirmed === true
    || payload.confirmation === 'approved'
    || (typeof payload.confirmation_token === 'string' && payload.confirmation_token.trim().length > 0);
}
