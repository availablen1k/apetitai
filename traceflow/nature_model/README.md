# Apetit nature data model — team handover

**Start here.** This folder contains the work on Apetit's Since AI challenge:
**Which farming areas should we prioritise for protecting water and biodiversity?**

**Status: ready for documented SQL exploration and data mining.** The data model,
source lineage, quality investigations and action-screening examples work. A
validated nutrient-loss model and final catchment priority ranking are **not built**.

Handover date: **7 November 2026**. Read [STATUS.md](STATUS.md) for completed work
and [ROADMAP.md](ROADMAP.md) for remaining work with acceptance criteria. To resume
after a break, use [HANDOVER.md](HANDOVER.md).

**Location:** this folder lives inside the TraceFlow app at `traceflow/nature_model/`.
TraceFlow reads its database read-only (Nature page, lineage, maps, Gemini query tools) and
runs these Python tools for rebuilds, saved query runs and nutrient experiments. See
[../README_LOCAL.md](../README_LOCAL.md#nature-and-water). This folder still works on its own.

## First run on a fresh clone

From the repository root:

```bash
cd traceflow/nature_model
python3 tools/check_environment.py
python3 tools/build_nature_model.py
python3 tools/check_environment.py --verify-existing
python3 tools/query_nature_model.py list
python3 tools/query_nature_model.py query 18_nature_action_opportunities --params '{"year":2025,"catchment_id":"CA28"}'
```

No API keys, accounts, pip packages or network access are required. Requirements:
Python **3.9+**, SQLite **3.33+** with JSON functions. The handover environment uses
Python 3.14.4 / SQLite 3.46.1. The preflight checks compatibility and required inputs.
Building and testing each take roughly a minute in this environment; hardware varies.

P1 input-policy work has started: query `22_nutrient_input_readiness` reports
nutrient/yield/soil-P coverage and affected hectares. Its
[policy 0.1.0](model/nature/NUTRIENT_INPUT_POLICY.md) is a draft awaiting review;
availability does not establish scientific suitability.

The next P1 increment adds a separate, read-only-base
[input-policy experiment](model/nature/NUTRIENT_MODEL_INPUT_POLICY.md), version
0.2.0, with peer/proxy estimates, copied evidence and scope/missingness sensitivity:

```bash
python3 tools/build_nutrient_inputs.py --year 2025
```

It creates a new local run, leaving the base database and earlier experiments
intact. See [the comparison](analysis/nature/INPUT_POLICY_SENSITIVITY.md).
All candidates remain provisional; no nutrient-loss calculations are introduced.

P2 now has an [uncalibrated loss pilot](model/nature/NUTRIENT_LOSS_METHOD.md),
version 0.1.0. After creating an input run, pass its printed SQLite path:

```bash
python3 tools/build_nutrient_losses.py --inputs /path/to/input_run/inputs.sqlite --catchment-id CA01
```

It separates annual field losses, distance delivery and catchment retention,
preserves unknown scope totals and compares input/method stress cases. Read the
[CA01 pilot report](analysis/nature/NUTRIENT_LOSS_PILOT.md). All numerical modifiers
are explicit prototype assumptions; numerical checks do not validate the science.

The database is **built locally**, not downloaded from Git. All required builders,
schemas, rules, tests and source data are tracked. Database binaries, compressed
snapshots, source archives and backups remain ignored. Preserve valuable local
review/proposal/query state before rebuilding; see the snapshot instructions below.

**Dataset dependency:** the supplied challenge dataset stays outside this folder, at the
repository root (`../../APETIT_CLIMATE_NATURE_NAVIGATOR_2026/`). `tools/paths.py` uses the
nearest parent folder that contains it. It is already tracked in this repository;
clone the full repository to get it. The model does not duplicate it.

If copying this model folder elsewhere, keep the **full** challenge package and set:

```bash
export APETIT_DATA_DIR=/absolute/path/APETIT_CLIMATE_NATURE_NAVIGATOR_2026/data
python3 tools/check_environment.py
```

The sibling `docs/` and reference `tools/ccn_tools/` inside that challenge package
are also required; a copy of only its CSV files is insufficient. This is explicit
data dependency configuration, not a request for secrets. Run the preflight after
changing it. `--data-dir` also exists on the main builder.

## Where everything lives

```text
traceflow/nature_model/
  README.md                    Entry point and quick start
  HANDOVER.md                  How to resume; suggested next-session prompt
  STATUS.md                    Completed work and known limitations
  ROADMAP.md                   Prioritised TODOs and acceptance criteria
  ARCHITECTURE.md               Data flow, code map and reproducibility
  CONTRIBUTING.md               Team workflow and query/change checklist
  tools/                       Python builders, query CLI, snapshots and tests
  model/nature/                SQL schema, 22 queries, rule configs and detailed docs
  analysis/farming/            Exploration reports and optional 2025 CSV export
  analysis/nature/             Small query-result snapshots and validation report
    nature.sqlite             Restored/working DB — local, ignored by Git
    sources.sqlite            Captured raw records/versions — local, ignored by Git
  backups/                     Manual snapshots — local, ignored by Git
```

The previous root `tools/`, `model/` and `analysis/` directories have moved here.
The current database is now **`traceflow/nature_model/analysis/nature/nature.sqlite`**.
All commands in the detailed documentation assume this model folder is the working
directory. Commands that receive a script path also work from another directory;
default data/model/output paths do not depend on the working directory.

## Useful exploration

```bash
# Arbitrary year; the database is not scoped to 2025.
python3 tools/query_nature_model.py query 01_contract_area --params '{"year":2018}'

# Missing inputs, outliers and other investigation candidates.
python3 tools/query_nature_model.py query 07_quality_findings --params '{"year":2025,"rule_id":"peer_outlier","limit":10}'

# Inspect action prerequisites and programme-level cost assumptions.
python3 tools/query_nature_model.py query 21_action_details --params '{"lever_id":"L12"}'

# Explain an existing result through records and method evidence.
python3 tools/query_nature_model.py lineage 18_nature_action_opportunities CA28:2025:L10 --output /tmp/apetit-action-lineage.json
```

Queries are read-only by default. `--save` records a new execution, actual bind
parameters, results, current quality-review context and contributor lineage. See
the [query contracts](model/nature/API_QUERY_CONTRACTS.md) for pagination, result
grain, NULL handling, units and execution-ID usage.

SQL clients can open `analysis/nature/nature.sqlite` directly. Start with
`field_context`; filter by `year` and `crop_status`. `field_context_2025` is just a
compatibility view. Future weather exposure has **field/year/scenario** grain.

## Checks, rebuilds and state preservation

```bash
python3 -m unittest discover -s tools -p 'test_*.py'
python3 tools/check_environment.py --verify-existing
```

**Before rebuilding a database with reviews, proposals or saved runs you need:**

```bash
python3 tools/create_snapshot.py
python3 tools/build_nature_model.py
```

The snapshot tool uses SQLite's backup API, includes a hash manifest and refuses
to overwrite an existing snapshot directory. It is a **manual safety copy, not
automatic review-state migration**. Rebuilding replaces analytical state. Raw
source capture in `sources.sqlite` preserves previous source versions separately.
See [ROADMAP P0](ROADMAP.md#p0-preserve-human-state-before-real-review-work).

The pre-packaging database has been retained locally under
`backups/pre_packaging/`; its old code hashes refer to the former directory layout.
New builds use package-relative code IDs and `dataset/` IDs for original reference
code. Preserve needed review/query state separately; it is not included in a
Git clone. The earlier compressed distribution experiment is retained locally
under ignored `backups/previous_git_snapshot/`, not supplied to teammates.

## What goes into Git

Commit this folder's code, SQL, JSON configs, tests, docs and small result reports.
Do not commit working databases, compressed snapshots/manifests, source archives,
sidecars, backups, caches or large derived farming CSVs. Teammates build locally:

```bash
cd traceflow/nature_model
python3 tools/check_environment.py
python3 tools/build_nature_model.py
python3 tools/check_environment.py --verify-existing
```

The original challenge dataset is already tracked in the repository, so a full
clone contains the inputs. No external Python packages or API keys are required.
`database_artifact.py` remains an optional local export/restore utility; it is not
the setup path and no prebuilt database artifact is supplied through Git.

From the repository root, inspect before staging:

```bash
git status --short
git status --short --ignored traceflow/nature_model
```

Do not force-add ignored databases or backups. Follow the team's branch/PR workflow.

The challenge package supplies its own code/data licences and original-workbook
exception. This model folder does not copy the original workbook. Synthetic
result snapshots derive from the Since AI ry 2026 package; preserve that attribution
and the original dataset licence files when sharing the repository.

## Detailed reading map

| Need | Read |
|---|---|
| Current state and unfinished work | [STATUS](STATUS.md), [ROADMAP](ROADMAP.md) |
| Resume with a teammate or coding agent | [HANDOVER](HANDOVER.md) |
| Code/data flow and reproduction | [ARCHITECTURE](ARCHITECTURE.md) |
| Add queries or change the model | [CONTRIBUTING](CONTRIBUTING.md) |
| Tables, types, units and grains | [Data dictionary](model/nature/DATA_DICTIONARY.md) |
| API/MCP-ready query contracts | [Query contracts](model/nature/API_QUERY_CONTRACTS.md) |
| Source-to-result explanation | [Lineage](model/nature/LINEAGE.md) |
| Findings versus corrections | [Data quality](model/nature/DATA_QUALITY.md) |
| Climate/sourcing assumptions | [Climate and sourcing](model/nature/CLIMATE_AND_SOURCING.md) |
| Evidence, scenarios and action screening | [Decision context](model/nature/DECISION_CONTEXT.md) |
| Original exploration | [Farming exploration](analysis/farming/README.md) |

In these documents, **challenge package/dataset** means the supplied
`APETIT_CLIMATE_NATURE_NAVIGATOR_2026`; **model package** means this folder.

## Troubleshooting

| Symptom | Check / action |
|---|---|
| Preflight reports missing data/docs/reference code | Clone the complete repository or point `APETIT_DATA_DIR` at the full challenge package's data directory |
| SQLite JSON functions unavailable | Use a compatible Python/SQLite runtime; preflight reports versions and does not install anything |
| Cannot open the database after cloning | Run `python3 tools/build_nature_model.py` to generate the local database |
| Old `analysis/…` or root `tools/…` path fails | Those directories now live inside this model folder |
| Code/source hash mismatch | Preserve valuable state, identify the changed version, then rebuild; do not describe stale outputs as current |
| Query is empty for a future year | Select the relevant SSP; economic scenarios have only supplied year points and no interpolation |
| Test imports fail | Use the documented unittest discovery command, not an assumed installed Python package |
| Important decisions disappeared after rebuilding | Restore the preserved snapshot; automatic migration remains ROADMAP P0 |
