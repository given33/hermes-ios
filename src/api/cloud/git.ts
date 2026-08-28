import type { HermesCloudTransport, JsonRecord } from './transport';

/** Read-only and explicitly-confirmed Git operations exposed by Hermes. */
export class HermesGitCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  private query(path: string, extra: Record<string, string | number | boolean | undefined> = {}) {
    return { query: { path, ...extra } };
  }

  getStatus(path: string) { return this.transport.request<JsonRecord>('/api/git/status', this.query(path)); }
  getGhAuth(refresh = false) { return this.transport.request<JsonRecord>('/api/git/gh-auth', { query: { refresh } }); }
  getWorktrees(path: string) { return this.transport.request<JsonRecord>('/api/git/worktrees', this.query(path)); }
  getBranches(path: string) { return this.transport.request<JsonRecord>('/api/git/branches', this.query(path)); }
  getBaseBranches(path: string) { return this.transport.request<JsonRecord>('/api/git/base-branches', this.query(path)); }
  getReviewList(path: string, scope = 'uncommitted', base = '') { return this.transport.request<JsonRecord>('/api/git/review/list', this.query(path, { scope, base: base || undefined })); }
  getReviewDiff(path: string, file: string, scope = 'uncommitted', base = '', staged = false) { return this.transport.request<JsonRecord>('/api/git/review/diff', this.query(path, { file, scope, base: base || undefined, staged })); }
  getFileDiff(path: string, file: string) { return this.transport.request<JsonRecord>('/api/git/file-diff', this.query(path, { file })); }
  getCommitContext(path: string) { return this.transport.request<JsonRecord>('/api/git/review/commit-context', this.query(path)); }
  getRevParse(path: string, ref = '') { return this.transport.request<JsonRecord>('/api/git/review/rev-parse', this.query(path, { ref: ref || undefined })); }
  getShipInfo(path: string) { return this.transport.request<JsonRecord>('/api/git/review/ship-info', this.query(path)); }

  listPullRequests(path: string, branches: string[] = [], numbers: number[] = []) {
    return this.transport.json<JsonRecord>('/api/git/review/pr-list', 'POST', { path, branches, numbers });
  }
  stage(path: string, file: string) { return this.transport.json<JsonRecord>('/api/git/review/stage', 'POST', { path, file }); }
  unstage(path: string, file: string) { return this.transport.json<JsonRecord>('/api/git/review/unstage', 'POST', { path, file }); }
  revert(path: string, file: string) { return this.transport.json<JsonRecord>('/api/git/review/revert', 'POST', { path, file }); }
  commit(path: string, message: string, push = false) { return this.transport.json<JsonRecord>('/api/git/review/commit', 'POST', { path, message, push }); }
  push(path: string) { return this.transport.json<JsonRecord>('/api/git/review/push', 'POST', { path }); }
  createPullRequest(path: string) { return this.transport.json<JsonRecord>('/api/git/review/create-pr', 'POST', { path }); }
  addWorktree(path: string, options: { name?: string; branch?: string; base?: string; existingBranch?: string } = {}) { return this.transport.json<JsonRecord>('/api/git/worktree/add', 'POST', { path, ...options }); }
  removeWorktree(path: string, worktreePath: string, force = false) { return this.transport.json<JsonRecord>('/api/git/worktree/remove', 'POST', { path, worktreePath, force }); }
  switchBranch(path: string, branch: string) { return this.transport.json<JsonRecord>('/api/git/branch/switch', 'POST', { path, branch }); }
}
