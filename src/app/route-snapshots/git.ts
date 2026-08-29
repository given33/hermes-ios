import type { HermesSwiftUIGitSnapshot } from '../swiftui-route-contract';
import { isRecord, stringValue } from './support';

const MAX_JSON_BYTES = 120_000;

/**
 * Keep the native bridge bounded while preserving the official Git payload.
 * The desktop Git rail renders these same records; iOS only adds a compact
 * JSON presentation so new upstream fields remain visible without a client
 * release.
 */
export function gitSnapshot(
  source: unknown,
  cwd: string,
  root: string,
  branch: string,
  selectedFile = '',
): HermesSwiftUIGitSnapshot {
  const value = isRecord(source) ? source : {};
  return {
    cwd,
    root,
    branch,
    statusJSON: boundedJSON(value.status),
    branchesJSON: boundedJSON(value.branches),
    baseBranchesJSON: boundedJSON(value.baseBranches ?? value.base_branches),
    worktreesJSON: boundedJSON(value.worktrees),
    reviewJSON: boundedJSON(value.review ?? value.reviewList ?? value.review_list),
    shipInfoJSON: boundedJSON(value.shipInfo ?? value.ship_info),
    ...(value.ghAuth !== undefined ? { ghAuthJSON: boundedJSON(value.ghAuth) } : {}),
    ...(value.fileDiff !== undefined ? { fileDiffJSON: boundedJSON(value.fileDiff) } : {}),
    ...(value.commitContext !== undefined ? { commitContextJSON: boundedJSON(value.commitContext) } : {}),
    ...(value.revParse !== undefined ? { revParseJSON: boundedJSON(value.revParse) } : {}),
    ...(value.pullRequests !== undefined ? { pullRequestsJSON: boundedJSON(value.pullRequests) } : {}),
    ...(selectedFile ? { selectedFile } : {}),
    ...(value.diff !== undefined ? { diffJSON: boundedJSON(value.diff) } : {}),
  };
}

export function gitJSON(value: unknown): string {
  return boundedJSON(value);
}

export function gitPath(value: unknown): string {
  if (!isRecord(value)) return '';
  return stringValue(value.cwd) || stringValue(value.path) || stringValue(value.root);
}

function boundedJSON(value: unknown): string {
  if (value === undefined) return '';
  let encoded = '';
  try {
    encoded = JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
  if (encoded.length <= MAX_JSON_BYTES) return encoded;
  return `${encoded.slice(0, MAX_JSON_BYTES)}\n… (truncated by iOS)`;
}
