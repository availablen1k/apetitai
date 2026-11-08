// Automations and deterministic report drafts. Questions are answered by the expert team
// (experts.ts); facts always come from the database.
import type { Config } from '../config.ts';
import { type DB, type Row, all, get, nowIso } from '../db/database.ts';
import { round } from '../domain/util.ts';
import { HttpError, recordAudit } from './common.ts';
import { createRun, getRun, latestRun } from './calculations.ts';
import { type ReportContext, readableReport } from '../domain/readableReport.ts';
import { standing } from './decisionWorkspace.ts';
import { errMessage } from './gemini.ts';
import { runScan } from './quality.ts';
import { createDoc, farmForecastOutlook, farms } from './workspace.ts';
import { REGIONS } from '../providers/openmeteo.ts';

// ---------------------------------------------------------------- automations
const WORKFLOWS: Record<string, { fi: string; en: string }> = {
  data_intake: { fi: 'Datan vastaanotto ja laatutarkistus', en: 'Data intake and quality scan' },
  weather_monitor: { fi: 'Sääseuranta sopimustiloille', en: 'Weather monitor for contract farms' },
  reporting: { fi: 'Inventaarion uudelleenlaskenta', en: 'Inventory recalculation' },
};

export async function runAutomation(db: DB, cfg: Config, workflow: string, year: number) {
  const wf = WORKFLOWS[workflow];
  if (!wf) throw new HttpError(400, `Unknown workflow ${workflow}`);
  const t0 = Date.now();
  const log: string[] = [];
  const logEn: string[] = [];
  let records = 0;
  let exceptions = 0;
  let status = 'success';
  let outputRef = '';
  try {
    if (workflow === 'data_intake') {
      const s = runScan(db);
      records = Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM source_records')?.n || 0);
      exceptions = s.created;
      log.push(`Säännöt ${s.rules_version}: ${s.findings} havaintoa, ${s.created} uutta, ${s.updated} päivitettyä.`);
      logEn.push(`Rules ${s.rules_version}: ${s.findings} findings, ${s.created} new, ${s.updated} updated.`);
      outputRef = `scan ${s.scan_id}`;
    } else if (workflow === 'reporting') {
      const r = createRun(db, { year, trigger: 'automation:reporting' });
      records = r.contribution_count;
      exceptions = r.gaps.length;
      log.push(`Laskenta ${r.id}: ${round(r.totals.grand_total ?? 0, 1)} tCO₂e, ${r.contribution_count} riviä.`);
      logEn.push(`Run ${r.id}: ${round(r.totals.grand_total ?? 0, 1)} tCO₂e, ${r.contribution_count} contributions.`);
      outputRef = `run ${r.id}`;
      if (r.status !== 'complete') status = 'partial';
    } else {
      const regions = [...new Set([...farms(db).values()].map((f) => String(f.region)))].filter((r) => REGIONS[r]);
      if (!regions.length) throw new Error('No farm registry imported');
      for (const code of regions) {
        const o = await farmForecastOutlook(db, code);
        records += o.farms.total;
        for (const f of o.farms.items.filter((i) => i.level === 'high').slice(0, 25)) {
          const drivers = f.drivers.map((d) => `${d.code}=${d.value}`).join(', ');
          createDoc(db, 'farm_alerts', {
            farm_id: f.farm_id, region: code, severity: f.level, drivers: f.drivers, generated_by: 'workflow:weather_monitor', source: 'open-meteo 7-day forecast', created_at: nowIso(),
            title: `Sääriski seuraavan 7 vuorokauden aikana (${f.level})`, title_en: `Weather risk in the next 7 days (${f.level})`,
            explanation: `Open-Meteo-ennuste tilan koordinaateille: ${drivers}. Pisteet ${f.score}.`, explanation_en: `Open-Meteo forecast for the farm coordinates: ${drivers}. Score ${f.score}.`,
            recommended_action: 'Tarkista viljelyneuvojan kanssa, tarvitaanko toimenpiteitä.', recommended_action_en: 'Check with the field advisor whether action is needed.',
          });
          exceptions++;
        }
        log.push(`${code}: ${o.farms.total} tilaa, ${o.farms.counts.high} korkea riski.`);
        logEn.push(`${code}: ${o.farms.total} farms, ${o.farms.counts.high} high risk.`);
      }
    }
  } catch (e) {
    status = 'failed';
    log.push(`Virhe: ${errMessage(e)}`);
    logEn.push(`Error: ${errMessage(e)}`);
  }
  const doc = createDoc(db, 'automation_runs', { workflow_id: workflow, year, workflow_name: wf.fi, workflow_name_en: wf.en, status, started_at: new Date(t0).toISOString(), duration_ms: Date.now() - t0, records_processed: records, exceptions, log, log_en: logEn, output_ref: outputRef, output_ref_en: outputRef, time_saved_min: null });
  recordAudit(db, { event_type: 'automation.run', actor_kind: 'system', actor_label: 'system', entity_type: 'automation_run', entity_id: doc.id, after: { workflow, status, records, exceptions } });
  void cfg;
  return { run: doc };
}

// ---------------------------------------------------------------- report drafts
// Exposure and driver-size findings restate the trust line and the largest sources.
const actionable = (f: Row) => f.kind !== 'open_issue_exposure' && (JSON.parse(String(f.effect_json || '{}')) as { basis?: string }).basis !== 'driver_size';

// The top three open findings from the latest finished discovery of this exact calculation.
function openFindings(db: DB, runId: string, year: number) {
  const latest = get<{ id: string }>(db, "SELECT id FROM discovery_runs WHERE calc_run_id = ? AND status IN ('completed','degraded','local_only') ORDER BY created_at DESC LIMIT 1", runId);
  if (!latest) return [];
  const closed = new Set(all<{ finding_key: string; decision: string }>(db, 'SELECT finding_key, decision FROM discovery_decisions d WHERE year = ? AND rowid = (SELECT MAX(rowid) FROM discovery_decisions WHERE finding_key = d.finding_key AND year = d.year)', year)
    .filter((d) => d.decision === 'done' || d.decision === 'dismissed').map((d) => d.finding_key));
  return all<Row>(db, 'SELECT * FROM discovery_findings WHERE discovery_run_id = ? ORDER BY rank', latest.id).filter((f) => !closed.has(String(f.finding_key)) && actionable(f)).slice(0, 3);
}

export function generateReportDraft(db: DB, input: { year: number; lang: 'fi' | 'en' }) {
  const r = latestRun(db, input.year);
  if (!r) throw new HttpError(409, `No calculation run for ${input.year}. Calculate the inventory first.`);
  const previous = r.parent_run_id ? getRun(db, r.parent_run_id) : null;
  const s = standing(db, r)!;
  const steps = openFindings(db, r.id, r.year);
  const ctx = (lang: 'fi' | 'en'): ReportContext => ({
    prior: s.previous && { year: s.previous.year, grand_total: s.previous.grand_total, comparable: s.previous.comparable, change_tco2e: s.previous.change_tco2e, change_pct: s.previous.change_pct },
    open_issue_tco2e: s.trust.open_issue_tco2e, open_issue_share_pct: s.trust.open_issue_share_pct, critical_incidents: s.trust.critical_incidents, missing_activity: s.trust.missing_activity,
    next_steps: steps.map((f) => ({ found: String(lang === 'fi' ? f.found_fi : f.found_en), suggest: String(lang === 'fi' ? f.suggest_fi : f.suggest_en), tco2e: (JSON.parse(String(f.effect_json || '{}')) as { tco2e?: number | null }).tco2e ?? null })),
  });
  const en = readableReport(r, previous, 'en', ctx('en'));
  const fi = readableReport(r, previous, 'fi', ctx('fi'));
  const content = input.lang === 'fi' ? fi : en;
  const doc = createDoc(db, 'reports', {
    title: input.lang === 'fi' ? `Päästöraportti ${r.year}${r.completeness.contains_demo_data ? " · DEMO" : ""}` : `Emissions report ${r.year}${r.completeness.contains_demo_data ? " · DEMO" : ""}`, title_fi: `Päästöraportti ${r.year}${r.completeness.contains_demo_data ? " · DEMO" : ""}`, title_en: `Emissions report ${r.year}${r.completeness.contains_demo_data ? " · DEMO" : ""}`,
    report_type: 'sustainability_overview', reader_version: 2, period: String(r.year), status: 'draft', run_id: r.id,
    summary: content.result, sections: content.sections, sections_en: en.sections, sections_fi: fi.sections,
    technical_sections: content.technicalSections, technical_sections_en: en.technicalSections, technical_sections_fi: fi.technicalSections,
    reader_snapshot: en.snapshot, citations: [{ id: r.id, label: input.lang === 'fi' ? `Vuoden ${r.year} tallennettu laskelma` : `Saved calculation for ${r.year}`, ref: r.id }],
    generated_by: 'deterministic template', language: input.lang,
  });
  recordAudit(db, { event_type: 'report.draft_created', actor_kind: 'system', actor_label: 'system', entity_type: 'report', entity_id: doc.id, after: { run_id: r.id } });
  return { report: doc };
}
