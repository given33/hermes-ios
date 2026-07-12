export type SemanticVersion = [number, number, number];

export function normalizeVersion(version: string): SemanticVersion | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = normalizeVersion(candidate);
  const installed = normalizeVersion(current);
  if (!next || !installed) {
    return false;
  }

  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== installed[index]) {
      return next[index] > installed[index];
    }
  }

  return false;
}
