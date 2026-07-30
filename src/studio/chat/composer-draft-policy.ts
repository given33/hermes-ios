export const LARGE_PASTE_CHARACTER_THRESHOLD = 8_000;

export function isLargePaste(previous: string, next: string): boolean {
  const inserted = next.length - previous.length;
  return next.length >= LARGE_PASTE_CHARACTER_THRESHOLD
    && inserted >= Math.floor(LARGE_PASTE_CHARACTER_THRESHOLD * 0.75);
}

export function largePasteMarker(content: string, name: string, isChinese: boolean): string {
  const preview = content.trim().slice(0, 240);
  const suffix = isChinese
    ? `[完整粘贴内容已转为附件：${name}]`
    : `[Full pasted text attached: ${name}]`;
  return preview ? `${preview}${content.trim().length > preview.length ? '…' : ''}\n\n${suffix}` : suffix;
}
