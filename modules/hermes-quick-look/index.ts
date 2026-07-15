import { requireOptionalNativeModule } from 'expo';

interface HermesQuickLookNativeModule {
  present(uri: string, title?: string): Promise<boolean>;
}

const nativeModule = requireOptionalNativeModule<HermesQuickLookNativeModule>(
  'HermesQuickLook',
);

export async function presentQuickLook(
  uri: string,
  title?: string,
): Promise<boolean> {
  if (!nativeModule) return false;
  return nativeModule.present(uri, title);
}
