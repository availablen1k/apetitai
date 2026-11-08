# Provisional field-loss pilot — screening export coefficient 0.1.0

Scientific status: **uncalibrated, unreviewed, synthetic-data experiment**.
This pilot makes units, missingness, delivery, retention and input-policy
sensitivity inspectable before calibration. Its numbers are not validated loads,
action benefits, final catchment priorities or measured biodiversity outcomes.

## Evidence and assumptions

The supplied `SIMULATION_DESIGN.md` lists reference field losses of approximately
1.1 kg P/ha/year and 15 kg N/ha/year. Its Nature section describes soil, weather,
crop and management dependencies, distance delivery and catchment retention.
It does **not** publish calibrated equations. `ASSUMPTIONS_AND_LIMITATIONS.md`
describes its hidden generator as an export-coefficient model, not VEMALA.

[Luke](https://projects.luke.fi/ruokafakta/en/field-crops/nitrogen-and-phosphorus-balance/)
distinguishes nutrient balances from loading to water.
[SYKE](https://www.vesi.fi/en/water-topics/can-water-pollution-from-farming-be-reduced/)
describes weather, bare soil and erosion processes. Neither validates this pilot's equations or
numerical modifiers. `NUTRIENT_LOSS_EVIDENCE.json` records the limited role of
each source; short original summaries are preserved with the artifact.

All modifiers, normalisation values, delivery lengths and stress ranges in
`nutrient_loss_model.json` are **explicit prototype assumptions**, not empirical
estimates, literature coefficients or calibrated uncertainty. The reference
rates themselves are package statements, not independently checked calibration.

## Boundary and input contract

Default pilot: catchment CA01, declared year 2025, historical weather. CA01 is a
monitored example, selected by ID, not by goodness of fit or resulting load.
Both registry-selected and registry-plus-unknown scopes are reported. Outside
scope: other farmland, natural background and all other source sectors.

The input artifact must have the same year, source build, file versions and
review/proposal snapshots as the base. The base is verified and read-only.
Future plans/scenarios cannot be passed as historical actuals. Each output keeps
field, year, weather scenario, model version, policy variant and input point.
The pilot accepts 2021–2026 so the 1991–2020 reference period does not include
years after the target year. Earlier farming history remains in the base model;
using it in this loss experiment needs an explicitly revised normal-period policy.

P requires the candidate `p_test_mgl_latest` (mg/L). N requires
`n_total_candidate_kg_ha` (kg N/ha), traversing its component inputs for donor
stress points. Original, estimated and derived input values retain their existing
distinctions and evidence. SE N interpretation remains explicitly provisional.
Static soil P, map class and parcel attributes have no effective-dated history.

P application and yield are intentionally not applied: the pilot has no validated
fertiliser-P release, crop nutrient-removal or fixation coefficients. N application
is only a supply-intensity proxy, **not N surplus or a loss quantity**. Buffers,
catch crops and drainage are retained in the drivers but receive no invented
quantified benefits. Adding their effects requires evidence and a new model.

## Executed equations

For field area `A` (ha), distance `d` (m), mapped slope/clay percentages `s,c`,
soil P `S` (mg/L), applied-N candidate `T` (kg N/ha):

```text
W = annual historical precipitation / mean 1991–2020 annual precipitation
source(x,reference) = clamp(0.5 + 0.5*x/reference, 0.5, 2.0)
terrain = (1 + 0.03*s + 0.003*c) / (1 + 0.03*2 + 0.003*30)
crop_P = 1.2 for carrot/potato, otherwise 1.0 for supplied crops

P_field_rate = 1.1 * W * source(S,15) * terrain * crop_P * field_loss_scale
N_field_rate = 15  * W * source(T,100) * organic_factor * field_loss_scale
# organic_factor applies only to mapped organic soil; otherwise 1.0

field_loss_kg = field_rate_kg_ha_year * A
delivery_fraction = exp(-d / delivery_length_m)
pre_retention_kg = field_loss_kg * delivery_fraction
R = clamp(supplied_catchment_retention + retention_delta, 0, 1)
delivered_kg = pre_retention_kg * (1 - R)
```

The field reference rates describe mixed existing management; no second generic
management discount is applied. Annual rain is a crude transport proxy, not
runoff; snowmelt, storm timing, PET and irrigation are omitted. The same distance
curve for surface and subsurface pathways is a major unvalidated simplification.
Retention is applied **exactly once**, after field-to-water delivery. A zero
fertiliser rate does not force zero N loss because soil/residue supply is not zero.
Rates are nutrient mass, not CO2e, application totals or monitored concentrations.

Unknown/invalid needed inputs, weather, normal completeness, spatial drivers or
retention make that nutrient's field result unavailable. The other nutrient is
evaluated independently. Dry-year zero rain can produce zero loss; missing rain
cannot. All 30 normal years must be complete; a partial normal is not accepted.
Unsupported crop/soil categories are unavailable, without an inferred default.

## Sensitivity contract

Each of three input policies is crossed with three donor points and three method
stress cases. At donor-lower/upper points, an estimated input uses its stored
10th/90th donor percentile; observed values stay fixed. Derived N is recalculated
from stressed components rather than treating its NULL interval as certainty.
These are deterministic input perturbations, not draws from a joint distribution.

| Method case | Field rate scale | Delivery length | Retention change | Organic N factor |
|---|---:|---:|---:|---:|
| low | 0.5 | 300 m | +0.10 | 1.0 |
| central | 1.0 | 1,000 m | 0 | 1.5 |
| high | 1.5 | 3,000 m | −0.10 | 2.0 |

These broad stress choices are not plausible-range claims or confidence bounds.
They do not exhaust measurement error, nonresponse, soil-map error, hydrology or
model-structure uncertainty. P/harvested-yield proxy values are unused, so the
SE-proxy input variant cannot change this model relative to country peers.

## Aggregation, baseline and monitoring

Every grouped subtotal sums unrounded field mass for the same nutrient, policy,
donor point and method case. `available_fields_delivered_kg` is the subtotal over
known fields. `scope_delivered_kg` is NULL unless **all scope fields** have valid
results. Coverage area and unavailable-field counts always accompany subtotals;
no zero filling or rescaling of missing fields occurs. Do not sum across variants.

`area_only_reference_kg` reproduces the package's simple area × reference-rate ×
`(1 - supplied_retention)` benchmark over the full selected scope, without the
pilot's delivery/weather modifiers. It is a different, coarse model boundary,
not an observation or independently validated prediction.

Whole-catchment monitoring is separate context. Contract-field predictions are
not forced to match it; no fit error is claimed while other farmland/background
remain unestimated. A missing monitoring row stays NULL. No public development
answers, hidden truth or monitor values influence parameters or field estimates.
This milestone has **no scientific validation**; numerical reconciliation only
checks implementation. Calibration and independent evaluation remain P3.

## Reproduce and explain a field

```bash
# First produce an input experiment, then use the path it prints:
python3 tools/build_nutrient_inputs.py --year 2025
python3 tools/build_nutrient_losses.py --inputs /path/to/input_run/inputs.sqlite --catchment-id CA01
```

The new run contains a self-contained `pilot.sqlite`, field contributions CSV,
catchment summary CSV and passing `validation.json`. Existing run directories
are refused. The input artifact is copied with SQLite backup; input/donor/raw
evidence remains available after source rebuilds. Extra climate, mapping,
catchment and monitoring ancestry is copied from the matching base. Driver
snapshots, formula factors, used input IDs, config, evidence notes and code/input
hashes make each estimate inspectable. Large local artifacts stay ignored under
`analysis/nature/loss_runs/`; small pilot CSV/report snapshots can be tracked.

Within `pilot.sqlite`, start with `field_loss.loss_id`, inspect `factors_json`,
join `loss_input` → `input_value`, and follow `input_dependency`/`input_evidence`.
`loss_driver_evidence` links weather/normal/mapping/parcel/catchment context to
copied `evidence_entity`, `evidence_dependency`, `evidence_link` and raw
`evidence_record`. `loss_driver.drivers_json` keeps exact numerical driver values.
