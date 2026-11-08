# Climate and sourcing connections

## Climate sources, grains and spatial mapping

All monthly CSV years and scenarios are retained. Daily Parquet weather is not
imported; monthly data supports initial exposure exploration, not rainfall-event
timing or a validated nutrient-loss model.

| Table / source | Grain / key | Units and interpretation |
|---|---|---|
| `climate_grid_cell` / `01_master/climate_grid_cells.csv` | `cell_id` | Region; WGS84 lat/lon; continentality 0–1; elevation m |
| `weather_monthly` / `04_climate/weather_monthly_1991_2060.csv` | cell/scenario/year/month | `tmean_c`: monthly mean °C; `tmax_c_max`: maximum daily Tmax °C; `precip_mm`, `pet_mm`: monthly totals mm; `hot_days_tmax_ge_27`: count of days |
| `climate_change_signal` / `04_climate/climate_change_signals.csv` | scenario/period/month | `delta_tmean_c`: °C change; precipitation/wet-day factors dimensionless; period text retained |
| `parcel_climate_mapping` | `parcel_id` | Selected `cell_id`, haversine `distance_km`, method and `mapping_status=assumed` |
| `weather_annual` | cell/scenario/year | Monthly completeness and complete-window precipitation/PET sums in mm |

Mapping method `nearest_same_region_haversine_v1`: use field centroid, restrict to
the farm registry's region, minimise great-circle centre distance using Earth radius
6371.0088 km, break exact ties by `cell_id`. This is an explicit modelling assumption,
not the generator's known true assignment or interpolation. It is static across years.
Mapping lineage includes the parcel and selected cell; the grid file hash and method
identify the candidate set. Rejected candidate cells are not positive lineage parents.

Historical weather is 1991–2026; `ssp126`, `ssp245`, `ssp585` are separate 2027–2060
realisations. Scenario remains part of every weather key. Crop plans end in 2031;
weather beyond that remains available without inventing field crop assignments.

Annual features require 12 accepted unique monthly records. Apr–Sep features require
six accepted months 4–9. Counts are stored as `months_present` and
`apr_sep_months_present`. Incomplete-window sums are NULL, not misleading partial
totals. Apr–Sep is a fixed calendar window, **not crop-specific phenology**.

`field_climate_context` left-joins field/year → static mapping → annual weather by
year. Grain is **field/year/scenario** when weather is available. Future field/year
rows can occur three times, once per SSP. Missing mapping/year yields NULL weather.
Do not sum land area over scenarios or attach all climate years to one crop year.
`annual_precip_mm`, `annual_pet_mm`, `apr_sep_precip_mm`, `apr_sep_pet_mm` are exposure
summaries, not field measurements or nutrient loads.

## ERP source preservation and interpretation

The focused raw-feed import contains `erp_purchase_lines_2021_2025.csv`,
`materials.csv` and `suppliers.csv`. It does not import meters, fuels, refrigerants,
electricity certificates, transport, waste or other corporate emissions feeds.

`erp_purchase` has one row per source CSV record. `purchase_record_id` is source
file hash plus line locator; `(doc_no,line_no)` is a non-unique business key so
potential duplicate records remain inspectable. All 17 original ERP fields remain:
document/line/date, company/plant, material ID/text, supplier ID, quantity/unit,
amount/currency, origin, lot, movement, reference document and WBS.

Additional fields:

| Column | Meaning |
|---|---|
| `year` | Parsed ISO posting-date year, not assumed harvest year |
| `resolved_material_id` | Material FK when known; original `material_id` always retained |
| `resolved_supplier_id` | Commercial supplier FK when known |
| `farm_id` | Supplier ID matches farm registry; a separate relationship from supplier master |
| `quantity_kg` | Quantity for KG; ×1000 for TO; NULL for EUR spend or unknown unit |
| `amount_eur_reference_rate` | `net_amount / units_per_eur` using package reference assumptions |
| `fx_currency` | Nullable FK identifying the reference conversion assumption |

Original quantity, amount and currency remain unchanged. Negative returns (movement
122) stay negative and net against receipts; no absolute value or second sign flip
is applied. Tonnes are legitimate, not automatically unit errors. Spend quantities
are not kilograms. Unknown references or conversions remain explicit and generate
review findings where applicable. Planted but plausible numeric errors remain.

`material` promotes all source material columns; `supplier` promotes all supplier
columns. Their categories, target/PCF status, EUDR/high-impact flags and origin lists
are source context, not independently verified classifications. `supplier.material_id`
is retained as reported, not enforced as an exclusive transaction-material constraint.
The importer does not calculate emissions or reconcile supplier PCFs.

## Explicit sourcing assumptions

`fx_reference_assumption` comes from package `tools/ccn_tools/factors.py:FX_PER_EUR`:
EUR 1.0, SEK 11.4, USD 1.08 units per EUR. The importer reads the assignment using
Python AST without executing package code. These are fixed teaching assumptions,
**not transaction-date market FX**. Their source code hash and interpretation are
recorded. FX-normalised price outliers cannot reliably distinguish currency mistakes
from price/unit/material issues. Raw currency is always available for investigation.

`material_crop_mapping` explicitly follows package `io.py` crop mapping:
M100→turnip_rape, M110→pea, M111→potato, M112→carrot, M113→spinach. This is not fuzzy
matching or an inferred mapping of all materials. Mapping code sources are hashed.

`farm_crop_purchases` aggregates accepted ERP records by matched farm/crop/posting
year **before** joining farming. `reported_net_quantity_kg` is signed source mass;
`records_without_mass_conversion` discloses unavailable conversions. Suspected
duplicates/outliers are retained. Do not call these corrected or verified totals.

`field_sourcing_context` adds `reported_purchase_support` and
`matching_purchase_record_count` to field/year rows without copying farm-wide delivery
mass onto every field. The support labels are `no_matching_purchase`,
`positive_reported_net_purchase`, `purchase_present_without_positive_net_mass`.
Repeated purchase counts are contextual and not additive over fields.

ERP years cover 2021–2025 only. No matching purchase in 2012–2020, 2026 or future
plans cannot establish absence of sourcing. Swedish pre-acquisition deliveries
are not represented by this ERP import. Posting year may differ from harvest year.
Positive reported support does not validate the planted raw values or prove a legal
contract. The original static provisional crop-selection flag is not overwritten.

Country/commodity nature indicators remain separate: no unreviewed mapping of their
broad labels to individual ERP materials has been invented.

## What remains to reach Track D estimates

Choose and document an estimation policy for missing nutrient inputs, model field
P/N losses, delivery to water and catchment retention, then calibrate/evaluate with
the supplied monitoring and separate development answers. Preserve uncertainty,
scenario and method version throughout. Current weather and sourcing context alone
do not produce scientifically validated nutrient loads or biodiversity impacts.
