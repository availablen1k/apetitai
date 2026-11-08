# Apetit TraceFlow — local setup (Fedora)

TraceFlow runs entirely on your machine: a React/Vite frontend, a Node.js (Fastify) API and a
SQLite database file. There is no login, no account and no cloud backend. Base44 is not used.

> **Local prototype.** The API binds to `127.0.0.1` only, refuses requests whose `Host` is not this
> machine and refuses browser requests from any other origin. By default only this machine can use it.
> For a small team on the same network, see "Team access on the same network" below (no code or login).
> For temporary remote judging, use the password-protected sharing gateway below. Never point a
> public tunnel directly at Vite or the unauthenticated API.

## 1. Prerequisites

| Need | Version | Check |
|---|---|---|
| Node.js | 22.13 or newer (uses the built-in `node:sqlite` and TypeScript type stripping) | `node --version` |
| npm | comes with Node.js | `npm --version` |
| Python 3 | 3.9 or newer with SQLite 3.33+ JSON functions (standard library only; no pip packages) | `python3 --version` |

On Fedora: `sudo dnf install nodejs npm`, then confirm the version above.
No compiler, Docker or database server is needed: SQLite is built into Node.js and Python, and the
only native files in `node_modules` are the prebuilt Vite toolchain binaries (`rolldown`, `lightningcss`).
Python runs only the nature model's own tools (build, saved query runs, nutrient runs); Fedora ships it.

Verified on this machine: Node.js 22.22.2, npm 10.9.7, Python 3.14.8 / SQLite 3.50.2, Fedora 43.

Optional: Google Chrome or Chromium for the browser part of `npm run test:e2e` (skipped if absent).

## 2. Install and start

```bash
npm install
cp .env.example .env        # optional; defaults work without it
npm run setup               # creates data/traceflow.sqlite, applies migrations, loads tmp/region_rows.json
npm run nature:build        # builds nature_model/analysis/nature/nature.sqlite (~1 minute, ~1 GB)
npm run dev                 # starts the API (127.0.0.1:8787) and Vite (http://localhost:5173)
```

Open <http://localhost:5173/>. The dashboard opens directly; there is no login page.

The header contains page navigation and language controls. The main workspace follows
**Overview → Footprint → Actions → Reporting**, with **Validation** for explicit human data decisions.
The reporting year follows navigation. **Quick guide** opens the walkthrough. **Upload files** opens the
**Validation → Uploads** directly. Technical connection, model and database details are under
**Settings → System information**, which is collapsed by default.

**Footprint** starts with ranked emissions sources and source-record drilldown. Its interactive
scope/FLAG Sankey, recorded history and illustrative sensitivity exercise are available on demand.
**Actions** compares existing operational measures, expected annual carbon effects, catalogue
investment and operating costs. Its detail panel connects the estimate to evidence and an explicit
human feasibility assessment. Completing that assessment does not record an implemented or verified
reduction. Finances describe catalogue design, not a scaled quote for the selected inventory;
overlapping measures are not summed.

**Overview** uses actual company target definitions from **Settings → Company-defined targets**.
With no definition, it explains what is missing. Absolute endpoints require a saved baseline and
an explicit boundary; later inventory versions require their own named comparability review.
**Reporting** provides actionable requirements alongside saved report snapshots, with ranked sources,
plain-language concerns, optional technical details and readable PDF export. Missing estimates,
unresolved incidents and stale report versions remain visible. Original agents, investigations,
source lineage, correction overlays and named report approval remain available.

To load the Apetit × Since AI 2026 challenge package (read in place, not copied into the repo):

```bash
npm run import:challenge -- "/path/to/APETIT_CLIMATE_NATURE_NAVIGATOR_2026"
# or during setup:
npm run setup -- --challenge "/path/to/APETIT_CLIMATE_NATURE_NAVIGATOR_2026"
```

Then in the app: **Validation → Check for possible errors**, review findings, **Sustainability → Calculate (new run)**,
**Explain this number**, **Excel**.

Use **Validation → Uploads** for CSV/TSV, Excel, PACT JSON, PDF, Word, images and other files,
several at once. Uploading stores the original file and creates an item marked **Needs classification**.
Open it to review the proposed category, reporting year, dataset and supplier/material/shipment links.
Suggested links are unchecked until you select them. Unknown files remain pending until you choose a category.

For tables, review the columns and sample values, then **Confirm destination and import rows**.
Unfamiliar layouts support manual column mapping or Gemini suggestions; values are never changed by AI.
Column mapping renames fields; it does not convert tonnes to kilograms or currencies. Check units before importing.
Every Excel worksheet is selectable and classified separately. You can file a cover sheet as evidence and import
the data sheets. The workbook stays pending until every sheet has a decision, or you explicitly file the entire
workbook as a document. Repeated imports do not duplicate rows. A conflicting interpretation of an already
imported row returns HTTP 409; use reviewed corrections rather than importing both versions and double-counting.

The inbox supports search and filters by file type, classification status and confirmed reporting year.
The **Documents** tab searches filenames, local text and linked identifiers, with file-type/link-status filters.
Document extraction is evidence only: it does not create accounting rows or approve corrections.

PDF text and DOCX are read locally. Legacy DOC/XLS, PowerPoint, RTF and OpenDocument files use LibreOffice
when available (`sudo dnf install libreoffice`). Legacy XLS is evidence-only; save as XLSX or CSV for row import.
Other formats can be stored even when no reader is available.

For scanned PDFs and images, choose **Read with OCR**. Optional Fedora dependencies:

```bash
sudo dnf install tesseract tesseract-langpack-eng poppler-utils
```

OCR runs locally with Tesseract; PDFs are rendered with pdftoppm. It accepts PDFs of up to 20 pages and fails
explicitly on larger files rather than silently dropping pages. Split larger scans first. OCR may misread numbers
and units: Gemini values matched against OCR are labelled **matches OCR — check the scan**, never verified source
text. Mixed PDFs can also be OCRed explicitly. Without the OCR tools, originals remain stored and Gemini can
read supported PDFs/images (up to 14 MB inline). Storage and local reading do not call Gemini. Extraction,
issue investigation, and AI-enabled data reviews may send bounded document evidence to Gemini; automatic
review of newly imported table batches is enabled by default as described below.

## Reporting years and the live mock-data demo

The current calendar year remains selectable even before activity has been imported. Calculation,
transport, materials, automation and report pages accept `?year=2026` links. The default remains the
latest year with activity until newer activity arrives. An empty year shows what is missing; the
API refuses to save an empty inventory as a zero-emissions result. Calculations with missing activity
categories remain provisional and identify unconfirmed coverage.

For a presentation, open **Automations**, select **2026**, and click **Add mock batch**. Each click
stores a clearly marked synthetic site, purchase, delivery, electricity reading and refrigerant event,
plus their supporting master data and example factors. It automatically runs the real importer,
built-in quality rules, inventory calculation and transport calculation. The panel shows actual job
progress, a saved result and links to the calculation pages. Another click adds a separate batch and
creates new calculation snapshots. Repeating the same request ID reuses its original job.

The open calculation pages refresh their latest results every three seconds. Demo data stays in this
database with DEMO identifiers and `demo=true` source fields; the generated files are not presented as
company data. Demo calculations are labelled in the page warnings, exported report text/titles and
assistant evidence, and are excluded from the annual trend chart. Reports and corrections still need
a human decision. This example is started by the button; ordinary uploads do not gain a new automatic
calculation trigger. The demo uses built-in rules and does not call AI.

Electricity factors in the reference method end in 2025. No later-year value is silently borrowed.
Future-year site factors can be imported into the emission-factor library as `EF-ELEC-LB:SITE:YEAR`
and `EF-ELEC-MB:SITE:YEAR`, with `unit=MWh` and `kgco2e_per_unit`. The engine converts kg/MWh to
t/MWh and retains the factor records in lineage. Both factors must be supplied when the reference
year is unavailable. The demo provides explicitly synthetic factors only for its own demo sites;
existing library factors and earlier calculation snapshots are preserved.

## Reading reports and checking information

On **Sustainability**, **Where our carbon comes from** shows a Sankey from source groups through
materials/activities to Scope 1, 2 and 3. Set **From year** and **To year** and choose **Apply**;
the range includes both years. These are annual inventory totals, not daily-prorated estimates.
Use **All scopes**, **Scope 1**, **Scope 2** or **Scope 3**, then **All emissions**, **FLAG** or
**Non-FLAG** where relevant. This dataset's Scope 1 fuel/refrigerant records and Scope 2 purchased
energy are Non-FLAG. Missing source splits remain **Not classified**, with their own filter.

The view uses one saved inventory run per year for the displayed Scope 2 basis; revisions are not
added together. A single-year view follows the selected historical run. Missing years are explicitly
excluded, not counted as zero. The filters apply to the flow and its records; the rest of the page
continues to show the selected annual calculation. Filters stay in the URL, for example:

```text
/sustainability?year=2025&flow_from=2024&flow_to=2025&flow_scope=scope1&flow_land=non_flag
```

The chart stays compact when several years are selected: a bounded overview groups small source
groups and activities into explicit **Other** flows without dropping emissions. Both the combined
total and each year's net total are shown. Hover over a bar or ribbon to trace its connected path,
dim unrelated flows, and see exact positive amounts, the share of the selected positive total and
each year's contribution. Labels use compact amounts; the tooltip shows unabbreviated amounts
with the view's standard rounding.

Select a bar (or use Enter/Space) to pin the flow without scrolling away. **Isolate this flow**
rescales the chart to that group/material/scope; **Explore the sources inside** opens the individual
members of an Other group. **View source records** explicitly opens the traceable records below.
Search finds materials and activities across the full selected data, including those inside Other.
The source-group picker provides another way to explore. **Back to overview** clears these extra
filters while preserving the year/scope/FLAG selection. Exploration stays in the URL as `flow_q`,
`flow_group` and `flow_source`.

**Expand** opens a larger native dialog (Escape closes it). The chart scrolls horizontally on small
screens, and its records remain readable without the chart. A mixed record contributes only its
selected FLAG or Non-FLAG portion to a filtered view. Each record links to the complete saved
contribution and source lineage. Negative adjustments remain in the net total and records; only
positive flows determine the Sankey widths. One proportional scale is used throughout each chart.

Classification uses the FLAG share on the exact source factor and only the corrections present in
that saved run. Contract farming uses its saved field-N₂O, liming and organic-soil components. A supplier
PCF without its own split does not silently borrow a default factor's share; older farm snapshots with
no component data also remain unclassified. **How do scopes and FLAG work?** links to the SBTi scope
definitions and FLAG guidance. This view does not claim SBTi validation. It runs locally without AI.

In **Reports**, select a year with a saved emissions calculation and choose **Create report draft**.
New drafts start with the main result, biggest contributors, changes since a comparable saved
calculation for the same year, items needing attention and the next step. Scope names and the
tCO₂e unit are explained. Missing information and estimated values remain visible in the reading
summary. This is a deterministic explanation of the saved calculation, without an AI call.

**Download PDF** is the main download. **More download options** contains Word, text, Markdown,
the calculation's detailed Excel workbook, and **Include calculation details** for the technical
appendix. Source references, full calculation notes and alternative energy calculations are also
available under **Sources and calculation details**. Earlier runs and their workbooks remain under
**Saved calculations and detailed Excel files**.

Drafts require **Review and approve**, a reviewer name and an explicit confirmation. Approval keeps
limitations visible. A saved report retains the calculation and review counts from when that
calculation was created; later corrections require recalculation and a new report. Comparisons
only describe same-year revisions with matching sources, factors and settings, not annual trends.
Existing reports retain their saved wording. New calculation reports are readable in Finnish and English.

In **Validation → Incidents**, open an item and follow the three steps: understand the concern,
check the original entry and supporting documents, then choose what to do. Suggested changes are
unconfirmed. **Enter a confirmed correction** asks for the value and reviewer name; missing entries
use labelled fields when possible. **Close without a change** records a decision without applying
the suggestion. **Ask for information** records what is still needed and leaves the item open;
contact the supplier or colleague yourself. IDs, original check explanations and history remain
under **Check details and history**. Confirmed corrections preserve the original information and take effect
when you calculate again.

## AI assistant

**Ask AI** floats at the bottom right of every page. It follows the current page and the
incident, figure or flow you hover, focus or select. Hovering is local; a question or **Root cause**
explicitly starts an AI request. Close the panel to keep working; its conversation survives page
navigation and clears on reload. Old `/assistant` and `/gemini` bookmarks open this panel in Data
quality. There is no standalone assistant, Climate intelligence, Weather archive or Weather forecast
page. Old weather/climate bookmarks return to the overview; underlying imported evidence is retained.

**Validation → Discoveries** shows **Findings and next steps** for the selected year: what we
found, what we suggest, who to discuss it with and the effect on the footprint. **Find next steps**
reviews the saved calculation. Discovery also runs after each inventory calculation by default; set
`DISCOVERY_AFTER_CALCULATION=false` for manual runs. Without AI, calculated findings still work.

Four background specialists cover the footprint, data quality, farming/raw materials and reduction
options. They are selected internally; there is no agent picker. Code mines candidates and calculates
effects before AI simplifies the wording in Finnish and English. Numeric values in AI text must match
the supplied values or supported rounding; otherwise the original calculated wording is retained.
This checks numeric support, not the scientific validity or full meaning of an AI statement.

Effect labels distinguish a category's size, exposure to open issues, a proposed-correction what-if,
a recomputed reduction scenario and an unverified catalogue design estimate. Unknown effects remain
unknown. Scenarios are not applied and their effects must not be added together. Older farm snapshots
without component data need recalculation before they can show drivers or a FLAG breakdown. FLAG
here includes field N₂O, liming and organic soils; the added component storage does not change totals.

**Mark handled**, **Dismiss** and **Reopen** require a named decision, saved in an append-only log.
These decisions persist across discovery reruns. They do not approve corrections or change inventory
figures. Use a card's action to open the existing review or calculation workflow. Newer calculations
mark older findings stale; missing nature data and failed AI wording remain visible in review details.

The floating **AI assistant** defaults to **All workspace**. Ask about any imported dataset,
suppliers, materials, sites, farms, transport, water, emissions, action costs/payback, configured
targets, reports or uploaded evidence. It can also explain concepts and draft text; general guidance
is labelled separately from company evidence. **This page / selection** keeps contextual explanations
and the specialised incident root-cause workflow available. Merely hovering an incident does not
restrict a workspace question. Workspace conversation follows navigation and reporting-year changes;
each turn still retains its original year and context when saved as a report draft.

General chat uses one workspace assistant without a separate routing call. Contextual questions can
still use the existing background specialists. All share structured read tools: dataset discovery,
paginated source search, aggregates across complete filtered datasets, saved inventory/lineage and
year comparisons, operational measures and finance estimates, targets/reporting, saved documents,
extracted uploaded-document text and the 22 catalogued nature queries. Raw aggregates are labelled
and units/currencies stay separate. Missing values do not become zero. No SQL, approval, job-running,
external messaging or data-write tool is exposed.

Execution is bounded to eight tool calls in four rounds per answer. A valid structured reply is reused
without another generation request. Unsupported figures get one constrained repair attempt and remain
withheld if unsupported; unknown citations are removed with a limited-evidence state. Provider rate
limits have an explicit retry state with source evidence retained. Follow up, expand citations or save
an answer as a report draft. There is no live web/weather retrieval or arbitrary filesystem access.

Gemini receives the question, current database evidence and up to three previous exchanges for the
same evidence context. Earlier answers and UI labels are untrusted context, not evidence. IDs and
filters are resolved against the database on each question. Chat is kept in app memory; reload clears it. Successful answers are logged in the activity log.

**Save as report draft** saves the selected answer, its original year/language, cited sources,
interpretation and any evidence limitations to **Reports**. It never approves or publishes the report.
Failed requests can be retried. Without AI, database context remains readable without an invented
answer. Missing keys and disabled AI can be checked in **Settings**.

## Validation: human review and two kinds of traceability

**Validation** is the human-in-the-loop workspace where sustainability experts inspect source evidence,
investigate incidents and approve or reject corrections. **Incidents** is the review queue, and
**Uploads** holds files for classification and import confirmation. A reviewer makes every decision.

**Validation → Incidents** has a compact Sankey: source dataset → incident type → criticality.
Widths are distinct canonical incident counts, not emissions. Rules, data-review findings and the
latest saved discovery findings link through the incident ID without double counting. The graph
shows up to six dataset groups and ten type nodes. Small groups remain inside explicit **Other**
flows; click a bar to pin it, isolate a criticality/dataset/type, explore Other, or open the associated
incidents. Hover highlights connected paths with exact counts, shares and year counts. **Expand**
opens a larger view. Search, year, review status and criticality apply to both chart and inbox.

Criticality policy `severity-impact-v1` projects existing assessments without rewriting detector
severity or history: high severity plus high potential impact is **Critical**; otherwise recorded
severity maps to **High**, **Medium**, or **Low**. These are review priorities, not proof of error.

**Traceability** offers **Reported figures** (saved calculation → contribution → original rows,
factors and corrections) and **Incident root causes**. Each incident's **Root cause** button opens a
specialized AI analyst in the floating panel. It reads bounded source rows, related records, rules,
history, factors and linked discoveries through allowlisted tools. Its result separates observations,
suspected mechanisms, uncertainty, missing evidence and the next human check, with source links.
Unsupported numbers are withheld; an unavailable model still shows the recorded evidence and
explicitly says the cause is unestablished. Analysis never approves a correction or alters source data.

## Data review agent

New table imports through the API or Uploads automatically queue a background data review
(`AUTO_REVIEW_IMPORTS=true`). Existing datasets are not sent to AI automatically. Use
**Validation → Uploads → Data review agent → choose a file → Check this file** for existing data.
The first button reuses a previous review; **Run checks again** explicitly starts a new run.

Results show readable field names, farm/crop/year context and a **Check entry** action. The initial
list contains items needing a decision, with ten per page. Search covers the entire review,
including findings beyond the original 100-item limit; crop names can be searched in Finnish or
English. Built-in and AI checks of the same issue share one card and one human decision; both
explanations remain in the card's details. Use the status filter for earlier decisions or withdrawn concerns. Human decisions update
the list and its counts immediately. **Comparison and check details** preserves the full explanation,
source filename/line and technical references. **Check coverage and details** retains AI sample
coverage, original run notes, model details and errors. A completed check is not a clean-data clearance.

The agent runs existing specialised rules and screens every new row for calendar/coordinate errors,
known fraction/percentage bounds, suspicious negative values and extreme batch-peer outliers.
Field semantics matter: PACT `primaryDataShare` is a percentage, unlike fractional crop/factor shares
([PACT 2.x specification](https://docs.carbon-transparency.org/tr/data-exchange-protocol/2.3.1/)).
Unknown share fields are not assigned a range based on their name.

Gemini initially receives at most 20 rows: suspicious rows plus an evenly spaced sample. It may use
six read-only tool calls in two rounds to inspect up to 20 additional batch rows, comparable historical
rows, and linked documents. It has no SQL, approval, deletion or correction tool. Calls have deadlines
and output limits. This uses the configured Gemini key and model, and sends that bounded evidence to
Google. Background review uses up to three generation steps per imported batch (transient failures may retry within each step’s deadline); disable automatic review
with `AUTO_REVIEW_IMPORTS=false` and run selected batches manually if preferred.

Every concern must reference an inspected row, a real field, its exact observed value, and returned
evidence IDs. Unsupported claims are discarded and the run is marked degraded. No model-supplied
replacement is applied. A concern is a hypothesis requiring human review, not a determination of error.
Confidence labels are qualitative, not calibrated probabilities. Coverage, local-only mode, failures
and uninspected rows are shown explicitly; no successful sample is a whole-dataset clearance.

Concerns appear in the existing Incidents and issue drawer. A person can enter a verified correction
(agent-origin concerns require a supporting reason), dismiss a concern, or **Ask for information**. Evidence
requests are local audit notes: no email or other message is sent, and the finding stays open. Rechecks
do not reopen or overwrite earlier human decisions. Corrected runs still require explicit recalculation;
until then source values remain in calculations with open-issue warnings.

Queued jobs survive restarts; a job interrupted while running is marked interrupted for explicit retry.
Without a key, local checks still run. AI failure never produces a clean-data claim or removes local
findings. Retrying an earlier failed/local-only review is explicit. No unbounded full-database AI scan
runs in the background.

## Nature and water

**Nature and water** (`/nature`) answers Track D: which contract-farming areas to prioritise for
protecting water and biodiversity. It uses the nature model in [nature_model/](nature_model/README.md),
built from the challenge package at `../APETIT_CLIMATE_NATURE_NAVIGATOR_2026/`.

* **Catchments**: map of the 42 catchments by ecological status, fields of the selected catchment
  (contract crop highlighted), monitored P/N loads, contract-crop area and screened nature actions.
  The geometry is synthetic and drawn without a basemap, so the map works offline.
* **Queries and sources**: the 22 documented nature queries with their parameter forms. **Sources**
  on a row shows its row-level lineage: model tables, source rows, source files with SHA-256, method
  context, and a JSON download. Lineage exists only for saved runs. The build saves each query with
  default parameters; for other parameters, **Save run for tracing** records one.
* **Nutrient experiments**: create an input run (policy 0.2.0, provisional), then run the
  uncalibrated loss pilot for one catchment. Results come from the pilot's own files. A scope total
  that includes unavailable fields stays unknown; the chart shows the available-fields-only sum,
  labelled partial.
* **Model and jobs**: build state, Python version, **Rebuild**, and the job log.
* **Farm detail** pages show the farm's fields, catchments, screened actions and farm/field findings
  from the nature model for a chosen year.
* **Ask AI** automatically handles nature questions with `list_nature_queries`,
  `run_nature_query` and `get_nature_lineage` (at most 4 calls in 2 rounds; 40 rows per result). It never receives SQL text.
  Citations it did not receive from a tool are removed, and the answer is then marked degraded.

How reads and writes are split:

* TraceFlow opens `nature.sqlite` **read-only** for every request. It never writes to it.
* Builds, saved query runs and nutrient runs run the nature model's Python tools as **jobs**, one at
  a time, so a rebuild cannot overlap a save. Each job needs a name and is logged in the audit trail.
  Repeating a request reuses the original job. A job running during a server restart is marked
  interrupted. Python never receives the Gemini or HERE keys.
* A rebuild replaces the whole file (atomically, only after a successful build). If saved runs,
  reviews or proposals exist, it is refused until you confirm, and it writes a snapshot to
  `nature_model/backups/` first. A rebuild also rewrites the tracked query exports in
  `nature_model/analysis/nature/`.
* Without the database, the Nature page shows how to build it and the other pages are unaffected.

What it does not do: there is no validated nutrient-loss model, no calibrated uncertainty and no
final catchment ranking. Action screens are leads, quality findings are review candidates, and
expert review decisions are not recorded in TraceFlow (nature model ROADMAP P0 comes first).

## Team access on the same network

For a few teammates on the same Wi-Fi or office network:

1. In `.env` set `LAN_ACCESS=true` and restart `npm run dev`. Vite now listens on all addresses; the API
   still listens on `127.0.0.1` only and is reached through Vite.
2. Find your address with `ip -4 addr show` (e.g. `10.50.3.24`) and give teammates `http://<that address>:5173`.

There is no code or login: anyone who can reach that address on the network can import files, approve
corrections and run Gemini on your key. Host names other than this machine's own addresses and other web
origins are still refused (DNS-rebinding and CSRF protection). Traffic is plain HTTP. Fedora's default
`FedoraWorkstation` firewall zone already allows ports 1025–65535; with a stricter zone run
`sudo firewall-cmd --add-port=5173/tcp`. Set `LAN_ACCESS=false` to go back to this-machine-only.

## Temporary remote jury access (up to 24 hours)

The optional sharing command serves the **production build** behind a new random password and
creates a temporary Cloudflare HTTPS link. No Cloudflare account or domain is needed. The ordinary
API remains on loopback with its existing Host/Origin checks. The gateway authenticates **every**
page, asset and API request, checks the browser origin, and strips the demo password before proxying.
Access closes automatically after 24 hours (or a shorter `--hours` value). Ctrl+C closes it immediately.

Install `cloudflared` from [Cloudflare's official downloads](https://developers.cloudflare.com/tunnel/downloads/).
On Linux x86-64 it can live privately under the ignored `data/` directory:

```bash
mkdir -p data/tools
curl --fail --location --output data/tools/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod 700 data/tools/cloudflared
npm run build
# Keep the existing local app/API running. On this workstation its integrated API uses 8788.
npm run demo:share -- --api-url http://127.0.0.1:8788 --hours 24
```

Share the printed HTTPS URL, username `jury`, and password from `data/demo-share/current.json`.
The jury enters these in its browser's sign-in prompt. That local file is mode 0600 inside a 0700
directory; it also records the exact expiry and connector state. No API key is included in the
frontend, tunnel process or sharing credentials. Do not share the state file itself.

```bash
npm run demo:stop
```

Keep the laptop plugged in, awake and online for the whole session, and keep the sharing command
and API running. On Linux you can prevent automatic idle sleep for the command's lifetime with
`systemd-inhibit --what=idle:sleep --who=TraceFlow --why="Jury demo" npm run demo:share -- --api-url http://127.0.0.1:8788 --hours 24`.
Closing the laptop lid, shutting down or losing connectivity can still interrupt access.
Cloudflare Quick Tunnels have no uptime guarantee; a restart generates a new URL
and password. See [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
This is a temporary demo, not permanent hosting. Judges use the **current workspace**, including
its existing upload/review/calculation/AI actions. An online SQLite backup is saved before opening
access at `data/demo-share/before-demo-*.sqlite`; it preserves the starting database without changing
source records or audit history. Uploads remain in their existing immutable storage.

## 3. Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + Vite together (`scripts/dev.mjs`); Ctrl+C stops both |
| `npm run dev:api` / `npm run dev:web` | either half on its own |
| `npm run demo:share -- --api-url http://127.0.0.1:8788 --hours 24` | production UI + password + temporary HTTPS tunnel; expires automatically |
| `npm run demo:stop` | close the current remote demo without stopping the ordinary local app |
| `npm run setup` | migrations + weather aggregates; `-- --challenge <dir>` also imports the package |
| `npm run import:challenge -- <dir>` | imports every known CSV/JSON file of the challenge package |
| `npm run db:migrate -- up\|down\|status` | apply, revert the newest, or list migrations |
| `npm run test` | unit + API tests (in-memory SQLite, no network, no secrets) |
| `npm run test:e2e` | starts `npm run dev` on spare ports, runs the full journey over HTTP, then a headless-Chrome smoke test of every page |
| `npm run build` | type-checks backend and frontend, then builds the frontend into `dist/` |
| `npm run lint` | ESLint |
| `npm run benchmark -- <dir>` | scores the rules and the calculation against the public 2023/2024 answers (throwaway database) |
| `npm run fixtures` | regenerates the DEMO test fixtures in `tests/fixtures/demo` |
| `npm run sample` | writes the sample workbook `docs/sample/traceflow_DEMO_2025.xlsx` from the DEMO fixtures |
| `npm run nature:build` | preflight, build and verify the nature model database (same as **Rebuild**, without the saved-state check) |
| `npm run nature:test` | the nature model's 80 Python tests |

## 4. Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `API_HOST` | `127.0.0.1` | only loopback values are accepted; anything else stops the server |
| `API_PORT` | `8787` | Vite proxies `/api` to this port |
| `VITE_PORT` | `5173` | the allowed browser origin follows this port |
| `SQLITE_PATH` | `./data/traceflow.sqlite` | WAL mode, foreign keys on |
| `GEMINI_API_KEY` | empty | backend only; never sent to the browser or logged |
| `GEMINI_MODEL` | `gemini-3.8-flash` | checked with the Gemini API on first use; a wrong id is reported, not faked |
| `ENABLE_AI_INVESTIGATION` | `true` | `false` disables the Gemini investigator |
| `AUTO_REVIEW_IMPORTS` | `true` | queue bounded data reviews after new API/UI table imports; `false` keeps batch review manual |
| `DISCOVERY_AFTER_CALCULATION` | `true` | review newly saved inventory calculations for findings; `false` keeps discovery manual |
| `ROUTING_PROVIDER` | `provided_distance` | `provided_distance`, `manual`, `fixture` (DEMO) or `here` |
| `HERE_API_KEY` | empty | optional HERE truck routing; needs exact coordinates |
| `MAX_UPLOAD_MB` | `100` | per file |
| `TESSERACT_PATH` | searched in PATH, then `data/tools/tesseract` | optional local OCR executable |
| `PDFTOPPM_PATH` | searched in PATH, then `data/tools/pdftoppm` | PDF rendering for OCR |
| `OCR_LANGUAGES` | `eng` | Tesseract languages; install matching language packs, e.g. `eng+fin+swe` |
| `NATURE_MODEL_DIR` | `./nature_model` | the nature model folder (tools, SQL, run directories) |
| `NATURE_SQLITE_PATH` | `<NATURE_MODEL_DIR>/analysis/nature/nature.sqlite` | read-only for TraceFlow; passed as `--database` to every Python tool |
| `PYTHON_PATH` | `python3` | interpreter for nature jobs; missing → jobs fail with a clear message |
| `APETIT_DATA_DIR` | found by the nature model (nearest parent with the challenge package) | passed to Python only when set |
| `NATURE_JOB_TIMEOUT_MIN` | `20` | a job running longer is stopped and marked failed |

Without `GEMINI_API_KEY` the app shows **AI not configured** and everything else (import, rules, review,
calculations, lineage, Excel) works normally.

## 5. Where data lives

| Path | Content |
|---|---|
| `data/traceflow.sqlite` (+ `-wal`, `-shm`) | everything: source rows, issues, corrections, runs, audit log |
| `data/uploads/<sha256>.<ext>` | the original bytes of every imported file |
| `data/uploads/evidence/<sha256>.<ext>` | original documents, including files queued in the Uploads |
| SQLite `upload_inbox`, `upload_decisions` | inbox items and append-only classification history |
| SQLite `evidence_files`, `evidence_links`, `evidence_extractions`, `evidence_text_runs` | metadata, original text, links, AI extractions and separate OCR readings |
| `tmp/region_rows.json` | regional weather aggregates loaded by `npm run setup` (part of the earlier project) |
| `nature_model/analysis/nature/nature.sqlite`, `sources.sqlite` | nature model database and captured source versions (built locally, git-ignored) |
| `nature_model/analysis/nature/input_runs/`, `loss_runs/` | one folder per nutrient experiment run (git-ignored); a folder without `validation.json` is listed as incomplete |
| `nature_model/backups/` | snapshots taken before a rebuild that would drop saved state (git-ignored) |
| SQLite `nature_jobs` | Python job log: kind, parameters, status, exit code, output tails |

`data/` and `.env` are git-ignored. To start over, stop the app and delete `data/` (this deletes all
imports, decisions and runs).

## 6. Troubleshooting

* **"Connection unavailable" in the header / pages show "Local API is not reachable"**: the API is not running; start `npm run dev`.
* **Port in use**: the API prints `Port 8787 … is already in use`; set `API_PORT` (and/or `VITE_PORT`) in `.env` and restart.
* **"Node … is too old"**: install Node.js 22.13 or newer.
* **Gemini errors**: the message from the Gemini API is shown on the investigation (e.g. unknown model id, invalid key). Set `GEMINI_MODEL` to a model your key can use.
* **Import rejected "columns do not match any known dataset"**: choose the dataset explicitly or import as `custom_<name>`.
* **Nature page says "not built"**: run `npm run nature:build` or **Model and jobs → Build**. If the preflight reports missing files, the challenge package is not at `../APETIT_CLIMATE_NATURE_NAVIGATOR_2026/`; set `APETIT_DATA_DIR`.
* **Nature job failed**: open it under **Model and jobs**; the Python stderr is shown. "Python is not available" means `PYTHON_PATH` is wrong.

## 7. Known limitations

* Source data is synthetic challenge material, not verified Apetit operational data.
* Reviewer names are typed labels without login; they are not verified identities, and the audit log is not a regulated audit trail.
* Shipments contain distance and mode but no exact origin/destination, so no route geometry is drawn; distances are used as supplied. Route proposals (manual/HERE/DEMO) are evidence, not proof of the actual journey or a ferry booking.
* Farm drought/nutrient risk indices and crop-yield climate impacts are not calculated (no validated model in the source data); those fields show "—". The nature model's loss pilot is uncalibrated and not used as a risk score.
* Saved nature query runs live in `nature.sqlite` and are dropped by a rebuild (snapshot first; no automatic migration).
* Snowflake is not part of the local version.
* See `IMPLEMENTATION_REPORT.md` for measured accuracy and open items.
