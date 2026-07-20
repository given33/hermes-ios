const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
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

const proxyTargetValue = process.env.HERMES_WEB_PROXY_TARGET?.trim();
if (proxyTargetValue) {
  const proxyTarget = new URL(proxyTargetValue);
  if (
    !['http:', 'https:'].includes(proxyTarget.protocol)
    || proxyTarget.username
    || proxyTarget.password
    || proxyTarget.pathname !== '/'
    || proxyTarget.search
    || proxyTarget.hash
  ) {
    throw new Error('HERMES_WEB_PROXY_TARGET must be a root HTTP(S) origin');
  }
  const transport = proxyTarget.protocol === 'https:' ? https : http;
  const previousEnhancer = config.server?.enhanceMiddleware;
  config.server = {
    ...config.server,
    enhanceMiddleware(middleware, metroServer) {
      const nextMiddleware = previousEnhancer
        ? previousEnhancer(middleware, metroServer)
        : middleware;
      return (request, response, next) => {
        const requestPath = request.url || '/';
        if (!requestPath.startsWith('/api/') && !requestPath.startsWith('/auth/')) {
          return nextMiddleware(request, response, next);
        }
        const headers = {
          ...request.headers,
          host: proxyTarget.host,
          origin: proxyTarget.origin,
        };
        delete headers.connection;
        const upstream = transport.request(
          {
            protocol: proxyTarget.protocol,
            hostname: proxyTarget.hostname,
            port: proxyTarget.port || undefined,
            method: request.method,
            path: requestPath,
            headers,
          },
          (upstreamResponse) => {
            response.writeHead(
              upstreamResponse.statusCode || 502,
              upstreamResponse.headers,
            );
            upstreamResponse.pipe(response);
          },
        );
        upstream.on('error', () => {
          if (response.headersSent) {
            response.destroy();
            return;
          }
          response.writeHead(502, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ detail: 'Hermes development proxy unavailable' }));
        });
        request.pipe(upstream);
      };
    },
  };
}

module.exports = config;
