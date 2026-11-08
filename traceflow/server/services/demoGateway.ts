// Optional, short-lived sharing boundary. The ordinary API keeps its loopback-only protections.
// Serve the production build only; never expose Vite, source files, .env or a directory listing.
import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream';

type Options = {
  distDir: string;
  apiUrl: string;
  username: string;
  password: string;
  expiresAt: number;
  sessionId: string;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const digest = (text: string) => createHash('sha256').update(text).digest();
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'content-length', 'range'];
const RESPONSE_HEADERS = ['content-type', 'content-length', 'content-disposition', 'content-encoding', 'content-range', 'accept-ranges'];

export function createDemoGateway(opts: Options) {
  const api = new URL(opts.apiUrl);
  if (api.protocol !== 'http:' || !LOOPBACK.has(api.hostname) || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
    throw new Error('The demo API URL must be an HTTP loopback origin.');
  }
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(opts.username) || opts.password.length < 16) throw new Error('Use a username and a password of at least 16 characters.');
  if (!Number.isFinite(opts.expiresAt) || opts.expiresAt <= Date.now()) throw new Error('The demo expiry must be in the future.');
  const root = fs.realpathSync(opts.distDir);
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Run npm run build before sharing the demo.');
  const expectedAuth = digest(`Basic ${Buffer.from(`${opts.username}:${opts.password}`).toString('base64')}`);
  let publicOrigin: string | null = null;

  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Traceflow-Demo-Id', opts.sessionId);
    const fail = (status: number, message: string) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(message);
    };
    if (Date.now() >= opts.expiresAt) return fail(410, 'This demo has ended.');
    let origin: string;
    try {
      const host = new URL(`http://${req.headers.host || ''}`);
      if (host.username || host.password || host.pathname !== '/' || host.search || host.hash) return fail(403, 'Host not allowed.');
      if (LOOPBACK.has(host.hostname)) origin = host.origin;
      else if (publicOrigin && host.host === new URL(publicOrigin).host) origin = publicOrigin;
      else return fail(403, 'Host not allowed.');
    } catch { return fail(403, 'Host not allowed.'); }
    // Check before removing Origin at the trusted local proxy boundary. Never accept arbitrary
    // origins, including requests trying to reuse cached browser Basic credentials cross-site.
    if (req.headers.origin && req.headers.origin !== origin) return fail(403, 'Origin not allowed.');
    if (req.headers['sec-fetch-site'] === 'cross-site' && !(req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate')) {
      return fail(403, 'Cross-site requests are not allowed.');
    }
    if (!timingSafeEqual(expectedAuth, digest(String(req.headers.authorization || '')))) {
      res.setHeader('WWW-Authenticate', 'Basic realm="TraceFlow jury demo", charset="UTF-8"');
      return fail(401, 'Enter the demo username and password.');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && req.headers.origin !== origin) return fail(403, 'A same-origin request is required.');

    let pathname: string;
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) return fail(400, 'Invalid path.');
      pathname = decodeURIComponent(new URL(req.url, origin).pathname);
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((part) => part.startsWith('.'))) return fail(404, 'Not found.');
    } catch { return fail(400, 'Invalid path.'); }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      // Whitelist headers: no demo password, cookies, forwarding headers or unvalidated Origin
      // reach the API. http.request sets Host to the explicit loopback target.
      const headers: http.OutgoingHttpHeaders = {};
      for (const key of REQUEST_HEADERS) if (req.headers[key] !== undefined) headers[key] = req.headers[key];
      const upstream = http.request(new URL(req.url!, api), { method: req.method, headers }, (response) => {
        for (const key of RESPONSE_HEADERS) if (response.headers[key] !== undefined) res.setHeader(key, response.headers[key]!);
        res.statusCode = response.statusCode || 502;
        pipeline(response, res, () => {});
      });
      upstream.setTimeout(300_000, () => upstream.destroy(new Error('Demo API timeout')));
      upstream.on('error', () => { if (!res.headersSent) fail(502, 'The local app is unavailable.'); else res.destroy(); });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
      req.pipe(upstream);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Method not allowed.');

    try {
      let file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(root + path.sep) && file !== root) return fail(404, 'Not found.');
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        // React Router routes have no extension. Missing assets and private paths never fall
        // back to HTML, and only files physically inside dist can be served.
        if (path.extname(pathname)) return fail(404, 'Not found.');
        file = path.join(root, 'index.html');
      }
      file = fs.realpathSync(file);
      if (!file.startsWith(root + path.sep)) return fail(404, 'Not found.');
      const ext = path.extname(file);
      if (!MIME[ext] || ext === '.map') return fail(404, 'Not found.');
      res.setHeader('Content-Type', MIME[ext]);
      res.setHeader('Content-Length', fs.statSync(file).size);
      if (req.method === 'HEAD') return res.end();
      pipeline(fs.createReadStream(file), res, () => {});
    } catch { fail(404, 'Not found.'); }
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 300_000;
  return {
    server,
    setPublicOrigin(origin: string) {
      const u = new URL(origin);
      if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(u.hostname) || u.port || u.pathname !== '/' || u.search || u.hash || u.username || u.password) {
        throw new Error('Expected a generated HTTPS trycloudflare.com origin.');
      }
      publicOrigin = u.origin;
    },
  };
}
