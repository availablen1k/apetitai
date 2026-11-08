# TraceFlow local API

Base URL `http://127.0.0.1:8787/api` (through Vite: `http://localhost:5173/api`). With `LAN_ACCESS=true`,
teammates call it through Vite at `http://<this machine's IP>:5173/api`, with no code or login. JSON in and out,
except the multipart upload and the `.xlsx` download. No authentication (localhost-only prototype):
requests with a non-localhost `Host` or a foreign browser `Origin` get `403`.

Errors: `{ "error": "message", "details": … }` with `400` (validation), `404`, `409` (conflict / stale
revision), `413` (file too large), `415` (not multipart), `502` (external provider failed).

## Health and overview

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | DB connection, migrations, app version, rules/method version, AI and routing *configured* state (never keys) |
| GET | `/overview?year=` | real counts: rows, batches, issue stats, latest run totals, transport link counts; `empty: true` on a fresh DB |

## Decision workspace

| Method | Path | Notes |
|---|---|---|
| GET | `/decision-workspace?year=&run_id=` | Saved inventory, configured target definitions, `standing` (change from the previous year's latest inventory and whether it is comparable, the three largest categories, tCO₂e and share resting on currently open incidents, critical incident count, activity datasets not imported), and six reporting requirements. Current incident counts remain distinct from the saved calculation's review counts. A pinned run must be an inventory for the requested year. |
| GET | `/action-options?year=&run_id=&id=&q=&scope=&limit=&offset=` | Paginated operational measures from the existing read-only nature catalogue and deterministic scenario engine. Includes expected carbon delta, separate design finances, overlap, source contributions and feasibility tasks. Missing estimates remain null; no portfolio sum or verified reduction is inferred. |
| POST | `/action-options/:id/assessments` | `{year, run_id, reviewer_label, note, request_id}` creates an explicit feasibility task in `consultant_tasks` and a reviewer audit event. Required run pins the baseline; repeated request IDs are idempotent, mismatched contexts return 409. |
| POST | `/action-assessments/:id/complete` | `{reviewer_label}` completes only an existing feasibility task and records an audit event. Does not approve an investment, correct data, recalculate an inventory or verify a reduction. |

Company target definitions use the existing versioned `app_settings` documents, under
`decision_targets`. Each definition requires a name, accounting metric, saved baseline run,
explicit boundary, target year and absolute endpoint in tCO₂e. No target is prepopulated.
Comparing a later calculation requires a named boundary review for that exact run, matching
methods and the relevant Scope 2 basis. Data gaps and estimates remain visible. No linear annual
trajectory, intensity target, separate FLAG target or eligible action credit is inferred.

Contextual assistant requests support `action_id`, `target_id` and `category`, alongside the
existing source/incident/run identifiers. The backend resolves their evidence from saved records;
the model does not calculate carbon or money, and its approval permissions are unchanged.

## Datasets and imports

| Method | Path | Notes |
|---|---|---|
| GET | `/datasets` | record counts and years per dataset, all import batches, the dataset catalog |
| POST | `/imports` | `multipart/form-data`, one or more `file` parts (`.csv`/`.txt`/`.tsv`, `.xlsx`, PACT `.json`); optional fields `dataset` (`auto` or an id or `custom_<name>`), `sheet`, `delimiter`. Returns per file: batch (`expected_rows`, `imported_rows`, `duplicate_rows`, `rejected_rows`, `errors[{line, reason}]`, `sha256`, `status`), detected dataset, 20-row preview |
| GET | `/imports/:id` | batch, rows per year, number of issues on its rows |

Repeat uploads of the same bytes create a `duplicate_upload` batch and no rows. Identical rows in a
different file are recognised by fingerprint (table + row hash + occurrence) and skipped.

## Quality issues and review

| Method | Path | Notes |
|---|---|---|
| POST | `/quality/scan` | body `{ "tables"?: string[] }`; deterministic rules; returns `created/updated/unchanged/missing` |
| GET | `/issues` | filters `status` (open/approved/rejected), `severity`, `table` (or `dataset`), `year`, `category`, `issue_type`, `q`; optional `include_shared=true` includes undated reference incidents with the selected year; `limit` ≤ 500, `offset`; `sort=impact` orders open before closed, then by `tco2e_affected` (tCO₂e of the lines the record feeds in the latest inventory of each year; several incidents can share a line). Every item carries `tco2e_affected` (null when unlinked). |
| GET | `/issues/stats` | counts by status/severity/type/table/year |
| GET | `/issues/:id` | issue, raw record, batch (file hash), evidence records, history, correction, investigations |
| POST | `/issues/:id/what-if` | `{ "candidate_value": "…" }` → deterministic Δ tCO2e if approved; nothing saved |
| POST | `/issues/:id/investigate` | Gemini investigation; without a key returns `{ "status": "not_configured" }` |
| POST | `/issues/:id/review` | see below |

Review body:

```json
{ "decision": "approve", "reviewer_label": "Apetit reviewer", "reason": "Confirmed decimal scaling using supplier document",
  "expected_revision": 3, "approved_value": "1.4091", "proposed_by": "rule", "investigation_id": null }
```

* `decision`: `approve` or `reject` only (anything else → 400; never defaults to approve).
* `reviewer_label`: required, sanitised, ≤ 80 chars. An unverified display label.
* `expected_revision` must equal the issue's current `revision`, else 409. A decided issue → 409.
* `approved_value` overrides the candidate for `set_value`/`add_record` issues; `proposed_by: "ai_investigation"` requires that issue's `investigation_id`.
* Approving the same field twice from different issues → 409.
* Approval writes an append-only correction (overlay) and an audit event with before/after values. It does not recalculate; the response has `recalculation_required`.

## Uploads and evidence

### Import-level data review agent

* `GET /year-coverage?year=2026` returns imported activity counts by dataset and the main activity categories with no imported rows. The current calendar year is always in `/overview.years`; the default year remains the latest with activity.
* `POST /live-demo` with `{year, request_id}` returns 202 and a persisted automation job. It imports labelled mock sources, runs built-in checks, and saves inventory/transport snapshots. A repeated request ID reuses its job; a different year with the same ID returns 409. Only one demo job runs at a time. No AI call or approval is performed.
* `GET /live-demo/:id` returns actual progress (`queued`, `importing`, `checking`, `calculating`, `completed`, or `failed`), logs, batch references and saved run IDs/totals. Interrupted jobs are marked failed after a restart, with imported files retained.
* `GET /data-reviews?batch_id=` returns the latest 30 runs, coverage, model, local/AI findings, and automatic-review configuration.
* `POST /data-reviews` with `{batch_id, retry?: boolean}` returns 202 and a queued/cached run. `retry: true` explicitly creates a fresh review after the previous run finishes.
* `GET /data-reviews/:id` returns status (`queued`, `running`, `completed`, `degraded`, `rules_only`, `failed`, `interrupted`), row coverage, notes, tool calls and paged concern records. Optional queries: `limit` (1–100, default 100), `offset`, `q` (literal search of farm/crop/year/field/source/reference, max 200 characters), `status` (`all`, `open`, `reviewed`, `withdrawn`) and `severity` (`high`, `medium`, `low`). `findings_total` counts matches across the whole run; `findings_count` and `awaiting_human` remain whole-run totals. Findings include farm/crop/survey/year, source filename/line and the issue's current decision. Search is applied before pagination.
  With `group_by_issue=true`, one item is returned per distinct issue, with all original automated explanations in `related_checks`. `findings_total` then counts matching issues, while `findings_count` remains the original automated-finding total. The human-facing agent list uses this grouped view.
* `POST /issues/:id/request-evidence` with `{reviewer_label, reason, expected_revision}` records a local evidence request, increments revision and keeps the issue open. No external communication occurs.

API/UI table imports queue reviews automatically unless `AUTO_REVIEW_IMPORTS=false`. Source records
and corrections are never written by the AI. Findings enter `dq_issues` with null candidates; a reviewer
must enter a verified replacement and reason for agent-origin concerns. Existing specialised rule
findings are linked instead of duplicated. Ordinary rule scans do not retire agent-origin concerns.
Interrupted jobs need explicit retry. Withdrawn validation concerns remain in history; their human
decision status is preserved, and they do not count toward active agent review.

| Method | Path | Notes |
|---|---|---|
| POST | `/uploads` | multipart `file` parts, any format; preserves bytes and queues classification without importing rows |
| GET | `/uploads` | filters `q`, `kind`, `state` (`needs_classification`/`confirmed`), confirmed `year`, `limit`, `offset`; returns `{ items, total }` |
| GET | `/uploads/capabilities` | configured file-size limit and local OCR capabilities |
| GET | `/uploads/targets?entity_type=&q=` | search existing suppliers, materials, shipments, findings, source records or route proposals; minimum 2 characters |
| GET | `/uploads/:id?sheet=` | file, original/OCR text, table sample, worksheets, classification history, saved mapping, suggested category/year/links; suggestions never persist automatically |
| POST | `/uploads/:id/suggest-mapping` | `{ dataset?, sheet? }`; exact-name prefill without AI, optional validated Gemini suggestion |
| POST | `/uploads/:id/confirm` | `{ destination: dataset\|evidence, dataset?, sheet?, mapping?, document_type, reporting_year?, reviewer_label, expected_revision, links?: [{entity_type, entity_id}] }`; classification, links and row import commit atomically |
| POST | `/evidence` | multipart files, optional `entity_type`, `entity_id`, `label`; contextual attachments |
| GET | `/evidence` | filters `q` (filename/text/linked ID), `kind`, `linked` (`linked`/`unlinked`), `entity_type`, `entity_id` |
| GET | `/evidence/:id` | original file metadata, links, original/latest successful OCR text, AI extractions, OCR history |
| GET | `/evidence/:id/file` | original bytes, always an attachment |
| POST | `/evidence/:id/links` | `{entity_type, entity_id, label?}`; validates the referenced entity exists |
| POST | `/evidence/:id/extract` | optional `{issue_id}`; Gemini reads the document only on request; no accounting writes |
| POST | `/evidence/:id/ocr` | optional local Tesseract OCR, PDFs up to 20 pages; `completed`, `failed` or `unavailable`; immutable text reading |

Document categories: `unclassified`, `supplier_pcf`, `invoice`, `freight`, `certificate`, `report`, `other`.
An evidence confirmation must choose a category other than `unclassified`. A worksheet confirmation applies
to that sheet; evidence without `sheet` explicitly files the entire workbook. A workbook remains pending
while any worksheet lacks a decision. The classification year is metadata, not a rewrite of source-row years.

Import identity includes the selected worksheet and effective column interpretation. Same-file/same-sheet
replays are idempotent. Conflicting mappings return 409 rather than silently ignoring the new mapping or
double-counting a second interpretation. Source rows and original files remain unchanged.

Extraction checks full numeric tokens, signs, decimals, exponents and units associated with that value.
Verification statuses include `verified_in_text`, `quote_not_found`, `value_not_in_quote`, `unit_not_in_quote`,
`no_local_text` and `matched_in_ocr`. An OCR match still needs checking against the original scan.

## Transport

| Method | Path | Notes |
|---|---|---|
| GET | `/shipments` | filters `year`, `direction`, `mode`, `join_status`, `route_status` (`supplied_distance`/`proposed`/`verified`), `q`; per leg `tkm_calculated = t × km`, `kgco2e_preview`, `join_status`, `route_label`; plus `summary` by mode/direction and `joins` |
| GET | `/shipments/:recordId` | leg, raw record, linked ERP line, sibling legs, factor, issues, route proposals |
| POST | `/routes/propose` | `{ shipment_record_id, provider?: provided_distance\|manual\|fixture\|here, legs?: [{mode, distance_km}], evidence_note?, origin?, destination?, vehicle? }`. `manual` needs legs + evidence note; `here` needs `HERE_API_KEY` and exact coordinates; `fixture` is a clearly flagged DEMO route |
| POST | `/routes/:id/review` | `{ decision, reviewer_label, expected_revision, evidence_type?, evidence_note? }`; verifying needs `evidence_type` + `evidence_note`; DEMO routes cannot be verified |

## Calculations, lineage, export

| Method | Path | Notes |
|---|---|---|
| POST | `/calculations/inventory` | `{ year, scope2_basis?: market\|location }` → new immutable run (all categories) |
| POST | `/calculations/transport` | same, persisting only Cat 4/9 contributions |
| POST | `/calculations/materials` | same, persisting only Cat 1/2 contributions |
| GET | `/calculations?year=&kind=` | run list (newest first) |
| GET | `/calculations/:runId` | totals, completeness, checks, gaps, dataset hashes, correction ids, method constants |
| GET | `/calculations/:runId/contributions` | filters `category`, `scope`, `kind`, `q`, `sort` (`tco2e`/`seq`), paging |
| GET | `/calculations/:runId/benchmark` | comparison with imported `benchmark_inventory` (2023/2024 dev truth) when present |
| GET | `/calculations/compare?a=&b=` | per-category deltas and added corrections between two runs |
| GET | `/footprint-flow?from_year=2024&to_year=2025&scope=scope1&land=non_flag` | read-only Sankey and paginated, traceable contributions; inclusive annual range; one saved run per year |
| GET | `/lineage/:runId/:contributionId` | contribution, every source record (file, row, batch hash), factor, corrections, open issues, routes, identifier-linked records, nodes/edges |
| GET | `/reports/:runId.xlsx` | workbook: Shipments, Route Legs, Raw Materials, Quality Issues, Corrections & Audit, Factors & Sources, Calculation Summary, Run Metadata |
| GET | `/audit-events` | filters `entity_type`, `entity_id`, `event_type` (prefix); paging |

The flow endpoint accepts `scope=all\|scope1\|scope2\|scope3`,
`land=all\|flag\|non_flag\|unclassified`, `scope2_basis=market\|location`, `offset` and `limit`
(1–100, default 20). Optional `run_id` pins a matching single-year inventory run. Optional `focus`
is a returned graph-node id and filters only the records, preserving the diagram context.
`q` searches material/activity and group labels in both languages (all whitespace-separated terms,
case-insensitive, maximum 120 characters), including sources hidden in aggregate nodes. Optional
`group` and `source` are original ids returned in `options.groups` and graph-node `members`;
these isolate/rescale the entire graph, totals and records. Group/search/source filters combine
with the selected range, scope and land filter. An unmatched selection returns empty data honestly.

It returns selected run/year metadata, explicit `missing_years`, available land classifications,
filtered signed/positive/negative totals, classification totals before the land filter (after the
other selection filters), `yearly` net/positive totals, balanced graph nodes/links and record-level
source links. Each graph node/link carries yearly positive values; group/source nodes also contain
the original, explorable `members` and their positive amounts. The overview names up to five groups
(retaining at least one per represented scope), aggregates remaining groups per scope, and limits
activities to ten. All positive emissions remain conserved at every column. FLAG allocation uses saved farm components
or the exact immutable source factor plus the saved run's correction ids. Missing or invalid splits
stay unclassified, including supplier PCFs that do not carry their own split. Negative adjustments
remain in net totals and records; only positive flows enter the Sankey. Small sources are grouped,
not dropped. It does not create runs, call AI, or write any data.

## Assistant, workspace and documents

| Method | Path | Notes |
|---|---|---|
| POST | `/assistant/ask` | `{ question, lang, year, history?, context? }`; `context.scope=workspace` uses one general workspace assistant; optional `selection` scope retains contextual evidence and specialist routing without forcing the topic. Shared read-only dataset/search/aggregate, inventory/comparison, finance/action, target/reporting, document/evidence and nature tools; bounded history (6 messages), figures and citations checked. `response_type=data\|guidance` distinguishes company evidence from general explanations/drafting. Without AI returns context and `not_configured`. |
| GET | `/discovery?year=2025&lang=en` | latest completed findings, pending run, failure, calculation id, demo/stale status; no AI call |
| POST | `/discovery/runs` | `{ year, request_id }`; 202 for a new queued run, 200 for a repeated request; no inventory → 409 |
| POST | `/discovery/findings/:key/decision` | `{ year, decision: done\|dismissed\|reopened, reviewer_label, note? }`; key must exist for that year; append-only, changes no source records/corrections/calculations |
| POST | `/automations/:workflow/run` | `data_intake` (scan), `weather_monitor` (Open-Meteo → farm alerts), `reporting` (new run) |
| POST | `/report-drafts` | `{ year, lang }` → deterministic draft from the latest run |
| GET | `/farms`, `/farms/:id` | derived from farm_registry + parcels + crop history + survey |
| GET | `/farm-footprint?year=&status=&q=&limit=&offset=` | Contract-farm footprint from the year's latest inventory: per farm tCO₂e, delivered kg, kg CO₂e/kg, data status (`measured`, `estimated`, `mixed`, `missing` = delivered without survey or parcels, `none` = no delivery) and open incidents; `summary` totals by status and the top-20 share. `status=estimated` includes `mixed`. |
| GET | `/climate-stats`, `/weather-years` | derived from `tmp/region_rows.json` |
| GET | `/forecast/:region`, `/forecast/:region/farms` | Open-Meteo (public, needs internet) |
| GET | `/source-registry` | from imported `source_registry.csv` |
| GET | `/integrations/snowflake` | always `not_configured` (not part of the local version) |
| GET/POST | `/documents/:collection` | `consultant_tasks`, `farm_alerts`, `app_settings`, `reports`, `automation_runs`, `weather_years` |
| GET/PATCH/DELETE | `/documents/:collection/:id` | |

### Incident exploration and contextual explanations

- `GET /api/incident-flow`: optional year, status, criticality (critical/high/medium/low), table, rule_id, issue_type, q, focus, limit, offset. Returns canonical counts, bounded count-conserving graph, linked discoveries and paginated incident evidence.
- `GET /api/issues`: also supports criticality and rule_id. Original severity remains available.
- `POST /api/issues/:id/root-cause` with `{ "lang": "en" }`: specialized bounded read-only analysis and verified source citations; analysis has no decision effect.
- `POST /api/assistant/ask`: optional context containing page, `scope` (`workspace` or `selection`) and selected issue_id, record_id, finding_key, run_id/contribution_id, metric, or node_id with flow/incidents filters. Workspace scope ignores stale selection IDs. The backend resolves selection IDs against saved evidence; UI labels/history are untrusted, and page context never restricts the question's topic.
