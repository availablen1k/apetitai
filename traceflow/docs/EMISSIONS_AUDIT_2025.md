# Why the 2025 inventory shows 18.36 million tCO₂e

Read-only investigation, 8 November 2026. No corrections approved, source records changed, saved
calculations created, or audit events written.

## Finding

The displayed total is reproducible from imported activity records, imported supplier factors and
the existing approved correction overlays. It is **not a reliable statement of actual emissions**.
Several unresolved source errors inflate it. The large difference is not a chart scaling problem
or an across-the-board kg-to-tonnes display conversion error.

The source package describes itself as a synthetic twin, with deliberately erroneous raw feeds.
Its methodology explicitly says that raw input passes data-quality problems through the calculation.
The supplier declarations below also identify themselves as synthetic hackathon documents, not real
supplier declarations.

## Saved calculations checked

| Year | Saved run | Market-based total | Open incidents affecting the saved calculation |
|---|---|---:|---:|
| 2024 | `run_6a3aa3191fd641c8b09d` | 712,850.368738 tCO₂e | 109 |
| 2025 | `run_653d9186f8c04939bd68` | 18,360,870.370455 tCO₂e | 119 |

Independent in-memory recomputation reproduced both totals exactly. Both saved runs are
`complete_with_gaps`; passing arithmetic checks does not establish that their inputs are correct.
Scope 2 uses one basis in the total, biogenic memo emissions are excluded, and the saved sum equals
the included contributions.

## Largest 2025 drivers

All PCF factors in this table are kgCO₂e per kg product. Proposed values are existing **unapproved**
incident candidates, not verified replacements.

| Source | Imported factor | Existing candidate | Emissions currently attributed to affected purchases | Incident |
|---|---:|---:|---:|---|
| Rapeseed imported from Lithuania, SUP011 / M104 | 1,409.1 | 1.4091 | 13,411,836.345600 tCO₂e across 3 purchase lines | `dq_39c46dee35656820` |
| Corrugated board / cartons, SUP072 / M153 | 847.6 | 0.8476 | 3,796,854.374560 tCO₂e across 12 purchase lines | `dq_e8828bba894a568b` |
| Frozen chickpea, SUP027 / M121 | 1,431.4 | 1.4314 | 90,247.531147 tCO₂e across 12 purchase lines | `dq_ca38523ef117755e` |

These are the values in the original JSON documents, not values introduced by the frontend or
import conversion. All three original declarations use `declaredUnit: kilogram` and
`unitaryProductAmount: 1`. The existing rules flag likely ×1,000 scaling errors. Correcting only
these three candidates would remove approximately **94.1% of the displayed 2025 total**.

Example of the exact calculation for the largest line:

`4,907.186 tonnes × 1,000 kg/tonne × 1,409.1 kgCO₂e/kg ÷ 1,000 kgCO₂e/tonne = 6,914,715.7926 tCO₂e`.

The purchase quantity is converted from tonnes to kilograms correctly. The suspect supplier
factor then multiplies the legitimate purchase quantity by a value around one thousand times
the proposed factor.

Further major open concerns:

- **Säkylä electricity, June 2025:** `energy_meter_readings.csv`, row 76, records
  **1,708,632 MWh**. Existing incident `dq_4c6a2ec149167e29` proposes **1,708.632 MWh**
  for a likely kWh/MWh error. The affected site's current market-based electricity contribution
  is **693,010.887408 tCO₂e**; the input also affects upstream electricity emissions in Scope 3.
- **Pudasjärvi refrigerant event RS00080:** `refrigerant_service_log.csv`, row 81, records
  **85,150 kg** of R449A. Existing incident `dq_09e6b82d31abe0b5` proposes **85.15 kg**
  for a likely grams/kg error. This event currently contributes **128,065.6 tCO₂e**.
- Duplicate-posting and other concerns remain open. The original purchase file and imported
  2025 purchase rows both contain 1,509 records; a second wholesale import of 2025 purchases is
  not the explanation for the enormous total. Intentional duplicate business entries inside
  the supplied raw file still require review.

## Isolated what-if calculation

The following scenarios were calculated in memory with the production database opened read-only,
using the existing deterministic engine and cloned overlays. Scenarios are **cumulative**.
They do not constitute approval, a final inventory, or physical carbon savings.

| Hypothetical scenario | 2025 total, tCO₂e |
|---|---:|
| Current saved inventory | 18,360,870.370455 |
| Apply rapeseed PCF candidate only | 4,962,445.861201 |
| Also apply cardboard PCF candidate | 1,169,388.341016 |
| Also apply chickpea PCF candidate | 1,079,231.057399 |
| Also apply Säkylä electricity candidate | 367,444.012943 |
| Also apply refrigerant candidate | **239,506.478543** |

The last scenario has Scope 1 **4,225.878936**, Scope 2 market **60.900000**, and Scope 3
**235,219.699607 tCO₂e**. This is an indicative sensitivity result, **not a verified 2025 total**.
Other source concerns, estimates, coverage, methodology and boundaries remain to be reviewed.

## Why 2024 is not a clean comparison

2024 also contains unresolved errors. Pudasjärvi electricity includes readings of **182,699 MWh**
and **693,108.523 MWh**, generating a **355,431.019160 tCO₂e** site contribution. Refrigerant
event RS00064 records **27,750 kg** of R404A and generates **131,202 tCO₂e**; its existing
candidate is **27.75 kg**. Therefore the lower 2024 number should not be treated as a validated
baseline or used to infer genuine operational emissions growth.

The imported public canonical 2024 benchmark totals **197,025.18 tCO₂e** on the market basis.
It is a reference for the challenge methodology, not a replacement for the saved raw-data run.
Published Apetit history uses a different basis/boundary and must not be substituted either.

## Human review and next steps

1. Inspect the original supplier declarations and meter/service evidence for the five priority
   incidents above. The existing proposals are strong leads, not automatic authority to change data.
2. Record explicit named decisions in Validation, including confirmed values and supporting evidence.
3. Recalculate a new immutable inventory; retain the earlier run and show the resulting change as
   an **inventory correction**, not an operational emissions reduction.
4. Review the 2024 incidents and compare both years only after checking accounting boundaries,
   coverage and the same Scope 2 basis.

Underlying evidence: `APETIT_CLIMATE_NATURE_NAVIGATOR_2026/START_HERE.md`,
`docs/METHODOLOGY.md`, original PCFs `SUP011_M104_2025.json`, `SUP072_M153_2025.json` and
`SUP027_M121_2025.json`; imported source rows; saved contributions and incident records.
Source, correction, calculation and audit counts were unchanged throughout the read-only check.
