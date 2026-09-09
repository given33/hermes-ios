import type { HermesChatViewMessage } from '../../api/chat-view-model';

export interface ConversationTimelineEntry {
  id: string;
  prompt: string;
  length: number;
}

export interface ConversationTimelineAnchor { id: string; y: number }

/** Preserve the rail's identity while assistant tokens update the transcript. */
export function buildConversationTimeline(
  messages: readonly HermesChatViewMessage[],
  previous: readonly ConversationTimelineEntry[] = [],
): readonly ConversationTimelineEntry[] {
  const entries = messages.filter(message => message.role === 'user').map((message, index) => {
    const prompt = message.content.trim() || (message.attachments || []).map(item => item.name).join(', ');
    const id = message.renderKey || message.id;
    if (previous[index]?.id === id && previous[index].prompt === prompt) return previous[index];
    return { id, prompt, length: Array.from(prompt).length };
  });
  return entries.length === previous.length && entries.every((entry, index) => entry === previous[index])
    ? previous : entries;
}

export function timelineBarWidth(length: number, maximum: number): number {
  // Log compression keeps ordinary prompts distinct beside a very long paste.
  return 8 + 24 * Math.log1p(Math.max(0, Math.min(length, maximum)) / 40)
    / Math.log1p(Math.max(1, maximum) / 40);
}

export function timelineTurnAtOffset(anchors: readonly ConversationTimelineAnchor[], offset: number, maximumOffset = Infinity): string {
  'worklet';
  if (!anchors.length) return '';
  // The last prompt may never reach the viewport top when its reply is short.
  if (maximumOffset > 0 && offset >= maximumOffset - 2) return anchors[anchors.length - 1].id;
  let low = 0;
  let high = anchors.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (anchors[mid].y <= offset + 18) low = mid;
    else high = mid - 1;
  }
  return anchors[low].id;
}
