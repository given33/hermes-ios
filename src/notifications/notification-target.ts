export interface HermesNotificationTarget {
  notificationId: string;
  conversationId: string;
  turnId?: string;
  status?: string;
}

export function parseHermesNotificationResponse(
  response: unknown,
): HermesNotificationTarget | null {
  if (!isRecord(response) || !isRecord(response.notification)) return null;
  const request = isRecord(response.notification.request)
    ? response.notification.request
    : null;
  if (!request) return null;
  const identifier = clean(request.identifier);
  const content = isRecord(request.content) ? request.content : null;
  const trigger = isRecord(request.trigger) ? request.trigger : null;
  const candidates = [content?.data, trigger?.payload];
  for (const candidate of candidates) {
    const target = parseHermesNotificationPayload(candidate, identifier);
    if (target) return target;
  }
  return null;
}

export function parseHermesNotificationPayload(
  payload: unknown,
  notificationId = '',
): HermesNotificationTarget | null {
  if (!isRecord(payload)) return null;
  const hermes = isRecord(payload.hermes) ? payload.hermes : payload;
  const deepLink = clean(hermes.deep_link);
  const deepLinkTarget = parseHermesDeepLink(deepLink);
  if (deepLink && !deepLinkTarget) return null;
  const explicitConversationId = boundedId(hermes.conversation_id);
  if (
    explicitConversationId
    && deepLinkTarget
    && explicitConversationId !== deepLinkTarget.conversationId
  ) {
    return null;
  }
  const conversationId = explicitConversationId || deepLinkTarget?.conversationId || '';
  if (!conversationId) return null;
  const turnId = boundedId(hermes.turn_id) || deepLinkTarget?.turnId;
  const status = clean(hermes.status).slice(0, 32);
  return {
    notificationId: clean(notificationId).slice(0, 256)
      || `${conversationId}:${turnId || 'conversation'}`,
    conversationId,
    ...(turnId ? { turnId } : {}),
    ...(status ? { status } : {}),
  };
}

function parseHermesDeepLink(
  value: string,
): Pick<HermesNotificationTarget, 'conversationId' | 'turnId'> | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'hermes-agent:' || url.hostname !== 'conversation') return null;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
  const conversationId = boundedId(decodedPath);
  if (!conversationId) return null;
  const turnId = boundedId(url.searchParams.get('turn'));
  return { conversationId, ...(turnId ? { turnId } : {}) };
}

function boundedId(value: unknown): string {
  const id = clean(value);
  if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) return '';
  return id;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
