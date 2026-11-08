# 2025 field-level farming dataset

This is an optional earlier export, not the temporal scope of the main database.
The large derived CSVs are local/ignored by Git; generate them with the command
below before using their links. Teammates do not need them to build the main model.

Build from the model-package folder (`traceflow/nature_model/`):

```bash
python3 tools/build_farming_2025.py
python3 -m unittest discover -s tools -p 'test_build_farming_2025.py'
```

Python 3 standard library only. Source files remain unchanged. Optional arguments
`--data-dir` and `--output-dir` select another source package or destination.

## Files and grain

| File | One row | Key |
|---|---|---|
| [field_year_2025.csv](field_year_2025.csv) | One field in 2025, with field/catchment attributes and available farm-level management rates | `parcel_id, year` |
| [farm_crop_observations_2025.csv](farm_crop_observations_2025.csv) | One source report for a farm/crop/year | `observation_id` |
| [summary.json](summary.json) | Coverage statistics and SHA-256 hashes of source files and builder | — |

The field file preserves **all 14,213 fields**. Filter
`is_contract_crop_provisional = true` for the current exploratory contract selection:
**2,410 fields**, 12,926.27 ha. Other rotation crops remain visible for context.
The flag means the year's crop appears in the farm registry's static contract-crop
list. It is not verified evidence of annual delivery or a final Track D boundary.

## Reading values

CSV is UTF-8, comma-delimited, with decimal points. Booleans are `true`/`false`.
An empty cell means **unknown or unavailable**, never zero or false. Numeric
values retain source precision; allocation fractions use Decimal arithmetic.
These are joined source reports, not corrected data or nutrient-loss estimates.

### Field identity, selection and area

| Columns | Type / unit | Meaning |
|---|---|---|
| `parcel_id`, `farm_id`, `crop` | String | Field, owner and annual crop |
| `year` | Integer | 2025 |
| `crop_status` | String | Source declared/planned status; all 2025 rows are declared |
| `parcel_catch_crop` | Boolean | Field/year catch crop from crop history |
| `country`, `farm_region` | String | Registry country and region |
| `is_contract_crop_provisional` | Boolean | Static contract-crop selection described above |
| `parcel_area_ha` | Decimal, ha | Mapped field area; additive across field rows |
| `farm_crop_mapped_area_ha` | Decimal, ha | Sum of mapped area for the same farm/crop/year; repeated context, **not additive** |
| `parcel_share_of_farm_crop_area` | Decimal, fraction | Field area / mapped group area; sums to approximately 1 per farm/crop/year |

No farm-level area or delivery total is duplicated as a field-level measurement.
The original `reported_area_ha` and Swedish `delivered_t` live in the observation
file and should be aggregated there. Allocation weights are provided for future
explicit allocation; no delivery or nutrient total has been allocated yet.

### Field attributes from `01_master/parcels.csv`

| Columns | Type / unit |
|---|---|
| `parcel_lat`, `parcel_lon` | Decimal, WGS84 degrees |
| `soil_class_soilmap`, `drainage` | String |
| `clay_pct_soilmap`, `slope_pct` | Decimal, % |
| `dist_to_water_m` | Decimal, m |
| `p_test_mgl_latest` | Nullable decimal, mg/L, latest soil P test |
| `soil_p_missing` | Boolean; true when the soil P cell is empty |
| `buffer_strip` | Boolean |

These are static/latest attributes. Treating them as representative of 2025 is an
explicit assumption. The soil map is uncertain, not ground truth.

### Catchment attributes from `06_nature/catchments.csv`

| Columns | Type / unit |
|---|---|
| `catchment_id`, `catchment_region` | String |
| `receiving_water_type`, `ecological_status_class` | String |
| `nutrient_retention_frac_estimate` | Decimal, fraction |
| `p_sensitivity` | Decimal, dimensionless multiplier |

These catchment attributes repeat across fields; do not sum them. Catchment state
and sensitivity are retained for a later priority calculation; there are no ranks yet.

### Management observations

`management_observation_id` joins to `observation_id` in the separate observation
file. It is blank when no exact `farm_id + crop + year` report exists. IDs are
`fi:<survey_id>` and `se:<grower_id>:pea:2025`.

The following field columns start with `reported_` to make clear that they are
**reported for the farm/crop/year**, not measured individually on the field:

| Field-file column | Type / unit | Availability |
|---|---|---|
| `reported_soil_type_reported` | String | Finnish survey |
| `reported_n_mineral_kg_ha`, `reported_n_manure_kg_ha` | Decimal, kg N/ha | Finnish survey |
| `reported_n_applied_kg_ha` | Decimal, kg N/ha | Swedish report, no mineral/manure split |
| `reported_p_kg_ha` | Decimal, kg P/ha | Finnish survey |
| `reported_fertiliser_product` | String | Finnish survey |
| `reported_diesel_l_ha` | Decimal, L/ha | Both sources |
| `reported_lime_t_ha` | Decimal, t/ha | Finnish survey |
| `reported_sprays` | Decimal, passes | Finnish survey |
| `reported_irrigated` | Boolean | Both sources |
| `reported_catch_crop_share` | Decimal, fraction | Finnish survey; distinct from field catch crop |
| `reported_yield_t_ha` | Decimal, harvested t/ha | Finnish survey |

The observation file uses these measurement names without the extra `reported_`
prefix, plus `reported_area_ha` (ha) and `delivered_t` (tonnes, Sweden only).
It also contains `farm_id`, `crop`, `year`, `source_kind`, `source_file`,
`source_csv_line` and `source_record_key`. See the [source-field mapping](../README.md)
for Swedish header translations. Swedish nitrogen is not assigned to a mineral or
manure category. Finnish total N is left blank because the source supplies components.
Swedish delivered production is not converted into harvested yield.

Using a farm-level rate in a future field calculation would assume uniform
management across that crop's fields. This view preserves the rate as context;
it has not validated that assumption. Rates and intensities should not be summed.

### Missingness, review and provenance

| Columns | Meaning |
|---|---|
| `management_status` | `reported_at_farm_crop_year` or `missing_observation` |
| `missing_management_fields` | Semicolon-separated list of missing canonical measurements |
| `missing_management_reason` | `not_collected_in_source`, `no_matching_report`, or `no_matching_report_noncontract_crop` |
| `area_difference_over_5pct` | Nullable boolean: abs(reported area − mapped group area) / mapped group area > 0.05 |
| `management_review_status` | `unreviewed` for a matched report; `not_applicable` without one |
| `management_source_file`, `management_source_csv_line` | Report provenance; blank without a report |
| `history_source_*`, `parcel_source_*`, `farm_source_*`, `catchment_source_*` | `file` and `csv_line` for each contributing source |

Paths are relative to the package's `data/` directory. CSV lines count the header
as line 1; these inputs have one physical line per record. Source keys and hashes
allow a reader to recover original column names, values and transformations.
All generated booleans and numbers are formatting conversions or documented join
diagnostics. No source value has been corrected and no missing rate has been filled.
An area discrepancy is a review candidate, not an official data-quality issue label.

## Current gaps in provisionally selected contract fields

| Country | Fields | With management report | Missing soil P test | Missing P application |
|---|---:|---:|---:|---:|
| Finland | 1,490 | 1,092 | 246 | 398 |
| Sweden | 920 | 920 | 162 | 920 |

Missing soil P and missing phosphorus application are different variables. A
Swedish observed N value of zero is preserved as zero; unavailable P stays blank.
Observation coverage does not certify correctness of the planted raw-data values.

The builder rejects duplicate lookup/observation keys and inconsistent field
ownership, and fails on missing mandatory master references. Tests check field
and area preservation, exact observation joins, zero versus missing, Swedish
normalisation, allocation-weight conservation, source lineage and the known
`FS00009` area discrepancy. Source hashes and deterministic output support reproduction.

Weather exposure, nutrient-loss modelling, retention calculations and catchment
ranking remain subsequent steps. Carbon-footprint results are intentionally kept
outside this nutrient-input view: they are not phosphorus or nitrogen losses.
