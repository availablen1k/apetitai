# Nutrient inputs — draft policy 0.1.0

Status: **draft, unreviewed**. This version defines reproducible coverage
classification, not an approved scientific input set. No owner/reviewer has
approved missing-value treatments, corrections, imputation or model eligibility.
The build records this document's hash; query 22 records the classification
version and review state. Change the version in this document and the view when
classification semantics change. Saved runs retain their SQL, results and build.

## Population and evidence

Default assessment: declared 2025 fields provisionally selected by the static
farm contract-crop registry. Year is a filter; all supplied years remain stored.
Query 22 can include unknown and unselected registry groups separately. An empty
contract list is unknown, not evidence of no relationship. ERP support and signed
returns remain separate contextual evidence (query 13), never nutrient inputs or
automatic inclusion/exclusion rules. Annual contract scope still needs review.

Rates come from exact farm/crop/year reports. Their source grain is not a field:
multiple fields can share a report. The query counts both fields and distinct
reports. Mapped field hectares measure exposure to gaps, not independently
measured hectares, reported crop area, delivered volume or nutrient load.

| Input | Unit | Finnish survey | Swedish grower report |
|---|---|---|---|
| `p_kg_ha` | kg P/ha | Reported rate | Not collected |
| `n_mineral_kg_ha` | kg N/ha | Reported mineral rate | Not collected |
| `n_manure_kg_ha` | kg N/ha | Reported manure rate | Not collected |
| `n_applied_kg_ha` | kg N/ha | Not collected as a total | Reported N application rate |
| `yield_t_ha` | t harvested/ha | Reported yield | Not collected |
| `p_test_mgl_latest` | mg/L | Static parcel master | Static parcel master |

Source mappings: `tools/build_farming_2025.py:observation`,
`column_lineage` for `farm_crop_observation` and `parcel`. Original rows remain
in `source_record`; saved query 22 contributors trace to field-years, their
reports, registry/parcel inputs and linked non-dismissed quality findings.
Absence is a statement about the captured version, not a nonexistent source row.

## Executed classification, in precedence order

For each field/year/input, `nutrient_input_context` emits its original numeric
value, unit, origin and exactly one availability status:

1. Management inputs on planned crops: `not_observed_plan`.
2. Input absent from that country's schema: `not_collected_by_schema`, even when
   no report matched. Use `observation_id`/query 02 for the separate report gap.
3. Schema supports the management input but no exact report: `missing_report`.
4. Supported input is NULL: `missing_value` (including missing static soil P).
5. Present numeric value: `reported_zero`, `reported_negative` or `reported_positive`.

Static soil P stays labelled `static_parcel`, including for planned years; it is
neither an annual measurement nor evidence that a historical/future value is known.
Present values are observed source values, not corrected, estimated or approved.
Zero yield and negative rates remain visible for investigation. A positive value
can still be questionable. Status alone never grants nutrient-model eligibility.

Query 22 also counts fields with a >5% area discrepancy and fields with any
non-dismissed scoped quality finding. Counts can overlap and are context across
all inputs, not input-specific rejection decisions. Dismissal affects the open
finding count but does not rewrite the raw area-discrepancy flag. Soil-map
uncertainty, reported-soil disagreement, peer/temporal outliers and implausible
values require inspection through query 07. No automatic exclusion is applied.

## Proposed treatments awaiting review

| Decision | Draft treatment / unresolved choice |
|---|---|
| Missing FI reports | Keep unknown; quantify affected hectares before selecting an estimation method |
| Missing SE P/manure/yield | Keep schema gaps; do not infer zero manure or derive harvested yield from delivered tonnes |
| FI N total | Leave the observed total absent; any sum of mineral/manure must be a separately named derived input with both components present and a reviewed interpretation |
| SE N interpretation | Verify what the supplied rate covers before equating it to a Finnish component or total |
| Missing soil P | Keep unknown; review suitable local evidence/estimation and sensitivity separately |
| Area discrepancies | Retain mapped and reported areas; review rate allocation and model denominator before calculating kg |
| Soil uncertainty | Preserve map/report alternatives; do not substitute certification for soil class |
| Peer/temporal outliers | Keep reported values until assessed; poor harvests can be real |
| Signed/duplicate sourcing | Investigate separately; no inferred nutrient rates or automatic field removal |
| Corrections | Require explicit proposal/approval with original evidence; no automatic application currently exists |
| Learned imputation | Define grouped farm/report evaluation and temporal splits before fitting; do not treat fields sharing reports as independent samples |

There is **no numerical uncertainty model or alternative-treatment sensitivity
calculation yet**. Neither zero filling nor complete-case selection is an approved
default. Selection bias and missing-area fractions must accompany later estimates.

Before supplying P/N loss calculations, create a versioned model-input layer
that separates observed, derived, corrected and estimated values. Each input must
retain field/year, source/evidence IDs, unit, policy/method version, reason,
review state and uncertainty representation. Preserve original values and the
review evidence. P0 state preservation is required before real review begins.

## Inspect coverage

```bash
python3 tools/query_nature_model.py query 22_nutrient_input_readiness --params '{"year":2025,"input_name":"p_kg_ha"}'
python3 tools/query_nature_model.py query 22_nutrient_input_readiness --params '{"selection_status":null,"catchment_id":"CA28"}'
python3 tools/query_nature_model.py query 22_nutrient_input_readiness --params '{"year":2028,"crop_status":"planned"}'
```

Within one input/year/population, statuses partition field counts and hectares.
Do not sum area across inputs or years. Distinct-report counts are not additive
across catchments or statuses of other inputs. An absent group is no matching
population, not a measured zero. See the query contract for exact filters/grain.
