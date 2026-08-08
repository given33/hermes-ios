import { useCallback, useEffect, useMemo, useState } from 'react';

import type { HermesApiClient } from '../../api/HermesApiClient';
import { hermesStudioApiFor } from '../../api/hermes-api-registry';
import type {
  HermesStudioWorkflowHistoryItem,
  HermesStudioWorkflowRecord,
  HermesStudioWorkflowRunRecord,
} from '../../api/hermes-studio';

export interface HermesStudioWorkflowHistoryController {
  items: HermesStudioWorkflowHistoryItem[];
  loading: boolean;
  refresh(): Promise<void>;
}

/** Lightweight cross-route index used by the unified conversation history. */
export function useHermesStudioWorkflowHistory({
  client,
  enabled = true,
  fixtureMode = false,
  profile = 'default',
}: {
  client?: HermesApiClient;
  enabled?: boolean;
  fixtureMode?: boolean;
  profile?: string;
}): HermesStudioWorkflowHistoryController {
  const api = useMemo(() => client ? hermesStudioApiFor(client) : null, [client]);
  const [items, setItems] = useState<HermesStudioWorkflowHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!api) {
      setItems(fixtureMode ? fixtureHistory() : []);
      return;
    }
    setLoading(true);
    try {
      const workflows = await api.workflows.list(profile);
      const runGroups = await Promise.all(workflows.slice(0, 24).map(async (workflow) => ({
        workflow,
        runs: await api.workflows.listRuns(workflow.id, 20),
      })));
      setItems(toHistoryItems(runGroups));
    } catch {
      // The workflow page will show the detailed error. Conversation history
      // remains usable even if one optional history index request fails.
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [api, enabled, fixtureMode, profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, loading, refresh };
}

function toHistoryItems(groups: Array<{
  workflow: HermesStudioWorkflowRecord;
  runs: HermesStudioWorkflowRunRecord[];
}>): HermesStudioWorkflowHistoryItem[] {
  return groups
    .flatMap(({ workflow, runs }) => runs.map((run) => ({
      id: `workflow-run:${workflow.id}:${run.id}`,
      workflowId: workflow.id,
      runId: run.id,
      title: workflow.name,
      preview: run.error || run.status,
      profile: workflow.profile,
      updatedAt: run.updated_at || run.finished_at || run.started_at || run.created_at,
      status: run.status,
    })))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 100);
}

function fixtureHistory(): HermesStudioWorkflowHistoryItem[] {
  const now = Date.now();
  return [{
    id: 'workflow-run:preview-workflow:preview-run-1',
    workflowId: 'preview-workflow',
    runId: 'preview-run-1',
    title: 'Release checklist',
    preview: 'completed',
    profile: 'default',
    updatedAt: now - 65_000,
    status: 'completed',
  }];
}
