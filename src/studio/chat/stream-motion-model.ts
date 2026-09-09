/** A short presentation buffer; transport and persisted text remain authoritative. */
export function advanceStreamText(current: string, target: string, elapsedMs: number): string {
  if (!target.startsWith(current)) return target;
  const remaining = target.length - current.length;
  if (!remaining) return target;
  const count = Math.max(1, Math.ceil(remaining * Math.min(1, elapsedMs / 80)));
  let end = Math.min(target.length, current.length + count);
  // Never expose half of an emoji/supplementary CJK code point.
  if (end < target.length && /[\uD800-\uDBFF]/.test(target[end - 1])) end += 1;
  return target.slice(0, end);
}

/** Time-based damping behaves the same on 60 Hz and 120 Hz displays. */
export function followStreamOffset(current: number, target: number, elapsedMs: number): number {
  'worklet';
  if (Math.abs(target - current) <= 0.5) return target;
  return current + (target - current) * (1 - Math.exp(-Math.min(elapsedMs, 64) / 65));
}

/** A flick toward history must keep its momentum even when it starts at the bottom. */
export function shouldResumeStreamFollow(distance: number, velocityY = 0): boolean {
  'worklet';
  return distance <= 24 && velocityY >= -0.01;
}
