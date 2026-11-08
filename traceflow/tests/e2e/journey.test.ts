// End-to-end: starts `npm run dev` (scripts/dev.mjs) on spare ports with a temporary database,
// runs the full journey over real HTTP through the Vite proxy, then opens every main page in a
// fresh headless Chrome profile and checks for uncaught errors, failed requests and Base44 traffic.
// The browser part is skipped (not failed) when no Chrome/Chromium binary is installed.
import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
import { makeNatureModel } from '../natureFixture.ts';
import { FIXTURES } from '../helpers.ts';
import { extractText } from '../../server/domain/documents.ts';

const API_PORT = 8797;
const WEB_PORT = 5197;
const WEB = `http://localhost:${WEB_PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-e2e-'));
let dev: ChildProcess;
const nature = makeNatureModel();
let devLog = '';

async function waitFor(url: string, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}\n${devLog.slice(-3000)}`);
}

const api = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(`${WEB}/api${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
};

describe('end-to-end through npm run dev', () => {
  before(async () => {
    const ndb = new DatabaseSync(nature.dbPath);
    const insert = ndb.prepare("INSERT INTO action_lever (lever_id,name,scope,flag,lever_type,abatement_tco2e_2030_design,capex_eur,opex_delta_eur_per_yr,lifetime_yr,earliest_start,ramp_years,confidence,indicative_cost_eur_per_tco2e,value_status) VALUES (?,?,'scope1',0,'technology',900000,?,?,10,2027,2,'medium',100,'fixture design estimate')");
    insert.run('L03', 'Replace refrigerant system', 1000, -200);
    insert.run('L04', 'Detect leaks', 2000, 100);
    insert.run('L02', 'Assess yard vehicles', 0, 0);
    const modelRoot = path.resolve('nature_model/model/nature');
    const catalogue = JSON.parse(fs.readFileSync(path.join(modelRoot,'queries/catalog.json'),'utf8')) as {id:string;description:string;grain:string;parameters:object;lineage:string}[];
    const query = catalogue.find(q=>q.id==='18_nature_action_opportunities')!;
    ndb.prepare('INSERT INTO query_definition VALUES (?,?,?,?,?,?)').run(query.id,query.description,query.grain,JSON.stringify(query.parameters),fs.readFileSync(path.join(modelRoot,'queries',`${query.id}.sql`),'utf8'),fs.readFileSync(path.join(modelRoot,'queries',query.lineage),'utf8'));
    ndb.close();
    dev = spawn(process.execPath, ['scripts/dev.mjs'], {
      env: { ...process.env, API_PORT: String(API_PORT), VITE_PORT: String(WEB_PORT), SQLITE_PATH: path.join(tmp, 'e2e.sqlite'), NATURE_MODEL_DIR: nature.dir, GEMINI_API_KEY: '', AUTO_REVIEW_IMPORTS: 'false', DISCOVERY_AFTER_CALCULATION: 'false', LOG_LEVEL: 'warn' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    dev.stdout!.on('data', (d) => (devLog += d));
    dev.stderr!.on('data', (d) => (devLog += d));
    await waitFor(`${WEB}/api/health`);
    await waitFor(WEB);
  });
  after(async () => {
    dev.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(tmp, { recursive: true, force: true });
    nature.cleanup();
  });

  test('API journey: import → flag → investigate → approve → recalc → trace → export', async () => {
    const h = await api('GET', '/health');
    assert.equal(h.json.database.connected, true);

    const form = new FormData();
    for (const f of fs.readdirSync(FIXTURES)) form.append('file', new Blob([fs.readFileSync(path.join(FIXTURES, f))]), f);
    const imp = await fetch(`${WEB}/api/imports`, { method: 'POST', body: form });
    assert.equal(imp.status, 200);
    const results = ((await imp.json()) as { results: { batch?: { rejected_rows: number } }[] }).results;
    assert.equal(results.length, fs.readdirSync(FIXTURES).length);
    assert.ok(results.every((r: { batch?: { rejected_rows: number } }) => r.batch && r.batch.rejected_rows === 0));

    const scan = await api('POST', '/quality/scan', {});
    assert.ok(scan.json.created > 0);
    const list = await api('GET', '/issues?status=open&q=pcf.value_scale');
    const issue = list.json.items[0];
    assert.equal(issue.candidate_value, '1.4091');

    const inv = await api('POST', `/issues/${issue.id}/investigate`);
    assert.equal(inv.json.status, 'not_configured', 'no key in e2e: honest not-configured state');

    const run1 = await api('POST', '/calculations/inventory', { year: 2025, scope2_basis: 'market' });
    assert.equal(run1.status, 201);
    const rev = await api('POST', `/issues/${issue.id}/review`, { decision: 'approve', reviewer_label: 'E2E reviewer', reason: 'Supplier confirmed ×1000 slip', expected_revision: issue.revision });
    assert.equal(rev.status, 200);
    const run2 = await api('POST', '/calculations/inventory', { year: 2025, scope2_basis: 'market' });
    assert.ok(run2.json.totals.grand_total < run1.json.totals.grand_total);
    assert.equal(run2.json.correction_ids.length, 1);

    const c = await api('GET', `/calculations/${run2.json.id}/contributions?kind=material_purchase&limit=1`);
    const lin = await api('GET', `/lineage/${run2.json.id}/${c.json.items[0].id}`);
    assert.ok(lin.json.records.length > 0);

    const x = await fetch(`${WEB}/api/reports/${run2.json.id}.xlsx`);
    assert.equal(x.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await x.arrayBuffer());
    assert.equal(wb.worksheets.length, 8);
    const audit = await api('GET', '/audit-events?event_type=issue.approved');
    assert.equal(audit.json.items[0].actor_label, 'E2E reviewer');
  });

  test('browser smoke: every main page renders with no uncaught errors or Base44 traffic', async (t) => {
    const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((b) => spawnSync('which', [b]).status === 0);
    if (!chrome) return t.skip('no Chrome/Chromium installed');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-chrome-'));
    const port = 9339;
    const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
    try {
      await waitFor(`http://127.0.0.1:${port}/json/version`, 20000);
      const { webSocketDebuggerUrl } = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
      const ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
      let id = 0;
      const pending = new Map<number, (m: Record<string, unknown>) => void>();
      const events: Record<string, unknown>[] = [];
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data));
        if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } else events.push(m);
      };
      const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
        new Promise<Record<string, any>>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
      const target = await send('Target.createTarget', { url: 'about:blank' });
      const att = await send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true });
      const sid = att.result.sessionId as string;
      for (const d of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable']) await send(d, {}, sid);

      const pages: [string, RegExp][] = [
        ['/', /Missä olemme ja mitä tehdä seuraavaksi|Where you stand and what to do next/],
        ['/actions', /Compare expected carbon effects|Vertaa päästövaikutuksia/],
        ['/data-quality', /Poikkeamat|Incidents/],
        ['/transport', /Kuljetukset|Transport/],
        ['/raw-materials', /Raaka-aineet|Raw materials/],
        ['/sustainability', /Scope 1/],
        ['/traceability', /Jäljitettävyys|Traceability/],
        ['/reports', /Excel/],
        ['/gemini', /AI-avustaja|AI assistant/],
        ['/assistant', /AI-avustaja|AI assistant/],
        ['/farms', /./],
        ['/nature', /Luonto ja vesistöt|Nature and water/],
        ['/nature?tab=queries&query=04_monitoring_change', /04_monitoring_change/],
        ['/nature?tab=nutrient', /Ravinnekokeilut|Nutrient experiments/],
        ['/nature?tab=model', /Python/],
        ['/traceability?tab=incidents', /Incident root causes|Havaintojen juurisyyt/],
        ['/automations', /./],
        ['/settings', /Settings|Asetukset/],
        ['/platform', /Datasets and coverage|Aineistot ja kattavuus/],
        ['/demo', /./],
      ];
      const problems: string[] = [];
      for (const [p, expect] of pages) {
        events.length = 0;
        await send('Page.navigate', { url: WEB + p }, sid);
        await new Promise((r) => setTimeout(r, 2500));
        const text = (await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true }, sid)).result.result.value as string;
        if (!expect.test(text)) problems.push(`${p}: expected ${expect} in page text`);
        for (const e of events) {
          const params = (e.params || {}) as Record<string, any>;
          if (e.method === 'Runtime.exceptionThrown') problems.push(`${p}: uncaught ${params.exceptionDetails?.exception?.description || params.exceptionDetails?.text}`);
          if (e.method === 'Runtime.consoleAPICalled' && params.type === 'error') problems.push(`${p}: console.error ${JSON.stringify(params.args?.map((a: any) => a.value ?? a.description)).slice(0, 300)}`);
          if (e.method === 'Network.requestWillBeSent' && /base44/i.test(params.request?.url || '')) problems.push(`${p}: Base44 request ${params.request.url}`);
          if (e.method === 'Network.responseReceived' && params.response?.status >= 400 && /\/api\//.test(params.response.url) && !/\/api\/forecast/.test(params.response.url)) problems.push(`${p}: HTTP ${params.response.status} ${params.response.url}`);
        }
      }
      // Exercise the upload UI, beyond the page-render smoke check.
      events.length = 0;
      const evaluate = async (expression: string) => {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
        if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
        return r.result.result.value;
      };
      const until = async (expression: string) => {
        const end = Date.now() + 20000;
        while (Date.now() < end) { if (await evaluate(expression)) return; await new Promise((r) => setTimeout(r, 150)); }
        throw new Error(`UI condition timed out: ${expression}\n${await evaluate('document.body.innerText')}`);
      };
      const pointerClick = async (selector: string) => {
        const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const rect = el.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, sid);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, sid);
      };
      // Scope/FLAG Sankey: the user's two-year Scope 1 Non-FLAG example, source drilldown,
      // invalid ranges, URL persistence and a classified Scope 3 view.
      await evaluate(`localStorage.setItem('apetit.lang', 'en')`);
      const run2024 = await api('POST', '/calculations/inventory', { year: 2024, scope2_basis: 'market' });
      assert.equal(run2024.status, 201);
      await send('Page.navigate', { url: WEB + '/sustainability?year=2025' }, sid);
      await until('!!document.querySelector(\'[data-testid="footprint-source"]\')');
      assert.equal(await evaluate('!!document.querySelector(\'[data-testid="footprint-sankey"]\')'), false, 'ranked sources lead the footprint page');
      await evaluate('document.querySelector(\'[data-testid="footprint-source"]\').click()');
      await until('!!new URLSearchParams(location.search).get("category")');
      await evaluate('document.querySelector(\'[data-testid="show-footprint-flow"] summary\').click()');
      await until('!!document.querySelector(\'[data-testid="footprint-sankey"]\')');
      const fillFlowYear = async (selector: string, value: string) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await fillFlowYear('[data-testid="flow-from"]', '2024');
      await fillFlowYear('[data-testid="flow-to"]', '2025');
      await evaluate('document.querySelector(\'[data-testid="flow-apply"]\').click()');
      await until('document.querySelector(\'[data-testid="footprint-flow"]\')?.dataset.fromYear === "2024" && document.querySelector(\'[data-testid="footprint-flow"]\')?.dataset.toYear === "2025" && !!document.querySelector(\'[data-testid="footprint-sankey"]\')');
      await evaluate('document.querySelector(\'[data-testid="flow-scope1"]\').click()');
      await until('document.querySelector(\'[data-testid="footprint-flow"]\')?.dataset.scope === "scope1" && !document.querySelector(\'[data-testid="flow-land-flag"]\') && !!document.querySelector(\'[data-testid="footprint-sankey"]\')');
      await evaluate('document.querySelector(\'[data-testid="flow-land-non_flag"]\').click()');
      await until('document.querySelector(\'[data-testid="footprint-flow"]\')?.dataset.land === "non_flag" && document.querySelector(\'[data-testid="footprint-flow"]\')?.dataset.fromYear === "2024" && !!document.querySelector(\'[data-testid="footprint-sankey"]\')');
      const scope1Flow = (await api('GET', '/footprint-flow?from_year=2024&to_year=2025&scope=scope1&land=non_flag')).json;
      const renderedScope1 = Number((await evaluate('document.querySelector(\'[data-testid="flow-total"]\').textContent')).replace(/[^0-9.-]/g, ''));
      assert.ok(Math.abs(renderedScope1 - scope1Flow.totals.net_tco2e) < 0.1, `${renderedScope1} matches ${scope1Flow.totals.net_tco2e}`);
      assert.ok(await evaluate('document.querySelector(\'[data-testid="footprint-sankey"] svg\').getBoundingClientRect().height <= 628'), 'multi-year diagram height stays bounded');
      const hoverPoint = await evaluate('(() => { const el = document.querySelector(\'[data-testid="footprint-sankey"] .flow-nodes [role="button"] .flow-bar\'); el.scrollIntoView({block:"center"}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint }, sid);
      await until('document.querySelector(\'[data-testid="flow-tooltip"]\')?.textContent.includes("tCO₂e")');
      assert.ok(!(await evaluate('document.querySelector(\'[data-testid="flow-tooltip"]\').textContent')).includes('NaN'));
      assert.match(await evaluate('document.querySelector(\'[data-testid="flow-tooltip"]\').textContent'), /2024[\s\S]*2025/);
      assert.ok(await evaluate('document.querySelectorAll(\'[data-testid="flow-ribbon"][data-active="true"]\').length >= 2'), 'hover follows the complete path');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 }, sid);
      await evaluate('document.querySelector(\'[data-testid="footprint-sankey"] .flow-nodes [role="button"]\').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))');
      await until('!!document.querySelector(\'[data-testid="flow-selection"]\')');
      assert.equal(await evaluate('document.querySelector(\'[data-testid="flow-records"]\').open'), false, 'pinning keeps the user at the diagram');
      await evaluate('document.querySelector(\'[data-testid="flow-show-records"]\').click()');
      await until('document.querySelector(\'[data-testid="flow-records"]\')?.open && !!document.querySelector(\'[data-testid="flow-record"]\')');
      assert.match(await evaluate('document.querySelector(\'[data-testid="flow-record"]\').textContent'), /Scope 1.*Non-FLAG/);
      assert.ok(await evaluate('!!document.querySelector(\'[data-testid="flow-record"] a[href^="/traceability?run="]\')'));
      await fillFlowYear('[data-testid="flow-from"]', '2026');
      await evaluate('document.querySelector(\'[data-testid="flow-apply"]\').click()');
      await until('document.querySelector(\'[data-testid="footprint-flow"] [role="alert"]\')?.textContent.includes("From year")');
      assert.ok((await evaluate('location.search')).includes('flow_from=2024'));
      await fillFlowYear('[data-testid="flow-from"]', '2024');
      await evaluate('document.querySelector(\'[data-testid="flow-apply"]\').click()');
      await evaluate('document.querySelector(\'[data-testid="flow-scope3"]\').click()');
      await until('document.querySelector(\'[data-testid="footprint-flow"]\')?.dataset.scope === "scope3" && !!document.querySelector(\'[data-testid="flow-land-flag"]\')');
      await evaluate('document.querySelector(\'[data-testid="flow-land-flag"]\').click()');
      await until('!!document.querySelector(\'[data-testid="footprint-sankey"]\') && document.querySelector(\'[data-testid="footprint-flow"]\')?.dataset.land === "flag"');
      assert.ok(await evaluate('[...document.querySelectorAll(\'[data-testid="footprint-sankey"] .flow-nodes [role="button"]\')].some(el => el.getAttribute("aria-label").startsWith("Scope 3 · FLAG"))'));
      await evaluate('document.querySelector(\'[data-testid="flow-all"]\').click()');
      await until('document.querySelector(\'[data-testid="footprint-flow"]\')?.dataset.scope === "all"');
      await evaluate('document.querySelector(\'[data-testid="flow-land-all"]\').click()');
      await until('!!document.querySelector(\'[data-testid="footprint-sankey"]\') && document.querySelector(\'[data-testid="footprint-flow"]\')?.dataset.land === "all"');
      assert.ok(await evaluate('document.querySelectorAll(\'[data-testid="flow-node"][data-kind="source"]\').length <= 10'));
      const overviewHover = await evaluate('(() => { const el = document.querySelector(\'[data-testid="flow-node"][data-kind="source"] .flow-bar\'); el.scrollIntoView({block:"center"}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...overviewHover }, sid);
      await until('!!document.querySelector(\'[data-testid="flow-tooltip"]\')');
      assert.ok(await evaluate('!!document.querySelector(\'[data-testid="flow-ribbon"][data-active="false"]\')'), 'unrelated paths are dimmed in the overview');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 }, sid);
      const isolateId = await evaluate('document.querySelector(\'[data-testid="flow-node"][data-node-id^="source:"]\').dataset.nodeId');
      await evaluate(`document.querySelector('[data-node-id="${isolateId}"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      await until('!!document.querySelector(\'[data-testid="flow-isolate"]\')');
      await evaluate('document.querySelector(\'[data-testid="flow-isolate"]\').click()');
      await until(`document.querySelector('[data-testid="footprint-flow"]').dataset.source === ${JSON.stringify(isolateId)}`);
      assert.ok(await evaluate('document.querySelectorAll(\'[data-testid="flow-node"][data-kind="source"]\').length === 1'), 'isolating a material rescales to its own flow');
      await evaluate('document.querySelector(\'[data-testid="flow-reset-exploration"]\').click()');
      await until('!document.querySelector(\'[data-testid="footprint-flow"]\').dataset.source');
      await evaluate('(() => { const el=document.querySelector(\'[data-testid="flow-search"]\'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"NO_MATCHING_MATERIAL_ABC"); el.dispatchEvent(new Event("input",{bubbles:true})); })()');
      await until('document.querySelector(\'[data-testid="footprint-flow"]\').dataset.query === "NO_MATCHING_MATERIAL_ABC" && !!document.querySelector(\'[data-testid="flow-empty"]\')');
      await evaluate('document.querySelector(\'[data-testid="flow-reset-exploration"]\').click()');
      await until('!!document.querySelector(\'[data-testid="footprint-sankey"]\') && !document.querySelector(\'[data-testid="footprint-flow"]\').dataset.query');
      await evaluate('document.querySelector(\'[data-testid="flow-expand"]\').click()');
      await until('document.querySelector(\'[data-testid="flow-dialog"]\').open');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sid);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sid);
      await until('!document.querySelector(\'[data-testid="flow-dialog"]\').open');
      if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
        await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
        await evaluate('document.querySelector(\'[data-testid="flow-records"]\').open=false; window.scrollTo(0,0)');
        await new Promise((r) => setTimeout(r, 200));
        const clip = await evaluate('(() => { const r = document.querySelector(\'[data-testid="footprint-flow"]\').getBoundingClientRect(); return { x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1 }; })()');
        const shot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true }, sid);
        fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, '-flow-desktop.png'), Buffer.from(shot.result.data, 'base64'));
      }
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sid);
      await evaluate('document.querySelector(\'header button[aria-label="Suomi"]\').click()');
      await until('document.querySelector("#footprint-flow-title").textContent.includes("Mistä")');
      assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Sankey filters and graph stay inside the mobile page');
      if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
        const clip = await evaluate('(() => { const r = document.querySelector(\'[data-testid="footprint-flow"]\').getBoundingClientRect(); return { x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1 }; })()');
        const shot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true }, sid);
        fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, '-flow-mobile-fi.png'), Buffer.from(shot.result.data, 'base64'));
      }
      await evaluate('document.querySelector(\'header button[aria-label="English"]\').click()');
      await send('Emulation.clearDeviceMetricsOverride', {}, sid);

      // Navigation remains usable on a phone, with focus trapped and restored by the drawer.
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sid);
      await send('Page.navigate', { url: WEB + '/sustainability' }, sid);
      await until('!!document.querySelector(\'[data-testid="open-navigation"]\') && !!document.querySelector("main h1")');
      assert.ok(!/Start guided demo|Local mode|AI not configured|gemini-/i.test(await evaluate('document.querySelector("header").innerText')));
      assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'sustainability controls fit on mobile');
      await evaluate('document.querySelector(\'header button[aria-label="Suomi"]\').click()');
      await until('document.querySelector("main h1").textContent.includes("Hiilijalanjälki")');
      assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Finnish sustainability controls fit on mobile');
      await evaluate('document.querySelector(\'header button[aria-label="English"]\').click()');
      await evaluate('document.querySelector(\'[data-testid="open-navigation"]\').click()');
      await until('!!document.querySelector(\'[role="dialog"]\')');
      assert.equal(await evaluate('document.querySelector(\'[role="dialog"]\').contains(document.activeElement)'), true);
      for (let i = 0; i < 22; i++) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sid);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sid);
        assert.equal(await evaluate('document.querySelector(\'[role="dialog"]\').contains(document.activeElement)'), true, 'Tab stays inside mobile navigation');
      }
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sid);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sid);
      await until('!document.querySelector(\'[role="dialog"]\')');
      assert.equal(await evaluate('document.activeElement.dataset.testid'), 'open-navigation');
      await evaluate('document.querySelector(\'[data-testid="open-navigation"]\').click()');
      await until('!!document.querySelector(\'[role="dialog"] a[href^="/platform"]\')');
      await evaluate('document.querySelector(\'[role="dialog"] a[href^="/platform"]\').click()');
      await until('location.pathname === "/platform" && !document.querySelector(\'[role="dialog"]\')');
      await evaluate('document.querySelector(\'main a[href="/data-quality?tab=import"]\').click()');
      await until('!!document.querySelector(\'[data-testid="inbox-files"]\')');
      assert.equal(await evaluate('new URLSearchParams(location.search).get("tab")'), 'import');
      await send('Emulation.clearDeviceMetricsOverride', {}, sid);
      await send('Page.navigate', { url: WEB + '/settings' }, sid);
      await until('!!document.querySelector(\'[data-testid="system-information"]\')');
      assert.equal(await evaluate('document.querySelector(\'[data-testid="system-information"]\').open'), false);
      await evaluate('document.querySelector(\'[data-testid="system-information"] summary\').click()');
      await until('document.querySelector(\'[data-testid="system-information"]\').innerText.includes("e2e.sqlite")');

      // Operational decisions show carbon, money and evidence; completing assessment earns no reduction.
      await send('Page.navigate', { url: WEB + '/actions?year=2025&action=L03' }, sid);
      await until('!!document.querySelector(\'[data-testid="action-reviewer"]\')');
      await new Promise((r) => setTimeout(r, 550));
      assert.match(await evaluate('document.querySelector(\'[data-testid="action-detail"]\').innerText'), /Expected annual carbon effect[\s\S]*reduction[\s\S]*€200[\s\S]*Operating savings per year[\s\S]*5 years/);
      assert.match(await evaluate('document.querySelector(\'[data-testid="action-detail"]\').innerText'), /Eligible target contribution: Not assessed/);
      assert.ok(await evaluate('(() => { const r=document.querySelector(\'[data-testid="action-detail"]\').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1; })()'), 'action detail remains inside the viewport');
      const fillField = async (selector: string, value: string, tag = 'input') => evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${tag === 'textarea' ? 'HTMLTextAreaElement' : tag === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('${tag === 'select' ? 'change' : 'input'}',{bubbles:true})); })()`);
      await fillField('[data-testid="action-reviewer"]', 'E2E sustainability expert');
      await fillField('[data-testid="action-note"]', 'Confirm supplier price and the measurement plan.', 'textarea');
      await evaluate('document.querySelector(\'[data-testid="action-record-assessment"]\').click()');
      await until('document.querySelector(\'[data-testid="action-detail"]\').innerText.includes("Feasibility assessment open")');
      await evaluate('[...document.querySelectorAll(\'[data-testid="action-detail"] button\')].find(b=>b.textContent.includes("Complete feasibility assessment")).click()');
      await until('document.querySelector(\'[data-testid="action-detail"]\').innerText.includes("Feasibility assessment completed")');
      const assessed = (await api('GET', '/action-options?year=2025&id=L03')).json.rows[0];
      assert.equal(assessed.stage, 'expected');
      assert.equal(assessed.effect.physical_reduction_verified_tco2e, null);
      assert.equal(assessed.assessments[0].status, 'done');

      // Target definitions are explicit human input; unreviewed boundaries yield no progress claim.
      await send('Page.navigate', { url: WEB + '/settings?year=2025#targets' }, sid);
      await until('!!document.querySelector(\'[data-testid="target-baseline"] option[value="' + run2024.json.id + '"]\')');
      await fillField('[data-testid="target-name"]', 'E2E operational target');
      await fillField('[data-testid="target-baseline"]', run2024.json.id, 'select');
      await fillField('[data-testid="target-year"]', '2030');
      await fillField('[data-testid="target-amount"]', '100');
      await fillField('[data-testid="target-boundary"]', 'Recorded sites in the test inventory; Scope 1 and 2.', 'textarea');
      await evaluate('document.querySelector(\'[data-testid="target-save"]\').click()');
      await until('document.querySelector(\'[data-testid="target-settings"]\').innerText.includes("Target definition saved")');
      await send('Page.navigate', { url: WEB + '/?year=2025' }, sid);
      await until('document.querySelector(\'[data-testid="target-progress"]\')?.innerText.includes("E2E operational target")');
      assert.match(await evaluate('document.querySelector(\'[data-testid="target-progress"]\').innerText'), /Comparable boundaries have not been confirmed/);
      assert.ok(!await evaluate('document.querySelector(\'[data-testid="target-progress"]\').innerText.includes("Gap to the target")'));
      assert.ok(await evaluate('!!document.querySelector(\'nav a[href="/actions?year=2025"]\')'), 'navigation carries the selected reporting period');

      // Reports lead with a readable result; full calculation details are optional.
      await send('Page.navigate', { url: WEB + '/reports' }, sid);
      await until('!!document.querySelector(\'[data-testid="create-report"]\') && !document.querySelector(\'[data-testid="create-report"]\').disabled');
      await evaluate('document.querySelector(\'[data-testid="create-report"]\').click()');
      await until('!!document.querySelector(\'[data-testid="report-reader"]\')');
      assert.match(await evaluate('document.querySelector(\'[data-testid="report-reader"]\').innerText'), /Main result[\s\S]*What needs checking/);
      assert.equal(await evaluate('document.querySelector(\'[data-testid="report-details"]\').open'), false);
      assert.equal(await evaluate('document.querySelector(\'[data-testid="saved-calculations"]\').open'), false);
      const readable = (await api('GET', '/documents/reports')).json[0];
      assert.ok(!await evaluate(`document.querySelector('[data-testid="report-reader"]').innerText.includes(${JSON.stringify(readable.run_id)})`), 'technical references are collapsed');
      const downloads = path.join(tmp, 'downloads');
      fs.mkdirSync(downloads);
      await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads });
      const downloadPdf = async () => {
        const before = new Set(fs.readdirSync(downloads));
        await evaluate('document.querySelector(\'[data-testid="report-pdf"]\').click()');
        const end = Date.now() + 15000;
        while (Date.now() < end) {
          const filename = fs.readdirSync(downloads).find((file) => !file.endsWith('.crdownload') && !before.has(file));
          if (filename) {
            const bytes = fs.readFileSync(path.join(downloads, filename));
            const extracted = await extractText(filename, bytes, 'pdf');
            assert.equal(extracted.status, 'extracted');
            return { bytes, text: extracted.pages.map((page) => page.text).join('\n') };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('PDF download did not finish');
      };
      const pdf = await downloadPdf();
      assert.match(pdf.text, /Main result[\s\S]*What needs checking/);
      assert.match(pdf.text, /Provisional/);
      assert.ok(!pdf.text.includes('Original calculation notes'), 'default PDF keeps the full technical appendix optional');
      await pointerClick('[data-testid="report-more-downloads"]');
      await until('!!document.querySelector(\'[role="menuitemcheckbox"]\')');
      await evaluate('document.querySelector(\'[role="menuitemcheckbox"]\').click()');
      await until('document.querySelector(\'[role="menuitemcheckbox"]\').getAttribute("aria-checked") === "true"');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sid);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sid);
      const detailedPdf = await downloadPdf();
      assert.match(detailedPdf.text, /Original calculation notes/);
      assert.ok(detailedPdf.text.includes(readable.run_id), 'detailed PDF retains the saved calculation reference');
      await evaluate('document.querySelector(\'header button[aria-label="Suomi"]\').click()');
      await until('document.querySelector(\'[data-testid="report-reader"]\').innerText.includes("Päätulos")');
      const fiPdf = await downloadPdf();
      assert.match(fiPdf.text, /Päätulos[\s\S]*Mitä pitää tarkistaa/);
      assert.match(fiPdf.text, /Alkuperäiset laskentahuomiot/);
      await evaluate('document.querySelector(\'header button[aria-label="English"]\').click()');
      await evaluate('document.querySelectorAll("[toast-close]").forEach(button => button.click())');
      await until('!document.querySelector(\'[data-radix-toast-viewport] [data-state="open"]\')');
      for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name === 'mobile' }, sid);
        await evaluate('window.scrollTo(0, 0)');
        assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${name}: readable reports fit the viewport`);
        if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
          const metrics = await send('Page.getLayoutMetrics', {}, sid);
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...metrics.result.cssContentSize, scale: 1 } }, sid);
          fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, `-report-${name}.png`), Buffer.from(shot.result.data, 'base64'));
        }
      }
      await send('Emulation.clearDeviceMetricsOverride', {}, sid);
      await evaluate('document.querySelector(\'[data-testid="report-approve"]\').click()');
      await until('!!document.querySelector(\'[data-testid="report-reviewer"]\')');
      await fillField('[data-testid="report-reviewer"]', '');
      assert.equal(await evaluate('document.querySelector(\'[data-testid="confirm-report-approval"]\').disabled'), true, 'approval requires a named human');
      await evaluate(`(() => { const el = document.querySelector('[data-testid="report-reviewer"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Report browser reviewer'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await until('!document.querySelector(\'[data-testid="confirm-report-approval"]\').disabled');
      await evaluate('document.querySelector(\'[data-testid="confirm-report-approval"]\').click()');
      await until('!document.querySelector(\'[data-testid="report-reviewer"]\') && document.body.innerText.includes("Approved by Report browser reviewer")');
      const approvedReport = (await api('GET', `/documents/reports/${readable.id}`)).json;
      assert.equal(approvedReport.status, 'approved');
      assert.deepEqual(approvedReport.sections_en, readable.sections_en);
      assert.deepEqual(approvedReport.reader_snapshot, readable.reader_snapshot);
      assert.match(await evaluate('document.querySelector(\'[data-testid="report-reader"]\').innerText'), /Provisional/, 'approval preserves limitations');
      if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
        fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, '-report-en.pdf'), pdf.bytes);
        fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, '-report-fi.pdf'), fiPdf.bytes);
      }

      await send('Page.navigate', { url: WEB + '/data-quality' }, sid);
      await until('!!document.querySelector(\'[data-tab="import"]\')');
      await evaluate('document.querySelector(\'[data-tab="import"]\').click()');
      await until('!!document.querySelector(\'[data-testid="inbox-files"]\')');
      const uploadFile = async (filename: string) => {
        const doc = await send('DOM.getDocument', {}, sid);
        const input = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '[data-testid="inbox-files"]' }, sid);
        await send('DOM.setFileInputFiles', { nodeId: input.result.nodeId, files: [filename] }, sid);
        await until('!document.querySelector(\'[data-testid="queue-files"]\').disabled');
        await evaluate('document.querySelector(\'[data-testid="queue-files"]\').click()');
      };
      const fillReviewer = async () => {
        await evaluate(`(() => { const el = document.querySelector('[data-testid="upload-reviewer"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Browser reviewer'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      };
      await uploadFile(path.join(FIXTURES, 'shipments_DEMO.csv'));
      await until('!!document.querySelector(\'[data-testid="upload-review"]\')');
      assert.equal(await evaluate('document.querySelector(\'[data-testid="upload-dataset"]\').value'), 'shipments');
      await fillReviewer();
      await until('!document.querySelector(\'[data-testid="confirm-upload"]\').disabled');
      await evaluate('document.querySelector(\'[data-testid="confirm-upload"]\').click()');
      await until('!!document.querySelector(\'[data-testid="upload-confirmed"]\')');
      assert.match(await evaluate('document.querySelector(\'[data-testid="upload-confirmed"]\').innerText'), /0/);
      await uploadFile(path.resolve('tests/fixtures/evidence/SUP011_PCF_declaration_DEMO.pdf'));
      await until('!!document.querySelector(\'[data-testid="upload-category"]\') && document.querySelector(\'[data-testid="upload-category"]\').value === "supplier_pcf"');
      const supplierSelected = await evaluate(`(() => { const labels = [...document.querySelectorAll('[data-testid="upload-review"] label')]; const label = labels.find(l => l.textContent.includes('SUP011') && l.querySelector('input[type="checkbox"]')); if (!label) return false; label.querySelector('input').click(); return true; })()`);
      assert.equal(supplierSelected, true, 'supplier suggestion is available in the review form');
      await fillReviewer();
      await evaluate('document.querySelector(\'[data-testid="confirm-upload"]\').click()');
      await until('!!document.querySelector(\'[data-testid="upload-confirmed"]\')');
      const pdfUpload = await api('GET', '/uploads?kind=pdf&state=confirmed');
      assert.equal(pdfUpload.json.total, 1);
      const evidence = await api('GET', `/evidence/${pdfUpload.json.items[0].evidence_id}`);
      assert.ok(evidence.json.links.some((l: { entity_id: string }) => l.entity_id === 'SUP011'));
      // The batch agent shares the human review queue and can record an evidence request.
      await evaluate('document.querySelector(\'[data-tab="import"]\').click()');
      await until('!!document.querySelector(\'[data-testid="agent-batch"] option[value]:nth-child(2)\')');
      await evaluate(`(() => { const el = document.querySelector('[data-testid="agent-batch"]'); const option = [...el.options].find(o => o.textContent.includes('refrigerant_service_log_DEMO.csv')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, option.value); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until('!document.querySelector(\'[data-testid="start-agent-review"]\').disabled');
      await evaluate('document.querySelector(\'[data-testid="start-agent-review"]\').click()');
      await until('!!document.querySelector(\'[data-testid="agent-review-result"]\') && document.querySelector(\'[data-testid="agent-review-result"]\').innerText.includes("Built-in checks finished")');
      await until('!!document.querySelector(\'[data-testid="agent-concern"]\')');
      await evaluate('document.querySelector(\'[data-testid="agent-concern"]\').click()');
      await until('!!document.querySelector(\'[data-testid="request-evidence"]\')');
      assert.match(await evaluate('document.querySelector(\'[data-testid="guided-review"]\').innerText'), /1\. What needs checking[\s\S]*2\. Check the original information[\s\S]*3\. Choose what to do/);
      assert.equal(await evaluate('document.querySelector(\'[data-testid="review-details"]\').open'), false);
      await evaluate('document.querySelector(\'[data-testid="original-entry"] summary\').click()');
      assert.match(await evaluate('document.querySelector(\'[data-testid="original-entry"]\').innerText'), /refrigerant_service_log_DEMO.csv/);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sid);
      await until('(() => { const rect = document.querySelector(\'[role="dialog"]\').getBoundingClientRect(); return Math.abs(rect.left) < 1 && Math.abs(rect.right - window.innerWidth) < 1; })()');
      assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth && document.querySelector(\'[role="dialog"]\').scrollWidth <= document.querySelector(\'[role="dialog"]\').clientWidth'), 'guided review fits on a phone');
      if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
        fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, '-review-mobile.png'), Buffer.from(shot.result.data, 'base64'));
        await evaluate('document.querySelector(\'[role="dialog"]\').scrollTop = document.querySelector(\'[role="dialog"]\').scrollHeight');
        const actionsShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
        fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, '-review-mobile-actions.png'), Buffer.from(actionsShot.result.data, 'base64'));
      }
      await send('Emulation.clearDeviceMetricsOverride', {}, sid);
      await evaluate('document.querySelector(\'[data-testid="request-evidence"]\').click()');
      await until('!!document.querySelector(\'[data-testid="review-reason"]\')');
      await evaluate(`(() => { const el = document.querySelector('[data-testid="review-reason"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Please confirm the service note and refrigerant charge in kg.'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await until('!document.querySelector(\'[data-testid="confirm-review"]\').disabled');
      await evaluate('document.querySelector(\'[data-testid="confirm-review"]\').click()');
      await until('!document.querySelector(\'[data-testid="confirm-review"]\')');
      const agentRuns = await api('GET', '/data-reviews');
      const reviewedIssue = await api('GET', `/issues/${agentRuns.json.runs[0].findings[0].issue_id}`);
      assert.equal(reviewedIssue.json.issue.status, 'open');
      assert.ok(reviewedIssue.json.history.some((h: { change: string }) => h.change === 'evidence_requested'));

      // Farm findings use readable names, complete pagination and current human decisions.
      const farmForm = new FormData();
      const farmCsv = 'survey_id,farm_id,crop,year,area_ha,yield_t_ha\n' + Array.from({ length: 14 }, (_, index) => `FS_DEMO_${String(index).padStart(3, '0')},FI_DEMO_${String(index).padStart(3, '0')},pea,2025,${-index - 1},${index === 0 ? '286.9' : '29.27'}`).join('\n');
      farmForm.append('file', new Blob([farmCsv]), 'farm_survey_DEMO_review.csv');
      const farmImport = await fetch(`${WEB}/api/imports`, { method: 'POST', body: farmForm });
      assert.equal(farmImport.status, 200);
      const farmBatch = (await farmImport.json() as { results: { batch: { id: string } }[] }).results[0].batch.id;
      const farmReview = await api('POST', '/data-reviews', { batch_id: farmBatch });
      await send('Page.navigate', { url: WEB + '/data-quality?tab=agent' }, sid);
      await until('document.querySelectorAll(\'[data-testid="agent-finding"]\').length === 10 && document.querySelector(\'[data-testid="agent-findings"]\').innerText.includes("Crop yield (t/ha)")');
      const farmText = await evaluate('document.querySelector(\'[data-testid="agent-review-result"]\').innerText');
      assert.match(farmText, /Farm surveys[\s\S]*Farm FI_DEMO_000[\s\S]*Peas[\s\S]*Survey FS_DEMO_000/);
      assert.ok(!/NEEDS_HUMAN_REVIEW|NEEDS_EVIDENCE|yield_t_ha|farm_survey:|Local ·/.test(farmText));
      assert.equal(await evaluate('document.querySelector(\'[data-testid="agent-review-details"]\').open'), false);
      assert.equal(await evaluate('document.querySelector(\'[data-testid="agent-finding-details"]\').open'), false);
      await evaluate('document.querySelector(\'[data-testid="agent-finding-details"] summary\').click()');
      assert.match(await evaluate('document.querySelector(\'[data-testid="agent-finding-details"]\').innerText'), /9\.8×[\s\S]*29\.27/);
      await evaluate('document.querySelector(\'[data-testid="agent-finding-details"] summary\').click()');
      await evaluate('document.querySelector(\'[data-testid="agent-next-page"]\').click()');
      await until('document.querySelectorAll(\'[data-testid="agent-finding"]\').length === 5');
      const fillAgentSearch = async (value: string) => {
        await evaluate(`(() => { const el = document.querySelector('[data-testid="agent-search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      };
      await fillAgentSearch('FI_DEMO_013');
      await until('document.querySelectorAll(\'[data-testid="agent-finding"]\').length === 1 && document.querySelector(\'[data-testid="agent-findings"]\').innerText.includes("FI_DEMO_013")');
      await fillAgentSearch('');
      await until('document.querySelectorAll(\'[data-testid="agent-finding"]\').length === 10');
      for (const [name, width, height] of [['desktop', 1440, 1100], ['mobile', 390, 844], ['mobile-fi', 390, 844]] as const) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name !== 'desktop' }, sid);
        if (name === 'mobile-fi') {
          await evaluate('document.querySelector(\'header button[aria-label="Suomi"]\').click()');
          await until('document.querySelector(\'[data-testid="agent-findings"]\').innerText.includes("Sato (t/ha)")');
          await fillAgentSearch('Herne');
          await until('document.querySelectorAll(\'[data-testid="agent-finding"]\').length === 10');
        }
        await evaluate('window.scrollTo(0, 0)');
        assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${name}: farm review has no horizontal overflow`);
        if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sid);
          fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, `-farm-review-${name}.png`), Buffer.from(shot.result.data, 'base64'));
          await evaluate('document.querySelector(\'[data-testid="agent-findings"]\').scrollIntoView({ block: "start" })');
          const rowsShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sid);
          fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, `-farm-findings-${name}.png`), Buffer.from(rowsShot.result.data, 'base64'));
        }
      }
      await send('Emulation.clearDeviceMetricsOverride', {}, sid);
      await evaluate('document.querySelector(\'header button[aria-label="English"]\').click()');
      await fillAgentSearch('FI_DEMO_013');
      await until('document.querySelectorAll(\'[data-testid="agent-finding"]\').length === 1');
      await evaluate('document.querySelector(\'[data-testid="agent-concern"]\').click()');
      await until('!!document.querySelector(\'[data-testid="reject"]\')');
      await evaluate('document.querySelector(\'[data-testid="reject"]\').click()');
      await until('!!document.querySelector(\'[data-testid="confirm-review"]\') && !document.querySelector(\'[data-testid="confirm-review"]\').disabled');
      await evaluate('document.querySelector(\'[data-testid="confirm-review"]\').click()');
      await until('!document.querySelector(\'[data-testid="confirm-review"]\')');
      await until('document.querySelectorAll(\'[role="dialog"]\').length === 1');
      await evaluate('[...document.querySelectorAll(\'[role="dialog"] button\')].find(button => button.textContent.trim() === "Close").click()');
      await until('!document.querySelector(\'[role="dialog"]\') && !document.querySelector(\'[data-testid="agent-finding"]\')');
      await evaluate(`(() => { const el = document.querySelector('[data-testid="agent-status-filter"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, 'reviewed'); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until('document.querySelector(\'[data-testid="agent-findings"]\')?.innerText.includes("Closed without a change")');
      const decidedFarm = await api('GET', `/data-reviews/${farmReview.json.id}?status=reviewed`);
      assert.equal(decidedFarm.json.findings.length, 1);
      assert.equal(decidedFarm.json.findings[0].review_status, 'rejected');

      // Canonical incident counts drive the compact chart; root-cause assistance is contextual.
      await send('Page.navigate', { url: WEB + '/data-quality' }, sid);
      await until('!!document.querySelector(\'[data-testid="show-incident-flow"] summary\')');
      assert.equal(await evaluate('!!document.querySelector(\'[data-testid="incident-sankey"]\')'), false, 'incident decisions lead Validation');
      await evaluate('document.querySelector(\'[data-testid="show-incident-flow"] summary\').click()');
      await until('!!document.querySelector(\'[data-testid="incident-sankey"] [data-testid="flow-node"]\') && document.querySelector(\'[data-testid="incident-flow"]\').getAttribute("aria-busy") === "false"');
      assert.ok(await evaluate('document.querySelector(\'[data-testid="incident-sankey"] svg\').getBoundingClientRect().height <= 628'));
      assert.equal(await evaluate('document.querySelectorAll(\'nav a[href="/assistant"], nav a[href="/climate"], nav a[href="/weather"], nav a[href="/forecast"]\').length'), 0);
      const incidentCounts = (await api('GET', '/incident-flow?status=open')).json;
      await evaluate('document.querySelector(\'[data-testid="incident-level-critical"]\').click()');
      await until('document.querySelector(\'[data-testid="incident-level-critical"]\').getAttribute("aria-pressed") === "true" && document.querySelector(\'[data-testid="incident-flow"]\').getAttribute("aria-busy") === "false"');
      assert.equal(await evaluate('document.querySelectorAll(\'[data-testid="incident-sankey"] [data-kind="scope"]\').length'), incidentCounts.counts.find((c: any)=>c.level==='critical').count ? 1 : 0);
      await evaluate('document.querySelector(\'[data-testid="incident-level-all"]\').click()');
      await until('document.querySelector(\'[data-testid="incident-flow"]\').getAttribute("aria-busy") === "false"');
      const incidentBefore = (await api('GET', '/issues?status=open&limit=1')).json.total;
      await evaluate('document.querySelector(\'[data-testid="issue-row"]\').click()');
      await until('!!document.querySelector(\'[data-testid="incident-root-cause"]\')');
      await evaluate('document.querySelector(\'[data-testid="incident-root-cause"]\').click()');
      await until('!!document.querySelector(\'[data-testid="root-cause-answer"]\')');
      assert.match(await evaluate('document.querySelector(\'[data-testid="root-cause-answer"]\').innerText'), /not been established|ei ole vahvistettu/);
      assert.equal((await api('GET', '/issues?status=open&limit=1')).json.total, incidentBefore);
      await evaluate(`history.pushState({}, '', '/traceability?tab=incidents'); window.dispatchEvent(new PopStateEvent('popstate'));`);
      await until('!!document.querySelector(\'[data-testid="incident-trace"]\')');
      assert.ok(await evaluate('!!document.querySelector(\'[data-testid="root-cause-answer"]\')'), 'assistant conversation survives navigation');

      // A source-row selection supersedes its parent figure's URL context.
      const traceRun = (await api('GET', '/calculations?year=2025')).json[0];
      const traceContribution = (await api('GET', `/calculations/${traceRun.id}/contributions?limit=1`)).json.items[0];
      await send('Page.navigate', {url:`${WEB}/traceability?run=${traceRun.id}&c=${traceContribution.id}`},sid);
      await until('!!document.querySelector(\'tr[data-ai-context]\')');
      await evaluate(`(() => {
        window.__contextRequests=[]; window.__originalContextFetch=window.fetch;
        window.fetch=async(input,init)=>{
          if(new URL(String(input),location.href).pathname!=='/api/assistant/ask')return window.__originalContextFetch(input,init);
          window.__contextRequests.push(JSON.parse(init.body));
          return new Response(JSON.stringify({status:'not_configured',message:'Context fixture',facts:[],citations:[]}),{headers:{'Content-Type':'application/json'}});
        };
        document.querySelector('[data-testid="assistant-launcher"]').click();
        document.querySelector('tr[data-ai-context]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));
      })()`);
      const askSelectedContext = async () => {
        await evaluate(`(() => {const input=document.querySelector('[data-testid="assistant-question"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Explain this selection');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await until('!document.querySelector(\'[data-testid="assistant-send"]\').disabled');
        await evaluate('document.querySelector(\'[data-testid="assistant-send"]\').click()');
        await until('!document.querySelector(\'[data-testid="assistant-question"]\').disabled');
      };
      assert.equal(await evaluate('document.querySelector(\'[data-testid="assistant-mode-workspace"]\').getAttribute("aria-pressed")'), 'true', 'workspace chat is the default');
      await askSelectedContext();
      assert.equal(await evaluate('window.__contextRequests[0].context.scope'), 'workspace');
      assert.equal(await evaluate('window.__contextRequests[0].context.record_id'), undefined, 'hover does not restrict workspace questions');
      await evaluate('document.querySelector(\'[data-testid="assistant-mode-selection"]\').click()');
      await askSelectedContext();
      const selectedContext = await evaluate('window.__contextRequests[1].context');
      assert.ok(selectedContext.record_id); assert.equal(selectedContext.run_id,undefined);assert.equal(selectedContext.contribution_id,undefined);
      await evaluate(`Array.from(document.querySelectorAll('[data-testid="assistant-context"] button')).find(b=>/Whole page|Koko sivu/.test(b.textContent)).click()`);
      await askSelectedContext();
      assert.equal(await evaluate('window.__contextRequests[2].context.record_id'),undefined);
      await evaluate('window.fetch=window.__originalContextFetch');

      await evaluate('document.querySelector(\'[data-testid="assistant-mode-workspace"]\').click()');

      // Discovery reads saved calculations and preserves named human decisions after a rerun.
      await evaluate(`localStorage.setItem('apetit.lang', 'en')`);
      await send('Page.navigate', { url: WEB + '/actions?year=2025#findings' }, sid);
      await until('!!document.querySelector(\'[data-testid="discovery-run"]\') && !document.querySelector(\'[data-testid="discovery-run"]\').disabled');
      await evaluate('document.querySelector(\'[data-testid="discovery-run"]\').click()');
      await until('!!document.querySelector(\'[data-testid="discovery-finding"]\') && !document.querySelector(\'[data-testid="discovery-run"]\').disabled');
      const findingText = await evaluate('document.querySelector(\'[data-testid="discovery-finding"]\').innerText');
      assert.match(findingText, /What we found/i);
      assert.match(findingText, /What we suggest/i);
      assert.match(findingText, /Effect on the footprint/);
      assert.equal(await evaluate('!!document.querySelector(\'[data-testid="assistant-scope-nature"]\')'), false, 'experts are selected internally');
      const countsBeforeDiscoveryDecision = (await api('GET', '/calculations?year=2025')).json.length;
      await evaluate('document.querySelector(\'[data-testid="discovery-done"]\').click()');
      await until('!!document.querySelector(\'[data-testid="discovery-reviewer"]\')');
      await evaluate(`(() => { const el = document.querySelector('[data-testid="discovery-reviewer"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Discovery reviewer'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await until('!document.querySelector(\'[data-testid="discovery-confirm"]\').disabled');
      await evaluate('document.querySelector(\'[data-testid="discovery-confirm"]\').click()');
      await until('!document.querySelector(\'[data-testid="discovery-reviewer"]\')');
      await evaluate('document.querySelector(\'[data-testid="discovery-filter-done"]\').click()');
      await until('document.querySelector(\'[data-testid="discovery-feed"]\').innerText.includes("Discovery reviewer")');
      await evaluate('document.querySelector(\'[data-testid="discovery-run"]\').click()');
      await until('!document.querySelector(\'[data-testid="discovery-run"]\').disabled');
      assert.match(await evaluate('document.querySelector(\'[data-testid="discovery-feed"]\').innerText'), /Discovery reviewer/);
      assert.equal((await api('GET', '/calculations?year=2025')).json.length, countsBeforeDiscoveryDecision);
      await evaluate('document.querySelector(\'[data-testid="discovery-filter-open"]\').click()');
      if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
        for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
          await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name === 'mobile' }, sid);
          await new Promise((r) => setTimeout(r, 200));
          assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${name}: discovery fits the screen`);
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
          fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, `-discovery-${name}.png`), Buffer.from(shot.result.data, 'base64'));
        }
        await send('Emulation.clearDeviceMetricsOverride', {}, sid);
      }

      // The single assistant keeps sources, follow-ups and report drafts together.
      await evaluate(`localStorage.setItem('apetit.lang', 'en')`);
      await send('Page.navigate', { url: WEB + '/gemini' }, sid);
      await until('location.pathname === "/data-quality" && !!document.querySelector(\'[data-testid="assistant-question"]\')');
      assert.equal(await evaluate('document.querySelectorAll(\'nav a[href="/gemini"]\').length'), 0);
      assert.equal(await evaluate('document.querySelectorAll(\'nav a[href="/assistant"]\').length'), 0);
      const fillAssistantQuestion = async (question: string) => {
        await evaluate(`(() => { const el = document.querySelector('[data-testid="assistant-question"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(question)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await until('!document.querySelector(\'[data-testid="assistant-send"]\').disabled');
        await evaluate('document.querySelector(\'[data-testid="assistant-send"]\').click()');
      };
      await fillAssistantQuestion('Which records need review?');
      await until('!!document.querySelector(\'[data-testid="assistant-response"]\')');
      assert.match(await evaluate('document.querySelector(\'[data-testid="assistant-response"]\').innerText'), /AI answer unavailable/);
      assert.ok(await evaluate('!!document.querySelector(\'[data-testid="assistant-evidence"] a\')'));
      assert.equal(await evaluate('!!document.querySelector(\'[data-testid="assistant-save"]\')'), false);

      // Script only AI responses; draft saving still uses the real temporary API/database.
      await evaluate(`(() => {
        const original = window.fetch.bind(window);
        window.__assistantRequests = [];
        window.fetch = async (input, init) => {
          if (new URL(String(input), location.href).pathname !== '/api/assistant/ask') return original(input, init);
          const body = JSON.parse(init.body);
          window.__assistantRequests.push(body);
          const response = window.__assistantRequests.length === 2
            ? { status: 'failed', message: 'Browser fixture temporary outage', facts: [], citations: [] }
            : { status: 'completed', answer: 'Browser fixture answer', interpretation: 'Browser fixture interpretation',
                citations: [{ id: 'dq:summary', label: 'Review queue fixture', value: 'Fixture context', source: 'dq_issues', link: '/data-quality' }],
                facts: [{ id: 'uncited:fixture', label: 'Uncited fixture should not be saved', value: 'unused', source: 'fixture' }],
                followups: ['Explain the same queue further.'], insufficient: false, evidence_count: 2, model: 'browser-scripted-model' };
          return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
      })()`);
      await evaluate(`history.pushState({}, '', '/data-quality?assist=1&year=2024'); window.dispatchEvent(new PopStateEvent('popstate'));`);
      await until('new URLSearchParams(location.search).get("year") === "2024" && document.querySelector(\'[data-testid="assistant-context"]\').textContent.includes("2024")');
      await fillAssistantQuestion('Explain the review queue for this year.');
      await until('!!document.querySelector(\'[data-testid="assistant-answer"]\')');
      await evaluate('document.querySelector(\'[data-testid="assistant-turn"]:nth-child(2) [data-testid="assistant-evidence"] summary\').click()');
      assert.equal(await evaluate('window.__assistantRequests[0].year'), 2024);
      assert.deepEqual(await evaluate('window.__assistantRequests[0].history'), []);
      assert.match(await evaluate('document.querySelector(\'[data-testid="assistant-interpretation"]\').textContent'), /Browser fixture interpretation/);
      assert.ok(await evaluate('!!document.querySelector(\'[data-testid="assistant-turn"]:nth-child(2) [data-testid="assistant-evidence"] a[href="/data-quality"]\')'));
      assert.ok(!await evaluate('document.querySelector(\'[data-testid="assistant-turn"]:nth-child(2)\').textContent.includes("Uncited fixture")'));
      await evaluate('document.querySelector(\'[data-testid="assistant-followup"]\').click()');
      await until('document.querySelectorAll(\'[data-testid="assistant-response"]\').length === 3');
      assert.match(await evaluate('document.querySelector(\'[data-testid="assistant-turn"]:last-child\').innerText'), /temporary outage/);
      await evaluate('document.querySelector(\'[data-testid="assistant-turn"]:last-child [data-testid="assistant-retry"]\').click()');
      await until('document.querySelectorAll(\'[data-testid="assistant-answer"]\').length === 2');
      const requests = await evaluate('window.__assistantRequests');
      assert.equal(requests.length, 3);
      assert.equal(requests[1].history.length, 2);
      assert.equal(requests[1].history[0].content, 'Explain the review queue for this year.');
      assert.deepEqual(requests[2].history, requests[1].history, 'retry excludes its own failed turn');

      // Save the older response after changing the selected year; it keeps its original context.
      await evaluate(`history.pushState({}, '', '/data-quality?assist=1&year=2025'); window.dispatchEvent(new PopStateEvent('popstate'));`);
      await until('new URLSearchParams(location.search).get("year") === "2025" && document.querySelector(\'[data-testid="assistant-context"]\').textContent.includes("2025")');
      const reportsBefore = (await api('GET', '/documents/reports')).json.length;
      await evaluate('document.querySelector(\'[data-testid="assistant-save"]\').click()');
      await until('!!document.querySelector(\'[data-testid="assistant-saved"]\')');
      const savedReports = (await api('GET', '/documents/reports')).json;
      assert.equal(savedReports.length, reportsBefore + 1);
      const savedAnswer = savedReports.find((report: { report_type: string }) => report.report_type === 'assistant_answer');
      assert.equal(savedAnswer.status, 'draft');
      assert.equal(savedAnswer.period, '2024');
      assert.equal(savedAnswer.language, 'en');
      assert.deepEqual(savedAnswer.citations.map((item: { id: string }) => item.id), ['dq:summary']);
      assert.ok(!JSON.stringify(savedAnswer).includes('Uncited fixture'));
      assert.ok(JSON.stringify(savedAnswer.sections).includes('Browser fixture interpretation'));
      if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
        for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
          await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name === 'mobile' }, sid);
          await new Promise((r) => setTimeout(r, 200));
          assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${name}: no horizontal overflow`);
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
          fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, `-assistant-${name}.png`), Buffer.from(shot.result.data, 'base64'));
        }
        await send('Emulation.clearDeviceMetricsOverride', {}, sid);
      }
      await evaluate('document.querySelector(\'[data-testid="assistant-saved"]\').click()');
      await until('location.pathname === "/reports" && document.body.innerText.includes("AI draft: Explain the review queue for this year.")');
      await evaluate(`(() => { const button = [...document.querySelectorAll('article button')].find(el => el.textContent.includes('AI draft: Explain the review queue for this year.')); if (button.getAttribute('aria-expanded') !== 'true') button.click(); })()`);
      await until('document.body.innerText.includes("AI generated") && document.body.innerText.includes("Browser fixture interpretation")');
      await evaluate('document.querySelector(\'[data-testid="assistant-mode-workspace"]\').click()');
      await fillAssistantQuestion('Now help me compare supplier data and action costs across the workspace.');
      await until('document.querySelectorAll(\'[data-testid="assistant-answer"]\').length === 3');
      assert.ok(await evaluate('window.__assistantRequests.at(-1).history.some(t=>t.content.includes("Explain the review queue"))'), 'workspace follow-ups retain cross-page conversation');
      assert.equal(await evaluate('window.__assistantRequests.at(-1).context.scope'), 'workspace');


      // A current year without operational data remains selectable, then real import events update it.
      for (const [route, selector] of [['raw-materials', 'raw-materials-year'], ['sustainability', 'sustainability-year']] as const) {
        await send('Page.navigate', { url: `${WEB}/${route}?year=2026` }, sid);
        await until(`document.querySelector('[data-testid="${selector}"]')?.value === '2026'`);
        assert.ok(await evaluate(`!!document.querySelector('[data-testid="${selector}"] option[value="2026"]')`));
      }
      await send('Page.navigate', { url: WEB + '/reports?year=2026' }, sid);
      await until('document.querySelector(\'[data-testid="report-year"]\')?.value === "2026" && document.body.innerText.includes("Save an emissions calculation for the selected year")');
      assert.equal(await evaluate('document.querySelector(\'[data-testid="create-report"]\').disabled'), true);
      await send('Page.navigate', { url: WEB + '/automations?year=2026' }, sid);
      await until('!!document.querySelector(\'[data-testid="add-demo-batch"]\')');
      assert.match(await evaluate('document.querySelector(\'[data-testid="live-demo"]\').innerText'), /saves synthetic files in this database/);
      await evaluate('document.querySelector(\'[data-testid="add-demo-batch"]\').click()');
      await until('!!document.querySelector(\'[data-testid="demo-result"]\')');
      const demoJobs = (await api('GET', '/documents/automation_runs?workflow_id=live_demo&year=2026')).json;
      const firstDemo = demoJobs[0];
      assert.equal(firstDemo.status, 'success');
      assert.equal(firstDemo.year, 2026);
      for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844], ['mobile-fi', 390, 844]] as const) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name !== 'desktop' }, sid);
        if (name === 'mobile-fi') await evaluate('document.querySelector(\'header button[aria-label="Suomi"]\').click()');
        await evaluate('window.scrollTo(0, 0)');
        assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${name}: live demo fits the viewport`);
        if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sid);
          fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, `-2026-automation-${name}.png`), Buffer.from(shot.result.data, 'base64'));
        }
      }
      await send('Emulation.clearDeviceMetricsOverride', {}, sid);
      await evaluate('document.querySelector(\'header button[aria-label="English"]\').click()');
      await send('Page.navigate', { url: WEB + '/sustainability?year=2026' }, sid);
      await until(`document.querySelector('[data-testid="inventory-metrics"]')?.dataset.runId === ${JSON.stringify(firstDemo.inventory_run_id)}`);
      const incoming = await api('POST', '/live-demo', { year: 2026, request_id: 'DEMO-browser-second-arrival' });
      const finishTime = Date.now() + 20000;
      let secondDemo;
      while (Date.now() < finishTime) {
        secondDemo = (await api('GET', `/live-demo/${incoming.json.id}`)).json;
        assert.notEqual(secondDemo.status, 'failed', secondDemo.error);
        if (secondDemo.status === 'success') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(secondDemo.status, 'success');
      assert.ok(secondDemo.total_tco2e > firstDemo.total_tco2e);
      await until(`document.querySelector('[data-testid="inventory-metrics"]')?.dataset.runId === ${JSON.stringify(secondDemo.inventory_run_id)}`);
      assert.match(await evaluate('document.querySelector(\'[data-testid="inventory-metrics"]\').innerText'), /8\.184/);
      assert.match(await evaluate('document.querySelector(\'[data-testid="inventory-metrics"]\').innerText'), /3\.060/);
      await evaluate('document.querySelector(\'header button[aria-label="Suomi"]\').click()');
      await until('document.querySelector(\'[data-testid="inventory-metrics"]\').innerText.includes("8,184")');
      await evaluate('document.querySelector(\'header button[aria-label="English"]\').click()');
      await until('document.querySelector(\'[data-testid="inventory-metrics"]\').innerText.includes("8.184")');
      await until('(() => { const rows = [...document.querySelectorAll(\'[data-testid="footprint-source"]\')]; if (rows.length < 2) return false; const first = Number(rows[0].dataset.tco2e); const second = Number(rows[1].dataset.tco2e); return first > 0 && second / first > 0.7 && second / first < 0.8; })()');
      assert.equal(await evaluate('location.pathname'), '/sustainability', 'the open calculation page receives the new result without navigation or reload');
      for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name === 'mobile' }, sid);
        await evaluate('window.scrollTo(0, 0)');
        assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${name}: 2026 calculation fits the viewport`);
        if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sid);
          fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH.replace(/\.png$/, `-2026-sustainability-${name}.png`), Buffer.from(shot.result.data, 'base64'));
        }
      }
      await send('Emulation.clearDeviceMetricsOverride', {}, sid);
      await send('Page.navigate', { url: WEB + '/raw-materials?year=2026' }, sid);
      await until('document.querySelector("main")?.innerText.includes("DEMO-MATERIAL-2026") && document.querySelector("main")?.innerText.includes("Showing 2 of 2")');
      assert.ok(!await evaluate('document.querySelector("main")?.innerText.includes("M104:SUP011")'), 'the 2026 view never substitutes 2025 purchases');
      await send('Page.navigate', { url: WEB + '/transport?year=2026' }, sid);
      await until(`document.querySelector('main')?.innerText.includes(${JSON.stringify(secondDemo.transport_run_id)})`);
      assert.equal(await evaluate('document.querySelector(\'[data-testid="transport-year"]\').value'), '2026');
      await send('Page.navigate', { url: WEB + '/reports?year=2026' }, sid);
      await until('!!document.querySelector(\'[data-testid="create-report"]\') && !document.querySelector(\'[data-testid="create-report"]\').disabled');
      await evaluate('document.querySelector(\'[data-testid="create-report"]\').click()');
      await until('document.querySelector(\'[data-testid="report-reader"]\')?.innerText.includes("Includes synthetic example data")');
      const demoPdf = await downloadPdf();
      assert.match(demoPdf.text, /DEMO[\s\S]*synthetic example\s+data/);

      for (const e of events) {
        const params = (e.params || {}) as Record<string, any>;
        if (e.method === 'Runtime.exceptionThrown') problems.push(`browser journey: ${params.exceptionDetails?.exception?.description || params.exceptionDetails?.text}`);
        if (e.method === 'Runtime.consoleAPICalled' && params.type === 'error') problems.push(`browser journey: console error ${JSON.stringify(params.args).slice(0, 300)}`);
        if (e.method === 'Network.responseReceived' && params.response?.status >= 400 && /\/api\//.test(params.response.url)) problems.push(`browser journey: HTTP ${params.response.status} ${params.response.url}`);
      }
      if (process.env.TRACEFLOW_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
        fs.writeFileSync(process.env.TRACEFLOW_SCREENSHOT_PATH, Buffer.from(shot.result.data, 'base64'));
      }
      ws.close();
      assert.deepEqual(problems, []);
    } finally {
      browser.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
});
