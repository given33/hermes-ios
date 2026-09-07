import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const expo = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
const portIndex = process.argv.indexOf('--port');
const previewPort = portIndex < 0 ? 8081 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) {
  throw new Error('--port must be an integer between 1 and 65535');
}
const child = spawn(process.execPath, [expo, 'start', '--web', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CI: 'false',
    EXPO_NO_BROWSER: '1',
    EXPO_PUBLIC_FRONTEND_PREVIEW: '0',
    EXPO_PUBLIC_HERMES_URL: `http://localhost:${previewPort}`,
    EXPO_PUBLIC_HERMES_ALLOW_HTTP: '1',
    HERMES_WEB_PROXY_TARGET: process.env.HERMES_WEB_PROXY_TARGET || 'https://daxueshenmai.top',
  },
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
