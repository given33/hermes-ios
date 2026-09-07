import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const expo = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
const expoPort = Number(process.env.HERMES_EXPO_PORT || 8084);
const proxyPort = Number(process.env.HERMES_PROXY_PORT || 8082);
const backend = new URL(process.env.HERMES_WEB_PROXY_TARGET || 'https://daxueshenmai.top');
if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password
  || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('Expected a backend origin');
const expoOrigin = new URL(`http://127.0.0.1:${expoPort}`);
const targetFor = (url = '/') => /^\/(api|auth|socket\.io)(\/|\?|$)/.test(url) ? backend : expoOrigin;
const transportFor = target => target.protocol === 'https:' ? https : http;
const headersFor = (request, target) => ({ ...request.headers, host: target.host,
  ...(target === backend ? { origin: target.origin } : {}) });

const server = http.createServer((request, response) => {
  const target = targetFor(request.url);
  const upstream = transportFor(target).request(new URL(request.url || '/', target), {
    method: request.method, headers: headersFor(request, target),
  }, remote => {
    response.writeHead(remote.statusCode || 502, remote.headers);
    response.flushHeaders();
    remote.pipe(response);
    response.on('close', () => remote.destroy());
  });
  upstream.on('error', () => {
    if (response.destroyed) return;
    if (response.headersSent) { response.destroy(); return; }
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ detail: 'Hermes preview upstream unavailable' }));
  });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
});

server.on('upgrade', (request, socket, head) => {
  const target = targetFor(request.url);
  const upstream = transportFor(target).request(new URL(request.url || '/', target), {
    method: 'GET', headers: headersFor(request, target),
  });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    const headerLines = response.rawHeaders.reduce((lines, value, index, all) => {
      if (index % 2 === 0) lines.push(`${value}: ${all[index + 1]}`);
      return lines;
    }, []);
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${headerLines.join('\r\n')}\r\n\r\n`);
    if (remoteHead.length) socket.write(remoteHead);
    if (head.length) remote.write(head);
    socket.pipe(remote).pipe(socket);
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
    socket.on('close', () => remote.destroy());
    remote.on('close', () => socket.destroy());
  });
  upstream.on('response', response => { response.resume(); socket.destroy(); });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  upstream.end();
});

const expoProcess = spawn(process.execPath, [expo, 'start', '--web', '--port', String(expoPort), '--localhost'], {
  stdio: 'inherit', env: { ...process.env, CI: 'false', EXPO_NO_BROWSER: '1',
    EXPO_PUBLIC_FRONTEND_PREVIEW: '0', EXPO_PUBLIC_HERMES_URL: `http://localhost:${proxyPort}`,
    EXPO_PUBLIC_HERMES_ALLOW_HTTP: '1', HERMES_WEB_PROXY_TARGET: '' },
});
server.listen(proxyPort, '127.0.0.1', () => console.log(`Hermes Expo preview: http://localhost:${proxyPort}`));
server.on('error', error => { console.error(error.message); expoProcess.kill(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); expoProcess.kill(); });
expoProcess.on('exit', code => { server.close(); process.exit(code || 0); });
