import type { HermesChatViewMessage as Message } from './chat-view-types';

/** Keep this device's send/receive boundaries separate from server model time. */
export function observeChatDelivery(next: Message[], previous: readonly Message[], now = Date.now()): Message[] {
  const byId = new Map(previous.map((message) => [message.id, message]));
  const byRenderKey = new Map(previous.filter((message) => message.renderKey)
    .map((message) => [message.renderKey, message]));
  const submitted = new Map<string, number>();
  for (const message of [...previous, ...next]) {
    if (message.runtimeTurnId && message.submittedAt) submitted.set(message.runtimeTurnId, message.submittedAt);
  }
  return next.map((message) => {
    const prior = byId.get(message.id) || byRenderKey.get(message.renderKey) || previous.find((candidate) => (
      message.role === 'assistant' && candidate.role === message.role
      && message.runtimeTurnId && candidate.runtimeTurnId === message.runtimeTurnId
      && candidate.roleStage === message.roleStage
      && (message.roleStage === 'chat' || (
        candidate.rawRoleStage === message.rawRoleStage
        && candidate.memberId === message.memberId && candidate.profile === message.profile
      ))
    ));
    const submittedAt = message.submittedAt || prior?.submittedAt || submitted.get(message.runtimeTurnId || '');
    if (!submittedAt) return message;
    if (message.role === 'user') return { ...message, submittedAt };
    const hasOutput = Boolean(message.content.trim() || message.activities?.some((activity) => (
      activity.category === 'reasoning' && (activity.output?.trim() || activity.preview?.trim())
    )));
    const firstObservedAt = prior?.firstObservedAt || message.firstObservedAt || (hasOutput ? now : undefined);
    const terminal = ['completed', 'failed', 'cancelled', 'stopped'].includes(message.status || '');
    return {
      ...message,
      submittedAt,
      firstObservedAt,
      completedObservedAt: prior?.completedObservedAt || message.completedObservedAt || (terminal ? now : undefined),
    };
  });
}
