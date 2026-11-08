# Parameterized query contracts for SQL, API and MCP use

The executable catalogue is [queries/catalog.json](queries/catalog.json). Each
entry specifies ID, question/limitations, output grain, parameter types/defaults
and contributor SQL. `query_definition` stores that catalogue and SQL in the built
database. A future API/MCP tool can call the same validated execution function
(`tools/nature_queries.py:execute`) without exposing arbitrary SQL.

There is no HTTP API or MCP server yet. The CLI is the working interface.

## Invocation and execution records

```bash
python3 tools/query_nature_model.py list
python3 tools/query_nature_model.py query 01_contract_area --params '{"year":2018}'
python3 tools/query_nature_model.py query 05_farming_coverage --params '{"year":2025,"country":"FI","crop":"pea"}'
python3 tools/query_nature_model.py query 10_field_weather --params '{"year":2028,"scenario":"ssp245","parcel_id":"F0001-P09"}' --save
```

`--params` must be a JSON object. Unknown parameter names, wrong types (including
boolean supplied as integer), out-of-range integers and invalid enum values fail
validation before SQL executes. Values use SQLite named bindings; SQL is not
constructed by concatenating parameter values. Unknown IDs passed as filters
produce an empty result, not an inferred ID or a zero-valued measurement.

Without `--save`, the database is opened read-only. `--save` deliberately opens an
existing database for writing and records a new execution ID, effective parameter
values (including defaults), SQL/contributor text and hashes, UTC time, result rows,
current review-state snapshot and contributing model entities in one transaction.
It prints the execution ID to stderr; stdout remains result CSV. Empty results
retain execution metadata and CSV column headers, with no fabricated result rows.
Review-state snapshots copy all reviews existing at execution, including context
that may explain why dismissed findings were omitted.

The builder saves one `query_id:default` execution per question. Later executions
use UUID-based labels and do not overwrite those defaults or the build-time CSVs.

```bash
python3 tools/query_nature_model.py lineage 10_field_weather F0001-P09:2028:ssp245 --run-id '<printed execution ID>' --output /tmp/field-weather-lineage.json
```

Omitting `--run-id` explains the build-time default execution. The lineage includes
its recorded review state rather than substituting later review decisions.

## Shared parameter conventions

- Year integers: 1900–2200. They are filters, not an ingestion range. Unsupported
  years yield no matching time-series rows; master-only queries are static.
- Nullable filters default to NULL, meaning no filter. A required `year` defaults
  to 2025 only for the relevant example questions; the database retains all years.
- `country`: FI/SE where present. `scenario`: historical/ssp126/ssp245/ssp585, default
  historical. For future years explicitly choose an SSP; historical weather is not
  silently substituted or extrapolated.
- `limit`: integer 1–1000, default 100; `offset`: nonnegative integer, default 0.
  These occur on questions 06, 07, 10, 14 and 15. Other questions are bounded grouped
  summaries or one field's history.
- Pagination uses deterministic SQL ordering. A saved execution includes lineage
  only for result keys on the returned page. Page boundaries can change when the
  dataset/review state changes; preserve a snapshot for repeatable pagination.
- NULL outputs export as blank CSV cells. Counts of selected records may be zero;
  unavailable measurements are not converted to zero.

## Catalogue and output contracts

Queries 01–04 have detailed calculation notes in [QUERY_CATALOG.md](QUERY_CATALOG.md).

| ID | Parameters | Grain / result key | Output meaning |
|---|---|---|---|
| `01_contract_area` | year=2025 | catchment within selected year / catchment ID | Region, field/distinct-farm counts and mapped contract-crop ha; 42 catchments, zero area allowed |
| `02_data_gaps` | year=2025 | catchment within selected year / catchment ID | Counts of selected fields without report/P application/soil P; missing-report area percentage |
| `03_ecological_context` | none | catchment / ID | Static ecological state, sensitivity, retention, station flag; no final priority score |
| `04_monitoring_change` | none | catchment / ID | 2019/2025 whole-catchment P/N kg and endpoint changes, year coverage; fixed comparison |
| `05_farming_coverage` | year?, country?, crop? | country/crop/year / `country:crop:year` | Declared selected field count, mapped ha, missing report and P counts; preserves separate years |
| `06_area_discrepancies` | year?, limit, offset | area finding / finding ID | Report ID, farm/crop/year, reported ha, mapped-area context JSON and latest review status |
| `07_quality_findings` | year?, rule_id?, review_status?, limit, offset | finding / finding ID | Rule/version/type/severity, year/field, observed/expected JSON, explanation, latest review status, target entity/source IDs |
| `08_catchment_quality` | year?, catchment_id? | catchment/year / `catchment:year` | Distinct non-dismissed findings and affected field counts; only groups with findings are returned |
| `09_field_history` | parcel_id=F0001-P09, start_year?, end_year? | field/year / `parcel:year` | Declared/planned crop, mapped ha, catchment, optional report, reported P kg/ha and static selection status |
| `10_field_weather` | year=2025, scenario=historical, parcel_id?, catchment_id?, limit, offset | field/year/scenario / `parcel:year:scenario` | Crop/context, selected grid/distance/status, monthly completeness, annual and Apr–Sep precipitation/PET mm |
| `11_catchment_weather` | year=2025, scenario=historical, catchment_id? | catchment/year/scenario / `catchment:year:scenario` | Selected field count/ha with matching exposure, complete-annual-weather field count, area-weighted annual precipitation mm |
| `12_sourcing_by_origin` | year=2025, origin_country?, material_id? | material/origin/year / `material:origin:year` | Source/return/non-mass row counts, signed net kg, fixed-reference EUR amount, currency set and review-candidate count |
| `13_farm_sourcing_support` | year=2025, country? | farm/crop/year / `farm:crop:year` | Declared selected fields/ha, matching purchase rows, signed net kg, unavailable-conversion count and support label |
| `14_master_references` | kind=material_factor, lookup_id?, limit, offset | resolution kind/lookup ID / `kind:ID` | Reported/resolved keys, resolution status and optional library unit/factor/value status |
| `15_farm_context` | farm_id?, country?, limit, offset | farm / farm ID | Full static registry attributes, distinct mapped parcel/catchment counts and mapped farm ha |
| `16_method_evidence` | method_id?, table_name? | method-evidence link / evidence ID | Purpose/status/interpretation, evidence role/note, exact local section/path/line range/hash, unfetched external pointer/licence/status |
| `17_framework_sources` | search? | registry pointer / reference ID | Original source name, URL, licence, use and explicit unfetched/unverified status |
| `18_nature_action_opportunities` | year=2025, planning_year=2027, crop_status=declared, catchment_id?, lever_id? | catchment/evidence year/lever / `catchment:year:lever` | Candidate fields/farms/ha, report gaps, ecological context, earliest start check and unquantified efficacy/status |
| `19_scenario_context` | scenario=net_zero_2050, year=2030 | transition scenario/year / `scenario:year` | Complete source transition row and count of matching grid/scenario/year weather summaries |
| `20_structural_events` | start_date?, end_date?, type? | dated event / event ID | ISO date, original event/type/relevance/source; no automatic scope filtering |
| `21_action_details` | lever_id=L10; NULL for all | lever / lever ID | Source costs, stated co-benefits/trade-offs, design abatement and any active screening rule/prerequisites; programme cost basis |
| `22_nutrient_input_readiness` | year?=2025, catchment_id?, country?, crop?, selection_status?=selected, crop_status?=declared, input_name? | catchment/country/crop/year/crop status/selection/input/availability / JSON array of those eight values | Field/report counts, mapped ha, overlapping quality counts and draft policy version; coverage only |

### Nutrient-input coverage contract (22)

The six `input_name` choices and classification precedence are defined in
[NUTRIENT_INPUT_POLICY.md](NUTRIENT_INPUT_POLICY.md), draft version 0.1.0. All
nullable parameters accept explicit NULL for no filter. `selection_status` is
selected/unknown_contract_list/not_selected_by_registry; `crop_status` is
declared/planned. The defaults exclude future plans and unknown/unselected
registry groups; these are not confirmed annual contract boundaries.

Each field/year occurs exactly once per input. Within one input/year/scope,
`availability_status` partitions field count and mapped hectares. `mapped_area_ha`
uses parcel hectares rounded to six decimals after aggregation. Never sum across
inputs or years as unique land. `distinct_report_count` counts non-NULL matched
observation IDs, including for schema-omitted inputs; counts can repeat across
catchments and inputs. It does not count measurements of the requested input.

`fields_with_area_discrepancy` counts the raw >5% mapped/report area flag;
`fields_with_open_quality_findings` counts fields with any scoped finding whose
latest review is not dismissed. Neither count changes the population or values.
These counts overlap, repeat across inputs and include issues unrelated to the
particular input. An unknown area flag contributes zero to the count, without
claiming agreement. Empty populations produce no result group. Counts are zero
when a group exists but has no matching flags. No uncertainty, imputation,
correction application, approved model eligibility or nutrient loss is calculated.

Contributor SQL applies identical filters and keys, linking field-year entities
and their non-dismissed scoped findings. Existing record ancestry explains
reports, mapped hectares and registry selection. Saved review snapshots preserve
execution context. The build hashes the policy document and schema. Inspect
`nutrient_input_context` for field-level original values and `observation_id`;
query 07 supplies quality evidence. The view has field/year/input grain.

### Important calculation details

- Query 05 counts **fields**, not reports. Several fields can share one report.
  Swedish uncollected P is missing P even with a present report.
- Query 06's `mapped_area_context_json` stores the detector's mapped hectare sum.
  This is an area review candidate, not a corrected report.
- Query 07 includes static findings (NULL finding year) with any selected year.
  `review_status` is one of unreviewed/confirmed/dismissed/needs_investigation.
- Query 08 counts distinct findings. Findings may overlap between catchments and
  years, so counts are not additive across those groups. Findings without a field
  linkage, such as unrelated imported-material issues, are not forced onto catchments.
  Grid-level weather month/value findings are available in query 07 but have not
  been propagated into this field-scope summary.
- Query 09 returns the supplied history and plans. Missing annual reports remain NULL.
- Query 10's weather comes from an assumed grid mapping. Its fields are not independent
  weather observations: multiple fields share a cell/scenario/year.
- Query 11 uses mapped **selected field area with available scenario exposure**,
  not total catchment area. Rainfall weighting denominator includes only fields
  whose annual precipitation is available. If no valid denominator remains, the
  weighted value is NULL. Missing mappings/scenario/year can exclude fields from
  this scenario-filtered result; inspect mapping/quality coverage separately.
- Query 12 includes signed returns and suspicious records; no implicit deduplication
  or correction. Spend rows have NULL mass and increase `non_mass_record_count`.
  Reference EUR totals use fixed package assumptions, not historical FX. The currency
  list is a set with no meaningful order. Review-candidate counts do not imply
  confirmed errors and may include dismissed candidates.
- Query 13 aggregates fields and purchases independently before joining. Net kg
  is farm/crop/year context, not mass allocated to each field. No matching ERP row
  does not establish no contract; see source coverage and Swedish acquisition limits.
- Query 14 `kind` is material_factor/material_site/erp_site. `lookup_id` is a material
  ID for the first two or technical purchase ID for the last. `FARM` is a method,
  not an unresolved library key. A displayed carbon factor is not applied to a quantity.
- Query 15 mapped area is static whole-farm parcel area, not annual contract-crop
  area. Certification is not soil type; registry joining year is not historical
  proof of every annual contract. Farm coordinates remain uncorrected.
- Query 16 evidence roles distinguish source-method definitions from package
  context and external pointers. A method may be planned/not implemented.
- Query 17 substring search uses SQLite `lower` on name/use text. URL/licence
  values are package statements, not fetched content or a verified licence assessment.
- Query 18 is **screening, not ranking**. Planning year only checks the catalogue
  earliest start. Area overlaps across actions and years; do not sum as unique land.
  It reports no nutrient reduction, biodiversity metric or validated suitability.
- Query 19 uses exact supplied scenario/year points. A missing year returns no
  economic row, without interpolation. Physical proxy is an explicit assumption,
  not scenario equivalence or a financial risk calculation.
- Query 20 date filters must be canonical `YYYY-MM-DD`; invalid or compact dates
  fail validation. Event claims remain package-provided and unverified externally.
- Query 21 catalogue costs are programme estimates, not per-field/catchment prices.
  One active screening rule per selected lever is supported. Negative operating
  cost changes can represent savings; measurement improvement is not abatement.

## Extending toward a service

For each new operation, add a catalogue entry with parameter validation, stable
result grain/key, SQL and contributor query; document units/NULLs/limitations and
test conservation or evidence paths. Keep result IDs and execution IDs in API
responses so an explanation can retrieve the corresponding lineage. An API/MCP
adapter should preserve the read-versus-save distinction and separately expose
expert review actions. It should not treat an LLM's proposed correction as approval.

Adding arbitrary SQL execution would require a separate read-only execution and
resource policy; it would not automatically inherit this explicit lineage model.
