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
  'ios-reminders:create': {
    risk: 'write',
    confirmation: 'required',
    permission: 'reminders',
  },
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
