// Discovery runs: mine the saved calculation (discoveryMiners.ts), let each hidden expert word its
// findings (experts.ts), store the result and keep human decisions. Runs one at a time in the
// background; a run requested for a year that already has one queued is coalesced into it.
import { z } from 'zod';
import type { Config } from '../config.ts';
import { type DB, type Row, all, get, json, nowIso, run, tx } from '../db/database.ts';
import { newId } from '../domain/util.ts';
import { onRunSaved } from './calculations.ts';
import { HttpError, recordAudit } from './common.ts';
import { type Candidate, type ExpertId, discoveryRun, mine } from './discoveryMiners.ts';
import { EXPERTS, wordFindings } from './experts.ts';
import { type LlmClient, errMessage } from './gemini.ts';

export const DecisionBody = z.object({
  year: z.number().int().min(2000).max(2100),
  decision: z.enum(['done', 'dismissed', 'reopened']),
  reviewer_label: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional(),
});

const EXPERT_ORDER: ExpertId[] = ['data_quality_reviewer', 'footprint_analyst', 'raw_materials_analyst', 'reduction_advisor'];

function runView(r: Row | undefined) {
  if (!r) return null;
  return { id: r.id, year: r.year, calc_run_id: r.calc_run_id, trigger: r.trigger, status: r.status, mode: r.mode, model: r.model, notes: json<string[]>(r.notes_json, []), ai_calls: r.ai_calls, error: r.error, created_at: r.created_at, finished_at: r.finished_at };
}

export function createDiscovery(db: DB, cfg: Config, llm: LlmClient | null) {
  let active: Promise<void> | null = null;
  let stopped = false;

  const execute = async (id: string) => {
    const row = get<Row>(db, 'SELECT * FROM discovery_runs WHERE id = ?', id)!;
    const year = Number(row.year);
    run(db, "UPDATE discovery_runs SET status = 'running', started_at = ? WHERE id = ?", nowIso(), id);
    const notes: string[] = [];
    let calls = 0;
    const usage = { input: 0, output: 0 };
    try {
      const mined = mine(db, cfg.nature, year);
      notes.push(...mined.notes);
      if (!mined.run) {
        run(db, "UPDATE discovery_runs SET status = 'failed', error = ?, notes_json = ?, finished_at = ? WHERE id = ?", mined.notes[0] || 'Nothing to mine', JSON.stringify(notes), nowIso(), id);
        return;
      }
      let rejected = 0;
      const minedRunId = mined.run.id;
      let failedCalls = 0;
      let rank = 0;
      const rows: { c: Candidate; w: Awaited<ReturnType<typeof wordFindings>>['worded'][number] }[] = [];
      for (const expert of EXPERT_ORDER) {
        const group = mined.candidates.filter((c) => c.expert === expert);
        if (!group.length) continue;
        const r = await wordFindings(llm, expert, group);
        calls += r.calls;
        usage.input += r.usage.input;
        usage.output += r.usage.output;
        if (r.error) { failedCalls++; notes.push(`${EXPERTS[expert].label.en}: ${r.error}`); }
        for (const w of r.worded) {
          if (w.check.reason === 'unverified figure in AI wording') { rejected++; notes.push(`${EXPERTS[expert].label.en}: AI wording for ${w.key} contained unverified figure(s) ${w.check.rejected.join(', ')}; the checked deterministic wording is shown.`); }
          else if (llm && w.wording === 'template' && !r.error) { failedCalls++; notes.push(`Deterministic wording used for ${w.key}: ${w.check.reason}.`); }
          rows.push({ c: group.find((c) => c.key === w.key)!, w });
        }
      }
      const ins = db.prepare(`INSERT INTO discovery_findings (id, discovery_run_id, finding_key, expert, kind, rank, found_en, found_fi, suggest_en, suggest_fi, who_json, effect_json, action_json, evidence_json, facts_json, wording, check_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const status = !llm ? 'local_only' : rejected || failedCalls ? 'degraded' : 'completed';
      tx(db, () => {
        for (const { c, w } of rows) ins.run(newId('dfd'), id, c.key, c.expert, c.kind, rank++, w.found.en, w.found.fi, w.suggest.en, w.suggest.fi, JSON.stringify(c.who), JSON.stringify(c.effect), JSON.stringify(c.action), JSON.stringify(c.evidence), JSON.stringify(c.facts), w.wording, JSON.stringify(w.check));
        run(db, 'UPDATE discovery_runs SET status = ?, calc_run_id = ?, notes_json = ?, ai_calls = ?, input_tokens = ?, output_tokens = ?, finished_at = ? WHERE id = ?', status, minedRunId, JSON.stringify(notes), calls, usage.input, usage.output, nowIso(), id);
      });
      recordAudit(db, { event_type: `discovery.${status}`, actor_kind: llm ? 'ai' : 'system', actor_label: llm ? `${llm.mode}:${llm.model}` : 'discovery (local)', entity_type: 'discovery_run', entity_id: id, after: { year, calc_run_id: mined.run.id, findings: rows.length, ai_calls: calls, rejected_wordings: rejected } });
    } catch (e) {
      run(db, "UPDATE discovery_runs SET status = 'failed', error = ?, notes_json = ?, ai_calls = ?, finished_at = ? WHERE id = ?", errMessage(e), JSON.stringify(notes), calls, nowIso(), id);
    }
  };

  const kick = () => {
    if (active || stopped) return;
    active = (async () => {
      for (;;) {
        if (stopped) break;
        const next = get<{ id: string }>(db, "SELECT id FROM discovery_runs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1");
        if (!next) break;
        await execute(next.id);
      }
    })().finally(() => { active = null; });
  };

  const enqueue = (input: { year: number; trigger: string; request_id?: string; calc_run_id?: string | null }) => {
    if (input.request_id) {
      const existing = get<Row>(db, 'SELECT * FROM discovery_runs WHERE request_id = ?', input.request_id);
      if (existing) {
        if (existing.year !== input.year) throw new HttpError(409, 'Request id already belongs to a different year.');
        return { run: runView(existing), reused: true };
      }
    }
    const queued = get<Row>(db, "SELECT * FROM discovery_runs WHERE year = ? AND status = 'queued' ORDER BY created_at DESC LIMIT 1", input.year);
    if (queued && !input.request_id) return { run: runView(queued), reused: true };
    if (!discoveryRun(db, input.year)) throw new HttpError(409, `No saved calculation for ${input.year}. Calculate the inventory first.`);
    const id = newId('dsc');
    run(db, "INSERT INTO discovery_runs (id, request_id, year, calc_run_id, trigger, status, mode, model, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)", id, input.request_id ?? null, input.year, input.calc_run_id ?? null, input.trigger, llm ? llm.mode : 'local', llm?.model ?? null, nowIso());
    setTimeout(kick, 0);
    return { run: runView(get<Row>(db, 'SELECT * FROM discovery_runs WHERE id = ?', id)), reused: false };
  };

  const unsubscribe = cfg.discoveryAfterCalculation
    ? onRunSaved(db, (saved) => { if (saved.kind === 'inventory') enqueue({ year: saved.year, trigger: `calculation:${saved.id}`, calc_run_id: saved.id }); })
    : () => {};

  return {
    start() {
      run(db, "UPDATE discovery_runs SET status = 'interrupted', error = 'Server restarted during discovery. Run it again.', finished_at = ? WHERE status = 'running'", nowIso());
      kick();
    },
    enqueue,
    feed(year: number, lang: 'en' | 'fi' = 'en') {
      const latest = get<Row>(db, "SELECT * FROM discovery_runs WHERE year = ? AND status IN ('completed','degraded','local_only') ORDER BY created_at DESC LIMIT 1", year);
      const pending = get<Row>(db, "SELECT * FROM discovery_runs WHERE year = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1", year);
      const failed = get<Row>(db, "SELECT * FROM discovery_runs WHERE year = ? AND status IN ('failed','interrupted') ORDER BY created_at DESC LIMIT 1", year);
      const calc = discoveryRun(db, year)?.run;
      const decisions = new Map(all<Row>(db, 'SELECT * FROM discovery_decisions WHERE year = ? ORDER BY decided_at, rowid', year).map((d) => [String(d.finding_key), d]));
      const findings = latest ? all<Row>(db, 'SELECT * FROM discovery_findings WHERE discovery_run_id = ? ORDER BY rank', String(latest.id)).map((f) => {
        const d = decisions.get(String(f.finding_key));
        const state = !d || d.decision === 'reopened' ? 'open' : String(d.decision);
        return {
          id: f.id, key: f.finding_key, expert: f.expert, checked_by: EXPERTS[f.expert as ExpertId].label[lang], kind: f.kind,
          found: lang === 'fi' ? f.found_fi : f.found_en, suggest: lang === 'fi' ? f.suggest_fi : f.suggest_en,
          who: json<{ en: string; fi: string }>(f.who_json, { en: '', fi: '' })[lang], effect: json(f.effect_json, {}), action: json(f.action_json, {}), evidence: json(f.evidence_json, []),
          facts: json(f.facts_json, {}), wording: f.wording, check: json(f.check_json, {}), state, decided_by: d && state !== 'open' ? d.reviewer_label : null, decided_at: d && state !== 'open' ? d.decided_at : null, note: d?.note ?? null,
        };
      }) : [];
      const latestCalc = calc?.id ?? null;
      return { year, calculation_id: latestCalc, run: runView(latest), pending: runView(pending), last_failure: failed && (!latest || String(failed.created_at) > String(latest.created_at)) ? runView(failed) : null, stale: !!latest && !!latestCalc && latest.calc_run_id !== latestCalc, findings };
    },
    decide(key: string, input: z.infer<typeof DecisionBody>) {
      if (!get(db, 'SELECT 1 FROM discovery_findings f JOIN discovery_runs r ON r.id = f.discovery_run_id WHERE f.finding_key = ? AND r.year = ? LIMIT 1', key, input.year)) throw new HttpError(404, 'Finding not found for this year');
      const id = newId('ddc');
      run(db, 'INSERT INTO discovery_decisions (id, finding_key, year, decision, reviewer_label, note, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, key, input.year, input.decision, input.reviewer_label, input.note ?? null, nowIso());
      recordAudit(db, { event_type: `discovery.finding_${input.decision}`, actor_kind: 'reviewer', actor_label: input.reviewer_label, entity_type: 'discovery_finding', entity_id: key, after: { year: input.year, note: input.note ?? null }, reason: input.note ?? null });
      return { id, key, decision: input.decision };
    },
    async stop() {
      stopped = true;
      unsubscribe();
      await active;
    },
  };
}
