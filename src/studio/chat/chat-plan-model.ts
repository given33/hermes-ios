import type { HermesChatViewMessage } from '../../api/chat-view-types';
import { todoItemsFromActivity } from '../../api/chat-todo-model';

export type ChatPlanItemStatus = 'cancelled' | 'completed' | 'in_progress' | 'pending';

export interface ChatPlanItem {
  content: string;
  id: string;
  status: ChatPlanItemStatus;
}

export interface ChatPlan {
  completed: number;
  items: ChatPlanItem[];
  total: number;
  updatedAt: number;
}

/** Resolve the latest full todo-tool snapshot across the current conversation. */
export function latestChatPlan(messages: readonly HermesChatViewMessage[]): ChatPlan | null {
  const snapshots = messages.flatMap((message) => (
    (message.activities || []).flatMap((activity) => {
      const snapshot = todoItemsFromActivity(activity);
      if (!snapshot) return [];
      const items = snapshot.map((item) => ({
        content: item.title,
        id: item.id,
        status: item.status,
      }));
      return [{
        items,
        updatedAt: activity.completedAt
          || activity.startedAt
          || message.updatedAt
          || message.createdAt
          || 0,
      }];
    })
  ));
  const latest = snapshots.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  // An empty todo snapshot is a clear signal that no plan is active. Treat it
  // as absence instead of opening a full-width drawer that only says
  // “暂无计划”; the drawer is reserved for an actual model-generated plan.
  if (!latest || latest.items.length === 0) return null;
  return {
    completed: latest.items.filter(({ status }) => status === 'completed').length,
    items: latest.items,
    total: latest.items.length,
    updatedAt: latest.updatedAt,
  };
}
