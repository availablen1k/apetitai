# Apetit — Since AI Hackathon 2026

Our team is working on Apetit’s **Climate & Nature Navigator**.

Everything runs in **[traceflow/](traceflow/README.md)**: a local web app (React, Node.js, SQLite)
for the climate side (emissions inventory, data quality, lineage, Gemini review) and, on its
**Nature and water** page, Track D: **Which farming areas should we prioritise for protecting water
and biodiversity?**

The Track D data model is packaged in **[traceflow/nature_model/](traceflow/nature_model/README.md)**
(Python standard library + SQLite). TraceFlow reads its database read-only and runs its tools.

- [What is complete](traceflow/nature_model/STATUS.md)
- [Remaining work and acceptance criteria](traceflow/nature_model/ROADMAP.md)
- [How to resume later](traceflow/nature_model/HANDOVER.md)
- [Local setup and the Nature page](traceflow/README_LOCAL.md)

```bash
cd traceflow
npm install
npm run setup
npm run nature:build   # about a minute; builds the nature database locally
npm run dev            # http://localhost:5173
```

Requirements: Node.js 22.13+, Python 3.9+ with SQLite 3.33+, and the supplied dataset already
tracked at `APETIT_CLIMATE_NATURE_NAVIGATOR_2026/`. No API keys are needed; Gemini is optional.
Databases, uploads, snapshots and backups are built or kept locally and excluded from Git.

The nature model includes a documented data-mining foundation, provisional input-policy
experiments and an [uncalibrated 2025 nutrient-loss pilot](traceflow/nature_model/model/nature/NUTRIENT_LOSS_METHOD.md).
Scientific validation, reviewed actions and final catchment ranking remain TODOs.

Use the team’s feature-branch/PR workflow. Keep service secrets in `traceflow/.env`, outside Git.
