# Implementation report — local TraceFlow (no Base44, no auth, Gemini investigator)

## Update: general workspace conversation — 2026-11-08

The floating assistant defaults to **All workspace**, with **This page / selection** for focused
explanations. Page or incident context no longer forces the topic. Example prompts cover source
data, suppliers, farms, emissions, costs, targets and reporting. General explanations and drafting
are supported and labelled separately from company evidence. Workspace history follows navigation
and year changes; saved replies retain their original context. Hovering a record does not narrow
workspace questions. Explicit incident root-cause and selected-element explanations remain.

Shared bounded read tools cover every imported dataset, including custom imports, paginated source
search, deterministic full-match aggregates, saved inventory/lineage and year comparisons,
operational action finances, actual targets/reporting requirements, saved reports/tasks/automations,
uploaded original/OCR text, incident/what-if evidence and catalogued nature queries. Raw aggregates
remain distinct from validated inventories; missing values and unit/currency groups remain explicit.
No SQL, approval, source-write, automation execution, filesystem or external messaging tool was added.

Broad chat uses one workspace assistant without a routing call. Valid structured answers are reused
without an extra final-generation request. Eight read-tool calls/four rounds bound execution.
Unsupported figures get one constrained repair attempt and remain withheld if unsupported.
Hexadecimal identifiers are not mistaken for scientific notation; unknown citations are filtered,
known run IDs resolve to registered citations, and provider limits retain evidence and Retry.
Markdown renders without raw HTML, remote images or unverified inline links.

Validation: **165/165 unit/API tests**, **2/2 end-to-end tests**, lint, frontend/backend type checks
and production build pass. Tests cover custom data, literal search/injection boundaries, pagination,
full-match aggregation, units/missing values, inventory/lineage, report/task/uploaded-text access,
topic routing, guidance, figure withholding, single-call answers, rate-limit recovery, workspace and
selection modes, cross-page history and draft saving. Desktop and 390px mobile views were inspected
in English/Finnish without overflow or uncaught exceptions. Real configured-model calls returned
the catalogue, investment/savings/payback and a supplier email draft. An inventory comparison
retained a limited-evidence state when unrecognized citations were filtered. Company data and
human decisions are unchanged by the tools; existing answer audit events remain. Provider quota
still governs live availability.

Published to the existing password-protected jury gateway with preceding assets retained and an
atomic HTML replacement. Authenticated Chrome through Cloudflare verified the new default mode,
English/Finnish mobile layout, and a real supplier-location question asked from Validation. The
reply cited imported supplier records; it remained visible after navigation to Reporting. No runtime
exceptions or page overflow occurred. Anonymous requests still receive 401; URL, password and expiry
are unchanged.

## Update: page simplification — 2026-11-08

- **Overview** answers where the footprint stands (total, change from the previous comparable year,
  three largest sources), how far to trust it (share resting on currently open incidents, critical
  count, datasets not imported) and the top three actionable findings with *Explain this* and
  *Root cause*. Served by `standing` on `/decision-workspace`. The year-readiness banner is removed.
- **Footprint**: the source bar chart is a ranked list (tCO₂e and share); the Sankey defaults to the
  selected year and the one before.
- **Reports**: drafts lead with the total, the change from the previous year (or why it is not
  comparable), the open-incident share and the top three open findings of that calculation. One
  report per year is shown; older drafts sit under *Earlier versions*. The checklist is one
  progress line. Saved drafts keep their original wording.
- **Validation** has two tabs, Incidents and Uploads (the data review agent sits under Uploads).
  Incidents are compact rows sorted by `tco2e_affected` (`/issues?sort=impact`). Findings moved to
  Actions (`#findings`); documents and change history to Data platform. Old `?tab=` links redirect.
- **Farmers & fields** ranks contract farms by footprint from the latest inventory
  (`/farm-footprint`) with data status, kg CO₂e/kg delivered and open incidents.
- **Nature & water** shortlists catchments with contract area by water status (a filter, not a
  ranking), with the map, contract farms and screened actions in words. Technical tabs unchanged.

## Update: decisions, operational measures and reporting — 2026-11-08

The main workspace now follows Overview, Footprint, Actions and Reporting, with Validation as
the dedicated human data-review workspace. Existing supply-chain, nature, evidence and administration
capabilities remain available. Reporting year and selected target follow navigation.

Overview shows the saved inventory, an actual configured target when available, three priority
incidents with distinct record references, operational assessment entry points and reporting needs.
The application had no configured company target; none was invented. Settings now accepts explicit
absolute target definitions against a saved baseline and accounting boundary using versioned
`app_settings` documents. Later inventory versions need a named comparability review for that exact
run, with method and relevant Scope 2 checks. Provisional data remains labelled; no annual pathway,
physical-reduction claim or earned action credit is inferred.

Footprint leads with ranked horizontal sources linked to paginated contributions and original
lineage. The compact interactive scope/FLAG Sankey, historical results, alternate accounting rows
and illustrative sensitivity exercise remain available on demand. Data quality is described
separately from magnitude. Validation leads with incidents and named decisions; its relationship
diagram is optional. Year-filtered Validation includes undated shared reference concerns by default,
with an explicit switch for year-only inspection, matching reporting blocker counts.

Actions reuses the existing read-only nature `action_lever` catalogue and deterministic discovery
scenario engine. Its paginated comparison separates annual expected carbon change, upfront
investment, annual operating savings/additional costs, target eligibility and the next decision.
Details follow recommendation, outcome, rationale, evidence/uncertainty and human action. Catalogue
finances are full-design estimates, not scaled quotes. Simple payback is only calculated from known
investment and positive operating savings; payback beyond catalogue lifetime is disclosed.
Affected-source overlap is disclosed without summing measures. Scenario factors come from the
selected calculation's frozen library, and higher-emitting scenarios show increases honestly.

An explicit named feasibility assessment uses existing `consultant_tasks` and reviewer audit events,
with a pinned baseline and idempotent request identifier. Completing an assessment does not approve
an investment, implement a measure, verify a physical reduction or change source/calculation data.
The contextual assistant resolves action, category and configured-target facts on the backend;
existing agents, source tools, root-cause analysis, human approval and recovery permissions remain
unchanged. Saved assistant drafts open in their original reporting period.

Reporting pairs actionable requirements with saved report versions: calculation, open incidents,
approved changes/new batches, gaps, estimates/checks and human sign-off. Current queue counts remain
distinct from frozen calculation concerns. Reports lead with a readable result, ranked sources,
concerns and a next step. PDF exports retain saved figures and limitations; technical appendices
and workbook downloads remain available. Earlier report text and approvals are not rewritten.

No schema migration, production data correction, target seed, source rewrite, recalculation or
agent permission change was performed. Missing finance, verified reductions, eligible target
contributions, intensity targets and separate FLAG target accounting remain explicitly unassessed
or unsupported instead of being simulated.

Verification: **152/152 unit/API tests**, **2/2 end-to-end tests**, lint, backend/frontend type
checks and the production build pass. The browser journey covers ranked-source drilldown, compact
two-year scope/FLAG filtering and hover, named incident decisions, action evidence/cost/payback and
feasibility completion, explicit target setup, boundary uncertainty, period-preserving navigation,
report approval and English/Finnish PDF export. Actual-data desktop and 390px mobile inspection
covered Overview, Footprint, Actions, Reporting and the action detail; no page overflow or uncaught
runtime exceptions were observed. Tests use temporary application and nature databases; production
configuration and human decisions were not altered.

Published the staged build to the existing jury gateway by copying assets before atomically replacing
the HTML entry point and retaining preceding chunks. The URL, password and expiry are unchanged.
Authenticated Chrome checks through Cloudflare rendered the five main workflows and the action
detail at desktop/mobile sizes without overflow or uncaught exceptions. The two-year Scope 1
Non-FLAG endpoint returned 200; anonymous access still returned 401. Remote checks were read-only.

## Update: compact, interactive Sankey exploration — 2026-11-08

Replaced the growing Recharts layout with a bounded three-column SVG layout. The overview retains
at least one named source group per scope, groups smaller groups/activities explicitly, and limits
the middle column to ten nodes. All positive emissions are conserved, with one proportional scale
throughout the chart. Label spacing is independent of value magnitude. The main overview is at
most 628 pixels tall; isolated/simple selections are shorter. No accounting values were corrected,
normalised or hidden to make the chart look more balanced.

Hovering nodes and ribbons highlights their complete ancestral/descendant path and dims unrelated
flows, including contributors sharing a destination. Tooltips show unabbreviated amounts, share of
selected positive emissions and each year's contribution. Clicking or Enter/Space pins the selection
without scrolling. Users can isolate a group, material/activity or scope/FLAG branch, explore original
members of Other, and explicitly open source records. Search includes data hidden inside Other.
Range, scope, FLAG, search and exploration filters combine and remain in the URL. Multi-year views
clearly label the combined total and show each year's net total separately. A native expanded dialog,
keyboard controls, reduced-motion support and contained mobile scrolling are included.

The read-only endpoint adds `q`, `group` and `source`, per-year totals, node/link yearly values,
original aggregate members and a source-group catalogue. Saved-run selection, historical source
versions, factor-based FLAG splits, missing-year handling and signed adjustments are preserved.

Validation: **137/137 unit/API tests**, **2/2 end-to-end tests**, lint, backend/frontend type checks
and the production build pass. Tests cover fold conservation and pagination, hidden-material search,
isolation, shared-destination path highlighting, geometric bounds, hover/year details, pinning,
source records, search/reset, expanded-dialog Escape and English/Finnish mobile layouts. Inspected
real-data overview, hover, isolated-material and Finnish mobile captures. Both 2024–2025 and the
DEMO-containing 2025–2026 range return balanced graphs with seven groups and ten activities.

Updated the existing password-protected demo in place, publishing assets before atomically replacing
its HTML entry point and retaining preceding assets. Its URL, credentials and expiry are unchanged.
A real Chrome session through Cloudflare passed the password challenge, rendered the two-year chart,
hovered/pinned/isolated a material, searched a hidden source, explored an Other-group member and
checked the Finnish mobile layout. Anonymous requests still receive 401; authenticated HTML/assets
return 200. Source records, corrections, calculations and audit history remain unchanged.

## Update: temporary remote jury access — 2026-11-08

Added `npm run demo:share -- --api-url http://127.0.0.1:8788 --hours 24` and `npm run demo:stop`.
A loopback gateway serves the production build and authenticates every page, asset and API request
with a random shared demo password. Only its exact generated Cloudflare hostname is accepted;
cross-origin browser requests are rejected before forwarding to the existing local API. Gateway
credentials, cookies and forwarding headers never reach that API. Backend secrets stay local and
are omitted from the connector environment. The existing API Host/Origin protections are unchanged.

The sharing process makes an online SQLite snapshot before exposure, stores its state/credentials
in private ignored files, closes access at the requested expiry (maximum 24 hours), and stops when
the connector exits. The jury uses the current workspace and existing explicit review decisions.
The workstation's active demo launcher holds a temporary Linux idle/sleep inhibitor; its lifetime
ends with the sharing process. A laptop shutdown, closed lid or connectivity loss can still interrupt
the demo. The README documents installation, sharing, expiry and immediate shutdown.

Validation: **132/132 unit/API tests**, **2/2 end-to-end tests**, lint, frontend/backend type checks
and production build pass. Seven gateway tests cover authentication, static-file boundaries,
registered hosts, cross-origin requests, streaming/credential stripping, expiry and unsafe config.
External HTTPS checks confirm 401 without credentials, 200 with credentials for the app and real
Scope 1 multi-year Sankey API, and 403 for an unrelated Origin. Browser tests now wait for the
selected assistant year to reach the URL before submitting a question, avoiding an interaction race.

A real headless Chrome session through the public URL also passed the native Basic login challenge,
rendered the requested 2024–2025 Scope 1 Non-FLAG diagram (13 nodes), and sent a same-origin POST
through the gateway to the real API validator.

## Update: scope and FLAG Sankey — 2026-11-08

Added **Where our carbon comes from** on Sustainability: an interactive Sankey from source groups
through materials/activities to scopes and their FLAG/Non-FLAG portions. Inclusive start/end year
filters, All scopes and individual Scope 1/2/3 controls, relevant land filters and shareable URLs
support, for example, two years of Scope 1 Non-FLAG emissions. Clicking or keyboard-selecting a
node opens paginated records linked to the existing source/calculation lineage. The UI supports
English/Finnish, with horizontal chart scrolling and readable records on phones.

`GET /api/footprint-flow` reads immutable snapshots: one saved run per year for the displayed
Scope 2 basis, or a pinned single-year historical run. Missing years are explicit. The flow excludes
alternative Scope 2 contributions and biogenic memo rows. Negative adjustments remain in the net
total and records, while the Sankey displays positive emissions. Smaller sources aggregate into
Other with no omitted emissions.

Classification follows the SBTi/GHG Protocol scope definitions and the challenge's FLAG method:
fuel/refrigerant operations and purchased energy are Non-FLAG; contract farms use saved field N₂O,
liming and organic-soil components; other emissions use the exact source factor's FLAG share.
Only corrections recorded in the selected run apply. Missing splits remain unclassified, including
supplier PCFs without a split and old farm snapshots without components. The UI links to the SBTi
definitions and FLAG guidance and does not claim SBTi validation. This feature changes no sources,
existing calculations or inventory methods and does not call AI.

Validation: **125/125 unit/API tests**, **2/2 end-to-end tests**, lint, backend/frontend type checks
and the production build pass. Coverage includes inclusive multi-year totals without double-counting
revisions, single Scope 2 basis, historical classification immutability, FLAG component conservation,
negative adjustments, source pagination/drilldown, range validation, synchronized filters, keyboard
selection and hover tooltips. Desktop and Finnish mobile captures were inspected. The live
2024–2025 Scope 1 Non-FLAG endpoint returns both years and reconciles with the saved scope totals.

## Update: discovery and background specialists — 2026-11-07

Completed the interrupted implementation of footprint analysis, data-quality review, raw-material
analysis and reduction advice behind a single assistant. A nature specialist handles catalogued
water/biodiversity questions. Users do not select or manage agents.

* **Findings and next steps:** bilingual cards show what was found, a suggested action, a responsible
  team, a labelled effect and source links. They open existing issue/calculation/query workflows.
  Discovery runs after saved inventory calculations by default, or explicitly with **Find next steps**.
  A missing key still produces deterministic findings. Model/jobs details and failures remain available.
* **Calculation first:** deterministic miners rank issues, calculate correction what-ifs, find
  footprint/farm drivers and match reduction levers. Selected levers (biogas, R404A replacement, HVO,
  low-carbon fertiliser) have scenarios recomputed from inventory inputs; other effects remain
  catalogue estimates or addressable-emissions ceilings. Scenarios are unapplied and non-additive.
  Farm components and FLAG are retained in new contribution metadata without changing totals.
  Older snapshots with no components do not display invented zero-valued breakdowns.
* **AI boundaries:** at most four wording requests per discovery run; wording with unsupported
  numeric values falls back to deterministic text. Questions route to at most two specialists, each
  with four read-only tool calls in two rounds and a final answer request. Numeric checks support
  English/Finnish formatting and rounding; unsupported figures are withheld from answers. These
  checks establish numeric support, not scientific validation or verification of every textual claim.
  Unknown citations are removed and marked limited. Model failures preserve database context.
* **Decisions:** named handled/dismissed/reopened decisions persist across reruns. They never approve
  a correction or apply a scenario. Migrations 006/007 store runs, immutable findings and append-only
  decisions. Writes to the nature model remain confined to its existing Python job tools.
* **Integration:** one shared reporting year, automatic topic routing, an overview shortcut and
  working deep links into issue review. Existing chat history, retries and answer-to-report drafts
  remain available. `DISCOVERY_AFTER_CALCULATION=false` disables automatic discovery.

Validation: **119/119 unit/API tests**, **2/2 end-to-end tests**, lint, frontend/backend type checks
and the production build pass. Browser coverage includes running discovery, named decisions,
decision persistence after reruns, the unified assistant and desktop/mobile layout checks. Tests
use temporary databases and scripted AI; they do not approve or modify operational source data.

Live verification with the configured `gemini-3.5-flash-lite` succeeded: the assistant selected
`list_nature_queries` and `run_nature_query`, answered the CA01 phosphorus-change question and
returned the monitoring-row citation. One live 2025 discovery run saved **15 findings**. Two wording
requests hit provider timeout/high-demand errors; those groups retained deterministic wording and
the run is explicitly `degraded`, with the original errors in review details. No correction was approved.

Rechecked the public 2023/2024 benchmark on a temporary SQLite backup of the existing challenge
imports, avoiding a slow redundant fresh import. Results retain **17/40** raw lines and **36/40**
lines within ±5% after simulated approvals. The working database and its review decisions were
unchanged by this benchmark. The standard fresh-import benchmark was stopped during import.

The integrated workspace currently serves at **http://localhost:5174** (API 8788); the older
separate app occupies 5173/8787. Default clean-install ports remain 5173/8787.

## Update: nature model integrated (Track D) — 2026-11-07

The Python/SQLite nature model moved into `nature_model/` (from the repository's
`apetit_nature_model/`, history kept with `git mv`). TraceFlow now reads its database and runs its tools.

* **Read path (TypeScript, read-only):** `server/services/nature.ts` opens `nature.sqlite` with
  `readOnly: true` per request: status, the 22 catalogued queries (parameter validation ported from
  `nature_queries.py`), saved runs, row-level lineage (port of `query_nature_model.py:trace`),
  catchment/parcel GeoJSON, farm context and nutrient-run listings. Missing or unreadable database → 409.
* **Write path (Python jobs):** `server/services/natureJobs.ts`, table `nature_jobs` (migration 005).
  Rebuild (snapshot first when saved state exists; refused without confirmation), saved query run
  (`--save`), nutrient input run and loss pilot. One job at a time, request-id idempotent, timeout,
  output tails, audit events, interrupted on restart. The child process gets only PATH/HOME/locale and
  `APETIT_DATA_DIR`, never API keys.
* **Gemini:** `server/services/natureAgent.ts`; assistant scope **Nature and water** with three
  read-only tools (list/run catalogued query, lineage summary), ≤ 6 calls in 3 rounds, 40 rows per
  result, citations restricted to returned ids. Not tested against the live API (no key here).
* **UI:** `/nature` (catchment map without basemap, P/N monitoring and action-screen charts, query
  explorer with lineage drawer and save-for-tracing, nutrient runs with partial-total labelling,
  model/jobs panel), a nature panel on farm detail pages, the assistant scope switch. New direct
  dependencies: `leaflet` 1.9.4 (was already installed via `react-leaflet`) and `@types/leaflet`
  1.9.22 (dev; brings `@types/geojson`).
* `nature_model/tools/paths.py` now finds the dataset in the nearest parent folder; docs updated.

Measured on this machine:

| Check | Result |
|---|---|
| Node vs Python, all 22 queries with default parameters | identical row counts and values (exact float equality) |
| TS lineage vs `query_nature_model.py lineage` (3 results: 01/CA01, 04/CA01, 18/CA28:2025:L10) | identical in all 13 sections; 67–128 ms vs ~1.9 s |
| Query timings | 0–111 ms each |
| Real jobs through the API | save run 01 (year 2018) succeeded; input run 2025: 12 s; CA01 loss pilot: 5 s |
| `npm test` | 110 tests, 110 pass (12 new nature tests, incl. TS-vs-Python parameter validation) |
| `npm run test:e2e` | 2 tests, 2 pass; browser smoke now covers four `/nature` views |
| `npm run nature:test` | 80 tests pass from the new location; rebuild reproduced all tracked exports byte-identically |
| `npm run lint` / `npm run typecheck` | 0 problems / 0 errors |

Not done: expert review decisions in TraceFlow (needs nature ROADMAP P0), MCP server, validated
load model or catchment ranking, a live Gemini call.

## Update: same-network team access — 2026-11-07

* `LAN_ACCESS=true` lets teammates use the app at `http://<this machine's IP>:5173` with no code or login
  (the team code was added and then removed at the user's request). The API still binds to `127.0.0.1`;
  only Vite opens to the network. Host/Origin allow-lists add only this machine's own interface addresses
  and hostname, so other host names (DNS rebinding) and other web origins (CSRF) are still refused.
* Code: `server/services/networkHosts.ts`, `server/config.ts`, `server/app.ts`, `vite.config.js`.
  Tests: `tests/api/lan-access.test.ts`.
* Anyone on the network can import, approve and use the configured Gemini key. Not done: accounts, HTTPS.

## Update: current-year selection and real calculation demo — 2026-11-07

Reporting years now include the current calendar year even without activity. Shared year selection
supports direct links across materials, sustainability, transport, automations and reports. Empty
years show missing-input guidance; report creation waits for a saved calculation. The calculation
API rejects years with no contributing activity and marks missing activity coverage explicitly.
The latest year with imported activity remains the default until new-year activity arrives.

Added an explicit **Add mock batch** workflow in Automations. Each persisted, idempotent job imports
synthetic sources through the existing importer, runs built-in quality checks, then saves real
inventory and transport calculations. Progress and logs come from the job, without simulated timers
or totals. Another batch creates new source records and snapshots. Calculation views poll for new
results. No source row, earlier run, factor-library value or human decision is overwritten; ordinary
file uploads retain their existing calculation trigger behaviour. Demo jobs do not invoke AI.

Method 1.1 supports imported site/year electricity factors with record lineage, unit validation,
approved corrections and open-issue tracking. Reference factors still stop in 2025. Mock factors are
explicitly synthetic and apply only to demo sites. Demo status is retained in calculation metadata,
page warnings, report titles/text and assistant evidence; demo runs are excluded from annual trends.

Validation: **95/95 unit/API tests**, **2/2 end-to-end tests**, lint, type checks and the production
build pass. Browser checks cover empty-year guidance, two real demo batches, calculation views
refreshing without a reload, year-specific source rows, calculation provenance and a downloadable
DEMO report. Finnish/English desktop and phone layouts were inspected. Small demo figures retain
decimal precision, chart bars use unrounded values, and language changes update number formatting
immediately.

Loaded one explicitly labelled 2026 mock batch into the running workspace: ten source records and
saved inventory/transport calculations, with an inventory total of **4.09604 tCO₂e** using the
workspace's existing transport/upstream factors and the labelled mock electricity factors. All four
earlier 2025 inventory snapshots were verified unchanged. No correction or review decision was
approved. The live app and database remain healthy at `http://localhost:5173`.

## Update: clearer data review agent results — 2026-11-07

Replaced the raw `farm_survey:… · yield_t_ha · medium · open` result rows with readable field names,
farm/crop/year/survey context, decision badges and a **Check entry** action. Internal origin/concern
codes and repeated human-review instructions now live in expandable details. Farm soil comparisons
keep the uncertainty and existing calculation basis explicit; full original comparisons and source
references remain available. Labels and common crop/field names support Finnish and English.

The agent now shows ten findings per page with whole-review search and status/priority filters.
The API searches before pagination, so findings beyond the old first-100 cap are accessible.
Built-in and AI findings attached to the same issue share a review card, with both explanations
retained. The live farm review has 343 automated findings across 341 distinct decisions; the
default list and its awaiting-review count now both show 341 items.
Current decisions take precedence over historical automated statuses, and saving a decision refreshes
the list and totals. Check coverage, sampling limitations, model metadata and original errors remain
expandable; incomplete review warnings remain visible. Source records and review rules are unchanged.

Validation: **92/92 unit/API tests**, **2/2 end-to-end tests**, lint, type checks and the production
build pass. API regression checks cover search beyond 100 findings, stable pagination, source
context, literal queries, grouping local/AI findings and preservation of human decisions. Browser
checks exercise farm results, pagination, search, comparison details, Finnish/English phone layouts
and a human decision immediately reflected in the list. Desktop/mobile captures of the live farm
review were inspected without changing its records or decisions. The app remains healthy at
`http://localhost:5173`.

## Update: readable reports and guided data review — 2026-11-07

New inventory report drafts use deterministic Finnish/English explanations over an immutable saved
calculation: main result, largest contributors, comparable changes, open questions, next step,
coverage and an explanation of tCO₂e. Provisional figures, estimates, affected areas of missing
information and failed checks remain visible. Only the selected Scope 2 basis enters the summary.
Comparison is restricted to same-year revisions with matching datasets, factors and settings;
the report makes no unsupported annual trend claim. Subsequent human decisions cannot rewrite
the report's saved review counts or explanations. Existing reports retain their original wording.

Reports now prioritise **Download PDF**. Other formats and an optional calculation appendix live
under **More download options**. Full source hashes, notes, calculation references and alternative
energy calculations remain available on demand, as do earlier runs and Excel workbooks. Report
approval requires a typed reviewer name and explicit confirmation, and retains all limitations.

The review inbox uses everyday priority/status labels, human dataset names and source filenames
instead of displaying suggested replacements as established corrections. The drawer follows three
steps: understand the concern, check the recorded entry and supporting documents, choose an action.
Missing-entry corrections use labelled fields when the proposal is a flat object. Technical IDs,
full source payloads and audit history remain expandable. Information requests explicitly record
a local note, leave the concern open and tell the reviewer to contact the source themselves.
No source rows or calculation logic changed, and no approval became automatic.

Validation: **90/90 unit/API tests**, **2/2 end-to-end tests**, lint, type checks and the production
build pass. Browser checks create a report, download and read English/Finnish PDFs with and without
the optional appendix, approve with a named reviewer, verify snapshot/limitation retention and
record a request for information through the guided drawer. Desktop/mobile captures and the
downloaded PDF were inspected. Added regression coverage for snapshot review counts, single-basis
Scope 2, missing-information summaries and restricted revision comparisons. Tests use temporary
databases and scripted AI; the running workspace database was not changed by these checks.

## Update: interface cleanup — 2026-11-07

Simplified the shared header to compact page context and language controls. Removed the persistent
local/database and AI/model badges, sidebar local-mode note, repeated brand eyebrows and prominent
demo buttons. The walkthrough remains available as **Quick guide** in the sidebar. Navigation now
separates workspace tasks, farms/climate, insights and management. The brand tagline wraps instead
of truncating, and system/model/database details are collapsed under **Settings → System information**.

Overview now prioritises **Upload files** and **Review data**, with direct links to upload and audit
tabs. Data platform focuses on datasets, mappings and import history; unsupported Snowflake and
database diagnostic cards were removed from that workflow. Read-only metrics no longer show link
arrows or hover elevation. Source badges are shorter, while data provenance and review labels remain.

Climate controls wrap on narrow screens, metric cards use two mobile columns, and unavailable values
show a dash. Empty crop-yield tables and weather comparison charts no longer occupy large cards;
relevant limitations remain readable. Farm-risk wording now describes the forecast signals actually
used, rather than implying unavailable climate normals or baseline risk models.

Fixed a count discrepancy exposed during the visual review: **Farms per region** was computed from
the first 500 paginated records, while the total covered all 680. The farm API now returns regional
totals over all matching records before pagination. The live summary is 380 Southwest Finland and
300 Skåne, summing to 680. A regression test covers more than 500 farms, pagination and filtering.

Mobile navigation uses a modal drawer with focus trapping, Escape dismissal and focus restoration.
Added a skip link, language labels/pressed states, visible keyboard focus and reduced-motion support.
Desktop and English/Finnish mobile screenshots were inspected with no horizontal overflow.

Validation: **85/85 unit/API tests**, **2/2 end-to-end tests**, lint, type checks and production build
pass. Browser checks include mobile keyboard navigation, upload deep links, expandable system details
and the existing import/review/assistant/report journeys. Tests use isolated databases; the running
app remains available at `http://localhost:5173`.

## Update: one AI assistant — 2026-11-07

Merged the chat and Gemini pages into **AI assistant** at `/assistant`, with one navigation entry
and a redirect from `/gemini`. The combined page includes reporting-year selection, conversation
history, cited evidence with source-view links, a separate AI interpretation, follow-up suggestions,
retry controls and per-answer report drafts. Examples now match the available inventory/quality
evidence. Global issue/dataset summaries are explicitly labelled as covering all reporting years.

Follow-ups send at most three previous exchanges for the same reporting year. The backend validates
message sizes/roles and treats prior model answers as untrusted context, never evidence. Invalid
citations mark the result as limited. Missing AI and failed requests preserve readable database
context. The UI does not present model confidence as a verified probability.

Saving an answer creates a draft with its original year, language, model, cited evidence, interpretation
and evidence limitations. Uncited context is excluded. Drafts are labelled AI generated in Reports;
approval remains an explicit human decision. Conversation state is held in page memory; no source
records, corrections or calculations are changed by the assistant.

Validation: **84/84 unit/API tests**, **2/2 end-to-end tests**, lint, type checks and production build.
The browser journey exercises the legacy redirect, single navigation entry, missing-key context,
follow-ups, failed requests/retry, saving an older answer after changing the selected year, and opening
the resulting draft in Reports. Desktop and mobile screenshots were inspected; neither layout has
horizontal overflow. Tests use isolated databases and scripted AI responses.

## Update: import-level data review agent — 2026-11-07

Added a persistent background review agent under **Data quality → Data review agent**. New API/UI
table imports queue reviews automatically (`AUTO_REVIEW_IMPORTS=true`); existing batches are reviewed
only when selected. Duplicate uploads reuse their previous review. Explicit retries retain run history.
Queued jobs resume; interrupted running jobs are labelled for an explicit retry.

The agent runs existing quality rules and whole-batch plausibility screening, then a bounded Gemini
review (20 initial rows, up to 20 extra batch rows, six read-only calls in two rounds, deadlines/output
limits). Tools can read batch rows, comparable history, and linked document excerpts. Results cite
inspected evidence and exact source fields/values. Unsupported flags are discarded; failures preserve
local findings and never become a clean-data result. Synthetic/demo labels are expected context.

Concerns reuse existing findings or create open issues with no candidate value. They remain visible in
calculation lineage as open-issue warnings. Humans can enter a source-verified replacement with a reason,
dismiss a concern, or record a local evidence request. No messages are sent. Rechecks preserve human
decisions. Source rows, approvals and calculations are never mutated by an AI tool.

The live Gemini test (`gemini-3.5-flash-lite`) completed on supplier PCF `SUP011:M104:2025`, read its
history, and flagged `1409.1` against `1.3515`. The concern remains open. The first live test exposed an
incorrect fractional assumption for PACT `primaryDataShare`; this was corrected to the percentage scale
using the [official specification](https://docs.carbon-transparency.org/tr/data-exchange-protocol/2.3.1/).
The test concern was withdrawn from active screening, with its original observations and withdrawal
reason retained in audit/history. Its human decision status and all source values were preserved.

Validation: **78/78 unit/API tests**, **2/2 end-to-end tests**, lint, strict type checks and production
build pass. Browser verification covers the agent panel, opening a concern and recording an evidence
request without closing the finding. Source row count remains 335,662; the live agent created zero
corrections. SQLite integrity check passes. Migration `004_data_review_agent` adds run diagnostics and
append-only concern records. A SQLite backup was saved before implementation. The app remains running
at `http://localhost:5173`.

## Update: upload reliability and classification — 2026-11-07

Fixed successful imports losing their column mappings, file-level duplicate detection skipping other
worksheets, and substring-based quote/value verification. Duplicate replays remain idempotent; conflicting
interpretations now return an explicit 409 and keep existing immutable rows intact. Verification checks
whole numbers (including sign/decimal/exponent), quote boundaries and the unit associated with that value.

Added a persistent Upload inbox under Data quality: mixed-format uploads, worksheet selection, sample
preview, manual/Gemini column suggestions, category/year suggestions, supplier/material/shipment matches,
manual record search, confirmed linking, reviewer-labelled classification history, and search/status/type/year
filters. No source rows or entity links are created by queuing a file. Confirmation saves classification,
links and table imports atomically. Workbooks remain pending until every sheet is classified, unless the
reviewer explicitly files the whole workbook as evidence. The Datasets table shows saved mappings.

Added optional local OCR with Tesseract and pdftoppm. Original file text is untouched; OCR attempts are
append-only readings. Values matched to OCR are labelled `matched_in_ocr`, requiring a scan check. The
20-page PDF limit is explicit; larger scans are rejected rather than partially read. On this machine the
existing OCR libraries/language data were sufficient; the signed Fedora Tesseract 5.5.3 executable was
downloaded and placed in ignored `data/tools/tesseract`, without installing system packages. Real PNG
and scanned-PDF smoke checks both extracted `120 kg`; identifier OCR was imperfect, reinforcing the
need for review. Setup for other Fedora machines is documented in README_LOCAL.md.

Final verification: lint, strict backend/frontend type checks, production build, **67/67 unit/API tests**,
and **2/2 end-to-end tests** pass. The browser test visits all 17 routes and exercises CSV destination
confirmation and PDF supplier linking through the UI. Existing live database record counts (335,662
source rows, 79 import batches, 1 calculation run, no corrections) were preserved; SQLite integrity check
passed. Migration `003_upload_inbox` was applied after a SQLite backup at
`data/backups/traceflow-before-upload-inbox-1794062985162.sqlite`. The updated app is running on port 5173.

The sections below record the original local migration and its earlier measurements.

Date: 2026-11-07. Machine: Fedora 43, Node.js 22.22.2, npm 10.9.7. Everything below was run on this
machine; numbers are copied from command output.

## Implemented

| Area | Result | Code |
|---|---|---|
| Base44 removal | `@base44/sdk`, `@base44/vite-plugin`, `base44/` (13 functions, 7 shared modules, 18 entity schemas), the SDK client, Base44 image-CDN helpers and the `base44.com` favicon are gone. `grep -i base44` over `src server scripts package.json vite.config.js index.html` finds only comments and the e2e check that asserts *no* Base44 traffic; `package-lock.json` has 0 `@base44` entries | `package.json`, `vite.config.js`, `index.html` |
| No authentication | Login, Register, ForgotPassword, ResetPassword, Mfa, OAuthConsent, AuthLayout, GoogleIcon, 4 MFA components, ProtectedRoute, UserNotRegisteredError, AuthContext, 3 auth helpers, app-params, RoleSwitcher and roles deleted. `/` opens the dashboard in a fresh browser profile | `src/App.jsx`, `src/components/AppLayout.jsx`, `AppTopBar.jsx` |
| Local backend | Fastify 5 on `127.0.0.1` only (non-loopback `API_HOST` stops the server), Host-header and Origin allow-list (DNS-rebinding/CSRF guard), zod validation, JSON errors | `server/app.ts`, `server/config.ts`, `server/index.ts` |
| SQLite | built-in `node:sqlite`, WAL, foreign keys, up/down migrations; source rows, corrections, runs, contributions, issue history and audit events are append-only via triggers | `server/db/*` |
| One-command dev | `npm run dev` starts API + Vite, stops both on Ctrl+C | `scripts/dev.mjs` |
| Import | CSV (RFC 4180, delimiter detection, BOM, CRLF, quoted newlines, Windows-1252 fallback), XLSX (exceljs), PACT JSON; whole file processed, line-numbered rejections, SHA-256 per file, row fingerprints → idempotent re-imports; 35 known datasets detected from headers + `custom_<name>` | `server/domain/{csv,xlsx,pcf,catalog}.ts`, `server/services/imports.ts` |
| Linking | shipments.ref_doc → ERP doc_no → material/supplier; statuses `linked`, `linked_multi_line` (allocation needed), `unlinked_no_erp_document`, `outbound_sales_reference` | `server/services/linker.ts` |
| Quality rules | 48 deterministic rule definitions, 54 rule ids (the farm-survey scale checks run per field) (rule id + version r1.0, evidence ids, candidate, action `set_value`/`exclude_record`/`add_record`/`acknowledge`), fingerprint upsert, never auto-resolved | `server/domain/rules.ts`, `server/services/quality.ts` |
| Review | exact `approve`/`reject`, mandatory reviewer label (unverified), reason, optimistic revision (409), field-conflict 409, append-only correction overlay + audit event with before/after | `server/services/quality.ts`, `src/components/dq/IssueDrawer.jsx` |
| Calculation engine | TypeScript port of the challenge reference calculator (all categories it covers) + contract-farm footprint; one contribution per leg / ERP line / farm with source ids, factor, formula, inputs; Scope 2 both bases stored, only the chosen basis in the total; checks (single basis, Σ = total, memo outside Scope 1, transport not in Cat 1, no farm double count); organisational boundary (S-BJU from 2025-12) | `server/domain/inventory.ts`, `server/domain/method.ts` |
| Runs and lineage | immutable runs (dataset hashes, correction ids, method + factor snapshot, completeness, gaps), compare, benchmark, lineage incl. identifier-linked ERP/material/supplier records | `server/services/calculations.ts` |
| Transport (RouteFlow) | legs with supplied distance, per-mode summary, ERP links, route proposals (`provided_distance`, `manual` with evidence, `fixture` = DEMO, optional HERE with exact coordinates); verifying needs evidence type + note; DEMO cannot be verified | `server/services/routing.ts`, `src/pages/Transport.jsx` |
| Raw materials | Cat 1 goods (PCF valid for the year → default factor), contract farming, services, Cat 2, shown separately from Cat 4 | `src/pages/RawMaterials.jsx` |
| Traceability | run → contribution → source file/row/hash → factor → corrections → open issues → linked records, table view + edge list | `src/pages/Traceability.jsx` |
| Excel export | sheets Shipments, Route Legs, Raw Materials, Quality Issues, Corrections & Audit, Factors & Sources, Calculation Summary, Run Metadata | `server/services/workbook.ts` |
| Gemini investigator | backend-only `@google/genai` 2.32.0; one issue, ≤ 6 tool calls in ≤ 2 rounds, 30 s timeout, retries on 429/5xx only, 8 read-only allowlisted tools, untrusted-data wrapping, JSON-schema output validated with zod, unknown/unreturned citations → `NEEDS_EVIDENCE`, impact only from the deterministic what-if tool, `review_status` always `pending`, model existence checked on first call | `server/services/{gemini,investigator}.ts` |
| General Q&A | `/gemini` and `/assistant` answer from database evidence with validated citations; without a key they show the facts and "AI not configured" | `server/services/assistant.ts` |
| Pages kept working | Overview (real counts, honest empty state), Farms/FarmDetail (registry + parcels + soil map + yields), Climate/Weather (from `tmp/region_rows.json`), Forecast (Open-Meteo), Automations, Settings, Reports, Data platform (local store), Demo | `src/pages/*` |

Removed fabricated or misleading content: the hard-coded Overview sample figures, the "apply all
high-confidence" auto-approval button, farm risk "0/100" tiles (risk is not calculated locally),
"scheduled daily 06:00" automation claims, Snowflake storage claims, the old "open high-severity rows are
excluded" claim (they are calculated as imported and marked `has_open_issue`).

## Tests run

| Command | Result |
|---|---|
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors (backend `tsc --strict`; frontend `checkJs`). The original tree had 200 frontend type errors. |
| `npm run build` | type-check + Vite build succeeded |
| `npm test` | 43 tests, 43 pass: CSV/number parsing, engine arithmetic (10.429 t × 52.6 km = 548.5654 tkm), Scope 2 single basis, overlays, PCF validity, farm formula vs hand calculation, rules, migrations up/up/down/up, imports (>200 rows, repeat upload, semicolon+BOM+decimal comma, xlsx, line-numbered rejections), idempotent scan, review 400/409, approve → new run, reject → unchanged, lineage ids exist, Excel sheets, route evidence rules, append-only triggers, Origin/Host guards, no key leakage, Gemini safeguards (invalid citations, injection text, non-allowlisted tools, call budget, malformed JSON, AI-proposed approval recorded as `ai_investigation`) |
| `npm run test:e2e` | 2 tests, 2 pass: `scripts/dev.mjs` on spare ports, real HTTP import → flag → investigate (not configured) → approve → recalc → trace → export; headless Chrome (fresh profile) over 17 routes with no uncaught errors, no console errors, no failed `/api` calls, no Base44 requests |

The Gemini path was tested with a scripted stub (`mode: stub`), not the real API: no `GEMINI_API_KEY`
was available. The default model id `gemini-3.8-flash` is listed as a stable model with function calling
and structured output on Google's model page (checked 2026-11-07); a call with a real key has not been made.
The server checks the model on the first call and reports the API's error if it is unavailable.

## Data coverage (challenge package, `npm run setup -- --challenge …`)

79 files read from `~/Downloads/Apetit_SinceAI2026 _1_/…/APETIT_CLIMATE_NATURE_NAVIGATOR_2026`
(not copied into the repo): **335,662 rows imported, 0 rejected, 0 duplicates**, in about 7.4 s.
Examples: `shipments.csv` 11,617 / 11,617 (2025: 2,339 legs), `erp_purchase_lines_2021_2025.csv`
7,427 / 7,427, `parcel_crop_history_and_plan.csv` 284,260 / 284,260, 38 PACT PCF files.
Not imported (no consumer in the app): `weather_monthly_1991_2060.csv`, climate signals, scenario/lever/price
tables, catchment loads, the parquet and GeoJSON files, `00_apetit_original/ApetitGroup_sample_data.xlsx`.
Quality scan: 767 findings in about 2.1 s; one inventory run about 1.9 s.

## Benchmark against the public 2023/2024 answers (`npm run benchmark -- <dir>`)

Rules vs `A1_dev_issue_labels_2023_2024.csv` (challenge formula 100 × F1 × (0.75 + 0.25 × type accuracy)):

| Year | Labels | Flagged | Precision | Recall | F1 | Type acc. | Score |
|---|---|---|---|---|---|---|---|
| 2023 | 97 | 95 | 0.958 | 0.938 | 0.948 | 0.978 | 94.3 |
| 2024 | 103 | 98 | 0.980 | 0.932 | 0.955 | 1.000 | 95.5 |

Calculation vs `A2_dev_inventory_{2023,2024}.csv`: **17/40** lines within ±5 % on raw data, **36/40** after
*simulating* approval of every rule proposal in a throwaway database (a measurement, not a workflow; the
app never auto-approves). With label-true values the engine reproduces the truth exactly for refrigerants,
combustion, heat, market electricity, capital goods, waste, travel, commuting, Cat 9, 11 and 12.
Remaining differences after simulation:

| Line | Diff | Cause |
|---|---|---|
| 2024 Cat 2 capital goods | +180 % | one capex line keyed in SEK (5,461,689 vs true 479,095) is not detected; capex amounts vary too much for a safe rule |
| 2023 Scope 2 market electricity | +22.6 % (13.7 t) | the estimate proposed for a missing month differs from the true reading |
| 2024 Scope 2 market electricity | +5.5 % (3.5 t) | same cause |
| Cat 1 | −0.5 % (2023), +0.8 % (2024) | within tolerance; farm soil comes from the ~88 %-accurate soil map |

Misses in the rules: 10 `soil_misreport` labels (soil map disagrees with the hidden true soil) and 3
SEK-keyed spend amounts.

## Mode

Local only. SQLite file, Fastify on 127.0.0.1, Vite on localhost. Routing: supplied distance (HERE not
configured; DEMO fixture route for tests). Gemini: not configured (stub in tests). Open-Meteo forecasts
need internet access.

## Blocked / not done

* Real Gemini calls: no API key on this machine, so no live call has been made.
* HERE routing: no key; untested against the live API.
* `npm audit --omit=dev`: 7 advisories. 5 predate this work: dompurify (critical, via jspdf),
  postcss-selector-parser, quill/react-quill-new and zod. zod is high severity: memory use on oversized
  collections, mitigated here by the 2 MB body limit and `.max()` bounds. 1 is new: exceljs → uuid
  (moderate). follow-redirects (high) left with the Base44 SDK. The zod fix is a 3 → 4 major upgrade that
  also affects the existing React form stack, so it was not applied.
* npm 10 ignores `.npmrc` `min-release-age`; the new direct dependencies are pinned to versions published
  at least 7 days ago (fastify 5.12.7, @fastify/multipart 10.1.6, @google/genai 2.32.0, exceljs 4.4.0).
  Their transitive dependencies were not age-checked.
* Not built: farm drought/nutrient risk indices, crop-yield climate modelling, multi-line ERP freight
  allocation by mass (no multi-line documents exist in the data; such legs are flagged `allocation_needed`),
  base-year recalculation and pathway tasks (B1/B2), nature tasks (D), Docker.

## Files

Added: `server/` (app, config, db, domain, services, providers), `scripts/` (dev, setup, migrate,
import-challenge, benchmark, make-demo-fixtures, sample-workbook), `tests/` (unit, api, e2e, DEMO fixtures),
`src/api/client.js`, `src/pages/{Transport,RawMaterials,Traceability}.jsx`, `src/components/dq/IssueDrawer.jsx`,
`src/lib/categories.js`, `public/favicon.svg`, `.env.example`, `tsconfig.server.json`, `README_LOCAL.md`,
`docs/API.md`, `docs/SCHEMA.md`, `docs/sample/traceflow_DEMO_2025.xlsx`, this report.

Modified: `package.json`, `package-lock.json`, `.npmrc`, `.gitignore`, `index.html`, `vite.config.js`,
`README.md`, `AGENTS.md`, `src/App.jsx`, layout/top bar/nav/i18n/format, every page that used the SDK
(Overview, DataQuality, Sustainability, Reports, Farms, FarmDetail, Climate, Weather, Forecast, Automations,
Settings, Assistant, GeminiAssistant, DataPlatform, Demo), shared components (MetricCard, PageHeader,
AuditTrail, Term, FarmCard, TrendChart, ImportPanel, DatasetTable, IssueRow), 5 shadcn wrappers
(typed as `any`), `src/lib/reportExport.js` (jsPDF page count call), `src/lib/PageNotFound.jsx`.

Deleted: `base44/`, the 21 auth/role files listed above, `src/api/base44Client.js`,
`src/components/snowflake/` (5 files), 4 Base44 image helpers in `src/components/ui/`,
`src/hooks/useOverview.js` (sample figures), `src/components/sustainability/InventoryTable.jsx`.
The untouched original tree is in `../apetit-base44-backup.tar.gz`.

## Next

Add a Gemini key and run one real investigation to confirm the model id. Decide on the zod 3 → 4
upgrade. Add a rule that checks capex lines against `capex_projects.csv` per WBS element, to catch the
SEK-keyed capex amount.

## Compact incident flow and contextual root-cause assistance

Added a count-conserving dataset → incident type → criticality Sankey over canonical issue IDs, with saved discovery links, search/filter/drilldown, hover paths and bounded grouping. Four-level review priority is a documented projection of existing severity/impact; original detector metadata is preserved.

Moved assistance into a persistent contextual floating panel and discoveries into Data quality. Added a specialized bounded root-cause analyst and two traceability views. Removed the standalone assistant, climate, weather archive and forecast pages plus their navigation/workflow entry points; imported evidence and nature tools are preserved. Context is resolved server-side, numeric claims and citations validated, no decisions or source changes occur automatically.

## Validation workspace naming and human review

The page is labelled Validation, its review queue is Incidents, and file intake is Uploads. The header identifies this as the human-in-the-loop workspace and explains that the sustainability expert checks source evidence and approves or rejects corrections. English/Finnish labels, entry points and the pitch brief follow the new naming. Existing review decisions, source provenance and deep links are retained. Validation: 144 unit/API tests, two end-to-end journeys, lint, type checks and production build passed.
