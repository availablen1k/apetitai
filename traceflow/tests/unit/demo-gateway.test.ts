import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createDemoGateway } from '../../server/services/demoGateway.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-demo-gateway-'));
const dist = path.join(tmp, 'dist');
fs.mkdirSync(dist);
fs.writeFileSync(path.join(dist, 'index.html'), '<html>TraceFlow production build</html>');
fs.writeFileSync(path.join(dist, 'app.js'), 'console.log("asset")');
fs.writeFileSync(path.join(tmp, '.env'), 'BACKEND_SECRET=private');
fs.symlinkSync(path.join(tmp, '.env'), path.join(dist, 'outside.js'));
const password = 'unit-test-demo-password-123';
const authorization = `Basic ${Buffer.from(`jury:${password}`).toString('base64')}`;
const publicOrigin = 'https://jury-demo-test.trycloudflare.com';
let gateway: ReturnType<typeof createDemoGateway>;
let localUrl: string;
let apiUrl: string;
let seen: { method?: string; headers: http.IncomingHttpHeaders; body: string; url?: string }[] = [];
const api = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  seen.push({ method: req.method, headers: req.headers, body, url: req.url });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify({ ok: true, body }));
});
const listen = (server: http.Server) => new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => {
  const a = server.address();
  assert.ok(a && typeof a !== 'string');
  resolve(`http://127.0.0.1:${a.port}`);
}));
const close = (server: http.Server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
const request = (route: string, opts: { auth?: boolean; method?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
  const req = http.request(new URL(localUrl), { path: route, method: opts.method || 'GET', headers: { ...(opts.auth === false ? {} : { authorization }), ...opts.headers } }, (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
  });
  req.on('error', reject);
  req.end(opts.body);
});

before(async () => {
  apiUrl = await listen(api);
  gateway = createDemoGateway({ distDir: dist, apiUrl, username: 'jury', password, expiresAt: Date.now() + 60_000, sessionId: 'test-demo-session' });
  gateway.setPublicOrigin(publicOrigin);
  localUrl = await listen(gateway.server);
});
after(async () => { await close(gateway.server); await close(api); fs.rmSync(tmp, { recursive: true, force: true }); });

test('every entry point needs the password, including assets and the API', async () => {
  seen = [];
  for (const route of ['/', '/sustainability', '/app.js', '/api/health']) {
    const r = await request(route, { auth: false });
    assert.equal(r.status, 401);
    assert.match(String(r.headers['www-authenticate']), /Basic/);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal((await request('/', { headers: { authorization: 'Basic wrong' } })).status, 401);
  assert.equal(seen.length, 0);
});

test('serves the built app and deep links, never environment files, traversal or symlink escapes', async () => {
  for (const route of ['/', '/sustainability?year=2025', '/app.js']) assert.equal((await request(route)).status, 200);
  for (const route of ['/.env', '/%2eenv', '/data/traceflow.sqlite', '/app.js.map', '/outside.js', '/%2e%2e%2f.env']) assert.equal((await request(route)).status, 404, route);
  assert.equal((await request('//example.com/api/health')).status, 400);
  const head = await request('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});

test('only the explicitly registered tunnel host is accepted', async () => {
  assert.equal((await request('/', { headers: { host: new URL(publicOrigin).host } })).status, 200);
  assert.equal((await request('/', { headers: { host: 'attacker.trycloudflare.com' } })).status, 403);
  assert.equal((await request('/', { headers: { host: 'example.org' } })).status, 403);
  assert.throws(() => gateway.setPublicOrigin('https://example.org'), /generated HTTPS/);
});

test('blocks cross-origin requests and unauthenticated writes before reaching the API', async () => {
  seen = [];
  assert.equal((await request('/api/write', { method: 'POST', headers: { origin: 'https://attacker.test' }, body: 'bad' })).status, 403);
  assert.equal((await request('/api/write', { method: 'POST', body: 'missing origin' })).status, 403);
  assert.equal((await request('/api/read', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' } })).status, 403);
  assert.equal((await request('/api/write', { auth: false, method: 'POST', headers: { origin: localUrl } })).status, 401);
  assert.equal(seen.length, 0);
});

test('streams same-origin requests and strips credentials and forwarding headers at the local boundary', async () => {
  seen = [];
  const body = '--file-boundary\r\nDemo upload bytes\r\n--file-boundary--';
  const r = await request('/api/uploads?year=2025', { method: 'POST', headers: {
    host: new URL(publicOrigin).host, origin: publicOrigin, cookie: 'secret-cookie=private',
    'x-forwarded-host': 'attacker.test', 'content-type': 'multipart/form-data; boundary=file-boundary',
  }, body });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).body, body);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/uploads?year=2025');
  assert.equal(seen[0].headers.host, new URL(apiUrl).host);
  for (const header of ['authorization', 'cookie', 'origin', 'x-forwarded-host']) assert.equal(seen[0].headers[header], undefined);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('expired access stops serving both the frontend and API', async () => {
  const expiresAt = Date.now() + 30;
  const expiring = createDemoGateway({ distDir: dist, apiUrl, username: 'jury', password, expiresAt, sessionId: 'expiry' });
  const url = await listen(expiring.server);
  try {
    await new Promise((r) => setTimeout(r, 40));
    for (const route of ['/', '/api/health']) {
      const r = await fetch(url + route, { headers: { authorization } });
      assert.equal(r.status, 410);
      await r.arrayBuffer();
    }
  } finally { await close(expiring.server); }
});

test('rejects non-loopback proxy targets and weak credentials', () => {
  const opts = { distDir: dist, apiUrl, username: 'jury', password, expiresAt: Date.now() + 1000, sessionId: 'validation' };
  assert.throws(() => createDemoGateway({ ...opts, apiUrl: 'http://example.org' }), /loopback/);
  assert.throws(() => createDemoGateway({ ...opts, password: 'short' }), /16 characters/);
});
