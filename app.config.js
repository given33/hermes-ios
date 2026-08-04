const base = require('./app.base.json').expo;

module.exports = () => {
  const buildProfile = String(process.env.EAS_BUILD_PROFILE || '').trim();
  const resignCompatibleBuild = process.env.HERMES_RESIGN_COMPAT_BUILD === '1';
  const distributableBuild = process.env.HERMES_DISTRIBUTABLE_BUILD === '1'
    || ['development', 'preview', 'production'].includes(buildProfile);
  const frontendPreview = String(process.env.EXPO_PUBLIC_FRONTEND_PREVIEW || '').trim();
  const amapIOSAPIKey = String(process.env.HERMES_AMAP_IOS_API_KEY || '').trim();
  const expoProjectId = String(process.env.EXPO_PROJECT_ID || '').trim();
  const ciBuildNumber = String(process.env.HERMES_CI_BUILD_NUMBER || '').trim();
  const bundleIdentifier = String(base.ios.bundleIdentifier || '').trim();
  if (expoProjectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expoProjectId)) {
    throw new Error('EXPO_PROJECT_ID must be the UUID of the already initialized EAS project.');
  }
  const localDevelopmentBuild = !distributableBuild && process.env.NODE_ENV !== 'production';
  const apnsEnvironment = buildProfile === 'development' || localDevelopmentBuild
    ? 'development'
    : 'production';
  const plugins = resignCompatibleBuild
    ? base.plugins.filter((plugin) => plugin !== './plugins/with-hermes-native-extensions.js')
    : base.plugins;
  const {
    'com.apple.developer.family-controls': _familyControls,
    'com.apple.security.application-groups': _applicationGroups,
    'keychain-access-groups': _keychainAccessGroups,
    ...resignCompatibleEntitlements
  } = base.ios.entitlements;
  const {
    HermesSharedKeychainAccessGroup: _sharedKeychainAccessGroup,
    ...resignCompatibleInfoPlist
  } = base.ios.infoPlist;

  if (distributableBuild && frontendPreview !== '0') {
    throw new Error(
      'Distributable iOS builds require EXPO_PUBLIC_FRONTEND_PREVIEW=0.',
    );
  }
  if (ciBuildNumber && !/^[1-9][0-9]{0,17}$/.test(ciBuildNumber)) {
    throw new Error(
      'HERMES_CI_BUILD_NUMBER must be a positive iOS build number with at most 18 digits.',
    );
  }
  return {
    ...base,
    plugins,
    extra: {
      ...base.extra,
      hermesResignCompatible: resignCompatibleBuild,
      ...(expoProjectId
        ? { eas: { ...base.extra?.eas, projectId: expoProjectId } }
        : {}),
    },
    ios: {
      ...base.ios,
      ...(ciBuildNumber ? { buildNumber: ciBuildNumber } : {}),
      entitlements: {
        ...(resignCompatibleBuild ? resignCompatibleEntitlements : base.ios.entitlements),
        'aps-environment': apnsEnvironment,
      },
      infoPlist: {
        ...(resignCompatibleBuild ? resignCompatibleInfoPlist : base.ios.infoPlist),
        HermesResignCompatible: resignCompatibleBuild,
        // AMap's iOS SDK uses an app-bound key. Keep it outside Git. Builds
        // without the optional key retain the native MapKit fallback.
        HermesAmapIOSAPIKey: amapIOSAPIKey,
        HermesAmapIOSBundleIdentifier: bundleIdentifier,
      },
    },
  };
};
