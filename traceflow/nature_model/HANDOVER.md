# Resume here

This handover freezes the documented **data-foundation milestone** for Apetit's
Track D challenge. No nutrient modelling or service implementation was started
as part of packaging.

P1 has since started: query 22 and `nutrient_input_context` classify nutrient,
yield and soil-P coverage under draft policy 0.1.0. Read the
[coverage summary](analysis/nature/NUTRIENT_INPUT_COVERAGE.md) and
[draft policy](model/nature/NUTRIENT_INPUT_POLICY.md). Next resolve the outstanding
policy decisions before building model inputs; implement P0 before recording
real reviews. The draft does not approve corrections or estimates.

Provisional input policy 0.2.0 is also implemented in
`tools/build_nutrient_inputs.py`. It creates independent input/evidence artifacts
and compares reported-only, same-country peers and a labelled SE pea proxy,
including scope uncertainty and leave-farm-out evaluation. Read
[INPUT_POLICY_SENSITIVITY](analysis/nature/INPUT_POLICY_SENSITIVITY.md). The base
DB is unchanged by these experiments. Next choose/validate scientific assumptions
for a P/N loss model; the experiments remain unreviewed and do not compute loads.

P2 now has `tools/build_nutrient_losses.py`, a separate uncalibrated CA01 2025
pilot using a matching input artifact. Read [NUTRIENT_LOSS_METHOD](model/nature/NUTRIENT_LOSS_METHOD.md)
and [the pilot report](analysis/nature/NUTRIENT_LOSS_PILOT.md). It computes
provisional field loss, delivery and retention, with independent nutrient coverage,
unknown totals, copied raw evidence and sensitivity cases. It does not modify
the base/input run or use monitoring to fit parameters. Next justify/calibrate
the model and design independent evaluation, keeping P0 ahead of real reviews.

## Ten-minute orientation

1. Read [README](README.md), [STATUS](STATUS.md) and [ROADMAP](ROADMAP.md).
2. From this folder, run `python3 tools/check_environment.py`.
3. If no DB exists, run `python3 tools/build_nature_model.py`. No database binary
   is supplied through Git. Preserve important local state before rebuilding;
   migration remains a TODO.
4. Run `python3 tools/check_environment.py --verify-existing` and inspect
   `analysis/nature/validation.json`.
5. List questions with `python3 tools/query_nature_model.py list`.
6. Explore one year/catchment and action lead, including lineage and prerequisites.
7. Before editing, run tests and read [CONTRIBUTING](CONTRIBUTING.md).

Detailed model documents are in `model/nature/`: dictionary, query contracts,
quality workflow, lineage, climate/sourcing and decision context. They describe
the implementation, not verified sustainability outcomes.

## What the next person inherits

- All supplied farming years/plans, not a database limited to 2025.
- Connected SQLite tables with 30 captured inputs and 22 documented questions.
- Versioned raw capture, typed data and source-linked quarantine.
- Investigative quality rules; original values remain unchanged.
- Saved execution/contributor lineage and explanatory method evidence.
- Five nature-action screens with prerequisites and unquantified efficacy.
- Standard-library-only tools, tests, source/config hashes and small result snapshots.

They do **not** inherit a validated load model, final rank, approved action
portfolio, API/MCP server, automatic state migration or verified external standards.

## Suggested prompt for the next session

> We are working on Apetit's Since AI Track D challenge: which farming areas should
> be prioritised for protecting water and biodiversity? The work is packaged in
> `traceflow/nature_model/`. Read README.md, STATUS.md, ROADMAP.md, ARCHITECTURE.md and
> the relevant model/nature docs before changing code. Retain all supplied farming
> years; years are query filters. Preserve original records, units, missingness,
> source lineage and expert-review distinctions. First inspect the current DB/state
> and run preflight. Do not rebuild over important reviews/proposals/saved runs
> without preserving them. Confirm the next roadmap item: P0 state preservation
> if real review is starting, otherwise P1 nutrient-input policy followed by a
> validated P/N loss/delivery model. Existing action screens are assessment leads,
> not final recommendations or quantified reductions. Keep docs and tests current.

## Decisions to keep

| Decision | Reason |
|---|---|
| SQLite and Python stdlib | Easy local mining before choosing API/MCP/UI |
| Dataset outside this folder | Original data is already tracked; avoid duplication |
| All years retained | Historical mining and scenarios need explicit filtering |
| Reports separate from field facts | Avoid repeated whole-farm totals after joins |
| Scenario remains in weather keys | Future scenarios must not multiply area unnoticed |
| Assumed field/grid mapping is explicit | No supplied field climate-cell key |
| Findings separate from corrections | An outlier is not an approved error/fix |
| Data and method provenance | Explain both inputs and applied assumptions/context |
| No efficacy inferred from catalogue | Programme costs/CO2e are not field P/N reductions |
| Development answers outside features | Calibration/evaluation must avoid leakage |

## State and reproduction

Database binaries, compressed snapshots/manifests, the independent source archive
and backups are excluded from Git. Build locally after cloning. Share important
review state separately if needed; rebuilding does not migrate it automatically.

`backups/pre_packaging/` preserves the local pre-move database. Its code hashes use
the former repository layout. New builds use model-relative IDs and `dataset/`
IDs for original reference code; the preflight verifies the current build.

Tracked query CSVs/reports describe a **build snapshot**, not a live dashboard.
Regenerate after data/rule changes and explain material differences in a PR.
Additional saved runs do not update build-time counts or default CSV exports.
