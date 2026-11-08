import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../../server/config.ts';
import { machineHosts } from '../../server/services/networkHosts.ts';
import { H, makeApp } from '../helpers.ts';

const lanIp = machineHosts().find((h) => /^\d+\.\d+\.\d+\.\d+$/.test(h));

test('LAN access needs no code; the API itself still never binds beyond loopback', () => {
  assert.equal(loadConfig({ LAN_ACCESS: 'true' }).lanAccess, true);
  assert.equal(loadConfig({}).lanAccess, false);
  assert.throws(() => loadConfig({ API_HOST: '0.0.0.0' }), ConfigError);
});

test('with LAN access on, this machine\'s network address is accepted as Host and Origin', async () => {
  const ctx = await makeApp({ env: { LAN_ACCESS: 'true' } });
  try {
    if (lanIp) {
      const r = await ctx.app.inject({ method: 'GET', url: '/api/overview', headers: { host: `${lanIp}:5173`, origin: `http://${lanIp}:5173` } });
      assert.equal(r.statusCode, 200);
      assert.equal(r.headers['access-control-allow-origin'], `http://${lanIp}:5173`);
    }
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/overview', headers: H })).statusCode, 200);
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example:5173' } })).statusCode, 403, 'other host names stay blocked (DNS rebinding)');
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/quality/scan', headers: { ...H, origin: 'https://evil.example' }, payload: {} })).statusCode, 403, 'other web origins stay blocked (CSRF)');
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/team-access', headers: H })).statusCode, 404, 'the team-code endpoint is gone');
  } finally {
    await ctx.cleanup();
  }
});

test('with LAN access off, the network address is refused', async (t) => {
  if (!lanIp) return t.skip('no non-loopback IPv4 address on this machine');
  const ctx = await makeApp();
  try {
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { host: `${lanIp}:5173` } })).statusCode, 403);
  } finally {
    await ctx.cleanup();
  }
});
