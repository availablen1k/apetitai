<p align="center">
  <img src="brand/bon-apetit-ai-logo.png" alt="Bon Apetit AI logo" width="140" />
</p>

<h1 align="center">Bon Apetit AI</h1>

<p align="center"><b>From source records to sustainability decisions you can explain.</b><br/>
AI investigates. The engine calculates. You decide.</p>

<p align="center">Built for the <b>Apetit × Since AI 2026 “Climate & Nature Navigator”</b> challenge.<br/>
Working prototype · synthetic challenge data</p>

---

## Live demo

**➡️ https://spaces-iron-cancer-compatible.trycloudflare.com**

| | |
|---|---|
| Username | `<ADD USERNAME>` |
| Password | `<ADD PASSWORD>` |

The demo runs on a team laptop behind a temporary Cloudflare tunnel. It is available until
**9 November 2026, 00:25 (Helsinki/Athens time)** and while that laptop is online. Everyone who
logs in shares one demo database, so the figures change as people review incidents and recalculate.

---

## What it is

Bon Apetit AI is a workspace for the sustainability expert at a food and farming company.
Emissions data arrives from many places: ERP purchases, supplier product footprints, energy meters,
refrigerant logs, shipments, commuting surveys and hundreds of contract-farm surveys. One wrong unit
can distort the whole inventory. In the challenge data, a single electricity reading typed in
kilowatt-hours instead of megawatt-hours moves the 2025 total by about 700,000 tCO₂e.

The app finds suspicious records, explains them in plain language, traces every reported figure
back to its source file and row, and lets a named person decide what changes, across both carbon and
nature data.

## What you can do

| Page | What it answers |
|---|---|
| **Overview** | Where do we stand? The footprint, the change from last year, the largest sources, how much of the total still rests on open incidents, and the three most useful next steps, each with **Explain this** and **Root cause**. |
| **Footprint** | Where do emissions come from? A ranked source list that opens the contributing records, and an interactive carbon Sankey (sources → activities → Scope 1/2/3, FLAG / non-FLAG). |
| **Actions** | What could we change? Reduction measures with effects recomputed on the saved inventory (or clearly labelled catalogue estimates), costs and payback, plus all findings. |
| **Reporting** | A readable report draft in one click: result, change from last year, reliability, largest sources, what to check, next steps. PDF/Excel download and named approval. |
| **Validation** | The human-in-the-loop page. **Incidents**, sorted by how much of the footprint they touch, each with its source row and a proposed correction to approve or reject. **Uploads** for Excel, CSV, PACT JSON and documents (with OCR). |
| **Raw materials · Transport** | Deep dives into purchased goods and inbound/outbound transport. |
| **Farmers & fields** | Which contract farms drive the raw-material footprint, and whose data is estimated or missing. |
| **Nature & water** | Where do contract areas meet weak water status, and what could be discussed with the farms there? A catchment map, monitored nutrient loads and screened nature actions. |
| **Traceability** | Follow any reported figure to its contributions, factor, source file and row, or follow an incident to its root-cause investigation. |
| **Ask AI** | A floating assistant on every page that knows what you are looking at and answers from database evidence with citations. |

The interface is available in English and Finnish.

## How the AI is used, and its limits

- **Deterministic code does the accounting.** It handles the greenhouse-gas inventory, what-if
  effects and lineage. The language model never calculates the reported numbers.
- **AI specialists investigate and explain.** A footprint analyst, data-quality reviewer,
  raw-materials analyst, reduction advisor, root-cause analyst and nature analyst work behind one
  interface, using allowlisted, read-only tools. The nature analyst calls documented, parameterised
  queries and never runs free SQL.
- **Every number the AI writes is checked** against the data it was given. Unsupported figures, raw
  record keys and jargon fall back to plain deterministic text.
- **Nothing is approved automatically.** Every correction and report sign-off needs a named person.
  Source records are never overwritten, every calculation is an immutable snapshot, and every change
  goes into an append-only audit trail.
- **It works without AI.** Calculations, rules, findings, lineage and reports run without a key.
  The current model is Google Gemini, called from the server only.

## Run it locally

**Requirements**
- Node.js 22.13+.
- Python 3.9+ with SQLite 3.33+.
- The challenge data package `APETIT_CLIMATE_NATURE_NAVIGATOR_2026/` (66 MB). It is **not in
  this repository**. Get it from the challenge organisers and place it next to `traceflow/`, or set
  `APETIT_DATA_DIR` to its `data/` folder.

```bash
cd traceflow
npm install
npm run setup                 # creates the local database
npm run nature:build          # builds the nature database (about a minute)
npm run dev                   # web app http://localhost:5173 · API http://127.0.0.1:8787
```

To load the challenge data into the app:

```bash
npm run setup -- --challenge "../APETIT_CLIMATE_NATURE_NAVIGATOR_2026"
```

**Optional AI:** copy `traceflow/.env.example` to `traceflow/.env` and set `GEMINI_API_KEY`.
Never commit `.env`. Other settings in that file include `GEMINI_MODEL`, `API_PORT`, `SQLITE_PATH`,
`AUTO_REVIEW_IMPORTS`, `DISCOVERY_AFTER_CALCULATION`, `OCR_LANGUAGES` and `LAN_ACCESS`.

### Tests

```bash
cd traceflow
npm run lint && npm run typecheck
npm test                      # unit and API tests
npm run test:e2e              # browser journeys (needs Chrome or Chromium)
npm run nature:test           # nature model tests (Python)
```

## Repository layout

```
brand/                     Logo files
traceflow/                 The app (React + Vite, Node.js/Fastify API, SQLite)
  src/                     Pages and components
  server/                  API, calculation engine, data-quality rules, AI specialists
  nature_model/            Python/SQLite nature model: builders, 22 queries, nutrient experiments
  tests/                   Unit, API and end-to-end tests
  docs/                    API and database schema
```

## Status and limitations

- **Prototype on synthetic challenge data.** It is not a company inventory, and corrected figures
  are data-quality changes, not physical emission reductions.
- **Runs on one machine**, with no user accounts. The public link is a temporary,
  password-protected demo.
- **Nature screening is decision support, not a validated catchment ranking.** The nutrient
  experiments are provisional, and the nutrient-loss pilot is uncalibrated.
- **Effects of measures are estimates** until a measure is implemented and measured.

## More documentation

- Local setup, configuration and troubleshooting: [traceflow/README_LOCAL.md](traceflow/README_LOCAL.md)
- API: [traceflow/docs/API.md](traceflow/docs/API.md) · Schema: [traceflow/docs/SCHEMA.md](traceflow/docs/SCHEMA.md)
- Nature model: [README](traceflow/nature_model/README.md) · [Status](traceflow/nature_model/STATUS.md) · [Roadmap](traceflow/nature_model/ROADMAP.md)
- Change log: [traceflow/IMPLEMENTATION_REPORT.md](traceflow/IMPLEMENTATION_REPORT.md)
