# Projects

Both parts use the Apetit × Since AI 2026 *Climate & Nature Navigator* challenge package
(`APETIT_CLIMATE_NATURE_NAVIGATOR_2026/`). All source data is synthetic. They now live in one app:
the nature model sits inside TraceFlow at `traceflow/nature_model/`.

## 1. Apetit TraceFlow (`traceflow/`)

A local, single-user web app for Apetit's **climate data**: emissions inventory and data quality
(challenge tracks A1 and A2). It also hosts the nature model's pages.

- **What it does:** imports Excel, CSV and PACT JSON files and links purchases, suppliers, farms
  and shipments. It calculates transport emissions (Scope 3 Cat 4/9) and raw-material emissions
  (Cat 1) separately. Deterministic rules flag suspicious data, and Gemini can optionally
  investigate a flag. A person approves or rejects each correction. Each recalculation is saved as
  an immutable run. Every number traces back to its source row and emission factor, and runs
  export to Excel.
- **Stack:** React + Vite frontend, Node.js (Fastify, TypeScript) API, SQLite. It runs on
  `127.0.0.1` only, with no login and no cloud backend. It was migrated off Base44; the original
  code is kept in `other project/apetit-base44-backup.tar.gz`.
- **Also includes:** an upload inbox for documents, local OCR, an AI data-review agent, an AI
  assistant that answers from database evidence, readable Finnish/English reports, and a mock-data
  demo mode.
- **Discovery and advice:** four background specialists find footprint drivers, data issues,
  farm-data gaps and reduction opportunities. Cards show what was found, a next step and a labelled
  effect, with source links and named decisions. A single assistant also handles nature questions;
  calculated findings remain available without AI.
- **Rules:** source rows, corrections and runs are append-only. Neither the rules nor the AI
  approve anything automatically.
- **Measured results** (from its `IMPLEMENTATION_REPORT.md`): A1 issue detection scored 94.3
  (2023) and 95.5 (2024). The A2 inventory matched 36 of 40 lines within ±5 % after all proposed
  corrections were applied.
- **Not built:** farm risk indices, crop-yield climate modelling and pathways (B). No real Gemini
  call has been made, because no API key was available.
- **Run:** `cd traceflow && npm install && npm run setup && npm run nature:build && npm run dev`,
  then open http://localhost:5173.

## 2. Apetit nature data model (`traceflow/nature_model/`)

A reproducible Python/SQLite **data foundation for Track D**: *which farming areas should Apetit
prioritise for protecting water and biodiversity?*

- **What it does:** builds a local SQLite database from the challenge data, covering farming,
  nature, catchment monitoring, climate, ERP sourcing, scenarios and frameworks. Raw source
  versions are captured before modelling, and rejected records are quarantined.
- **Contents:** 22 parameterised, documented SQL queries with record-level lineage; quality
  findings (review candidates, not corrections); five nature-action screening rules; and saved
  query executions.
- **Data scale** (from its `STATUS.md`): 680 farms, 14,213 fields, 284,260 field-year rows and
  42 catchments.
- **Experiments:** a provisional nutrient-input policy (0.2.0) with peer/proxy estimates, and an
  **uncalibrated** nutrient-loss pilot for catchment CA01 in 2025.
- **Not built:** a validated nutrient-loss model, calibration, and the final pressure × state
  catchment ranking (D1). Reviews also do not carry over automatically when the database is
  rebuilt. `ROADMAP.md` lists the remaining work as P0–P4.
- **Stack:** Python 3.9+ standard library and SQLite 3.33+. It needs no packages, API keys or
  network access. The database is built locally and is not stored in Git.
- **Run on its own:** `cd traceflow/nature_model && python3 tools/check_environment.py && python3 tools/build_nature_model.py`

## How they work together

- TraceFlow's **Nature and water** page reads the nature database **read-only**. It shows a
  catchment and field map, monitored P/N loads, screened actions, the 22 queries with row-level
  source lineage, and the nutrient experiment results. Farm detail pages show the same data for
  one farm.
- Rebuilds, saved query runs and nutrient runs run the nature model's own **Python tools as jobs**,
  one at a time and logged.
- The AI assistant's **Nature and water** mode lets Gemini call the catalogued queries as read-only
  tools. It gets a query id and validated parameters, never SQL.
