import { requireOptionalNativeModule } from 'expo';
import { isExpoGoParityBuild } from '../build-flags';

interface HermesQuickLookNativeModule {
  present(uri: string, title?: string): Promise<boolean>;
}

const nativeModule = isExpoGoParityBuild
  ? null
  : requireOptionalNativeModule<HermesQuickLookNativeModule>('HermesQuickLook');

export async function presentQuickLook(
  uri: string,
  title?: string,
): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.present(uri, title);
}
