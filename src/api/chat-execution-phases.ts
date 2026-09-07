import type { HermesChatActivity, HermesChatViewMessage } from './chat-view-types';

type Report = NonNullable<HermesChatViewMessage['executionReports']>[number];
export function executionReportText(message: Pick<HermesChatViewMessage, 'rawRoleStage'>, content: string): string {
  if (!message.rawRoleStage?.startsWith('manager_planning') || !/^\s*(?:\{|```)/.test(content)) return content;
  try {
    const plan = JSON.parse(content.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''));
    if (!Array.isArray(plan.plan)) return '';
    const assignments = plan.plan.flatMap((item: { title?: unknown; assignee?: unknown }) =>
      typeof item.title === 'string' && typeof item.assignee === 'string'
        ? [`${item.assignee}: ${item.title}`] : []);
    return assignments.join('\n');
  } catch { return ''; }
}
export interface ChatExecutionPhase {
  id: string;
  reports: Report[];
  activities: HermesChatActivity[];
}

export function appendExecutionReport(reports: Report[] = [], report: Report): Report[] {
  const text = report.content.replace(/\s/g, '');
  if (!text || reports.some(item => item.id === report.id || item.content.replace(/\s/g, '') === text)) return reports;
  return [...reports, report];
}

/** A new model pass after tools begins a new phase; its report stays with that pass. */
export function chatExecutionPhases(message: HermesChatViewMessage): ChatExecutionPhase[] {
  const timeline = [
    ...(message.activities || []).map(activity => ({ at: activity.startedAt || 0, activity, report: undefined as Report | undefined })),
    ...(message.executionReports || []).map(report => ({ at: report.createdAt,
      report: { ...report, content: executionReportText(message, report.content) }, activity: undefined as HermesChatActivity | undefined })),
  ].sort((a, b) => a.at - b.at);
  const phases: ChatExecutionPhase[] = [];
  for (const item of timeline) {
    let phase = phases.at(-1);
    const afterTools = phase?.activities.some(activity => activity.category !== 'reasoning');
    if (!phase || (afterTools && (item.report || item.activity?.category === 'reasoning'))) {
      phase = { id: item.activity?.id || item.report!.id, reports: [], activities: [] };
      phases.push(phase);
    }
    if (item.activity) phase.activities.push(item.activity);
    else if (item.report) phase.reports.push(item.report);
  }
  if (['running', 'streaming'].includes(message.status || '') && message.content.trim()) {
    let phase = phases.at(-1);
    if (!phase || phase.activities.some(activity => activity.category !== 'reasoning')) {
      phase = { id: `report-live:${phases.length}`, reports: [], activities: [] };
      phases.push(phase);
    }
    phase.reports = appendExecutionReport(phase.reports, { id: 'report-live', content: executionReportText(message, message.content), createdAt: message.updatedAt || 0 });
  }
  return phases;
}
