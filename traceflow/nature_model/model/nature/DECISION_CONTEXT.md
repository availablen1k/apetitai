# From connected data to defensible nature decisions

The purpose of this model is to help identify **which farming areas Apetit should
prioritise for water and biodiversity assessment**, explain the evidence and data
gaps, and connect those areas to possible actions. Completing more themes supports
that decision; it is not a claim that imports alone produce a valid impact model.

This extension follows three steps: complete master references, retain framework
and method evidence, then connect scenarios and action context. All source years
are preserved. The default build stage is now `decisions`.

## 1. Complete masters without inventing history or calculations

All seven `01_master` CSVs are now imported. Farm columns `lat`, `lon`,
`organic_certified`, `livestock` and `joined_year` are promoted from raw snapshots
to typed nullable columns. The actual package supplies values for every farm.
`organic_certified` is farming certification; it is **not organic/peat soil**.
Land-use screening uses `parcel.soil_class_soilmap`, not certification.

| Table | Key / fields | Interpretation |
|---|---|---|
| `site` | `site_id`; name, country, lat/lon degrees, activity, `in_group_from`, nullable `in_group_to` | Source annual group-boundary context, not precise operating dates |
| `emission_factor` | `ef_id`; name, unit, `kgco2e_per_unit`, FLAG fraction, LUC flag, source type/reference, geography, version, value status, GWP set | Carbon references, not P/N loss factors or biodiversity outcomes |
| `material_factor_resolution` | `material_id`; reported EF, nullable factor FK, resolution status | `library_factor`, `farm_specific_method`, or `unresolved` |
| `material_site_resolution` | `material_id`; reported receiving site, nullable site FK, resolution status | Exact lookup, not fuzzy name matching |
| `erp_site_resolution` | `purchase_record_id`; reported plant, nullable site FK, resolution status | Technical ERP record linked to site context |

`FARM` is an explicit method reference. It resolves without inventing a library
factor or copying the existing mineral-soil calculator value as a universally
valid result. Library units, GWP and synthetic/partner/public value status remain
available for any later calculation. This extension does not calculate emissions.

Source site years such as `2026.0` become integer 2026 only when exactly integral;
blank end years remain NULL. No historical farming or purchase rows are deleted
based on group dates. Structural events retain more precise dated context.

Two additional quality rules are recorded: `master_reference_unresolved` and
`farm_coordinate_review`. The latter uses explicitly heuristic broad country
boxes, not legal boundaries or country polygons. It produces three review leads
in this package and does not swap coordinates. Weather mapping still uses field
centroids, not potentially erroneous farm-centre coordinates.

## 2. Method provenance as well as data lineage

The complete `07_frameworks` source registry (36 entries) and digest are loaded.
Three additional **local package documents** are included: `NATURE_SBTN.md`,
`METHODOLOGY.md` and `SIMULATION_DESIGN.md`. Their source paths begin `../docs/`
relative to the package data directory. This is deliberate, limited to the known
package files—not a generic arbitrary-path ingestion interface.

| Table | Grain / key | Meaning |
|---|---|---|
| `reference_source` | `reference_id` | Original source name, URL, licence and intended use; status `not_fetched_or_verified` |
| `evidence_document` | `document_id` | Full local text, title, path, source file identity; package-provided status |
| `evidence_section` | `section_id` | Heading, level, exact start/end lines and text within one document |
| `method_context` | `method_id` | Purpose, implementation status, interpretation and unreviewed status |
| `method_evidence` | `evidence_id` | Explicit method/section/reference link, evidence role and explanatory note |
| `model_method_link` | table/method | Which modeled entities the explanation applies to; it is not per-cell causal proof |

Section splitting follows each Markdown heading, preserving exact text and line
ranges. Full documents remain available, including surrounding context. Raw source
capture stores the full document; the model additionally stores exact line-range
slices. A section's locator therefore resolves against the archived full text even
when that slice is not a separate archive record.

[knowledge_map.json](knowledge_map.json) is the versioned, curated mapping between
methods and evidence. Examples:

- Annual joins have package data descriptions as evidence.
- Nearest-grid mapping is an **implemented assumption**. Spatial context documents
  do not prove that nearest-centre assignment is the correct weather exposure.
- Quality thresholds are prototype heuristics, not claimed SBTN requirements.
- The challenge's pressure × state formula is retained as a **planned, not yet
  implemented** method requiring delivered P/N loads.
- Nature actions are **screening only**; their field predicates are not validated
  SBTN target-setting or restoration methods.

URLs and licence statements are retained as provided. No external standard, PDF
or website is downloaded, verified or redistributed. The digest's reported dates
and rules remain package claims; they are not independent legal or standards advice.
Method references support expert examination, not automatic certification.

Saved-result lineage exports now include `method_context`: applicable methods,
roles, local text/line ranges/document hashes and any unfetched source pointers.
Computational record ancestry and explanatory evidence are kept distinguishable.

## 3. Scenario and action sources, all records retained

| Table | Rows | Grain / key | Interpretation |
|---|---:|---|---|
| `action_lever` | 30 | `lever_id` | Design estimates, costs, stated co-benefits and trade-offs |
| `structural_event` | 12 | `event_id` derived from date + event text | Dated package context; source claim retained |
| `transition_scenario` | 49 | scenario/year | Illustrative transition parameters and explicit physical proxy |
| `contract_price` | 54 | year/item | Contract prices and replacement premiums, 2018–2026 |
| `published_inventory` | 5 | year | Reported history, 2019–2024 with gaps; original and restated Scope 3 kept separately |
| `draft_report_line` | 4 | year/line | Preliminary 2025 report figures, including inconsistencies |
| `price_crop_mapping` | 6 | item | Explicit teaching-label mapping to crop/country; no fuzzy commodity mapping |

### All scenario columns and units

- `scenario`, `ngfs_category`, `narrative`, `year`, `physical_pathway_proxy`: source
  identity and context. The proxy points to SSP weather, not scenario equivalence.
- `carbon_price_eur_t`, `eu_ets2_fuel_price_eur_t`: reference EUR/tCO2 prices.
- `electricity_price_eur_mwh`: reference EUR/MWh.
- `n_fertiliser_price_index`, `diesel_price_index`, `plant_based_demand_index`:
  dimensionless source indices, baseline 2025=1.
- `frozen_veg_import_premium_pct`: percent, distinct from the contract-price table's
  `replacement_import_premium_frac` fraction.
- `value_status`: original illustrative-value caveat, retained in query output.

Only the seven supplied year points per transition scenario are stored; missing
intermediate years produce no economic scenario row. No interpolation, discounting
or causal cost/impact model is applied. Weather can exist for years without an
economic scenario record. Sharing an SSP proxy does not make transition pathways
interchangeable.

### Price, events and reporting context

`contract_price` fields are `year,item,contract_price_eur_t` (EUR/t),
`replacement_import_premium_frac` (fraction), `note`. `pea_SE` explicitly maps to
pea/SE; the five unqualified crop labels map to FI. These are contextual package
prices, not forecasts after 2026 or field-level water-action costs.

`structural_event` fields are `event_id,date,event,type,relevance,source`.
Dates are validated ISO dates. Acquisition and site-year context do not remove
Swedish historical reports or apply inventory-boundary logic to nature records.

`published_inventory` keeps `year,scope1,scope2_market,scope3,scope3_restated,note`;
emissions are tCO2e, missing restatements remain NULL. `draft_report_line` keeps
`year,line,tco2e,status`. Published history, synthetic activity and preliminary
reports are separate datasets, not substitutes for one another.

The new `draft_total_mismatch` rule flags the draft total's disagreement with its
own S1 + market S2 + S3 component sum. It retains the original numbers and component
evidence; it does not infer which component or total should be corrected.
`scenario_proxy_unresolved` flags a physical proxy with no imported weather scenario.

## 4. Field-based action screening—not a pollution priority ranking

The full lever catalogue remains queryable, while five explicit rules connect
field evidence to potentially relevant nature actions. They are defined in
[action_screening_rules.json](action_screening_rules.json), hashed with the build.

| Lever | Field predicate | What remains unknown |
|---|---|---|
| L09 soil testing / precision nutrients | Latest field soil-P test is missing | Current sampling coverage and suitable nutrient-management design |
| L10 catch crops | Pea/spinach field, no recorded catch crop | Agronomic feasibility and actual adoption opportunity |
| L11 organic-soil sourcing review | Soil map says organic | Verified soil, grower agreement and alternative land/sourcing |
| L12 retired-peat pilot review | Soil map says organic | **Retirement is not established**; hydrology, suitability and expert water assessment are prerequisites |
| L24 water-management review | Carrot or potato | Irrigation status, water availability, local needs and a suitable intervention |

Only provisionally selected contract-crop field-years are screened. Both declared
and planned source records are retained; query callers select the desired status.
Unknown static contract lists can exclude fields from this selection, so lack of a
candidate is not proof that no nature action is relevant. Static/latest attributes
are assumed context across years. The rules are intentionally limited leads, not
an exhaustive agricultural recommendation system.

`nature_action_rule` stores one active versioned rule per selected lever: ID,
version, lever, predicate, description, prerequisites and `efficacy_status`.
`nature_action_candidate` stores field/year/lever, rule/version, reason and
`review_status=unreviewed`. Each candidate traces to its field/year and rule, then
the parcel/catchment, raw inputs and original lever catalogue record.

All efficacy statuses are **`not_quantified`**. There are no inferred P/N savings,
biodiversity units, eligibility approvals or nutrient-cost ratios. Earlier catalogue
start year is only a planning-time check, not proof of readiness or feasibility.
Action approval and implementation are not performed by the prototype.

Lever fields retain their exact meaning: `scope`, FLAG boolean, `lever_type`,
`abatement_tco2e_2030_design` (tCO2e design estimate), programme `capex_eur`,
`opex_delta_eur_per_yr` (negative can mean saving), `lifetime_yr`, `earliest_start`,
`ramp_years`, qualitative `confidence`, `co_benefits`, `trade_offs`,
`indicative_cost_eur_per_tco2e` and `value_status`. These costs are **not per field
or per catchment**; do not multiply or sum them across candidate rows. L27 remains
a measurement improvement with zero design abatement, not a real reduction action.

## 5. A decision-oriented exploration workflow

```bash
# Establish evidence coverage and unresolved input concerns.
python3 tools/query_nature_model.py query 05_farming_coverage --params '{"year":2025}'
python3 tools/query_nature_model.py query 08_catchment_quality --params '{"year":2025,"catchment_id":"CA28"}'

# Examine action leads and their catalogue constraints independently of costs.
python3 tools/query_nature_model.py query 18_nature_action_opportunities --params '{"year":2025,"planning_year":2027,"catchment_id":"CA28"}'
python3 tools/query_nature_model.py query 21_action_details --params '{"lever_id":"L12"}'

# Explain the relevant method, including what has not been implemented.
python3 tools/query_nature_model.py query 16_method_evidence --params '{"method_id":"nature_pressure_state"}'
```

Query 18's areas are action-specific screening hectares. The same field can match
more than one action; do not sum them across levers or years as unique land area.
Ordering is by catchment/action identity, not priority. Receiving-water status and
P sensitivity are context; a large candidate area is not a large measured load.

The next substantive scientific step remains: choose a policy for missing nutrient
inputs, estimate field P/N losses and delivery/retention, and calibrate/evaluate
against monitoring plus separately handled development answers. Then estimate
action efficacy and local costs, retain uncertainty, and ask an expert to assess
which farming areas and actions should actually be prioritised.
