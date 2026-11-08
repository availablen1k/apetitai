# Provisional model-input policy 0.2.0

This is an executable **provisional experiment**, not a scientific approval.
It resolves operational choices so their consequences can be compared before
choosing inputs for P/N loss modelling. Coverage classification remains at
[0.1.0](NUTRIENT_INPUT_POLICY.md); it still describes original data unchanged.
The new executable configuration is `nutrient_input_policy.json` and the method
is `leave_farm_out_peer_median_v1`. No person is recorded as having approved it.

## Scope decision

The primary analysis uses declared crops in the requested year, provisionally
selected by static registry crop membership. Default year 2025 follows the local
challenge's `NATURE_SBTN.md`, section “D1 priority formula”. Do not require an ERP
purchase: purchase absence and signed returns cannot establish annual contracts.
The sensitivity population additionally includes `unknown_contract_list` fields,
kept separately labelled. Fields explicitly unselected by the registry remain
outside both populations; neither population claims to be confirmed annual scope.
No future-plan field is used as an observed historical input. All source years
remain in the base model; run a separate experiment for another declared year.

## Missingness decision and comparison variants

| Variant | Operational treatment |
|---|---|
| `reported_only` | Preserve observed values, leave gaps unavailable; report the missing-area denominator rather than silently selecting complete cases |
| `country_peers` | Additionally fill compatible gaps with a median of at least eight distinct source reports in the same country/crop/year, excluding all reports from the target farm |
| `se_pea_proxy` | Same as country peers, plus a separately flagged FI pea proxy for missing SE pea P application and harvested yield; no proxy for SE manure/mineral N |

All reported zeros remain observed, including zero manure or Swedish N. Negative
rates/tests and nonpositive harvested yields remain in `original_value` and
`value`, but get `blocked_invalid`; no peer value replaces them. Positive
peer/temporal outliers remain observed and remain eligible donors with explicit
quality context. No automatic outlier deletion, area correction, delivered-tonne
yield conversion, zero filling or correction application occurs.

Management peer pools use **one record per farm/crop/year**, not one row per
field. Every target excludes its own farm. Only requested-year donors are used,
so later reports cannot leak into earlier years. No other-crop fallback is used.
Donors come from all captured reports in the declared year, including farms with
unknown registry lists; they are evidence for a crop rate, not additions to
the primary population. Negative rates/nonpositive yields are not donors.

Soil P uses at least eight known parcel tests from the same country, catchment
and mapped soil class, excluding every parcel on the target farm. These are
distinct tests, **not independent farms**, and are not area weighted. The latest
test has no date: observed and estimated soil P are static proxies, not annual
observations. No cross-catchment/class/country fallback occurs. Unknown donor
applicability leaves the input unavailable.

The minimum of eight and the grouping choices are prototype assumptions, not
validated agronomic thresholds. Eight donors can still give a poor estimate.

## Nitrogen interpretation decision

Keep mineral N, manure N and reported N application as separate original inputs.
An additional `n_total_candidate_kg_ha` sums FI mineral/manure components **only
when both are present and nonnegative**, following the local data dictionary's
component definitions. This is a derived applied-N candidate, not available N,
crop uptake, N surplus or N loss. Components retain their own input/evidence links.
For Sweden, the candidate aliases the supplied “N applied” rate, with
`se_rate_total_interpretation_unverified`; equivalence to the Finnish component
sum still requires review. Never add proxy manure to the Swedish rate. A derived
candidate can depend on estimated components; inspect `input_dependency`.

## Quality, uncertainty and evidence decisions

Use mapped parcel hectares as the coverage denominator. Preserve the >5% area
discrepancy flag and all non-dismissed field-scoped quality findings. A flagged
report is not automatically bad: sensitivity tables expose the affected available
hectares. Soil-map/report disagreement remains unresolved; no corrected soil
class is chosen. Current peer groups do not resolve that disagreement.

For estimated values, record the unweighted donor median and donor 10th/90th
percentiles, using linear interpolation at index `(n-1)*q`. These bounds describe
**donor spread**, not calibrated prediction or confidence intervals. They omit
measurement error, nonresponse bias, correlated reports and cross-country/temporal
applicability uncertainty. Observed values and derived N have NULL numerical
bounds because that uncertainty has not been quantified. Zero interval width
does not prove certainty. FI donor spread cannot validate transfer to Sweden.

The artifact stores each field/input/variant, original and candidate values,
unit, availability, kind (observed/estimated/derived/unavailable), blocking reason,
method/policy version, review state, uncertainty kind, donor count and donor quality
count and `depends_on_estimate` flag (including derived components). Estimates
link to each donor entity; derived N links to component inputs.
`input_evidence` plus recursive `evidence_dependency` leads to copied raw source
records with locators and file-version hashes. It preserves target and donor
evidence after a base rebuild. Column rules, transformations and the three local
method documents are copied too. These documents describe package context;
they do not independently validate agronomic estimates.

Correction proposals and quality reviews are snapshotted as context, not applied
as corrected measurements. The experiment has no approval-writing interface.
Implement ROADMAP P0 before collecting real reviews; immutable experiment copies
are not a replacement for state migration.

## Evaluation and sensitivity decisions

`peer_evaluation.csv` reports leave-farm-out absolute/signed errors and donor-spread
coverage against available same-country management self-reports. Targets are
distinct reports, never replicated field labels. Each target farm is excluded
from its donor pool; there is no fitted hyperparameter tuning. This checks
self-report consistency only, not ground truth, missing-case accuracy, cross-country
transfer or physical nutrient loads. Static soil tests have no independent annual
validation target, and the SE P/yield proxy has no Swedish reported target.

`sensitivity.csv` compares both scope populations and all three missingness
variants for each input. It preserves total, available, blocked, estimated and
quality/area-flagged hectares plus the area-weighted available value. The latter
is conditional on availability, **not a whole-population estimate or nutrient
load**. Do not compare means without the changed coverage denominator. For derived
N, estimated dependencies remain in component records rather than being counted
as directly estimated hectares; `depends_on_estimate_area_ha` exposes their area.
No effect on final ranking is claimed yet.

## Run and inspect

```bash
python3 tools/build_nutrient_inputs.py --year 2025
# For a named run, choose a new directory; existing paths are refused:
python3 tools/build_nutrient_inputs.py --year 2025 --output /tmp/apetit-input-experiment
```

The tool verifies the existing base, opens it read-only in a consistent read
transaction and creates a new `inputs.sqlite`, `sensitivity.csv`,
`peer_evaluation.csv` and `validation.json`. It does not rebuild the base or
replace earlier runs. Default run folders are ignored under
`analysis/nature/input_runs/`. Partial failed runs may remain for inspection;
only a run with passing `validation.json` is complete. Use an SQLite client to
inspect `field_scope`, `input_value`, `input_dependency` and `input_evidence`.
The SQLite artifact contains policy/config and code hashes, source-build/file
versions and review/proposal snapshots. Field/year/input/variant is unique.

Remaining scientific decisions: confirm annual scope, validate SE N interpretation,
validate or replace SE proxy assumptions, quantify missingness/applicability
uncertainty, assess soil alternatives and approve inputs before decision use.
No experiment is an approved nutrient-loss input dataset.
