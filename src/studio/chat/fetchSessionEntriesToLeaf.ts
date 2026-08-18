import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type { ConversationSessionEntriesResponse } from '../../api/cloud/contracts';

/**
 * Fetch session entries page-by-page until the leaf.
 *
 * The server returns up to `limit` entries after a cursor; a FULL page means
 * more may follow. First-open previously took a single 2000-entry page, so
 * longer conversations rendered partial history/Todos until later activity
 * pushed the tail in. This helper loops while pages come back full (bounded
 * by maxPages), respecting the caller's AbortSignal.
 */
export const SESSION_ENTRIES_PAGE_SIZE = 2_000;
const SESSION_ENTRIES_MAX_PAGES = 50;

export interface SessionEntriesFetchState {
  resetCursor: boolean;
  abortSignal?: AbortSignal;
}

export async function fetchSessionEntriesToLeaf(
  cloudApi: HermesCloudApi,
  conversationId: string,
  startCursor: number,
  signal?: AbortSignal,
): Promise<ConversationSessionEntriesResponse | null> {
  let current = await cloudApi.getConversationSessionEntries(
    conversationId,
    startCursor,
    SESSION_ENTRIES_PAGE_SIZE,
    signal,
  ).catch(() => null);
  if (!current) return null;
  let lastPageCount = current.entries.length;
  let pages = 1;
  // A full LAST page is the only "maybe more" signal the protocol offers —
  // the accumulated total keeps growing, so gate on lastPageCount.
  while (
    lastPageCount >= SESSION_ENTRIES_PAGE_SIZE
    && pages < SESSION_ENTRIES_MAX_PAGES
    && !(signal?.aborted)
    && !current.reset_cursor
  ) {
    const nextCursor = Math.max(0, Math.floor(current.cursor || 0));
    if (nextCursor <= Math.max(0, Math.floor(startCursor)) && pages > 1) break;
    const page = await cloudApi.getConversationSessionEntries(
      conversationId,
      nextCursor,
      SESSION_ENTRIES_PAGE_SIZE,
      signal,
    ).catch(() => null);
    if (!page || page.entries.length === 0) break;
    lastPageCount = page.entries.length;
    current = {
      ...page,
      entries: [...current.entries, ...page.entries],
    };
    pages += 1;
  }
  return current;
}
