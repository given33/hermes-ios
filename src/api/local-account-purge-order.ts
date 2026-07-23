export interface LocalAccountPurgePhases {
  purgeData(): Promise<void>;
  revokeEncryptionKey(): Promise<void>;
}

export async function runLocalAccountPurgePhases(
  phases: LocalAccountPurgePhases,
): Promise<void> {
  let revokeFailed = false;
  let revokeFailure: unknown;
  let purgeFailed = false;
  let purgeFailure: unknown;

  try {
    await phases.revokeEncryptionKey();
  } catch (error) {
    revokeFailed = true;
    revokeFailure = error;
  }

  try {
    await phases.purgeData();
  } catch (error) {
    purgeFailed = true;
    purgeFailure = error;
  }

  // Always attempt both phases, but keep the operation pending until key
  // revocation and data cleanup have each completed successfully.
  if (revokeFailed) throw revokeFailure;
  if (purgeFailed) throw purgeFailure;
}
