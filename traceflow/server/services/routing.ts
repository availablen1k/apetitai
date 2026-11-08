// Transport legs and route proposals. A route proposal is evidence about a leg, not proof of
// the carrier's actual journey: provider output stays "proposed" until a reviewer confirms it
// with documentary evidence. Calculations keep using the supplied distance of the leg.
import { z } from 'zod';
import type { Config } from '../config.ts';
import { type DB, all, get, json, nowIso, run, tx } from '../db/database.ts';
import { newId, round, sanitizeLabel } from '../domain/util.ts';
import { HttpError, recordAudit } from './common.ts';

export type ShipmentFilter = { year?: number; direction?: string; mode?: string; join_status?: string; route_status?: string; q?: string; limit?: number; offset?: number };

export function listShipments(db: DB, f: ShipmentFilter) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.year) { where.push('s.year = ?'); params.push(f.year); }
  if (f.direction) { where.push('s.direction = ?'); params.push(f.direction); }
  if (f.mode) { where.push('s.mode = ?'); params.push(f.mode); }
  if (f.join_status) { where.push('s.join_status = ?'); params.push(f.join_status); }
  if (f.q) { where.push('(s.shipment_id LIKE ? OR s.ref_doc LIKE ? OR s.material_id LIKE ? OR s.supplier_id LIKE ?)'); const l = `%${f.q}%`; params.push(l, l, l, l); }
  const routeSql = `(SELECT status FROM route_proposals rp WHERE rp.shipment_record_id = s.record_id ORDER BY CASE status WHEN 'verified' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END, created_at DESC LIMIT 1)`;
  if (f.route_status === 'verified') where.push(`${routeSql} = 'verified'`);
  else if (f.route_status === 'proposed') where.push(`${routeSql} = 'proposed'`);
  else if (f.route_status === 'supplied_distance') where.push(`${routeSql} IS NULL`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM shipments s ${w}`, ...params)?.n || 0);
  const limit = Math.min(Math.max(f.limit || 50, 1), 500);
  const rows = all(
    db,
    `SELECT s.*, f.kgco2e_per_unit AS factor_value, f.record_id AS factor_record_id, ${routeSql} AS route_proposal_status,
       (SELECT COUNT(*) FROM dq_issues i WHERE i.record_id = s.record_id AND i.status = 'open') AS open_issues
     FROM shipments s LEFT JOIN v_emission_factors f ON f.ef_id = s.ef_id ${w}
     ORDER BY s.year DESC, s.ref_doc, s.shipment_id LIMIT ? OFFSET ?`,
    ...params, limit, Math.max(f.offset || 0, 0),
  ).map((r) => {
    const t = r.freight_t === null ? null : Number(r.freight_t);
    const km = r.distance_km === null ? null : Number(r.distance_km);
    const fv = r.factor_value === null ? null : Number(r.factor_value);
    const tkm = t !== null && km !== null ? t * km : null;
    return {
      ...r,
      tkm_calculated: tkm === null ? null : round(tkm, 6),
      kgco2e_preview: tkm !== null && fv !== null ? round(tkm * fv, 6) : null,
      route_label: r.route_proposal_status === 'verified' ? 'verified_route' : r.route_proposal_status === 'proposed' ? 'route_proposed' : r.route_status,
      geometry: 'route geometry unavailable',
    };
  });
  const summary = all(db, `SELECT s.mode, s.direction, COUNT(*) AS legs, SUM(s.freight_t * s.distance_km) AS tkm, SUM(s.freight_t * s.distance_km * f.kgco2e_per_unit) AS kgco2e FROM shipments s LEFT JOIN v_emission_factors f ON f.ef_id = s.ef_id ${w} GROUP BY s.mode, s.direction ORDER BY tkm DESC`, ...params);
  const joins = all(db, `SELECT join_status, COUNT(*) AS n FROM shipments s ${w} GROUP BY join_status`, ...params);
  return { total, limit, offset: f.offset || 0, items: rows, summary, joins };
}

export function getShipment(db: DB, recordId: string) {
  const s = get(db, 'SELECT * FROM shipments WHERE record_id = ?', recordId);
  if (!s) throw new HttpError(404, `Shipment leg ${recordId} not found`);
  const record = get(db, 'SELECT * FROM source_records WHERE id = ?', recordId);
  const erp = s.erp_record_id ? get(db, 'SELECT * FROM source_records WHERE id = ?', String(s.erp_record_id)) : null;
  const siblings = all(db, 'SELECT * FROM shipments WHERE ref_doc = ? AND record_id <> ? ORDER BY shipment_id', String(s.ref_doc), recordId);
  const routes = all(db, 'SELECT * FROM route_proposals WHERE shipment_record_id = ? ORDER BY created_at DESC', recordId).map((r) => ({
    ...r, provider_response: json(r.provider_response_json, null), legs: all(db, 'SELECT * FROM route_legs WHERE route_id = ? ORDER BY leg_order', String(r.id)),
  }));
  const factor = get(db, 'SELECT * FROM v_emission_factors WHERE ef_id = ?', String(s.ef_id));
  const issues = all(db, 'SELECT id, rule_id, issue_type, severity, status, field, observed_value, candidate_value FROM dq_issues WHERE record_id = ? OR record_key LIKE ?', recordId, `ship:${s.ref_doc}:%`);
  return { shipment: s, record: record ? { ...record, payload: json(record.payload_json, {}) } : null, erp: erp ? { ...erp, payload: json(erp.payload_json, {}) } : null, siblings, routes, factor, issues };
}

const Point = z.object({ label: z.string().min(1).max(120), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), kind: z.enum(['site', 'supplier_pickup', 'port', 'address', 'other']).default('address') });
const ManualLeg = z.object({ mode: z.enum(['truck', 'truck-reefer', 'ropax', 'ship-reefer', 'ship-bulk', 'rail']), distance_km: z.number().positive().max(40000), start_label: z.string().max(120).optional(), end_label: z.string().max(120).optional(), start_evidence: z.string().max(300).optional(), end_evidence: z.string().max(300).optional() });

export const ProposeBody = z.object({
  shipment_record_id: z.string().min(1).max(64),
  provider: z.enum(['provided_distance', 'manual', 'fixture', 'here']).optional(),
  origin: Point.optional(),
  destination: Point.optional(),
  vehicle: z.enum(['truck', 'truck-reefer']).optional(),
  legs: z.array(ManualLeg).max(10).optional(),
  evidence_note: z.string().max(1000).optional(),
});

const FIXTURE_ROUTES: Record<string, { legs: z.infer<typeof ManualLeg>[] }> = {
  // Clearly labelled demonstration route used by tests and the demo walkthrough; not a real journey.
  DEMO_TALLINN_KANTVIK: { legs: [ { mode: 'truck', distance_km: 12, start_label: 'DEMO pickup (Tallinn)', end_label: 'DEMO port Tallinn' }, { mode: 'ropax', distance_km: 85, start_label: 'DEMO port Tallinn', end_label: 'DEMO port Helsinki' }, { mode: 'truck', distance_km: 38, start_label: 'DEMO port Helsinki', end_label: 'DEMO Kantvik mill' } ] },
};

export async function proposeRoute(db: DB, cfg: Config, body: z.infer<typeof ProposeBody>) {
  const ship = get(db, 'SELECT * FROM shipments WHERE record_id = ?', body.shipment_record_id);
  if (!ship) throw new HttpError(404, `Shipment leg ${body.shipment_record_id} not found`);
  const provider = body.provider || cfg.routingProvider;
  let legs: z.infer<typeof ManualLeg>[] = [];
  let response: unknown = null;
  let isDemo = 0;
  if (provider === 'provided_distance') {
    if (ship.distance_km === null) throw new HttpError(400, 'The leg has no supplied distance; enter a manual route with evidence instead.');
    legs = [{ mode: String(ship.mode) as z.infer<typeof ManualLeg>['mode'], distance_km: Number(ship.distance_km), start_label: 'origin not in source data', end_label: 'destination not in source data' }];
    response = { basis: 'calculated_from_supplied_distance', note: 'Exact origin/destination are not in the source data; no geometry is drawn.' };
  } else if (provider === 'manual') {
    if (!body.legs?.length) throw new HttpError(400, 'A manual route needs at least one leg with mode and distance.');
    if (!body.evidence_note?.trim()) throw new HttpError(400, 'A manual route needs an evidence note (document, booking reference or source).');
    legs = body.legs;
    response = { basis: 'manual_entry', entered_legs: legs.length };
  } else if (provider === 'fixture') {
    legs = FIXTURE_ROUTES.DEMO_TALLINN_KANTVIK.legs;
    isDemo = 1;
    response = { basis: 'DEMO fixture', warning: 'DEMO route for tests and demonstration only. Not a real or verified journey.' };
  } else {
    if (!cfg.hereApiKey) throw new HttpError(400, 'HERE routing is not configured (HERE_API_KEY is empty). Use the supplied distance or a manual route.');
    if (!body.origin || !body.destination) throw new HttpError(400, 'HERE routing needs exact origin and destination coordinates; country centroids are not accepted.');
    const r = await hereRoute(cfg, body.origin, body.destination, body.vehicle || 'truck');
    legs = r.legs;
    response = r.response;
  }
  const id = newId('route');
  const total = round(legs.reduce((s, l) => s + l.distance_km, 0), 3);
  return tx(db, () => {
    const loc = (p?: z.infer<typeof Point>) => {
      if (!p) return null;
      const lid = newId('loc');
      run(db, 'INSERT INTO locations (id, label, kind, lat, lon, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', lid, p.label, p.kind, p.lat, p.lon, 'entered for route proposal (not in source data)', nowIso());
      return lid;
    };
    run(
      db,
      `INSERT INTO route_proposals (id, shipment_record_id, provider, status, is_demo, origin_location_id, destination_location_id, vehicle, total_km, provider_response_json, evidence_note, created_at)
       VALUES (?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, body.shipment_record_id, provider, isDemo, loc(body.origin), loc(body.destination), body.vehicle ?? null, total, JSON.stringify(response), body.evidence_note ?? null, nowIso(),
    );
    legs.forEach((l, i) => run(db, 'INSERT INTO route_legs (id, route_id, leg_order, mode, distance_km, start_label, end_label, start_evidence, end_evidence, factor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('leg'), id, i + 1, l.mode, l.distance_km, l.start_label ?? null, l.end_label ?? null, l.start_evidence ?? null, l.end_evidence ?? null, null));
    recordAudit(db, { event_type: 'route.proposed', actor_kind: 'system', actor_label: provider, entity_type: 'route_proposal', entity_id: id, after: { shipment: body.shipment_record_id, provider, total_km: total, legs: legs.length, is_demo: !!isDemo } });
    const supplied = ship.distance_km === null ? null : Number(ship.distance_km);
    return {
      id, provider, status: 'proposed', is_demo: !!isDemo, total_km: total, legs, supplied_km: supplied,
      deviation_pct: supplied ? round(((total - supplied) / supplied) * 100, 2) : null,
      note: 'A route proposal is not proof of the actual journey or of a ferry booking. Calculations keep using the supplied distance.',
    };
  });
}

async function hereRoute(cfg: Config, o: z.infer<typeof Point>, d: z.infer<typeof Point>, vehicle: string) {
  const url = new URL('https://router.hereapi.com/v8/routes');
  url.searchParams.set('transportMode', 'truck');
  url.searchParams.set('origin', `${o.lat},${o.lon}`);
  url.searchParams.set('destination', `${d.lat},${d.lon}`);
  url.searchParams.set('return', 'summary,polyline');
  url.searchParams.set('apikey', cfg.hereApiKey);
  const ctl = AbortSignal.timeout(15000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctl });
  } catch (e) {
    throw new HttpError(502, `HERE routing request failed: ${(e as Error).message}`);
  }
  if (!res.ok) throw new HttpError(502, `HERE routing returned HTTP ${res.status}`);
  const body = (await res.json()) as { routes?: { sections?: { type: string; transport?: { mode?: string }; summary?: { length?: number }; polyline?: string }[] }[] };
  const sections = body.routes?.[0]?.sections || [];
  if (!sections.length) throw new HttpError(502, 'HERE routing returned no route');
  const legs = sections.map((s) => ({
    mode: (s.transport?.mode === 'ferry' ? 'ropax' : vehicle) as z.infer<typeof ManualLeg>['mode'],
    distance_km: round((s.summary?.length || 0) / 1000, 3),
    start_label: o.label,
    end_label: d.label,
  }));
  // The key is never stored: only the section summary and polylines are kept.
  return { legs, response: { provider: 'HERE Routing v8', sections: sections.map((s) => ({ type: s.type, mode: s.transport?.mode, length_m: s.summary?.length, polyline: s.polyline })) } };
}

export const RouteReviewBody = z.object({
  decision: z.enum(['approve', 'reject']),
  reviewer_label: z.string().transform((s) => sanitizeLabel(s, 80)).pipe(z.string().min(1, 'reviewer_label is required')),
  reason: z.string().max(1000).optional(),
  expected_revision: z.number().int().positive(),
  evidence_type: z.enum(['carrier_document', 'ferry_booking', 'gps_log', 'reviewer_confirmation']).optional(),
  evidence_note: z.string().max(1000).optional(),
});

export function reviewRoute(db: DB, id: string, body: z.infer<typeof RouteReviewBody>) {
  return tx(db, () => {
    const r = get(db, 'SELECT * FROM route_proposals WHERE id = ?', id);
    if (!r) throw new HttpError(404, `Route ${id} not found`);
    if (Number(r.revision) !== body.expected_revision) throw new HttpError(409, `Route ${id} changed (revision ${r.revision}, expected ${body.expected_revision}).`, { current_revision: Number(r.revision) });
    if (r.status !== 'proposed') throw new HttpError(409, `Route ${id} was already ${r.status}.`);
    if (body.decision === 'approve') {
      if (Number(r.is_demo)) throw new HttpError(400, 'A DEMO fixture route cannot be marked verified.');
      if (!body.evidence_type || !body.evidence_note?.trim()) throw new HttpError(400, 'Verifying a route requires evidence_type and evidence_note (e.g. carrier document or ferry booking reference).');
    }
    const status = body.decision === 'approve' ? 'verified' : 'rejected';
    const note = body.evidence_note ? `${body.evidence_type}: ${body.evidence_note}` : r.evidence_note;
    run(db, 'UPDATE route_proposals SET status = ?, reviewer_label = ?, review_reason = ?, reviewed_at = ?, evidence_note = ?, revision = revision + 1 WHERE id = ?', status, body.reviewer_label, body.reason ?? null, nowIso(), (note as string) ?? null, id);
    recordAudit(db, { event_type: `route.${status}`, actor_kind: 'reviewer', actor_label: body.reviewer_label, entity_type: 'route_proposal', entity_id: id, before: { status: r.status, revision: Number(r.revision) }, after: { status, evidence_type: body.evidence_type ?? null, evidence_note: body.evidence_note ?? null }, reason: body.reason ?? null });
    return get(db, 'SELECT * FROM route_proposals WHERE id = ?', id);
  });
}
