import { criticalityOf } from './domain/criticality.ts';
// HTTP API (Fastify). Localhost-only prototype: no authentication by design, so the server
// binds to loopback, rejects foreign Host headers (DNS rebinding) and foreign Origins (CSRF),
// and validates every input.
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import type { Config } from './config.ts';
import { type DB, all, get } from './db/database.ts';
import { currentMachineHosts } from './services/networkHosts.ts';
import { appliedMigrations } from './db/migrate.ts';
import { DATASETS } from './domain/catalog.ts';
import { RULES_VERSION } from './domain/rules.ts';
import { METHOD_VERSION } from './domain/method.ts';
import { generateReportDraft, runAutomation } from './services/assistant.ts';
import { benchmark, compareRuns, createRun, getLineage, getRun, latestRun, listContributions, listRuns } from './services/calculations.ts';
import { HttpError } from './services/common.ts';
import { FlowQuery, footprintFlow } from './services/footprintFlow.ts';
import { incidentFlow, IncidentFlowQuery } from './services/incidentFlow.ts';
import { incidentRootCause } from './services/rootCause.ts';
import { ActionQuery, AssessmentBody, WorkspaceQuery, actionOptions, decisionWorkspace, finishAssessment, recordAssessment } from './services/decisionWorkspace.ts';
import { CRITICALITIES } from './domain/criticality.ts';
import { AssistantContext } from './services/pageContext.ts';
import { type LlmClient, aiStatus, createLlm } from './services/gemini.ts';
import { getBatch, importFile, listDatasets } from './services/imports.ts';
import { investigate, whatIfImpact } from './services/investigator.ts';
import { ENTITY_TYPES, addEvidence, evidenceFile, extractEvidence, getEvidence, linkEvidence, listEvidence, ocrEvidence } from './services/evidence.ts';
import { ConfirmUpload, confirmUpload, findUploadTargets, getUpload, listUploads, queueUpload, suggestUploadMapping } from './services/uploads.ts';
import { ocrCapabilities } from './domain/ocr.ts';
import { createDataReviewAgent, listReviewRuns, reviewRun } from './services/dataReviewAgent.ts';
import { readTableHead, suggestMapping } from './services/mapping.ts';
import fs from 'node:fs';
import { EvidenceRequest, IncludeShared, ReviewBody, getIssueDetail, issueStats, listIssues, requestIssueEvidence, reviewIssue, runScan } from './services/quality.ts';
import { ProposeBody, RouteReviewBody, getShipment, listShipments, proposeRoute, reviewRoute } from './services/routing.ts';
import { buildWorkbook, workbookName } from './services/workbook.ts';
import { reportingYears, yearCoverage } from './services/reportingYears.ts';
import { createLiveDemo } from './services/liveDemo.ts';
import { catchmentOverview, catchmentParcels, farmNature, inputRunDetail, listNutrientRuns, listQueries, listSavedRuns, lossRunDetail, natureStatus, runQuery, savedRunResults, traceResult } from './services/nature.ts';
import { NatureJobBody, createNatureJobs, pythonInfo } from './services/natureJobs.ts';
import { DecisionBody, createDiscovery } from './services/discovery.ts';
import { askTeam } from './services/experts.ts';
import { FarmFootprintQuery, farmFootprint } from './services/farmFootprint.ts';
import { climateStats, createDoc, deleteDoc, farmForecastOutlook, getDoc, getFarm, listDocs, listFarms, regionalForecast, sourceRegistry, updateDoc } from './services/workspace.ts';

export type AppOptions = { db: DB; cfg: Config; llm?: LlmClient | null; logger?: boolean };


function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Invalid request', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const Year = int(2000, 2100);
const Paging = { limit: int(1, 1000).optional(), offset: int(0, 10_000_000).optional() };
const Basis = z.enum(['location', 'market']);

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db, cfg } = opts;
  const llm = opts.llm === undefined ? createLlm(cfg) : opts.llm;
  const app = Fastify({
    logger: opts.logger === false ? false : { level: cfg.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
  });
  await app.register(multipart, { limits: { fileSize: cfg.maxUploadBytes, files: 50, fields: 10 } });
  const dataAgent = createDataReviewAgent(db, cfg.aiEnabled ? llm : null);
  const liveDemo = createLiveDemo(db, cfg);
  const natureJobs = createNatureJobs(db, cfg.nature);
  const discovery = createDiscovery(db, cfg, cfg.aiEnabled ? llm : null);
  app.addHook('onReady', async () => discovery.start());
  app.addHook('onClose', async () => discovery.stop());
  app.addHook('onReady', async () => natureJobs.start());
  app.addHook('onClose', async () => natureJobs.stop());
  app.addHook('onReady', async () => dataAgent.start());
  app.addHook('onClose', async () => dataAgent.stop());
  app.addHook('onClose', async () => liveDemo.stop());

  const localHosts = new Set(cfg.allowedHosts);
  const isAllowedHost = (h: string) => localHosts.has(h) || (cfg.lanAccess && currentMachineHosts().has(h));
  const isAllowedOrigin = (o: string) => {
    if (cfg.allowedOrigins.includes(o)) return true;
    if (!cfg.lanAccess) return false;
    try {
      const u = new URL(o);
      return u.protocol === 'http:' && cfg.webPorts.includes(Number(u.port)) && isAllowedHost(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  };
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (!isAllowedHost(host)) return reply.code(403).send({ error: cfg.lanAccess ? 'Host not allowed: use this machine\'s network address or localhost.' : 'Host not allowed: this API only serves localhost.' });
    const origin = req.headers.origin;
    if (origin) {
      if (!isAllowedOrigin(origin)) return reply.code(403).send({ error: `Origin ${origin} is not allowed.` });
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type');
        return reply.code(204).send();
      }
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, details: err.details });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', details: err.issues });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: `File exceeds the ${Math.round(cfg.maxUploadBytes / 1048576)} MB limit.` });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal error', message: err.message });
  });

  // ------------------------------------------------------------ health / overview
  app.get('/api/health', async () => {
    let dbOk = false;
    let dbError: string | null = null;
    try {
      dbOk = get<{ ok: number }>(db, 'SELECT 1 AS ok')?.ok === 1;
    } catch (e) {
      dbError = (e as Error).message;
    }
    return {
      status: dbOk ? 'ok' : 'degraded', version: cfg.version, time: new Date().toISOString(),
      database: { connected: dbOk, path: cfg.sqlitePath === ':memory:' ? ':memory:' : cfg.sqlitePath.replace(process.cwd() + '/', ''), migrations: dbOk ? appliedMigrations(db) : [], error: dbError },
      ai: aiStatus(cfg), routing: { provider: cfg.routingProvider, here_configured: !!cfg.hereApiKey }, rules_version: RULES_VERSION, method_version: METHOD_VERSION, auth: cfg.lanAccess ? 'none (open to this machine\'s local network: LAN_ACCESS=true)' : 'none (localhost-only prototype)',
    };
  });

  app.get('/api/overview', async (req) => {
    const q = parse(z.object({ year: Year.optional() }), req.query);
    const available = reportingYears(db);
    const years = available.years;
    const year = q.year || available.defaultYear;
    const run = latestRun(db, year);
    const records = Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM source_records')?.n || 0);
    const batches = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM import_batches WHERE status <> 'duplicate_upload'`)?.n || 0);
    const legs = get<{ n: number; linked: number; unlinked: number }>(db, `SELECT COUNT(*) AS n, SUM(join_status = 'linked') AS linked, SUM(join_status = 'unlinked_no_erp_document') AS unlinked FROM shipments WHERE year = ?`, year);
    const recentIssues = all(db, `SELECT id, issue_type, severity, record_key, observed_value, candidate_value, explanation, explanation_en, impact FROM dq_issues WHERE status = 'open' AND (year = ? OR year IS NULL) ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, impact = 'high' DESC LIMIT 6`, year);
    const runs = Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM calculation_runs')?.n || 0);
    const corrections = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM corrections WHERE status = 'approved'`)?.n || 0);
    const lastAudit = get(db, 'SELECT at, event_type, actor_label FROM audit_events ORDER BY seq DESC LIMIT 1');
    return {
      year, years, empty: records === 0, records, batches, issues: issueStats(db), corrections_approved: corrections, runs,
      latest_run: run ? { id: run.id, created_at: run.created_at, status: run.status, totals: run.totals, scope2_basis: run.scope2_basis, by_category: run.completeness.by_category, correction_count: run.correction_ids.length, open_issue_count: run.open_issue_count, contains_demo_data: !!run.completeness.contains_demo_data } : null,
      transport: { legs: Number(legs?.n || 0), linked: Number(legs?.linked || 0), unlinked: Number(legs?.unlinked || 0) },
      recent_issues: recentIssues.map(i => ({ ...i, criticality: criticalityOf(i as {severity: string; impact: string}) })), last_event: lastAudit ?? null, ai: aiStatus(cfg),
      coverage: yearCoverage(db, year),
    };
  });

  app.get('/api/decision-workspace', async(req)=>decisionWorkspace(db,parse(WorkspaceQuery,req.query)));
  app.get('/api/action-options', async(req)=>actionOptions(db,cfg,parse(ActionQuery,req.query)));
  app.post('/api/action-options/:id/assessments',async(req)=>recordAssessment(db,cfg,parse(z.object({id:z.string().min(1).max(100)}),req.params).id,parse(AssessmentBody,req.body)));
  app.post('/api/action-assessments/:id/complete',async(req)=>finishAssessment(db,parse(z.object({id:z.string().min(1).max(100)}),req.params).id,parse(z.object({reviewer_label:z.string().trim().min(1).max(80)}),req.body).reviewer_label));

  app.get('/api/year-coverage', async (req) => yearCoverage(db, parse(z.object({ year: Year }), req.query).year));

  // ------------------------------------------------------------ datasets & imports
  app.get('/api/datasets', async () => ({ ...listDatasets(db), catalog: DATASETS.map((d) => ({ id: d.id, label: d.label, group: d.group, required_columns: d.required, columns: [...new Set([...d.required, ...d.numeric])] })) }));

  app.post('/api/imports', async (req) => {
    if (!req.isMultipart()) throw new HttpError(415, 'Send the file as multipart/form-data (field "file").');
    const fields: Record<string, string> = {};
    const outcomes = [];
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value).slice(0, part.fieldname === 'mapping' ? 20000 : 100);
        continue;
      }
      const bytes = await part.toBuffer();
      if (part.file.truncated) throw new HttpError(413, `File ${part.filename} exceeds the upload limit.`);
      let mapping: Record<string, string> | undefined;
      if (fields.mapping) {
        try {
          mapping = parse(z.record(z.string().max(200)), JSON.parse(fields.mapping));
        } catch (e) {
          throw e instanceof HttpError ? e : new HttpError(400, 'mapping must be a JSON object of target column → source header');
        }
      }
      try {
        const outcome = await importFile(db, cfg.uploadsDir, { filename: part.filename || 'upload.csv', bytes, dataset: fields.dataset, sheet: fields.sheet, delimiter: fields.delimiter, mapping });
        outcomes.push({ ...outcome, agent_review: cfg.autoReviewImports && outcome.batch.status !== 'rejected' ? dataAgent.enqueue(outcome.batch.id) : null });
      } catch (e) {
        if (e instanceof HttpError) outcomes.push({ error: e.message, details: e.details, filename: part.filename, status: e.status });
        else throw e;
      }
    }
    if (!outcomes.length) throw new HttpError(400, 'No file in the request.');
    if (outcomes.length === 1 && 'error' in outcomes[0]) throw new HttpError(outcomes[0].status, String(outcomes[0].error), outcomes[0].details);
    return { results: outcomes };
  });

  app.post('/api/imports/suggest-mapping', async (req) => {
    if (!req.isMultipart()) throw new HttpError(415, 'Send the file as multipart/form-data (field "file").');
    const fields: Record<string, string> = {};
    let head: Awaited<ReturnType<typeof readTableHead>> | null = null;
    let filename = '';
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value).slice(0, 100);
        continue;
      }
      filename = part.filename || 'upload.csv';
      head = await readTableHead(filename, await part.toBuffer(), fields.sheet);
    }
    if (!head) throw new HttpError(400, 'No file in the request.');
    const s = await suggestMapping(cfg.aiEnabled ? llm : null, { headers: head.headers, rows: head.rows, dataset: fields.dataset && fields.dataset !== 'auto' ? fields.dataset : undefined });
    return { filename, headers: head.headers, sample: head.rows.slice(0, 5), total_rows: head.total, ...s };
  });

  app.get('/api/imports/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    const b = getBatch(db, id);
    if (!b) throw new HttpError(404, `Import ${id} not found`);
    const coverage = all(db, 'SELECT year, COUNT(*) AS n FROM source_records WHERE batch_id = ? GROUP BY year ORDER BY year', id);
    const issues = Number(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM dq_issues i JOIN source_records r ON r.id = i.record_id WHERE r.batch_id = ?', id)?.n || 0);
    return { batch: b, coverage, issues_on_rows: issues };
  });

  // ------------------------------------------------------------ quality
  app.get('/api/data-reviews', async (req) => {
    const q = parse(z.object({ batch_id: z.string().max(64).optional() }), req.query);
    return { runs: listReviewRuns(db, q.batch_id), automatic: cfg.autoReviewImports, ai: aiStatus(cfg) };
  });
  app.post('/api/data-reviews', async (req, reply) => {
    const body = parse(z.object({ batch_id: z.string().max(64), retry: z.boolean().optional() }), req.body);
    reply.code(202); return dataAgent.enqueue(body.batch_id, body.retry);
  });
  app.get('/api/data-reviews/:id', async (req) => {
    const q = parse(z.object({ limit: int(1, 100).optional(), offset: int(0, 10_000_000).optional(), q: z.string().max(200).optional(), status: z.enum(['all', 'open', 'reviewed', 'withdrawn']).optional(), severity: z.enum(['high', 'medium', 'low']).optional(), criticality: z.enum(CRITICALITIES).optional(), group_by_issue: z.enum(['true', 'false']).transform((value) => value === 'true').optional() }), req.query);
    return reviewRun(db, parse(z.object({ id: z.string().max(64) }), req.params).id, q);
  });
  app.post('/api/quality/scan', async (req) => {
    const body = parse(z.object({ tables: z.array(z.string().max(60)).max(40).optional() }).default({}), req.body ?? {});
    return runScan(db, { tables: body.tables });
  });
  app.get('/api/issues/stats', async () => issueStats(db));
  app.get('/api/issues', async (req) => {
    const q = parse(z.object({ status: z.enum(['open', 'approved', 'rejected']).optional(), severity: z.enum(['high', 'medium', 'low']).optional(), criticality: z.enum(CRITICALITIES).optional(), rule_id: z.string().max(120).optional(), table: z.string().max(60).optional(), dataset: z.string().max(60).optional(), year: Year.optional(), include_shared: IncludeShared, category: z.string().max(30).optional(), issue_type: z.string().max(40).optional(), q: z.string().max(100).optional(), sort: z.enum(['impact', 'priority']).optional(), ...Paging }), req.query);
    return listIssues(db, { ...q, table: q.table || q.dataset });
  });
  app.get('/api/issues/:id', async (req) => getIssueDetail(db, parse(z.object({ id: z.string().max(40) }), req.params).id));
  app.post('/api/issues/:id/review', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    return reviewIssue(db, id, parse(ReviewBody, req.body));
  });
  app.post('/api/issues/:id/request-evidence', async (req) => requestIssueEvidence(db, parse(z.object({ id: z.string().max(40) }), req.params).id, parse(EvidenceRequest, req.body)));
  app.post('/api/issues/:id/what-if', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const body = parse(z.object({ candidate_value: z.string().max(4000) }), req.body);
    return whatIfImpact(db, id, body.candidate_value);
  });
  app.post('/api/issues/:id/investigate', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    if (!cfg.aiEnabled) return { status: 'not_configured', message: 'AI investigation is disabled (ENABLE_AI_INVESTIGATION=false).' };
    return investigate(db, id, llm);
  });

  // ------------------------------------------------------------ evidence documents (any file type)
  const EntityType = z.enum(ENTITY_TYPES);
  app.get('/api/uploads/capabilities', async () => ({ ocr: ocrCapabilities(), max_upload_bytes: cfg.maxUploadBytes }));
  app.post('/api/uploads', async (req) => {
    if (!req.isMultipart()) throw new HttpError(415, 'Send files as multipart/form-data.');
    const results = [];
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const bytes = await part.toBuffer();
      try { results.push(await queueUpload(db, cfg.uploadsDir, { filename: part.filename || 'document', bytes })); }
      catch (e) {
        if (e instanceof HttpError) results.push({ filename: part.filename, error: e.message });
        else throw e;
      }
    }
    if (!results.length) throw new HttpError(400, 'No files in the request.');
    return { results };
  });
  app.get('/api/uploads', async (req) => listUploads(db, parse(z.object({ q: z.string().max(200).optional(), kind: z.string().max(30).optional(), state: z.enum(['needs_classification', 'confirmed']).optional(), year: Year.optional(), ...Paging }), req.query)));
  app.get('/api/uploads/targets', async (req) => {
    const q = parse(z.object({ entity_type: EntityType, q: z.string().trim().min(2).max(100) }), req.query);
    return findUploadTargets(db, q.entity_type, q.q);
  });
  app.get('/api/uploads/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const q = parse(z.object({ sheet: z.string().max(200).optional() }), req.query);
    return getUpload(db, id, q.sheet);
  });
  app.post('/api/uploads/:id/suggest-mapping', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const body = parse(z.object({ sheet: z.string().max(200).optional(), dataset: z.string().max(60).optional() }), req.body ?? {});
    return suggestUploadMapping(db, id, cfg.aiEnabled ? llm : null, body);
  });
  app.post('/api/uploads/:id/confirm', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const result = await confirmUpload(db, cfg.uploadsDir, id, parse(ConfirmUpload, req.body));
    return { ...result, agent_review: cfg.autoReviewImports && result.imported ? dataAgent.enqueue(result.imported.batch.id) : null };
  });
  app.post('/api/evidence', async (req) => {
    if (!req.isMultipart()) throw new HttpError(415, 'Send the file(s) as multipart/form-data (field "file").');
    const fields: Record<string, string> = {};
    const results = [];
    for await (const part of req.parts()) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value).slice(0, 500);
        continue;
      }
      const bytes = await part.toBuffer();
      if (part.file.truncated) throw new HttpError(413, `File ${part.filename} exceeds the upload limit.`);
      const link = fields.entity_type && fields.entity_id ? { entity_type: parse(EntityType, fields.entity_type), entity_id: fields.entity_id.slice(0, 64), label: fields.label?.slice(0, 80) } : undefined;
      results.push(await addEvidence(db, cfg.uploadsDir, { filename: part.filename || 'document', bytes, link, note: fields.note }));
    }
    if (!results.length) throw new HttpError(400, 'No file in the request.');
    return { results };
  });
  app.get('/api/evidence', async (req) => listEvidence(db, parse(z.object({ entity_type: EntityType.optional(), entity_id: z.string().max(64).optional(), q: z.string().max(200).optional(), kind: z.string().max(30).optional(), linked: z.enum(['linked', 'unlinked']).optional() }), req.query)));
  app.get('/api/evidence/:id', async (req) => getEvidence(db, parse(z.object({ id: z.string().max(40) }), req.params).id));
  app.get('/api/evidence/:id/file', async (req, reply) => {
    const f = evidenceFile(db, parse(z.object({ id: z.string().max(40) }), req.params).id);
    // Always a download: an uploaded HTML or SVG file must never render inside the app's origin.
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', `attachment; filename="${f.filename.replace(/[^\w.\- ]/g, '_')}"`);
    return reply.send(fs.createReadStream(f.file));
  });
  app.post('/api/evidence/:id/links', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const b = parse(z.object({ entity_type: EntityType, entity_id: z.string().min(1).max(64), label: z.string().max(80).optional() }), req.body);
    return linkEvidence(db, id, b.entity_type, b.entity_id, b.label);
  });
  app.post('/api/evidence/:id/extract', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const b = parse(z.object({ issue_id: z.string().max(40).optional() }).default({}), req.body ?? {});
    return extractEvidence(db, cfg.aiEnabled ? llm : null, id, b);
  });
  app.post('/api/evidence/:id/ocr', async (req) => ocrEvidence(db, parse(z.object({ id: z.string().max(40) }), req.params).id));

  // ------------------------------------------------------------ transport
  app.get('/api/shipments', async (req) => {
    const q = parse(z.object({ year: Year.optional(), direction: z.enum(['inbound', 'outbound']).optional(), mode: z.string().max(30).optional(), join_status: z.string().max(40).optional(), route_status: z.enum(['verified', 'proposed', 'supplied_distance']).optional(), q: z.string().max(60).optional(), ...Paging }), req.query);
    return listShipments(db, q);
  });
  app.get('/api/shipments/:id', async (req) => getShipment(db, parse(z.object({ id: z.string().max(64) }), req.params).id));
  app.post('/api/routes/propose', async (req) => proposeRoute(db, cfg, parse(ProposeBody, req.body)));
  app.post('/api/routes/:id/review', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    return reviewRoute(db, id, parse(RouteReviewBody, req.body));
  });

  // ------------------------------------------------------------ calculations & lineage
  const CalcBody = z.object({ year: Year, scope2_basis: Basis.optional() });
  for (const kind of ['transport', 'materials', 'inventory'] as const) {
    app.post(`/api/calculations/${kind}`, async (req, reply) => {
      const b = parse(CalcBody, req.body);
      reply.code(201);
      return createRun(db, { year: b.year, scope2_basis: b.scope2_basis, kind, trigger: 'manual' });
    });
  }
  app.get('/api/footprint-flow', async (req) => footprintFlow(db, parse(FlowQuery, req.query)));
  app.get('/api/incident-flow', async (req) => incidentFlow(db, parse(IncidentFlowQuery, req.query)));
  app.post('/api/issues/:id/root-cause', async (req) => {
    const { id } = parse(z.object({ id: z.string().min(1).max(80) }), req.params);
    const body = parse(z.object({ lang: z.enum(['fi', 'en']).default('fi') }).default({}), req.body ?? {});
    return incidentRootCause(db, id, cfg.aiEnabled ? llm : null, body.lang);
  });
  app.get('/api/calculations', async (req) => listRuns(db, parse(z.object({ year: Year.optional(), kind: z.enum(['inventory', 'transport', 'materials']).optional(), limit: int(1, 200).optional() }), req.query)));
  app.get('/api/calculations/compare', async (req) => {
    const q = parse(z.object({ a: z.string().max(64), b: z.string().max(64) }), req.query);
    return compareRuns(db, q.a, q.b);
  });
  app.get('/api/calculations/:runId', async (req) => getRun(db, parse(z.object({ runId: z.string().max(64) }), req.params).runId));
  app.get('/api/calculations/:runId/contributions', async (req) => {
    const { runId } = parse(z.object({ runId: z.string().max(64) }), req.params);
    const q = parse(z.object({ category: z.string().max(60).optional(), scope: z.string().max(30).optional(), kind: z.string().max(30).optional(), q: z.string().max(80).optional(), sort: z.enum(['seq', 'tco2e']).optional(), ...Paging }), req.query);
    return listContributions(db, runId, q);
  });
  app.get('/api/calculations/:runId/benchmark', async (req) => benchmark(db, parse(z.object({ runId: z.string().max(64) }), req.params).runId));
  app.get('/api/lineage/:runId/:contributionId', async (req) => {
    const p = parse(z.object({ runId: z.string().max(64), contributionId: z.string().max(80) }), req.params);
    return getLineage(db, p.runId, p.contributionId);
  });
  app.get('/api/reports/:file', async (req, reply) => {
    const { file } = parse(z.object({ file: z.string().max(80).regex(/^run_[A-Za-z0-9]+\.xlsx$/, 'expected <runId>.xlsx') }), req.params);
    const runId = file.replace(/\.xlsx$/, '');
    const buf = await buildWorkbook(db, runId);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${workbookName(db, runId)}"`);
    return reply.send(buf);
  });
  app.get('/api/audit-events', async (req) => {
    const q = parse(z.object({ entity_type: z.string().max(40).optional(), entity_id: z.string().max(64).optional(), event_type: z.string().max(60).optional(), ...Paging }), req.query);
    const where: string[] = [];
    const params: string[] = [];
    if (q.entity_type) { where.push('entity_type = ?'); params.push(q.entity_type); }
    if (q.entity_id) { where.push('entity_id = ?'); params.push(q.entity_id); }
    if (q.event_type) { where.push('event_type LIKE ?'); params.push(`${q.event_type}%`); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM audit_events ${w}`, ...params)?.n || 0);
    const items = all(db, `SELECT * FROM audit_events ${w} ORDER BY seq DESC LIMIT ? OFFSET ?`, ...params, Math.min(q.limit || 50, 500), q.offset || 0).map((e) => ({ ...e, before: e.before_json ? JSON.parse(String(e.before_json)) : null, after: e.after_json ? JSON.parse(String(e.after_json)) : null }));
    return { total, items };
  });

  // ------------------------------------------------------------ assistant, automations, report drafts
  app.post('/api/live-demo', async (req, reply) => {
    const body = parse(z.object({ year: Year, request_id: z.string().min(8).max(100) }), req.body);
    reply.code(202);
    return liveDemo.start(body.year, body.request_id);
  });
  app.get('/api/live-demo/:id', async (req) => liveDemo.get(parse(z.object({ id: z.string().max(64) }), req.params).id));
  app.post('/api/assistant/ask', async (req) => {
    const b = parse(z.object({
      question: z.string().trim().min(1).max(1000),
      context: AssistantContext.optional(),
      lang: z.enum(['fi', 'en']).default('fi'),
      year: Year.default(2025),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })).max(6).optional(),
    }), req.body);
    return askTeam(db, cfg, cfg.aiEnabled ? llm : null, b);
  });
  app.post('/api/automations/:workflow/run', async (req) => {
    const { workflow } = parse(z.object({ workflow: z.enum(['data_intake', 'weather_monitor', 'reporting']) }), req.params);
    const b = parse(z.object({ year: Year.default(2025) }).default({}), req.body ?? {});
    return runAutomation(db, cfg, workflow, b.year);
  });
  app.post('/api/report-drafts', async (req) => generateReportDraft(db, parse(z.object({ year: Year, lang: z.enum(['fi', 'en']).default('fi') }), req.body)));

  // ------------------------------------------------------------ workspace (farms, climate, weather, documents)
  app.get('/api/farms', async (req) => listFarms(db, parse(z.object({ q: z.string().max(60).optional(), region: z.string().max(30).optional(), ...Paging }), req.query)));
  app.get('/api/farm-footprint', async (req) => farmFootprint(db, parse(FarmFootprintQuery, req.query)));
  app.get('/api/farms/:id', async (req) => getFarm(db, parse(z.object({ id: z.string().max(20) }), req.params).id));
  app.get('/api/climate-stats', async () => climateStats(db));
  app.get('/api/weather-years', async () => listDocs(db, 'weather_years', {}, { sort: '-year', limit: 1000 }));
  app.get('/api/forecast/:region', async (req) => regionalForecast(parse(z.object({ region: z.string().max(20) }), req.params).region));
  app.get('/api/forecast/:region/farms', async (req) => farmForecastOutlook(db, parse(z.object({ region: z.string().max(20) }), req.params).region));
  // ------------------------------------------------------------ data discovery (hidden expert agents)
  app.get('/api/discovery', async (req) => {
    const q = parse(z.object({ year: Year, lang: z.enum(['fi', 'en']).default('en') }), req.query);
    return discovery.feed(q.year, q.lang);
  });
  app.post('/api/discovery/runs', async (req, reply) => {
    const b = parse(z.object({ year: Year, request_id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }), req.body);
    const out = discovery.enqueue({ year: b.year, trigger: 'button', request_id: b.request_id });
    return reply.code(out.reused ? 200 : 202).send(out.run);
  });
  app.post('/api/discovery/findings/:key/decision', async (req) => {
    const { key } = parse(z.object({ key: z.string().min(1).max(200) }), req.params);
    return discovery.decide(key, parse(DecisionBody, req.body));
  });

  // ------------------------------------------------------------ nature model (read-only; writes run as Python jobs)
  const NatureId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,119}$/);
  app.get('/api/nature/status', async () => ({ ...natureStatus(cfg.nature), python: await pythonInfo(cfg.nature), ai: aiStatus(cfg) }));
  app.get('/api/nature/queries', async () => listQueries(cfg.nature));
  app.post('/api/nature/queries/:id/run', async (req) => {
    const { id } = parse(z.object({ id: NatureId }), req.params);
    const { params } = parse(z.object({ params: z.record(z.string(), z.union([z.string().max(200), z.number(), z.null()])).default({}) }), req.body ?? {});
    return runQuery(cfg.nature, id, params);
  });
  app.get('/api/nature/runs', async (req) => listSavedRuns(cfg.nature, parse(z.object({ query_id: NatureId.optional() }), req.query).query_id));
  app.get('/api/nature/runs/:runId', async (req) => savedRunResults(cfg.nature, parse(z.object({ runId: NatureId }), req.params).runId));
  app.get('/api/nature/lineage', async (req) => {
    const q = parse(z.object({ query_id: NatureId, result_key: z.string().min(1).max(400), run_id: NatureId.optional() }), req.query);
    return traceResult(cfg.nature, q.query_id, q.result_key, q.run_id);
  });
  app.get('/api/nature/catchments', async () => catchmentOverview(cfg.nature));
  app.get('/api/nature/catchments/:id/parcels', async (req) => {
    const { id } = parse(z.object({ id: NatureId }), req.params);
    return catchmentParcels(cfg.nature, id, parse(z.object({ year: int(1900, 2200).default(2025) }), req.query).year);
  });
  app.get('/api/nature/farms/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().regex(/^[A-Za-z0-9-]{1,20}$/) }), req.params);
    return farmNature(cfg.nature, id, parse(z.object({ year: int(1900, 2200).default(2025) }), req.query).year);
  });
  app.get('/api/nature/nutrient-runs', async (req) => listNutrientRuns(cfg.nature, parse(z.object({ kind: z.enum(['inputs', 'losses']) }), req.query).kind));
  app.get('/api/nature/nutrient-runs/inputs/:id', async (req) => inputRunDetail(cfg.nature, parse(z.object({ id: NatureId }), req.params).id));
  app.get('/api/nature/nutrient-runs/losses/:id', async (req) => {
    const { id } = parse(z.object({ id: NatureId }), req.params);
    const v = parse(z.object({ input_variant: z.string().max(80).optional(), input_point: z.string().max(80).optional(), stress_case: z.string().max(80).optional() }), req.query);
    return lossRunDetail(cfg.nature, id, v);
  });
  app.post('/api/nature/jobs', async (req, reply) => {
    const out = natureJobs.submit(parse(NatureJobBody, req.body));
    return reply.code(out.reused ? 200 : 202).send(out.job);
  });
  app.get('/api/nature/jobs', async () => natureJobs.list());
  app.get('/api/nature/jobs/:id', async (req) => natureJobs.get(parse(z.object({ id: NatureId }), req.params).id));

  app.get('/api/source-registry', async () => sourceRegistry(db));
  app.get('/api/integrations/snowflake', async () => ({ configured: false, connected: false, status: 'not_configured', message: 'Snowflake is an optional cloud integration and is not part of the local version. All data lives in the local SQLite database.' }));

  const DocParams = z.object({ collection: z.string().max(40), id: z.string().max(64).optional() });
  app.get('/api/documents/:collection', async (req) => {
    const { collection } = parse(DocParams, req.params);
    const q = parse(z.record(z.string().max(80)), req.query || {});
    const { sort, limit, ...filter } = q;
    return listDocs(db, collection, filter, { sort, limit: limit ? Number(limit) : undefined });
  });
  app.post('/api/documents/:collection', async (req, reply) => {
    const { collection } = parse(DocParams, req.params);
    reply.code(201);
    return createDoc(db, collection, parse(z.record(z.unknown()), req.body));
  });
  app.get('/api/documents/:collection/:id', async (req) => {
    const p = parse(DocParams.required({ id: true }), req.params);
    return getDoc(db, p.collection, p.id!);
  });
  app.patch('/api/documents/:collection/:id', async (req) => {
    const p = parse(DocParams.required({ id: true }), req.params);
    return updateDoc(db, p.collection, p.id!, parse(z.record(z.unknown()), req.body));
  });
  app.delete('/api/documents/:collection/:id', async (req, reply) => {
    const p = parse(DocParams.required({ id: true }), req.params);
    deleteDoc(db, p.collection, p.id!);
    return reply.code(204).send();
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: `No route ${req.method} ${req.url}` }));
  return app;
}
