export function copyTargetWithRollback<T extends { delete(): void; exists: boolean }>(
  target: T,
  copy: (target: T) => void,
): void {
  try {
    copy(target);
  } catch (error) {
    try {
      if (target.exists) target.delete();
    } catch {
      // Preserve the copy failure; account purge will retry any undeletable cache residue.
    }
    throw error;
  }
}
