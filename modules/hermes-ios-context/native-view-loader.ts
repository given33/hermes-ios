export interface NativeViewContractModule {
  getNativeViewContract?(): unknown;
}

export interface NativeViewContract {
  version: number;
  views: string[];
}

export function discoverNativeContextView<T>(
  module: NativeViewContractModule | null,
  viewName: string,
  requireView: (viewName: string) => T,
): T | null {
  if (!module) {
    return null;
  }

  try {
    return requireView(viewName);
  } catch {
    return null;
  }
}

export function readNativeViewContract(
  module: NativeViewContractModule | null,
): NativeViewContract {
  if (!module || typeof module.getNativeViewContract !== 'function') {
    return { version: 0, views: [] };
  }

  try {
    const contract = module.getNativeViewContract();
    if (!isRecord(contract)
      || !Number.isInteger(contract.version)
      || !Array.isArray(contract.views)) {
      return { version: 0, views: [] };
    }
    return {
      version: contract.version as number,
      views: contract.views.filter((value): value is string => typeof value === 'string'),
    };
  } catch {
    return { version: 0, views: [] };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
