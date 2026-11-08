# SQL query catalogue

Each numbered [SQL file](queries) has a catalogue description in `catalog.json` and
a separately versioned contributor query. The builder saves both SQL texts and
hashes, execution time, effective bind parameters, output rows and
row-level contributor links in SQLite. CSV exports use blank cells for NULL.
`result_key` is the catchment ID in the original four outputs; each returns all 42
catchments. [Parameterized contracts](API_QUERY_CONTRACTS.md) document all twenty-two
questions, including nature-action leads, method evidence and scenario context.

## 01_contract_area — Where is the mapped contract-crop area?

- Inputs: unrestricted `field_context` and `catchment`.
- Selection: `is_contract_crop_provisional = 1`, bound year (default 2025).
- Output: `result_key`, region, contract field count, distinct farm count and
  contract area in ha. Area is summed once per field and rounded to 2 decimals.
- Zero selected fields produce zero counts and area. These zeros describe the
  selection, not pollution or verified sourcing absence.
- Farms spanning catchments count once in each relevant catchment. Farm counts
  are **not additive** between catchments. Field counts and areas are additive.
- Contributor SQL: `field_contributors.sql`; selected field/year entities and
  the corresponding catchment row. Both result and contributor SQL explicitly
  use the same bound year; changing the selection requires changing both.

## 02_data_gaps — Where are nutrient-input data gaps?

- Inputs and selection: same as 01, using the optional observation and soil-P data.
- Output: contract field count, `fields_without_report`,
  `fields_without_p_application`, `fields_without_soil_p` and
  `area_without_report_pct`.
- Report missing: `observation_id IS NULL`. P application missing:
  `reported_p_kg_ha IS NULL`, including Sweden's uncollected P field. Soil P missing:
  `p_test_mgl_latest IS NULL`. These are different, overlapping counts; do not add
  them to count unique fields with a problem.
- Percentage: 100 × mapped selected area without a report / all mapped selected
  area. NULL when the selected area denominator is zero.
- Contributor SQL: `field_contributors.sql`.
- A present report can still be wrong or lack measurements. Coverage is not quality
  approval, and group-level report coverage differs from field-level coverage.

## 03_ecological_context — What is the receiving-water context?

- Input: `catchment` only.
- Output: region, water type, ecological class, P sensitivity, estimated retention
  fraction and monitoring flag.
- Ordering: bad → poor → moderate → good, then decreasing P sensitivity, then ID.
- There is no numeric risk score or priority rank. Poor state and high sensitivity
  are separate contextual attributes, not a substitute for estimated delivered loads.
- Contributor SQL: `catchment_contributors.sql`.

## 04_monitoring_change — How did whole-catchment loads change?

- Inputs: `catchment_monitoring`, grouped by catchment before joining `catchment`.
- Output: observed-year count, first/last observed years, P and N in kg for 2019 and
  2025, and endpoint percentage changes.
- Change: 100 × (2025 load − 2019 load) / 2019 load, rounded to 2 decimals. NULL if
  an endpoint is missing or the baseline is zero. This is **not a fitted trend**.
- Fifteen catchments have seven observations; 27 have none. Missing observations
  remain NULL, with observed-year count zero. Monitoring flag and actual row coverage
  are distinct concepts.
- All seven records contribute to coverage count and first/last years; only endpoint
  records contribute to change values. The lineage is row-level, not per-cell.
- Source method states approximately ±10–15% uncertainty; output changes do not
  include propagated uncertainty or significance tests.
- Loads include natural background and non-contract farmland. They are **not Apetit's
  contribution** and should not be divided by contract area to imply an attributed rate.
- Contributor SQL: `monitoring_contributors.sql`.

## Rules for adding SQL and mining features

The database holds all farming years. To analyse another year, query
`field_context WHERE year = <chosen year>`; do not change the ingestion scope.
For an auditable saved question, register the SQL and matching contributor filter,
or execute an existing parameterized question with `--save`.
Keep year and declared/planned status in multi-year result keys and grouping.

1. State the question and output grain before writing the query.
2. Document selection, years, declared/planned status, units, denominators,
   NULL/zero handling and rounding. Repeated area across years is hectare-years,
   not unique land area.
3. Check relationship cardinality. Aggregate monitoring at catchment level before
   joining field aggregates; joining field rows to all monitoring years multiplies area.
4. Keep observations, estimates and reference/evaluation answers distinguishable.
5. Add contributor SQL returning `result_key, entity_id`, with unique pairs. Every
   output key must have contributors. Document conservative lineage limitations.
6. Add a catalogue entry, conservation/coverage tests and an example interpretation.
7. Rebuild to capture the SQL version, dependencies and output together.

Never sum a farm observation's whole crop area or delivery tonnes after joining
it to multiple fields. Use the observation table for farm/crop totals, or an
explicit, documented allocation. Means of rates need a declared weighting method.
