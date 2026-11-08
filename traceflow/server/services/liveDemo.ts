// Explicit, synthetic import events exercise the real importer, rules and inventory engine.
import type { Config } from '../config.ts';
import { type DB, get, nowIso } from '../db/database.ts';
import { createRun, latestRun } from './calculations.ts';
import { HttpError, recordAudit } from './common.ts';
import { importFile } from './imports.ts';
import { runScan } from './quality.ts';
import { type Doc, createDoc, getDoc, listDocs, updateDoc } from './workspace.ts';

type DemoJob = Doc & { year: number; status: string; phase: string; request_id: string; log_en: string[] };
const csv = (headers: string[], rows: (string | number)[][]) => Buffer.from([headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n') + '\n');

export function createLiveDemo(db: DB, cfg: Config) {
  let active: Promise<void> | null = null;
  const jobs = () => listDocs(db, 'automation_runs', { workflow_id: 'live_demo' }, { limit: 1000 });
  for (const job of jobs().filter((item) => ['queued', 'running'].includes(String(item.status)))) updateDoc(db, 'automation_runs', job.id, { status: 'failed', phase: 'interrupted', error: 'Server restarted. Imported files are retained. Inspect this batch before adding another.' });

  const execute = async (job: DemoJob) => {
    const started = Date.now();
    const log: string[] = [];
    const batchIds: string[] = [];
    let importedRows = 0;
    const patch = (data: Record<string, unknown>) => updateDoc(db, 'automation_runs', job.id, { ...data, log: log, log_en: log, batch_ids: batchIds });
    try {
      patch({ status: 'running', phase: 'importing' });
      const year = job.year;
      const suffix = job.id.slice(-12);
      const site = `DEMO-${year}-${suffix}`;
      const doc = `DEMO-${year}-${suffix}`;
      const material = `DEMO-MATERIAL-${year}`;
      const supplier = `DEMO-SUPPLIER-${year}`;
      const goodsFactor = `EF-LIVE-DEMO-GOODS-${year}`;
      const factors: (string | number)[][] = [
        [goodsFactor, 'kg', 0.5, 'demo', 'Synthetic live demo; illustrative factor', year, 'true'],
        [`EF-ELEC-LB:${site}:${year}`, 'MWh', 25, 'demo', 'Synthetic live demo; illustrative electricity factor', year, 'true'],
        [`EF-ELEC-MB:${site}:${year}`, 'MWh', 400, 'demo', 'Synthetic live demo; illustrative electricity factor', year, 'true'],
      ];
      // Reuse existing transport/upstream factors; never replace a library factor to run a demo.
      for (const [id, unit, value] of [['EF-TKM-TRUCK', 'tkm', 0.1], ['EF-ELEC-UPSTREAM-FI', 'MWh', 10]] as const) {
        if (!get(db, "SELECT id FROM source_records WHERE table_name = 'emission_factors' AND json_extract(payload_json, '$.ef_id') = ?", id)) factors.push([id, unit, value, 'demo', 'Synthetic live demo; illustrative factor', year, 'true']);
      }
      const files = [
        { dataset: 'sites', bytes: csv(['site_id', 'name', 'country', 'demo'], [[site, `Synthetic demo site ${suffix}`, 'FI', 'true']]) },
        { dataset: 'suppliers', bytes: csv(['supplier_id', 'supplier_name', 'country', 'demo'], [[supplier, 'Synthetic demo supplier', 'FI', 'true']]) },
        { dataset: 'materials', bytes: csv(['material_id', 'material_group', 'base_uom', 'default_ef_id', 'demo'], [[material, 'raw_material', 'KG', goodsFactor, 'true']]) },
        { dataset: 'emission_factors', bytes: csv(['ef_id', 'unit', 'kgco2e_per_unit', 'source_type', 'reference_source', 'version', 'demo'], factors) },
        { dataset: 'erp_purchase_lines', bytes: csv(['doc_no', 'line_no', 'posting_date', 'plant', 'material_id', 'supplier_id', 'quantity', 'uom', 'net_amount', 'currency', 'movement_type', 'demo'], [[doc, 10, `${year}-01-15`, site, material, supplier, 1000, 'KG', 600, 'EUR', 101, 'true']]) },
        { dataset: 'shipments', bytes: csv(['shipment_id', 'year', 'direction', 'ref_doc', 'ef_id', 'mode', 't', 'km', 'tkm', 'demo'], [[`DEMO-SHIP-${suffix}`, year, 'inbound', doc, 'EF-TKM-TRUCK', 'truck', 1, 120, 120, 'true']]) },
        { dataset: 'energy_meter_readings', bytes: csv(['site_id', 'year', 'month', 'carrier', 'value', 'unit', 'demo'], [[site, year, 1, 'electricity', 5, 'MWh', 'true']]) },
        { dataset: 'refrigerant_service_log', bytes: csv(['site_id', 'refrigerant', 'year', 'event_id', 'kg_added', 'demo'], [[site, 'R134a', year, `DEMO-REF-${suffix}`, 1, 'true']]) },
      ];
      for (const file of files) {
        const outcome = await importFile(db, cfg.uploadsDir, { filename: `${file.dataset}_LIVE_DEMO_${year}_${suffix}.csv`, bytes: file.bytes, dataset: file.dataset });
        batchIds.push(outcome.batch.id);
        importedRows += outcome.batch.imported_rows;
        if (outcome.batch.rejected_rows || outcome.batch.status === 'rejected') throw new Error(`Demo import failed for ${file.dataset}; inspect the import errors.`);
        log.push(`${file.dataset}: ${outcome.batch.imported_rows} new rows, ${outcome.batch.duplicate_rows} existing rows.`);
        patch({ records_processed: importedRows });
      }
      patch({ phase: 'checking' });
      const scan = runScan(db, { tables: ['erp_purchase_lines', 'shipments', 'energy_meter_readings', 'refrigerant_service_log'] });
      log.push(`Built-in quality checks finished: ${scan.created} new findings. No correction was approved.`);
      const previous = latestRun(db, year);
      patch({ phase: 'calculating', scan_id: scan.scan_id, previous_run_id: previous?.id || null, previous_total: previous?.totals.grand_total ?? null });
      const inventory = createRun(db, { year, scope2_basis: 'market', trigger: `live_demo:${job.id}` });
      patch({ inventory_run_id: inventory.id });
      const transport = createRun(db, { year, kind: 'transport', scope2_basis: 'market', trigger: `live_demo:${job.id}` });
      log.push(`Inventory saved: ${inventory.id}. Transport saved: ${transport.id}. Synthetic inputs remain labelled DEMO.`);
      patch({ status: 'success', phase: 'completed', inventory_run_id: inventory.id, transport_run_id: transport.id, total_tco2e: inventory.totals.grand_total, change_tco2e: previous ? inventory.totals.grand_total - previous.totals.grand_total : null, exceptions: scan.created, duration_ms: Date.now() - started, finished_at: nowIso(), output_ref: `DEMO ${year} · ${inventory.id}` });
      recordAudit(db, { event_type: 'demo.completed', actor_kind: 'system', actor_label: 'explicit synthetic demo', entity_type: 'automation_run', entity_id: job.id, after: { year, batch_ids: batchIds, run_id: inventory.id, transport_run_id: transport.id } });
    } catch (error) {
      patch({ status: 'failed', phase: 'failed', error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - started, finished_at: nowIso() });
    }
  };
  return {
    start(year: number, requestId: string) {
      const saved = get<{ id: string }>(db, "SELECT id FROM documents WHERE collection = 'automation_runs' AND json_extract(data_json, '$.workflow_id') = 'live_demo' AND json_extract(data_json, '$.request_id') = ? LIMIT 1", requestId);
      const existing = saved ? getDoc(db, 'automation_runs', saved.id) : null;
      if (existing) { if (existing.year !== year) throw new HttpError(409, 'This request ID belongs to another year.'); return existing; }
      if (active) throw new HttpError(409, 'A demo batch is already running. Wait for it to finish.');
      const job = createDoc(db, 'automation_runs', { workflow_id: 'live_demo', workflow_name: 'Synteettisen datan live-demo', workflow_name_en: 'Live demo with synthetic data', year, request_id: requestId, is_demo: true, status: 'queued', phase: 'queued', started_at: nowIso(), records_processed: 0, exceptions: 0, duration_ms: 0, log: [], log_en: [] }) as DemoJob;
      active = Promise.resolve().then(() => execute(job)).finally(() => { active = null; });
      return job;
    },
    get(id: string) { const job = getDoc(db, 'automation_runs', id); if (job.workflow_id !== 'live_demo') throw new HttpError(404, 'Demo batch not found.'); return job; },
    async stop() { await active; },
  };
}
