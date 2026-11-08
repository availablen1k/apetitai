# Remaining work — ordered TODOs

The goal is defensible farming-area decisions for water and biodiversity. The
relational foundation is complete for now. This document records future work;
it is **not an instruction to begin it as part of packaging**.

## P0: Preserve human state before real review work

**Why:** rebuilding currently replaces review/proposal/saved-query state in the
analytical database. Manual snapshots mitigate loss but do not solve migration.

- [ ] Design a persistent state store or explicit migration/versioning process.
- [ ] Define how findings are matched when source file hashes, records or rule versions change.
- [ ] Preserve old decisions with their original evidence; do not silently approve changed data.
- [ ] Preserve correction proposals, reviewer/time/note, saved runs/results and execution review snapshots.
- [ ] Provide tested backup/restore and migration instructions.

**Acceptance:** create a review, proposal and saved execution, change source/rule
version, rebuild, and demonstrate that original audit state remains recoverable
and changed evidence is marked for reconsideration. No natural-key or hash match
should silently turn an old approval into a new one.

Current mitigation: `python3 tools/create_snapshot.py` before a rebuild. Copies
live only in ignored `backups/` unless deliberately preserved/shared elsewhere.

## P1: Define a reviewed nutrient-input policy

**Started:** query `22_nutrient_input_readiness` reports field/report counts and
mapped hectares by input/availability, year, catchment, country, crop and registry
selection. The versioned [draft policy](model/nature/NUTRIENT_INPUT_POLICY.md)
documents schema omissions, zeros, missing reports/values, plans and proposed
treatments. Provisional model-input records and missingness/scope comparisons
now exist under [policy 0.2.0](model/nature/NUTRIENT_MODEL_INPUT_POLICY.md), with
donor evidence, derived-N dependencies and leave-farm-out consistency checks.
Scientific approval, calibrated uncertainty and validation of proxy applicability
remain unfinished. The [comparison](analysis/nature/INPUT_POLICY_SENSITIVITY.md)
quantifies how the assumptions change coverage and conditional input means.

- [x] Implement input coverage/missingness classification with source lineage and quality context.
- [x] Record a versioned draft policy without silently approving assumptions.
- [x] Implement explicit provisional scope/missingness variants and immutable input artifacts.
- [x] Retain observed/estimated/derived/unavailable distinctions, units, reasons, donor spread and evidence.
- [x] Compare reported-only, country-peer and SE-proxy assumptions under selected/unknown-registry scopes.
- [x] Prevent same-farm and later-year donor leakage; evaluate against distinct held-out reports.

- [ ] Confirm annual scope beyond the provisional static registry selection.
- [ ] Scientifically review/approve the implemented missing-input alternatives and SE N interpretation.
- [ ] Decide handling of area discrepancies, uncertain soil classification, outliers and signed/raw sourcing anomalies.
- [ ] Keep observed, corrected and estimated values distinct, with units and uncertainty.
- [ ] Record approved corrections separately; do not edit original CSVs or relabel unknowns as zero.

The remaining review items require scientific decisions beyond the operational
experiment. No approved corrections are applied; calibrated prediction intervals,
missingness-bias treatment and SE proxy validation are not supplied by the donor
spread or self-report evaluation. P0 still precedes collecting real reviews.

**Acceptance:** every input used by a nutrient model identifies its source or
estimation policy, method version, reason, uncertainty and review state. Report
coverage and sensitivity to alternative treatments. A high outlier score is not
automatic evidence to discard a bad harvest.

## P2: Estimate field losses and delivered nutrient loads

**Pilot implemented:** [screening export-coefficient 0.1.0](model/nature/NUTRIENT_LOSS_METHOD.md)
uses assumed modifiers and package reference scales. The CA01 2025 experiment
has field contributions, copied evidence, independent P/N coverage, donor/method
stress cases, an area-only reference and separate whole-catchment monitor context.
It is explicitly uncalibrated; see [pilot report](analysis/nature/NUTRIENT_LOSS_PILOT.md).

- [x] Document a provisional P/N model contract, units, source roles and assumed coefficients.
- [x] Implement field loss → distance delivery → retention once, with contributor evidence.
- [x] Preserve missing field results and unknown scope totals; reconcile available mass.
- [x] Keep year/scenario/model/input-policy versions and declared-only historical weather.
- [x] Compare input variants, donor endpoints and explicit method stress assumptions.
- [ ] Select/justify or calibrate scientifically defensible coefficient values and applicability.
- [ ] Connect crop, management, soil, slope, buffers, catch crops and rainfall as justified by that model.
- [ ] Replace N application-intensity proxy with a justified supply/removal/surplus treatment if required by the chosen model.
- [ ] Quantify uncertainty beyond the uncalibrated stress cases and donor spread.

Buffers, catch crops and drainage have no quantified effect in this version;
P application and yield remain unused. Non-contract/background boundaries are
explicit, with unknown loads. Pilot runs accept 2021–2026; earlier-year normal
policies and future scenario modelling remain separate extensions.

**Acceptance:** outputs in kg P/year and kg N/year reconcile from fields to
catchments, retain uncertainty and can be reproduced from input records/assumptions.
Use historical weather for historical assessment. Future crop plans are not actuals;
weather beyond 2031 does not imply crop assignments are known beyond 2031.

## P3: Calibrate and evaluate before ranking

- [ ] Use monitoring with an explicit treatment of non-contract farming and background.
- [ ] Load six public development catchments into a separately labelled evaluation/calibration layer.
- [ ] Record which data influenced calibration versus evaluation; do not leak answer keys into generic features.
- [ ] Test robustness to missing inputs, soil-map uncertainty and plausible data corrections.
- [ ] Compare with the supplied area-only baseline and report limitations honestly.

**Acceptance:** documented validation results, uncertainty and reproducibility;
contract-only loads are not forced to equal whole-catchment monitored loads.

## P4: Produce defensible catchment priorities

- [ ] Implement the package's pressure × state formula using **delivered** P/N.
- [ ] Explicitly define eligible catchments, median population, zero-load behaviour and tie-breaking.
- [ ] Use the package's ecological-state weights and P sensitivity with source/version evidence.
- [ ] Trace every aggregate/rank to field estimates, factors and assumptions.
- [ ] Add a parameterized query and explain how ranking changes under uncertain inputs/scenarios.

**Acceptance:** ranks reproduce from validated loads and documented rules. Current
mapped area, ecological ordering or action-screening counts are not presented as
that final ranking. Freshwater pressure remains distinct from measured biodiversity.

## P5: Quantify and review actions

- [ ] Replace broad screening leads with site/grower feasibility assessment.
- [ ] Verify soil and land-retirement prerequisites, water context and other action conditions.
- [ ] Estimate action-specific P/N effects and uncertainty from defensible evidence.
- [ ] Estimate local costs, timing and ownership; catalogue programme costs cannot be multiplied by candidate fields.
- [ ] Handle overlapping actions, trade-offs, budgets and counterfactuals.
- [ ] Add explicit expert action review/approval and monitoring of outcomes.

**Acceptance:** an expert can inspect an action, location, effect/cost range,
prerequisites and evidence. Measurement improvements are not counted as physical
reductions; CO2e benefits are not converted to nutrient/biodiversity benefits by assumption.

## P6: Deliver one end-to-end hackathon decision

- [ ] Select a catchment and show pressure, contributing fields, uncertainties and quality concerns.
- [ ] Explain feasible actions, evidence, indicative economics and expert review.
- [ ] Prepare a runnable demo and one-page method note.
- [ ] Export the chosen Track D submission CSV only once calculations are validated.

**Acceptance:** problem → evidence → estimated impact → proposed action → human
review, with clear separation of actual data, synthetic assumptions and estimates.

## Optional after a concrete use case exists

- [x] Thin API around the existing validated query catalogue: TraceFlow's `/api/nature/*`
  (read-only queries, lineage, saved runs and nutrient runs as Python jobs). No MCP server.
- [ ] UI for browsing findings, lineage and expert decisions. Browsing queries, lineage, maps
  and nutrient runs is in TraceFlow's Nature page; expert review decisions are not (P0 first).
- [ ] Daily weather if the chosen model needs event timing/intensity.
- [ ] More raw feeds if the team deliberately expands to corporate inventory quality.
- [ ] Broader nature screening using explicit commodity/origin mappings and verified external evidence.
- [ ] Production access controls, append-only audit/state retention, deployment and performance work.

Do not let these optional items delay a validated Track D decision.
