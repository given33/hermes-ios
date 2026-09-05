import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const expo = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
const child = spawn(process.execPath, [expo, 'start', '--web', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, CI: 'false', EXPO_NO_BROWSER: '1', EXPO_PUBLIC_FRONTEND_PREVIEW: '1' },
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
