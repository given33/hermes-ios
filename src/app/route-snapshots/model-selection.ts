export function encodeModelSelection(provider: string, model: string): string {
  return JSON.stringify([provider, model]);
}

export function decodeModelSelection(value: string): { model: string; provider: string } | null {
  try {
    const decoded = JSON.parse(value) as unknown;
    if (
      !Array.isArray(decoded)
      || decoded.length !== 2
      || decoded.some((part) => typeof part !== 'string' || !part)
    ) {
      return null;
    }
    return { provider: decoded[0], model: decoded[1] };
  } catch {
    return null;
  }
}
