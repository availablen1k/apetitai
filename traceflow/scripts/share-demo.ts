// Share the existing local app through an expiring, password-protected Cloudflare tunnel.
// No changes to the app's Host/Origin allowlists or backend secrets are needed.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { loadConfig } from '../server/config.ts';
import { createDemoGateway } from '../server/services/demoGateway.ts';

process.umask(0o077);
try { process.loadEnvFile('.env'); } catch { /* optional */ }
const stateFile = path.resolve('data/demo-share/current.json');
type State = { id: string; pid: number; localUrl: string; url: string | null; username: string; password: string; expiresAt: string; status: string; backup: string };
const auth = (s: Pick<State, 'username' | 'password'>) => `Basic ${Buffer.from(`${s.username}:${s.password}`).toString('base64')}`;
const args = process.argv.slice(2);

async function isActive(state: State) {
  try {
    const url = new URL(state.localUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return false;
    const res = await fetch(url, { headers: { Authorization: auth(state) }, signal: AbortSignal.timeout(2000) });
    await res.arrayBuffer();
    return res.headers.get('x-traceflow-demo-id') === state.id;
  } catch { return false; }
}

if (args.includes('--stop')) {
  if (!fs.existsSync(stateFile)) { console.log('No demo link is running.'); process.exit(0); }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as State;
  if (state.status === 'running' && await isActive(state)) {
    process.kill(state.pid, 'SIGTERM');
    console.log('Demo shutdown requested. The public link is closing.');
  } else console.log('No active demo link found.');
  process.exit(0);
}

const option = (name: string) => args[args.indexOf(name) + 1];
if (!args.includes('--api-url') || args.includes('--help')) {
  console.log('Usage: npm run demo:share -- --api-url http://127.0.0.1:8788 [--hours 24]\nStop: npm run demo:stop');
  process.exit(args.includes('--help') ? 0 : 1);
}
for (let i = 0; i < args.length; i += 2) {
  if (!['--api-url', '--hours'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Use --api-url <origin> and optionally --hours <1–24>.');
}
const hours = args.includes('--hours') ? Number(option('--hours')) : 24;
if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('--hours must be above 0 and at most 24.');
if (fs.existsSync(stateFile) && await isActive(JSON.parse(fs.readFileSync(stateFile, 'utf8')) as State)) throw new Error('A demo is already running. Use npm run demo:stop first.');
const cfg = loadConfig();
const apiUrl = option('--api-url');
const expiresAt = Date.now() + hours * 3_600_000;
const state: State = {
  id: randomUUID(), pid: process.pid, localUrl: '', url: null, username: 'jury',
  password: randomBytes(18).toString('base64url'), expiresAt: new Date(expiresAt).toISOString(),
  status: 'starting', backup: path.resolve('data/demo-share', `before-demo-${Date.now()}.sqlite`),
};
const gateway = createDemoGateway({ distDir: path.resolve('dist'), apiUrl, username: state.username, password: state.password, expiresAt, sessionId: state.id });
// Require a real, healthy TraceFlow API before creating an internet endpoint.
const health = await fetch(new URL('/api/health', apiUrl), { signal: AbortSignal.timeout(10_000) });
const healthBody = await health.json() as { status?: string; version?: string };
if (!health.ok || healthBody.status !== 'ok' || healthBody.version !== cfg.version) throw new Error('Start the local TraceFlow API first and check --api-url.');

const localBinary = path.resolve('data/tools/cloudflared');
const binary = fs.existsSync(localBinary) ? localBinary : 'cloudflared';
const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 });
if (version.status !== 0) throw new Error('Install cloudflared first. See README_LOCAL.md → Temporary remote jury access.');
fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
fs.chmodSync(path.dirname(stateFile), 0o700);
// Online SQLite backup includes committed WAL contents without modifying source records.
console.log('Saving a database snapshot before sharing…');
const db = new DatabaseSync(cfg.sqlitePath, { readOnly: true });
try { await backup(db, state.backup); } finally { db.close(); }

let tunnel: ChildProcess | null = null;
let stopping = false;
let deadline: ReturnType<typeof setTimeout>;
let startupDeadline: ReturnType<typeof setTimeout>;
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  clearTimeout(deadline);
  clearTimeout(startupDeadline);
  state.status = 'stopped';
  save();
  tunnel?.kill('SIGTERM');
  gateway.server.closeAllConnections();
  gateway.server.close(() => process.exit(code));
  setTimeout(() => { tunnel?.kill('SIGKILL'); process.exit(code); }, 3000).unref();
};
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
gateway.server.on('error', (e) => { console.error(e.message); stop(1); });
await new Promise<void>((resolve) => gateway.server.listen(0, '127.0.0.1', resolve));
const address = gateway.server.address();
if (!address || typeof address === 'string') throw new Error('Cannot start the demo gateway.');
state.localUrl = `http://127.0.0.1:${address.port}`;
save();
deadline = setTimeout(() => { console.log('The demo time has ended. Closing access.'); stop(); }, Math.max(1, expiresAt - Date.now()));
startupDeadline = setTimeout(() => { console.error('Cloudflare did not connect within 90 seconds.'); stop(1); }, 90_000);

// A new empty config prevents a pre-existing account/tunnel config from changing the target.
const tunnelConfig = path.join(path.dirname(stateFile), 'cloudflared.yml');
fs.writeFileSync(tunnelConfig, '{}\n', { mode: 0o600 });
tunnel = spawn(binary, ['tunnel', '--config', tunnelConfig, '--no-autoupdate', '--url', state.localUrl, '--protocol', 'http2'], {
  // Do not pass Gemini/HERE keys or inherited tunnel settings to the connector.
  env: { PATH: process.env.PATH, HOME: process.env.HOME, SSL_CERT_FILE: process.env.SSL_CERT_FILE, SSL_CERT_DIR: process.env.SSL_CERT_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
let connected = false;
const output = (chunk: Buffer) => {
  const text = chunk.toString();
  process.stdout.write(text);
  log = (log + text).slice(-24_000);
  const match = log.match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)/);
  if (match && !state.url) {
    state.url = match[0];
    gateway.setPublicOrigin(state.url);
    save();
  }
  if (!connected && state.url && log.includes('Registered tunnel connection')) {
    connected = true;
    clearTimeout(startupDeadline);
    state.status = 'running';
    save();
    console.log(`\nDemo link: ${state.url}\nUsername: ${state.username}\nPassword and expiry: ${stateFile}\nStop: npm run demo:stop\nKeep this laptop awake and online.\n`);
  }
};
tunnel.stdout!.on('data', output);
tunnel.stderr!.on('data', output);
tunnel.on('error', (e) => { console.error(e.message); stop(1); });
tunnel.on('exit', (code) => { if (!stopping) { console.error(`Cloudflare stopped (${code}).`); stop(1); } });
