import { requireOptionalNativeModule } from 'expo';

interface HermesSheetControllerNativeModule {
  configure(): Promise<boolean>;
}

const nativeModule = requireOptionalNativeModule<HermesSheetControllerNativeModule>(
  'HermesSheetController',
);

export async function configurePresentedSheet(): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.configure();
}
