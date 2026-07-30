const base = require('./app.base.json').expo;

module.exports = () => {
  const buildProfile = String(process.env.EAS_BUILD_PROFILE || '').trim();
  const distributableBuild = process.env.HERMES_DISTRIBUTABLE_BUILD === '1'
    || ['development', 'preview', 'production'].includes(buildProfile);
  const frontendPreview = String(process.env.EXPO_PUBLIC_FRONTEND_PREVIEW || '').trim();
  const amapIOSAPIKey = String(process.env.HERMES_AMAP_IOS_API_KEY || '').trim();
  const bundleIdentifier = String(base.ios.bundleIdentifier || '').trim();
  const localDevelopmentBuild = !distributableBuild && process.env.NODE_ENV !== 'production';
  const apnsEnvironment = buildProfile === 'development' || localDevelopmentBuild
    ? 'development'
    : 'production';

  if (distributableBuild && frontendPreview !== '0') {
    throw new Error(
      'Distributable iOS builds require EXPO_PUBLIC_FRONTEND_PREVIEW=0.',
    );
  }
  return {
    ...base,
    ios: {
      ...base.ios,
      entitlements: {
        ...base.ios.entitlements,
        'aps-environment': apnsEnvironment,
      },
      infoPlist: {
        ...base.ios.infoPlist,
        // AMap's iOS SDK uses an app-bound key. Keep it outside Git. Builds
        // without the optional key retain the native MapKit fallback.
        HermesAmapIOSAPIKey: amapIOSAPIKey,
        HermesAmapIOSBundleIdentifier: bundleIdentifier,
      },
    },
  };
};
