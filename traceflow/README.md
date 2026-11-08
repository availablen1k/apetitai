# Apetit TraceFlow

Local, single-user workspace for Apetit's climate data: import Excel/CSV/PACT files, link purchases,
suppliers, farms and shipments, calculate transport (Scope 3 Cat 4/9) and raw-material (Cat 1)
emissions separately, flag suspicious data with deterministic rules, optionally investigate a flag
with Gemini, approve or reject corrections by hand, recalculate as an immutable run, trace every
number to its source row, and export the run to Excel.

The **Nature and water** page adds the Track D nature model ([nature_model/](nature_model/README.md)):
catchment and field maps, monitored P/N loads, screened nature actions, the 22 documented nature
queries with row-level source lineage, saved query runs, experimental nutrient input/loss runs and
Gemini answers that call those queries as read-only tools.

**Validation → Discoveries** combines calculated discoveries with plain-language
suggestions, effect estimates and source links. Background specialists cover footprint analysis,
data quality, raw materials, reductions and nature questions. A contextual **Ask AI** panel floats on every page. The compact incident Sankey breaks distinct
incidents down by dataset, type and Critical/High/Medium/Low priority; adjacent **Root cause** buttons
open a specialized evidence-based analyst. **Traceability** covers both reported figures and incident
causes. The standalone assistant, climate intelligence and weather pages have been removed. Findings also work without AI; decisions never apply corrections or
reduction scenarios automatically.

Runs on your machine only: React + Vite frontend, Node.js (Fastify) API, SQLite files, and Python 3
for the nature model's builders. No login, no cloud backend.

```bash
npm install
npm run setup
npm run nature:build   # builds nature_model/analysis/nature/nature.sqlite (about a minute)
npm run dev            # http://localhost:5173
```

* Setup, configuration and troubleshooting: [README_LOCAL.md](README_LOCAL.md)
* API: [docs/API.md](docs/API.md) · Database schema: [docs/SCHEMA.md](docs/SCHEMA.md)
* What was built, tested and measured: [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md)
