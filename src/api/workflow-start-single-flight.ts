export interface WorkflowStartFlight<T> {
  leader: boolean;
  promise: Promise<T>;
  requestId: string;
}

interface WorkflowStartEntry {
  active?: Promise<unknown>;
  requestId: string;
}

export class WorkflowStartSingleFlight {
  private readonly entries = new Map<string, WorkflowStartEntry>();

  run<T>(
    workflowId: string,
    proposedRequestId: string,
    operation: (requestId: string) => Promise<T>,
  ): WorkflowStartFlight<T> {
    const key = workflowId.trim();
    const candidate = proposedRequestId.trim();
    if (!key) throw new Error('Workflow id is required');
    if (!candidate) throw new Error('Workflow start request id is required');

    let entry = this.entries.get(key);
    if (!entry) {
      entry = { requestId: candidate };
      this.entries.set(key, entry);
    }
    if (entry.active) {
      return {
        leader: false,
        promise: entry.active as Promise<T>,
        requestId: entry.requestId,
      };
    }

    const started = Promise.resolve().then(() => operation(entry.requestId));
    let active!: Promise<T>;
    active = started.then(
      (result) => {
        if (entry.active === active) this.entries.delete(key);
        return result;
      },
      (error: unknown) => {
        if (entry.active === active) entry.active = undefined;
        throw error;
      },
    );
    entry.active = active;
    return { leader: true, promise: active, requestId: entry.requestId };
  }
}
