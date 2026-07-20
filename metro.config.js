const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const productionFixtures = path.resolve(
  __dirname,
  'src/preview/production-fixtures.ts',
);
const productionRouteStubs = path.resolve(
  __dirname,
  'src/preview/production-route-stubs.tsx',
);
const productionPreviewLocalization = path.resolve(
  __dirname,
  'src/i18n/production-preview-localization.ts',
);
const previewRouteModule = /(?:^|\/)Preview(?:Automation|Core|Plugin|Settings)Pages$/;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    process.env.EXPO_PUBLIC_FRONTEND_PREVIEW !== '1'
    && (moduleName === './preview-fixtures' || moduleName.endsWith('/preview-fixtures'))
  ) {
    return context.resolveRequest(context, productionFixtures, platform);
  }
  if (
    process.env.EXPO_PUBLIC_FRONTEND_PREVIEW !== '1'
    && previewRouteModule.test(moduleName.replaceAll('\\', '/'))
  ) {
    return context.resolveRequest(context, productionRouteStubs, platform);
  }
  if (
    process.env.EXPO_PUBLIC_FRONTEND_PREVIEW !== '1'
    && (moduleName === './preview-localization' || moduleName.endsWith('/preview-localization'))
  ) {
    return context.resolveRequest(context, productionPreviewLocalization, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
