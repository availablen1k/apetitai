import assert from 'node:assert/strict';
import { test } from 'node:test';
import { H, makeApp, multipart } from '../helpers.ts';

test('farm region totals cover the full matching registry across pagination', async (t) => {
  const ctx = await makeApp();
  t.after(ctx.cleanup);
  const rows = ['farm_id,segment,region,lat,lon'];
  for (let i = 0; i < 680; i++) rows.push(`DEMO-F${i},contract,${i < 380 ? 'FI_SW' : i < 500 ? 'SE_SKANE' : 'FI_SAVO'},60,22`);
  const upload = multipart([{ filename: 'farm_registry_DEMO.csv', content: rows.join('\n') }]);
  const imported = await ctx.app.inject({ method: 'POST', url: '/api/imports', ...upload });
  assert.equal(imported.statusCode, 200, imported.body);
  assert.equal(imported.json().results[0].batch.imported_rows, 680);

  for (const query of ['limit=1', 'limit=500', 'limit=500&offset=500']) {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/farms?${query}`, headers: H });
    assert.equal(response.statusCode, 200);
    const data = response.json();
    assert.equal(data.total, 680);
    assert.deepEqual(data.region_counts, { FI_SW: 380, SE_SKANE: 120, FI_SAVO: 180 });
    assert.equal(Object.values(data.region_counts).reduce((sum: number, value) => sum + Number(value), 0), data.total);
  }
  const filtered = (await ctx.app.inject({ method: 'GET', url: '/api/farms?region=SE_SKANE&limit=1', headers: H })).json();
  assert.equal(filtered.total, 120);
  assert.equal(filtered.items.length, 1);
  assert.deepEqual(filtered.region_counts, { SE_SKANE: 120 });
});
