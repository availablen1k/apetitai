/// <reference types="vite/client" />
// Local API client. Every call goes to the local backend under /api (proxied by Vite to
// 127.0.0.1). There is no account, token or login.

const BASE = import.meta.env.VITE_API_BASE || '/api';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * @param {string} method
 * @param {string} path
 * @param {{ body?: unknown, query?: Record<string, unknown>, form?: FormData }} [opts]
 */
async function request(method, path, opts = {}) {
  const { body, query, form } = opts;
  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const init = { method, headers: {} };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ApiError(0, `Local API is not reachable (${e.message}). Is "npm run dev" running?`);
  }
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data && data.details);
  }
  return data;
}

const get = (path, query) => request('GET', path, { query });
const post = (path, body) => request('POST', path, { body: body ?? {} });

export const api = {
  health: () => get('/health'),
  overview: (year) => get('/overview', { year }),
  startLiveDemo: (year, request_id) => post('/live-demo', { year, request_id }),
  liveDemo: (id) => get(`/live-demo/${encodeURIComponent(id)}`),

  datasets: () => get('/datasets'),
  /** @param {File[]} files @param {{ dataset?: string, mapping?: Record<string, string>, sheet?: string }} [opts] */
  importFiles: (files, opts = {}) => {
    const { dataset, mapping, sheet } = opts;
    const form = new FormData();
    if (dataset && dataset !== 'auto') form.append('dataset', dataset);
    if (mapping && Object.keys(mapping).length) form.append('mapping', JSON.stringify(mapping));
    if (sheet) form.append('sheet', sheet);
    for (const f of files) form.append('file', f, f.name);
    return request('POST', '/imports', { form });
  },
  /** @param {File} file @param {string} [dataset] */
  suggestMapping: (file, dataset) => {
    const form = new FormData();
    if (dataset && dataset !== 'auto') form.append('dataset', dataset);
    form.append('file', file, file.name);
    return request('POST', '/imports/suggest-mapping', { form });
  },
  /** @param {File[]} files @param {{ entity_type?: string, entity_id?: string, label?: string }} [link] */
  addEvidence: (files, link = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(link)) if (v) form.append(k, v);
    for (const f of files) form.append('file', f, f.name);
    return request('POST', '/evidence', { form });
  },
  evidenceList: (filter) => get('/evidence', filter),
  evidence: (id) => get(`/evidence/${encodeURIComponent(id)}`),
  evidenceFileUrl: (id) => `${BASE}/evidence/${encodeURIComponent(id)}/file`,
  linkEvidence: (id, body) => post(`/evidence/${encodeURIComponent(id)}/links`, body),
  extractEvidence: (id, issueId) => post(`/evidence/${encodeURIComponent(id)}/extract`, issueId ? { issue_id: issueId } : {}),
  ocrEvidence: (id) => post(`/evidence/${encodeURIComponent(id)}/ocr`),
  queueUploads: (files) => {
    const form = new FormData();
    for (const f of files) form.append('file', f, f.name);
    return request('POST', '/uploads', { form });
  },
  uploads: (filter) => get('/uploads', filter),
  upload: (id, sheet) => get(`/uploads/${encodeURIComponent(id)}`, { sheet }),
  confirmUpload: (id, body) => post(`/uploads/${encodeURIComponent(id)}/confirm`, body),
  suggestUploadMapping: (id, body) => post(`/uploads/${encodeURIComponent(id)}/suggest-mapping`, body),
  uploadTargets: (entity_type, q) => get('/uploads/targets', { entity_type, q }),
  uploadCapabilities: () => get('/uploads/capabilities'),
  importBatch: (id) => get(`/imports/${encodeURIComponent(id)}`),

  scan: (tables) => post('/quality/scan', tables ? { tables } : {}),
  issueStats: () => get('/issues/stats'),
  issues: (filter) => get('/issues', filter),
  issue: (id) => get(`/issues/${encodeURIComponent(id)}`),
  reviewIssue: (id, body) => post(`/issues/${encodeURIComponent(id)}/review`, body),
  requestIssueEvidence: (id, body) => post(`/issues/${encodeURIComponent(id)}/request-evidence`, body),
  dataReviews: (batch_id) => get('/data-reviews', { batch_id }),
  dataReview: (id, filter = {}) => get(`/data-reviews/${encodeURIComponent(id)}`, filter),
  startDataReview: (batch_id, retry = false) => post('/data-reviews', { batch_id, retry }),
  investigate: (id) => post(`/issues/${encodeURIComponent(id)}/investigate`),
  whatIf: (id, candidate_value) => post(`/issues/${encodeURIComponent(id)}/what-if`, { candidate_value }),

  shipments: (filter) => get('/shipments', filter),
  shipment: (id) => get(`/shipments/${encodeURIComponent(id)}`),
  proposeRoute: (body) => post('/routes/propose', body),
  reviewRoute: (id, body) => post(`/routes/${encodeURIComponent(id)}/review`, body),

  calculate: (kind, body) => post(`/calculations/${kind}`, body),
  footprintFlow: (filter) => get('/footprint-flow', filter),
  incidentFlow: (filter) => get('/incident-flow', filter),
  decisionWorkspace: (filter) => get('/decision-workspace', filter),
  actionOptions: (filter) => get('/action-options', filter),
  recordActionAssessment: (id,body) => post(`/action-options/${encodeURIComponent(id)}/assessments`,body),
  finishActionAssessment: (id,reviewer_label) => post(`/action-assessments/${encodeURIComponent(id)}/complete`,{reviewer_label}),
  rootCause: (id, lang) => post(`/issues/${encodeURIComponent(id)}/root-cause`, { lang }),
  runs: (filter) => get('/calculations', filter),
  run: (id) => get(`/calculations/${encodeURIComponent(id)}`),
  contributions: (id, filter) => get(`/calculations/${encodeURIComponent(id)}/contributions`, filter),
  benchmark: (id) => get(`/calculations/${encodeURIComponent(id)}/benchmark`),
  compareRuns: (a, b) => get('/calculations/compare', { a, b }),
  lineage: (runId, contributionId) => get(`/lineage/${encodeURIComponent(runId)}/${encodeURIComponent(contributionId)}`),
  workbookUrl: (runId) => `${BASE}/reports/${encodeURIComponent(runId)}.xlsx`,
  auditEvents: (filter) => get('/audit-events', filter),

  ask: (body) => post('/assistant/ask', body),
  discovery: (year, lang) => get('/discovery', { year, lang }),
  startDiscovery: (year, request_id) => post('/discovery/runs', { year, request_id }),
  decideFinding: (key, body) => post(`/discovery/findings/${encodeURIComponent(key)}/decision`, body),

  // Nature model (read-only database; rebuilds, saved runs and nutrient runs are Python jobs)
  natureStatus: () => get('/nature/status'),
  natureQueries: () => get('/nature/queries'),
  natureRunQuery: (id, params) => post(`/nature/queries/${encodeURIComponent(id)}/run`, { params }),
  natureSavedRuns: (queryId) => get('/nature/runs', { query_id: queryId }),
  natureSavedRun: (runId) => get(`/nature/runs/${encodeURIComponent(runId)}`),
  natureLineage: (queryId, resultKey, runId) => get('/nature/lineage', { query_id: queryId, result_key: resultKey, run_id: runId }),
  natureCatchments: () => get('/nature/catchments'),
  natureCatchmentParcels: (id, year) => get(`/nature/catchments/${encodeURIComponent(id)}/parcels`, { year }),
  natureFarm: (id, year) => get(`/nature/farms/${encodeURIComponent(id)}`, { year }),
  natureNutrientRuns: (kind) => get('/nature/nutrient-runs', { kind }),
  natureInputRun: (id) => get(`/nature/nutrient-runs/inputs/${encodeURIComponent(id)}`),
  natureLossRun: (id, variant) => get(`/nature/nutrient-runs/losses/${encodeURIComponent(id)}`, variant),
  natureJobs: () => get('/nature/jobs'),
  natureJob: (id) => get(`/nature/jobs/${encodeURIComponent(id)}`),
  natureSubmitJob: (body) => post('/nature/jobs', body),
  runAutomation: (workflow, year) => post(`/automations/${workflow}/run`, { year }),
  createReportDraft: (body) => post('/report-drafts', body),

  farmFootprint: (filter) => get('/farm-footprint', filter),
  farm: (id) => get(`/farms/${encodeURIComponent(id)}`),
  climateStats: () => get('/climate-stats'),
  weatherYears: () => get('/weather-years'),
  forecast: (region) => get(`/forecast/${encodeURIComponent(region)}`),
  farmForecast: (region) => get(`/forecast/${encodeURIComponent(region)}/farms`),
  sourceRegistry: () => get('/source-registry'),
  snowflake: () => get('/integrations/snowflake'),

  docs: (collection, filter) => get(`/documents/${collection}`, filter),
  createDoc: (collection, data) => post(`/documents/${collection}`, data),
  updateDoc: (collection, id, data) => request('PATCH', `/documents/${collection}/${encodeURIComponent(id)}`, { body: data }),
  deleteDoc: (collection, id) => request('DELETE', `/documents/${collection}/${encodeURIComponent(id)}`),
};

const REVIEWER_KEY = 'traceflow.reviewer';
export function getReviewerLabel() {
  try {
    return localStorage.getItem(REVIEWER_KEY) || 'Local reviewer';
  } catch {
    return 'Local reviewer';
  }
}
export function setReviewerLabel(v) {
  try {
    localStorage.setItem(REVIEWER_KEY, v);
  } catch {
    /* storage blocked */
  }
}
