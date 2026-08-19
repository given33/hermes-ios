/**
 * Truncate by code points instead of UTF-16 code units.
 *
 * `String.slice` can split a surrogate pair (emoji, CJK extension chars)
 * at the boundary; the orphaned half then leaks into native bridges,
 * clipboard content, and notifications, where it renders as � or crashes
 * strict JSON encoders. Every user-visible truncation should go through
 * here.
 */
export function truncateByCodePoints(text: string, maxCodePoints: number): string {
  if (maxCodePoints <= 0) return '';
  // Array.from iterates code points, so slicing it never splits a pair.
  // The spread limit guards against pathological inputs: for ASCII text
  // Array.from(text) === text and we take the fast path.
  if (text.length <= maxCodePoints) return text;
  return Array.from(text).slice(0, maxCodePoints).join('');
}
