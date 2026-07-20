export interface NativeViewContractModule {
  getNativeViewContract?(): unknown;
}

export interface NativeViewContract {
  version: number;
  views: string[];
}

export interface NativeViewRuntime {
  getViewConfig?(moduleName: string, viewName?: string): unknown;
  viewManagersMetadata?: unknown;
}

export function discoverRegisteredNativeView<T>(
  module: object | null,
  runtime: NativeViewRuntime,
  moduleName: string,
  viewName: string | undefined,
  requireView: (moduleName: string, viewName?: string) => T,
): T | null {
  if (!module || !isNativeViewRegistered(runtime, moduleName, viewName)) {
    return null;
  }

  try {
    return requireView(moduleName, viewName);
  } catch {
    return null;
  }
}

export function isNativeViewRegistered(
  runtime: NativeViewRuntime,
  moduleName: string,
  viewName?: string,
): boolean {
  if (!isRecord(runtime.viewManagersMetadata)
    || typeof runtime.getViewConfig !== 'function') {
    return false;
  }

  const metadataKey = viewName ? `${moduleName}_${viewName}` : moduleName;
  if (!isRecord(runtime.viewManagersMetadata[metadataKey])) {
    return false;
  }

  try {
    const config = runtime.getViewConfig(moduleName, viewName);
    return isRecord(config)
      && isRecord(config.validAttributes)
      && isRecord(config.directEventTypes);
  } catch {
    return false;
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
