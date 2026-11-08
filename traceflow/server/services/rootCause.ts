import { type DB, type Row, all, json } from '../db/database.ts';
import { getIssueDetail } from './quality.ts';
import { investigate } from './investigator.ts';
import type { LlmClient } from './gemini.ts';

export function relatedDiscoveries(db: DB, issueId: string) {
  return all<Row>(db, `SELECT f.* FROM discovery_findings f JOIN discovery_runs r ON r.id = f.discovery_run_id
    WHERE json_extract(f.facts_json, '$.issue_id') = ? AND r.rowid = (SELECT MAX(r2.rowid) FROM discovery_runs r2
    WHERE r2.year = r.year AND r2.status IN ('completed','degraded','local_only')) ORDER BY f.rank LIMIT 8`, issueId)
    .map((f) => ({ id: String(f.id), key: String(f.finding_key), found: { en: String(f.found_en), fi: String(f.found_fi) }, suggest: { en: String(f.suggest_en), fi: String(f.suggest_fi) }, facts: json(f.facts_json, {}), effect: json(f.effect_json, {}), evidence: json(f.evidence_json, []) }));
}

export async function incidentRootCause(db: DB, id: string, llm: LlmClient | null, lang: 'fi' | 'en') {
  const detail = getIssueDetail(db, id);
  const discoveries = relatedDiscoveries(db, id);
  const result = await investigate(db, id, llm, { purpose: 'root_cause', lang, discoveryEvidence: discoveries });
  const fi = lang === 'fi';
  const fallback = {
    issue_id: id, status: 'NEEDS_EVIDENCE', review_status: 'pending',
    summary: fi ? 'Tarkistettava havainto; juurisyytä ei ole vahvistettu.' : 'This incident needs review; its root cause has not been established.',
    suspected_cause: fi ? 'Syytä ei ole vahvistettu lähdeaineistosta.' : 'The cause has not been established from the source evidence.',
    observations: [fi ? detail.issue.explanation : detail.issue.explanation_en], inferences: [],
    uncertainty: fi ? 'AI:n juurisyyanalyysi ei ole tällä hetkellä käytettävissä. Alla näkyy tallennettu näyttö.' : 'AI root-cause analysis is currently unavailable. The recorded evidence is shown below.',
    missing_evidence: [fi ? 'Vahvistus tiedon omistajalta ja alkuperäisestä asiakirjasta.' : 'Confirmation from the data owner and original document.'],
    next_human_action: fi ? 'Tarkista alkuperäinen merkintä ja sen yksikkö tai puuttuva tieto.' : 'Check the original entry, its unit, or the missing information.',
    evidence_ids: [id, ...(detail.record ? [detail.record.id] : [])], proposed_value: null,
    calculated_impact: { value: null, unit: 'tCO2e', basis: 'not calculated' }, validation_notes: [] as string[],
  };
  const analysis = 'result' in result && result.result ? result.result : fallback;
  const known = new Map([detail.record, ...detail.evidence].filter((r) => !!r).map((r) => [r!.id, r!]));
  return {
    status: result.status, analysis, issue: detail.issue, discoveries,
    agent: 'incident_root_cause_specialist', investigation_id: 'id' in result ? result.id : null,
    citations: analysis.evidence_ids.map((eid) => {
      const source = known.get(eid);
      return { id: eid, label: source ? `${source.source_file} · ${fi ? 'rivi' : 'line'} ${source.source_row}` : eid === id ? fi ? 'Tallennettu havainto ja tarkistussääntö' : 'Recorded incident and detector rule' : fi ? 'Tutkimuksessa tarkistettu lähde' : 'Evidence checked during investigation', link: `/data-quality?issue=${encodeURIComponent(id)}` };
    }),
    original: detail.record ? { id: detail.record.id, file: detail.record.source_file, row: detail.record.source_row, values: detail.record.payload } : null,
  };
}
