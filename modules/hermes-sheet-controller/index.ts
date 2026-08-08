import { requireOptionalNativeModule } from 'expo';
import { isExpoGoParityBuild } from '../build-flags';

interface HermesSheetControllerNativeModule {
  configure(): Promise<boolean>;
}

const nativeModule = isExpoGoParityBuild
  ? null
  : requireOptionalNativeModule<HermesSheetControllerNativeModule>('HermesSheetController');

export async function configurePresentedSheet(): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.configure();
}
