# CA01 2025 nutrient-loss pilot — uncalibrated

**Inspect the implementation, not a final environmental conclusion.** Model
0.1.0 uses package reference loss scales and explicitly assumed modifiers.
Its numerical checks pass; scientific calibration and independent evaluation
have not been performed. Synthetic data and provisional contract scope limit
interpretation. No catchment ranking or action recommendation is produced.

Primary population: **107 registry-selected declared fields / 581.01 ha**.
Historical annual rain is compared with complete 1991–2020 grid normals.
Input policy 0.2.0 retains observed and estimated inputs separately. The primary
comparison uses `country_peers`, central donor inputs and the central method case.

| Nutrient | Field loss (kg/year) | After distance delivery, before retention | After retention |
|---|---:|---:|---:|
| P | 671.22 | 475.61 | **305.34** |
| N | 7,599.77 | 5,481.46 | **3,519.09** |

All values above are unvalidated model outputs. Retention of 0.358 is applied
once, after distance delivery. Unrounded field mass reconciles with the scope
totals. The area-only package reference gives **410.31 kg P/year / 5,595.13 kg
N/year** under its coarser boundary; differences do not establish improvement.

With reported inputs only, P coverage is **89.57%** of mapped hectares and N
coverage **74.66%**. Available-field subtotals are 277.77 kg P/year and 2,691.47 kg
N/year, but both full scope totals remain **unknown**. No missing field is zeroed
or extrapolated to the full scope.

Including unknown registry lists adds **72 fields / 363.65 ha**. Under country
peers, P becomes 459.49 kg/year over that wider population; N remains unknown
because the added fields lack compatible N inputs. This is scope sensitivity,
not confirmation that those fields belong in annual contract farming.

Across all donor endpoints and assumed method stress cases, the selected-scope
country-peer outputs span **70.78–687.84 kg P/year** and **837.52–7,725.32 kg
N/year**. These are deterministic perturbations, not calibrated uncertainty or
confidence intervals. The wide spread demonstrates why coefficients and delivery
assumptions need review. The SE P/yield proxy has no effect in this model: it
uses soil P and an applied-N candidate, without crop-removal/fixation equations.
Buffers, catch crops and drainage have no quantified benefit assigned.

The 2025 monitored loads, **5,128 kg P / 117,975 kg N**, cover the whole catchment,
including non-contract farmland/background. They are context only: they do not
set coefficients, and their difference from contract-field outputs is not a
validation error. Other-farmland and natural-background estimates remain unknown.

Reproduce from the model folder:

```bash
python3 tools/build_nutrient_inputs.py --year 2025
python3 tools/build_nutrient_losses.py --inputs /path/printed/by/input_run/inputs.sqlite --catchment-id CA01
```

The immutable local pilot contains 179 fields across both scope groups,
9,666 field/nutrient/input-policy/donor-point/method-case records and 108 grouped
summaries. Each estimate retains formula factors, used inputs and copied raw
climate/parcel/donor ancestry. [The method](../../model/nature/NUTRIENT_LOSS_METHOD.md)
documents the equations, assumptions, source roles and missingness contract.
The [214-row field snapshot](nutrient_loss_pilot_fields.csv) contains only the
selected central country-peer case; [grouped sensitivity](nutrient_loss_pilot_summary.csv)
contains both scopes and all variants. [Verification](nutrient_loss_pilot_validation.json)
records 80 passing tests, final focused checks, mass reconciliation and verified
model/config/input/document hashes. Base and input databases were read-only.

Next: justify or calibrate the loss/delivery coefficients, define non-contract
and background treatment, and design separated calibration/evaluation before
ranking. Complete P0 before collecting real expert approvals.
