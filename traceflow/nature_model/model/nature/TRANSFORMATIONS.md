# Transformations and assumptions

The executable implementation is [build_nature_model.py](../../tools/build_nature_model.py)
and the existing [farming builder](../../tools/build_farming_2025.py).
`transformation` stores the base rule groups below and the quality/climate/ERP
rules documented in [DATA_QUALITY.md](DATA_QUALITY.md) and
[CLIMATE_AND_SOURCING.md](CLIMATE_AND_SOURCING.md). `column_lineage` records a
source expression and rule for **every column of every physical domain table**.
The SQL view and query output expressions are retained as executable SQL.

Master completion, local-document segmentation, curated evidence, scenario imports
and action screening are documented in [DECISION_CONTEXT.md](DECISION_CONTEXT.md).
Their definitions are in `decision_context.sql`, `knowledge_map.json` and
`action_screening_rules.json`, all hashed with the build. No nutrient-load or
action-efficacy estimates are added.

| Rule | Inputs | Output and operation |
|---|---|---|
| `copy_typed` | Same-name fields in master and nature CSVs | Select documented columns, empty string → SQL NULL; numbers → INTEGER/REAL; True/False → 1/0. No factor or unit changes. |
| `normalize_observation` | All supplied Finnish survey and Swedish grower records | Reuse the existing farming normaliser; map Swedish labels, decimal commas, ja/nej and headers; source-specific missing fields → NULL. |
| `field_join` | All crop-history/plan years, field/farm masters and matching report | Exact field ID lookup; ownership check; exact farm/crop/year report lookup; provisional contract flag and same-year area-discrepancy diagnostic. |
| `geometry_link` | GeoJSON features and declared CRS | Retain geometry as JSON; match feature property ID to master ID; preserve CRS84. No spatial reassignment. |

## Observation mappings

Finnish identifiers: `observation_id = fi:<survey_id>`. Same-name management fields
are copied; `area_ha` becomes `reported_area_ha`. No total N value is manufactured
from components, and no delivery tonnage is present in this source.

Swedish identifiers: `observation_id = se:<odlar_id>:pea:<skördeår>`.

| Source column | Model column | Operation |
|---|---|---|
| `odlar_id` | `farm_id` | Copy ID |
| `skördeår` | `year` | Integer |
| `gröda` | `crop` | Only `Ärt (frysärt)` accepted → `pea` |
| `areal_ha` | `reported_area_ha` | Decimal comma → point |
| `levererad_mängd_ton` | `delivered_t` | Decimal comma → point, tonnes |
| `kvävegiva_kg_ha` | `n_applied_kg_ha` | Reported N, no mineral/manure split inferred |
| `diesel_l_ha` | `diesel_l_ha` | Numeric |
| `bevattnad` | `irrigated` | ja/nej → 1/0 |

Other management fields are NULL for Swedish reports. `source_kind` is generated
as `fi_survey` or `se_grower_report`. Crop/year source columns and generated IDs
can be checked against each raw source snapshot.

`current_calculator_footprint` copies every source footprint record, with numeric
intensity and the original calculator note. Its `observation_id` comes from an
exact farm/crop/year lookup. This is an existing, method-limited reference result;
it is not recalculated and no value is used as a nutrient-loss factor.

## Field derivations

- Retain all supplied crop assignments: declared 2012–2026 and planned 2027–2031.
  Retain all management observations and reference footprints in their original years.
- A field is provisionally selected when its annual crop appears in its owner's
  semicolon-delimited registry contract list. A blank list does not select fields
  but is explicitly marked unknown in the analytical view.
- `observation_id` is NULL without an exact farm + crop + year match.
  Do not fill gaps from prior years or attach historical reports to future plans.
- `area_difference_over_5pct` is
  `abs(reported_area_ha - mapped_group_area_ha) / mapped_group_area_ha > 0.05`.
  Mapped group area sums all fields for that farm/crop/year. NULL reported area
  gives a NULL diagnostic. Peer field areas **and crop assignments** are recorded
  in the diagnostic's lineage. This is not the official planted issue label.
- Reports are `unreviewed`; a missing report has review status `not_applicable`.
- No field-level management values, nutrient loads or delivery totals are allocated.

## Time, geometry and source snapshot assumptions

Static/latest parcel, farm and catchment attributes are applied as context across
all years; their historical effective dates and future versions are unavailable.
The static crop list is not proof of a historical or future contract. Monitoring
keeps all supplied 2019–2025 rows. Match annual exposures to monitoring years before
treating them as contemporaneous training examples. Declared and planned crop
assignments must remain distinguishable in features and analyses.

GeoJSON duplicate attributes are not used to overwrite CSV master attributes.
Geometry completeness is checked by ID; coordinates are only checked for Polygon
rings, closure and longitude/latitude bounds. Biological and hydrological accuracy
is outside those checks.

The original parcel GeoJSON contains 2,518 nonstandard `NaN` soil-P properties.
Source snapshots encode these as `{"$source_nonfinite_number":"nan"}` to preserve
the distinction in valid JSON. They are not changed to a measured value. Typed
soil P comes from the CSV, whose corresponding blank values become SQL NULL.
Snapshots preserve parsed content, not byte-for-byte source formatting. Full-file
SHA-256 hashes identify the exact original files; source files remain unchanged.

## Failures and checks

Duplicate domain keys, missing mandatory master references, mismatched field
ownership, conflicting observation keys, unknown Swedish crop codes, invalid
booleans and non-finite typed numbers now produce source-linked quarantine findings
for CSV imports. ERP business duplicates coexist under technical record IDs.
Structural geometry or internal consistency failures can still fail the typed
build; the independent source archive is committed before modelling. See the
quality guide for the first-accepted-record policy and review workflow.
Database checks cover foreign keys, integrity, observation join consistency and
recorded contributors for each stored query result. Tests additionally check area
conservation, missingness, source/hash recovery, geometry IDs, column-rule coverage
and end-to-end monitoring lineage. Constraints do not validate the scientific
plausibility of every reported number.
