# Status — 7 November 2026

## Verdict

**Complete for the current data-foundation milestone. Not a finished Track D solution.**
The database enables exploration, source-quality investigation and evidence-backed
action screening. Separate P1 input experiments and a P2 catchment pilot now
produce provisional inputs and uncalibrated delivered-load estimates. There is
no scientifically validated load model or final catchment ranking. Continue with [ROADMAP.md](ROADMAP.md), rather than
importing unrelated feeds simply to increase coverage.

## Completed

- [x] All four farming sources, all supplied years, retaining declared versus planned crops.
- [x] All seven master CSVs, including full farm attributes, sites and emission factors.
- [x] All supplied nature files, catchment monitoring, indicators and linked geometry.
- [x] Monthly climate, grids/signals, assumed same-region field mapping and complete-window summaries.
- [x] Focused ERP sourcing, explicit units/reference FX, signed returns and annual farm/crop support.
- [x] All six scenario CSVs, original/restated/preliminary values kept distinct.
- [x] Framework registry/digest plus three local method documents and exact sections.
- [x] Versioned source capture before typed modelling; quarantine and evidence for rejected CSV records.
- [x] Versioned quality findings, review/proposal tables and explicit heuristic limitations.
- [x] Source-record and transformation lineage; additional explanatory method evidence.
- [x] Twenty-two parameterized, documented SQL questions with contributor queries.
- [x] Saved execution/result/review snapshots and backward/forward lineage exploration.
- [x] Five explicit nature-action screens, with prerequisites and unquantified efficacy.
- [x] Reproducible builders, unit/integration tests and build validation reports.
- [x] One-folder handover, environment preflight, portable data configuration and manual DB snapshots.
- [x] Build-from-source distribution: binaries, compressed exports and local state are excluded from Git.
- [x] P1 first increment: nutrient-input coverage query/view and draft policy 0.1.0,
  distinguishing schema omissions, report/value gaps, reported zeros and future plans.
  Includes affected mapped hectares, distinct reports, quality context and lineage.
- [x] P1 second increment: provisional input policy 0.2.0 with immutable input/evidence
  artifacts, distinct observed/estimated/derived values, N component dependencies,
  same-country peers and labelled SE proxy alternatives, scope/missingness
  sensitivity, donor spread and leave-farm-out self-report consistency checks.
  No scientific approvals or nutrient-loss estimates are implied.
- [x] P2 first increment: uncalibrated CA01 2025 field-loss/delivery/retention pilot,
  explicit method assumptions, complete raw-input/driver evidence, historical
  weather, independent nutrient coverage, donor/method stress cases and tested
  field-to-catchment reconciliation. Missing scope totals remain unknown.

## Baseline data coverage

| Entity | Baseline count / coverage |
|---|---|
| Source files in the current build | 30, including four local Markdown documents |
| Farms / fields | 680 / 14,213 |
| Field-year assignments | 284,260; declared 2012–2026, planned 2027–2031 |
| Management reports | 6,120; FI 2012–2026, SE 2018–2026 |
| Existing calculator footprints | 3,437; FI 2012–2026 |
| Catchments / annual monitoring rows | 42 / 105; 15 catchments, 2019–2025 |
| Monthly weather | 139,104; historical 1991–2026, three SSPs 2027–2060 |
| Annual weather summaries | 11,592; scenario retained |
| ERP / materials / suppliers | 7,427 / 48 / 86; ERP posting years 2021–2025 |
| Sites / emission factors | 5 / 84 |
| Framework source pointers / local sections | 36 / 22 |
| Action levers / active screening rules | 30 / 5 |
| Action-screening records | 36,312 **field/year/lever records**, not unique opportunities or hectares |
| Quality findings | 7,006 **review candidates**, not confirmed errors |

Counts describe the supplied input version and current rules. The authoritative
machine-readable build report is [validation.json](analysis/nature/validation.json).
It describes build-time state; later `--save` executions can increase run/result
counts without changing domain data. **All 80 tests passed after the P2 pilot**,
including coverage conservation, missingness, contributor lineage, portability
and snapshot checks. The database was snapshotted and rebuilt; preflight passed,
and all 2,539 result rows from the original 21 queries are unchanged. See
[P1 verification](analysis/nature/nutrient_input_verification.json) and the
[coverage summary](analysis/nature/NUTRIENT_INPUT_COVERAGE.md). The earlier
[handover verification](analysis/nature/handover_verification.json) records the
original packaging milestone.
The later experiment reads that base without changing it. Its 2025 artifact
contains 60,879 candidate inputs and copies raw evidence into a new local run.
See [policy sensitivity](analysis/nature/INPUT_POLICY_SENSITIVITY.md) and
[experiment validation](analysis/nature/nutrient_policy_validation.json).
The separate P2 run preserves that input artifact and base. See the
[CA01 pilot](analysis/nature/NUTRIENT_LOSS_PILOT.md) and
[pilot validation](analysis/nature/nutrient_loss_pilot_validation.json).
This includes nine focused tests for transport, retention once, unknown totals,
derived-input donor stress, read-only artifacts and monitoring isolation.
An earlier compressed-distribution experiment passed five targeted tests and a
full restore check. Distribution has since reverted to building locally from
source; the optional export/restore utility remains tested but its outputs are ignored.

## Explicitly unfinished

- [ ] Automatic preservation/migration of reviews, correction proposals and saved runs across rebuilds.
- [ ] A reviewed policy for missing or questionable nutrient inputs.
- [ ] Calibrated input uncertainty, missingness-bias assessment, validation of
  SE proxy applicability and SE N interpretation. Provisional alternatives exist.
- [ ] Scientifically justified/calibrated field P/N loss and delivery coefficients;
  the implemented screening pilot uses assumed modifiers and reference scales.
- [ ] Calibration, independent evaluation and uncertainty reporting for nutrient loads.
- [ ] Pressure × state priority scores/ranks from modeled delivered loads.
- [ ] Quantified local action efficacy/costs, overlap handling and an expert action-approval workflow.
- [ ] A decision-oriented hackathon demo and one-page method note for those new results.
- [ ] Optional MCP server and deployment. An HTTP API and UI now exist in TraceFlow
  (`../server/services/nature.ts`, Nature page); they read this database and do not record reviews.

Nothing in this handover starts those scientific or service tasks automatically.

## Known limits to preserve in future work

1. Source data is synthetic. Absolute results are not Apetit's actual impacts.
2. Static ownership, soil tests, contract-crop lists and ecological context are
   applied across years; effective-dated histories are not available.
3. Twenty-three farms have blank contract lists. Provisional selection is not
   confirmed annual delivery or proof of no sourcing when a field is excluded.
4. Missing values remain unknown. A reported zero is distinct from absence.
5. Farm/crop reports attach to several fields; shared reports are not independent samples.
6. Soil-map uncertainty and reported-soil differences are not resolved automatically.
7. Climate mapping is an assumed nearest centre; daily weather is not imported.
8. Weather grid/scenario findings are not fully propagated into field-scope quality counts.
9. Reference FX is fixed teaching context, not transaction-date market FX.
10. Programme action costs are not per-field/catchment costs. Screening area is not nutrient reduction.
11. Framework URLs and package claims are not independently verified. Method context is not certification.
12. Geometry is synthetic, linked by supplied IDs and not fully topology-validated; no spatial extension is installed.
13. Raw source versions survive rebuilds; analytical review/proposal/query state does not migrate automatically.
14. Source/result hashes provide integrity/reproducibility evidence, not tamper-proof audit controls.
15. Nutrient pressure and ecological context do not directly measure biodiversity outcomes.
16. Pilot load outputs are uncalibrated. Annual rainfall is not runoff; delivery,
    crop/soil modifiers and stress ranges are assumed, N intensity is not surplus,
    and no numeric buffer/catch-crop/drainage effect is claimed. Numerical
    reconciliation is not scientific validation.

## Intentionally outside current imports

Daily weather Parquet; corporate energy/fuel/refrigerant/GoO/transport/waste/travel
feeds and supplier PCF JSONs; original workbook as modeled truth; development
answer keys as training features. Do not add these without a decision-relevant
use case and documented provenance/units. Six Track D development catchments remain
separate for later explicit calibration/evaluation.
