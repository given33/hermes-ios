export interface MutablePlaintextDirectory {
  readonly exists: boolean;
  create(options: { idempotent: boolean; intermediates: boolean }): void;
  delete(): void;
}

export interface PlaintextDirectoryLifecycle {
  initialized: boolean;
}

export function initializePlaintextDirectory(
  directory: MutablePlaintextDirectory,
  lifecycle: PlaintextDirectoryLifecycle,
): void {
  if (lifecycle.initialized) return;
  if (directory.exists) directory.delete();
  directory.create({ idempotent: true, intermediates: true });
  lifecycle.initialized = true;
}
