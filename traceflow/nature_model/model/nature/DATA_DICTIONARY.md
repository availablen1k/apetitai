# Data dictionary

Executable types, nullability, keys, constraints and indexes are in [schema.sql](schema.sql).
All IDs and categories are TEXT; years and booleans are INTEGER (booleans 0/1);
measurements are REAL unless stated otherwise. JSON is stored as TEXT. Empty CSV
values become SQL NULL. NULL means unknown/unavailable; it is not zero or false.
Column-level source expressions are queryable in `column_lineage`.

`nutrient_input_context` is a field/year/input view over `field_context` and its
exact management report. It retains field context and adds `input_name`, `unit`,
`input_value`, `input_origin`, `collected_by_schema`, `availability_status`,
`coverage_policy_version` and `policy_review_state`. Six input rows exist per
field/year; hectares must not be summed across inputs. Original numeric values
remain unchanged. Classification and schema capabilities are documented in
[NUTRIENT_INPUT_POLICY.md](NUTRIENT_INPUT_POLICY.md); query 22 summarizes this
view with source-linked quality context. Availability is not model eligibility.

The separate `inputs.sqlite` experiment is defined in `nutrient_inputs.sql`:
`field_scope` has one field in a single declared year; `input_value` has one
field/input/variant with original/candidate values, unit, kind, blocking reason,
method/policy/review state, donor-spread bounds, donor counts and
`depends_on_estimate`. `input_dependency` connects derived N to its original or
estimated components. `input_evidence` links candidates to target/donor/quality
entities. `evidence_*` tables copy recursive raw ancestry, file versions, column
rules, transformations and method documents. `input_run` stores the policy,
hashes and source build/review/proposal snapshots. No rows are approved or applied
as corrections. See [model-input policy](NUTRIENT_MODEL_INPUT_POLICY.md).

The independent `pilot.sqlite` extends a copied input artifact using
`nutrient_loss.sql`. `loss_run` stores model config/code/input hashes and source
build; `loss_driver` stores exact parcel/crop/climate/normal/retention values in
JSON, with `loss_driver_evidence` links to copied raw ancestry. `field_loss` has
one field/year/nutrient/input-variant/donor-point/stress-case result: annual rate
(kg nutrient/ha/year), field mass, pre-retention and delivered mass (kg/year),
delivery/retention fractions, status/reason and factor JSON. `loss_input` links
to the required soil-P or applied-N candidate, whose components/donors remain
available. See [the method contract](NUTRIENT_LOSS_METHOD.md) for NULL scope totals,
historical-weather bounds, unused inputs and uncalibrated scientific status.

## Physical domain tables

| Table | Grain / primary key | Relationships |
|---|---|---|
| `farm` | Farm / `farm_id` | One farm has many parcels and reports |
| `parcel` | Field / `parcel_id` | `farm_id` → farm; `catchment_id` → catchment |
| `parcel_crop_year` | Field/year / `(parcel_id, year)` | Field → parcel; optional report → farm_crop_observation |
| `farm_crop_observation` | One report / `observation_id` | Farm → farm; current source-specific farm/crop/year uniqueness enforced |
| `current_calculator_footprint` | Existing Finnish calculator result / `(farm_id, crop, year)` | Matching report → farm_crop_observation; farm → farm |
| `catchment` | Catchment / `catchment_id` | One catchment has fields and annual monitoring |
| `catchment_monitoring` | Catchment/year / `(catchment_id, year)` | Catchment → catchment |
| `parcel_geometry` | One boundary per field / `parcel_id` | Field → parcel |
| `catchment_geometry` | One boundary per catchment / `catchment_id` | Catchment → catchment |
| `origin_nature_indicator` | Indicative country/commodity context / `(origin_country, commodity)` | Deliberately not joined to catchments or materials yet |

### farm

- `farm_id`: source registry identity.
- `country`: country code, currently FI or SE.
- `region`: source region code, FI_SW or SE_SKANE.
- `segment`: registry farming segment (veg, oil, se_pea).
- `contract_crops`: semicolon-separated source crop list; nullable. Retained as
  source context, not an annual contract table. Blank lists are unknown.
- `lat`, `lon`: nullable static farm-centre coordinates, WGS84 degrees; not field centroids.
- `organic_certified`, `livestock`: nullable registry booleans; certification is not soil class.
- `joined_year`: nullable registry joining year; no annual contracts inferred.

All supplied registry columns are now promoted; the original record also remains
in `source_record.raw_json`. Coordinate review candidates remain uncorrected.

### parcel

- `parcel_id`, `farm_id`, `catchment_id`: supplied field, owner and receiving catchment IDs.
- `lat`, `lon`: source centroid latitude/longitude in WGS84 degrees.
- `area_ha`: mapped hectares; additive over distinct fields.
- `soil_class_soilmap`: mapped class; uncertain, not true field soil classification.
- `clay_pct_soilmap`: mapped clay content, %.
- `slope_pct`: field slope, %.
- `dist_to_water_m`: distance to water, metres.
- `drainage`: supplied drainage category.
- `p_test_mgl_latest`: nullable latest soil P test, mg/L (acid ammonium acetate).
- `buffer_strip`: boolean buffer-strip presence.

These attributes have no supplied effective dates. Area from the CSV is retained;
it is not recomputed from synthetic polygon geometry.

### parcel_crop_year

- `parcel_id`, `year`: field/year key; all supplied 2012–2031 records are loaded.
- `crop`: canonical source crop code, including non-contract rotation crops.
- `crop_status`: declared for 2012–2026, planned for 2027–2031.
- `catch_crop`: field/year boolean; distinct from farm-level catch-crop share.
- `is_contract_crop_provisional`: boolean annual-crop membership in the static
  registry list. Zero means not selected by this rule, not confirmed non-sourcing.
- `observation_id`: nullable report identity from an exact owner/crop/year lookup.
- `area_difference_over_5pct`: nullable boolean comparing reported versus mapped
  farm/crop/year area; diagnostic, not an approved correction.
- `management_review_status`: unreviewed for a report, not_applicable without one.

### farm_crop_observation

- `observation_id`: `fi:<survey_id>` or `se:<grower_id>:pea:<year>`.
- `farm_id`, `crop`, `year`: observed farm/crop/year; current package has one report
  per combination. This constraint would need revision for multiple future revisions/sources.
  All Finnish reports (2012–2026) and Swedish reports (2018–2026) are retained.
- `source_kind`: fi_survey or se_grower_report.
- `reported_area_ha`: report's crop area, ha; do not confuse with mapped area.
- `delivered_t`: delivered tonnes, Sweden only; not harvested yield.
- `soil_type_reported`: farmer's soil classification, Finnish survey only.
- `n_mineral_kg_ha`, `n_manure_kg_ha`: reported mineral/manure N application, kg N/ha, Finland.
- `n_applied_kg_ha`: reported N application, kg N/ha, Sweden; no component split inferred.
- `p_kg_ha`: P application, kg P/ha, Finland.
- `fertiliser_product`: reported product label, Finland.
- `diesel_l_ha`: diesel, L/ha, both sources.
- `lime_t_ha`: liming, t/ha, Finland.
- `sprays`: plant-protection passes, Finland; not pesticide mass/toxicity.
- `irrigated`: nullable boolean, both sources; no water volume supplied.
- `catch_crop_share`: fraction 0–1 of crop area, Finland.
- `yield_t_ha`: harvested t/ha, Finland.

All measurements may be NULL according to source availability. Missing measurements
are not imputed. These remain **farm/crop/year observations** even when a query
attaches them to individual fields. Totals are additive over distinct observations,
not over field rows sharing the observation. Rates require explicit weighting.

### current_calculator_footprint

- `farm_id`, `crop`, `year`: original Finnish calculator result key, 2012–2026.
- `observation_id`: matching Finnish survey observation for the same farm/crop/year.
- `carbon_footprint_kgco2e_per_kg`: reported calculator intensity, kg CO2e/kg product.
- `calculator_note`: original method limitations: mineral-soil assumption, exclusion
  of land-use change and organic-soil emissions.

All 3,437 results are retained unchanged in meaning, with source lineage. The note
is part of the result's interpretation. Intensity is not additive, not nutrient
pollution and not a newly validated or recalculated carbon footprint.

### catchment

- `catchment_id`, `region`: source catchment and region codes.
- `receiving_water_type`: receiving-water category.
- `ecological_status_class`: source ecological class (good/moderate/poor/bad).
- `nutrient_retention_frac_estimate`: estimated nutrient retention, fraction 0–1.
- `catchment_area_km2`: supplied total catchment area, km².
- `field_area_total_ha`: all farmland area, ha; not contract area.
- `p_sensitivity`: dimensionless phosphorus-sensitivity multiplier.
- `monitoring_station`: source boolean station flag; check observation rows for actual coverage.

Catchment attributes are context, not quantities to sum after a one-to-many field join.
Ecological status is not a species-count or habitat-condition measurement.

### catchment_monitoring

- `catchment_id`, `year`: annual monitoring identity; 2019–2025 supplied.
- `total_p_load_kg`, `total_n_load_kg`: whole-catchment annual outlet loads, kg/year.
- `method`: original method and uncertainty text; currently flow-weighted sampling,
  approximately ±10–15%. Not parsed into a statistical uncertainty distribution.

These are synthetic monitoring observations including background and non-contract
farmland. They are not labelled Apetit-attributable delivered loads.

### parcel_geometry / catchment_geometry

- `parcel_id` / `catchment_id`: matched master identity.
- `crs`: original collection CRS name, OGC CRS84.
- `geometry_json`: valid JSON Polygon with longitude/latitude coordinate order.

No area or distance is derived from geometry, and no spatial indexes are present.
Full original feature properties and the collection CRS are retained in lineage.

### origin_nature_indicator

- `origin_country`, `commodity`: supplied country and broad commodity label.
- `baseline_water_stress_cat_indicative`: integer indicative category, source scale 0–4.
- `deforestation_conversion_risk_indicative`: source qualitative risk label.
- `biodiversity_sensitivity_indicative`: source qualitative sensitivity label.
- `freshwater_nutrient_status_indicative`: source qualitative nutrient-status text.
- `water_stress_scale`: original explanation of the category scale.
- `source_note`: source caveats and suggested production replacements.

These teaching indicators are not quantitative impact factors or catchment observations.
Category numbers are ordinal, not additive measurements. No missing commodity mapping
is inferred from country alone.

## Analytical view

`field_context` has one row per field/year across 2012–2031. It selects all `parcel_crop_year`
columns and adds `farm_id`, `catchment_id`, `area_ha`, `soil_class_soilmap`,
`p_test_mgl_latest`, `buffer_strip`, `country`, `region` and reported N/P rates
(`reported_p_kg_ha`, `reported_n_mineral_kg_ha`, `reported_n_manure_kg_ha`,
`reported_n_applied_kg_ha`). Their meanings and units are inherited from the domain
tables above. It also provides `contract_selection_status`:

- `unknown_contract_list`: registry list is NULL.
- `selected`: provisional contract flag is 1.
- `not_selected_by_registry`: known list but current crop not selected.

View values are calculated at query time. Trace the joined base records and the
view's SQL in `schema.sql`; the view does not create separate lineage entities.
`field_context_2025` is a compatibility view that filters `field_context` to 2025;
the database's storage and general view are not scoped to that year.
The view also exposes `organic_certified`, `livestock` and `joined_year` from the farm registry.

## Lineage and execution tables

| Table | Columns and meaning |
|---|---|
| `build_run` | `build_id`: local build identifier; `built_at_utc`: UTC ISO timestamp; `code_hashes_json`: code/schema/catalog paths and SHA-256 hashes; `parameters_json`: scope and imputation settings |
| `source_file` | `source_id`: content SHA-256 identity; `relative_path`: path relative to package data directory; `sha256`: complete file hash; `bytes`: byte count; `format`: csv/geojson |
| `source_record` | `source_record_id`: file hash plus locator; `source_id`: file FK; `locator`: CSV physical line or GeoJSON pointer; `raw_json`: parsed original record snapshot with explicit non-finite tags |
| `transformation` | `transformation_id`: stable rule name; `description`: operation and assumptions |
| `column_lineage` | `(table_name, column_name)`: domain column key; `source_expression`: source field(s) or derivation; `rule`: applied rule/explanation |
| `entity_record` | `entity_id`: table plus canonical JSON key; `table_name`: physical model table or query_result; `key_json`: ordered natural-key values |
| `record_source` | `entity_id`: model entity FK; `source_record_id`: raw record FK; `transformation_id`: applied rule FK; all three form the key |
| `record_dependency` | `child_entity_id`: derived entity; `parent_entity_id`: contributing entity; `reason`: relationship/derivation context; child/parent pair is key |
| `query_run` | `query_run_id`: catalogue ID plus default or UUID execution label; `query_id`: question ID; `executed_at_utc`: execution timestamp; `parameters_json`: actual bound parameters including defaults; `sql_text`, `sql_sha256`: result SQL/version; `lineage_sql_text`, `lineage_sql_sha256`: contributor SQL/version; `description`: question and limitations |
| `query_result` | `entity_id`: result entity FK; `query_run_id`: execution FK; `result_key`: unique output-grain key within a run; `values_json`: typed output-row snapshot |

File and record hashes are identifiers/integrity evidence, not signatures or an
immutable external audit system. Result value definitions are in the [query catalogue](QUERY_CATALOG.md).

## Quality, climate and sourcing extension tables

Executable definitions and constraints are in [extensions.sql](extensions.sql).
The rule/workflow, climate and sourcing explanations are in
[DATA_QUALITY.md](DATA_QUALITY.md) and [CLIMATE_AND_SOURCING.md](CLIMATE_AND_SOURCING.md).

### Quality and execution metadata

| Table | Columns / meaning |
|---|---|
| `quality_rule` | `rule_id` key; `version`; `issue_type`; `severity`; `description`; `parameters_json` with detection policy thresholds |
| `quality_finding` | `finding_id` deterministic hash key; `rule_id` FK and `rule_version`; nullable `entity_id`/`source_record_id`; `expected_key_json` for absent records; nullable `year`/`field_name`; `observed_json`, `expected_json`, `explanation` |
| `quality_evidence` | `finding_id` FK; optional `source_record_id` and/or `entity_id` evidence FKs; `role` explains contribution; repeated evidence is not a finding count |
| `quality_scope` | Composite key `finding_id,parcel_id,year`; `catchment_id` identifies affected field-year context; not a separate confirmed error |
| `quality_review` | Autoincrement `review_id`; `finding_id`; human `status`, `reviewer`, `reviewed_at_utc`, `note`; latest ID determines current status |
| `correction_proposal` | `proposal_id`; `finding_id`; `field_name`; `original_value_json`, `proposed_value_json`; `reason`, `proposed_by`, `proposed_at_utc`; `status`; nullable `reviewed_by`, `reviewed_at_utc`; not automatically applied |
| `quarantine_record` | Composite key `source_record_id,target_table`; `reason` for typed acceptance failure |
| `query_definition` | `query_id` key; `description`, `grain`, validated parameter schema in `parameters_json`, `sql_text`, `lineage_sql_text` |
| `query_review_snapshot` | Key `query_run_id,review_id`; copied `finding_id,status,reviewer,reviewed_at_utc,note` capturing review context at saved execution |

`quality_finding_context` adds rule `issue_type`, `severity` and latest
`review_status` (default unreviewed). It does not change modeled measurements.

### Climate entities

| Table | Key / columns / units |
|---|---|
| `climate_grid_cell` | `cell_id`; `region`; `lat,lon` in WGS84 degrees; `continentality` dimensionless; `elevation_m` metres |
| `weather_monthly` | Key `cell_id,scenario,year,month`; `tmean_c` monthly mean °C; `tmax_c_max` max daily Tmax °C; `precip_mm,pet_mm` monthly mm; `hot_days_tmax_ge_27` days |
| `climate_change_signal` | Key `scenario,period,month`; `delta_tmean_c` °C; `precip_factor,wetday_factor` dimensionless factors |
| `parcel_climate_mapping` | `parcel_id` key; `cell_id` FK; `distance_km`; `method`; `mapping_status` currently assumed |
| `weather_annual` | Key `cell_id,scenario,year`; integer `months_present,apr_sep_months_present`; nullable `annual_precip_mm,annual_pet_mm,apr_sep_precip_mm,apr_sep_pet_mm` complete-window totals in mm |

`field_climate_context` adds mapping/grid distance, mapping status, scenario,
completeness counts and weather summaries to `field_context`. Its grain is
field/year/scenario, with NULL exposure when no match exists. It is not a
one-row-per-field view across future scenarios.

### Sourcing entities

| Table | Columns / units / interpretation |
|---|---|
| `material` | `material_id` key; `erp_name,name_en,material_group`; source `base_uom`; `default_ef_id`; `receiving_site`; semicolon-separated `origin_countries`; boolean `eudr_commodity,sbtn_high_impact_commodity` |
| `supplier` | `supplier_id` key; `supplier_name,supplier_type,country`; reported `material_id`; `sbti_status`; boolean `provides_pcf`; `cdp_score` |
| `fx_reference_assumption` | `currency` key; numeric `units_per_eur`; `source_reference`; `interpretation` explicitly fixed package assumptions |
| `material_crop_mapping` | `material_id` key/FK; canonical `crop`; `source_reference` for package code mapping |
| `erp_purchase` | `purchase_record_id` technical key; original fields and nullable resolved/converted values detailed below |

ERP source fields: `doc_no` TEXT; `line_no` integer; `posting_date` ISO date;
`company_code,plant,material_id,material_text,supplier_id` TEXT;
`quantity` REAL in source `uom`; `net_amount` REAL in source `currency`;
`origin_country,lot_id` TEXT; `movement_type` integer; `reference_doc,wbs_element`
nullable TEXT. Returns retain their signed quantities and amounts.

ERP derived fields: `year` integer posting year; nullable `resolved_material_id`,
`resolved_supplier_id`, `farm_id` FKs; nullable `quantity_kg` converted mass;
`amount_eur_reference_rate` approximate reference-rate EUR; `fx_currency` nullable
FK to the conversion assumption. The raw supplier/material identifiers are not
replaced when master resolution fails.

`farm_crop_purchases`: one matched farm/crop/posting-year group, with
`purchase_record_count`, `reported_net_quantity_kg` (signed kg) and
`records_without_mass_conversion`. These totals are not corrected or allocated
to fields. `field_sourcing_context` joins this aggregated context and adds
`reported_purchase_support` plus `matching_purchase_record_count` without
duplicating whole-farm purchase mass onto every field.

All new physical domain columns have entries in `column_lineage`. Metadata tables
are documented here, rather than described as measured domain data.

## Master, evidence, scenario and action decision context

The [decision-context dictionary and interpretation](DECISION_CONTEXT.md) covers
all columns in [decision_context.sql](decision_context.sql): `site`,
`emission_factor`, the three reference-resolution bridges, `reference_source`,
`evidence_document`, `evidence_section`, `method_context`, `method_evidence`,
`model_method_link`, all six scenario source tables, `price_crop_mapping`,
`nature_action_rule` and `nature_action_candidate`.

These physical domain columns are also registered in `column_lineage`. Explanatory
metadata links in `model_method_link` are not measured outcomes. Nulls in factor
resolution can mean the explicit farm-specific method; check the status rather
than treating every absent factor FK as an error. Action efficacy is unquantified.
