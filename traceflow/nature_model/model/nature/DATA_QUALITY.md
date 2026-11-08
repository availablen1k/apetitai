# Data quality: evidence, review and corrections

Quality findings are **investigation candidates**. A missing value is not a measured
zero, and an outlier is not automatically an error. No detector changes source
values or excludes plausible observations from reported totals.

## Capture before acceptance

The build first writes `analysis/nature/sources.sqlite`, a separate source archive.
It captures every selected CSV record and GeoJSON feature, retaining duplicate
business keys. File content hashes identify versions. A complete file version is
committed before modelling begins, so typed-model failures cannot erase its source.
Earlier versions remain in this archive when source contents change.

`nature.sqlite` is a rebuilt analytical snapshot. Duplicate natural keys or invalid
typed records are retained in its source tables, linked to a finding, and listed
in `quarantine_record`. The first accepted record in file order owns a unique
modeled key; subsequent conflicting records are not silently merged. Rejection
can cascade where dependent references cannot resolve. This is a deterministic
ingestion policy, not an expert-approved correction. Fatal build failures still
leave the previous analytical database and the independent source archive intact.

ERP rows use technical file/line identities, so repeated ERP business keys can
coexist in the typed table and remain visible in raw reported totals. Do not
interpret those totals as a cleaned procurement inventory.

## Rule catalogue, version 1.0

The database `quality_rule` stores descriptions, severity, issue type, version and
parameters. These rules are not calibrated confidence models or the official
hidden challenge labels. Absence of a finding does not establish correctness.

| Rule ID | Test and population | Interpretation / legitimate alternatives |
|---|---|---|
| `ingest_rejection` | Typed conversion, reference or constraint failure | Inspect source; record remains archived |
| `duplicate_key` | Natural key collides with an accepted domain row | Later row quarantined; reconciliation required |
| `missing_management` | No exact report for declared, provisionally selected farm/crop/year | Reporting gap, not zero activity; future plans excluded |
| `missing_soil_p` | Parcel latest P test is NULL | One static finding per field, scoped to its field-years |
| `area_difference` | Absolute reported vs mapped crop area difference / mapped area > 5% | One finding per report; boundary/reporting differences possible |
| `peer_outlier` | At least 8 comparable reports; deviation > 6 × 1.4826 × MAD from median | Peers are country/crop/year. Check yield, N components/total, P and diesel. MAD zero produces no outlier finding |
| `temporal_change` | Positive yield differs more than factor 3 from the preceding consecutive calendar year on same farm/crop | Weather/crop failure can be real; gaps are not treated as consecutive years |
| `negative_management` | Negative N/P/diesel/lime/spray rate or nonpositive harvested yield | Check interpretation/sign; no automatic repair |
| `climate_month_gap` | Fewer than 12 accepted monthly records in an existing grid/scenario/year group | Annual features NULL; Apr–Sep features independently require six months |
| `climate_value` | Negative precipitation/PET or hot-day count outside calendar bounds | Inspect values; no weather correction |
| `climate_mapping_missing` | No same-region climate grid candidate | No invented exposure |
| `climate_mapping_distance` | Assumed grid centre farther than 25 km | Mapping review threshold, not a scientific accuracy bound |
| `erp_business_duplicate` | Repeated document/line, or identical same-day receipt signature | Signature: date, supplier, material, quantity, unit, amount, currency, movement. Legitimate repeated deliveries remain possible |
| `erp_unknown_reference` | Material or supplier/farm cannot resolve | Retain original IDs; resolved keys NULL |
| `erp_unsupported_unit_currency` | Unit outside KG/TO/EUR or currency lacks package reference factor | Converted measure NULL; no guessed conversion |
| `erp_sign_review` | Positive quantity/amount on return 122, or negative quantity/amount on receipt 101 | Negative signed returns are legitimate and net normally |
| `erp_price_outlier` | At least 8 material/year positive receipts; reference EUR/kg price ratio below 0.25 or above 4 × median | Candidate unit, currency, decimal or material issue; fixed FX assumptions also affect comparison |
| `erp_material_text` | Source material text differs from master text after trimming | A description variant can be legitimate; aliases not curated |
| `master_reference_unresolved` | Material factor/site or ERP plant cannot resolve | FARM is an explicit method, not a missing factor; reported IDs remain |
| `farm_coordinate_review` | Farm centre falls outside heuristic FI/SE review box | Possible coordinate issue; no automatic repair; not a polygon check |
| `scenario_proxy_unresolved` | Transition physical proxy absent from imported weather scenarios | No proxy substitution or scenario-equivalence claim |
| `draft_total_mismatch` | Draft total differs from its own S1 + market S2 + S3 sum | Original components and total retained |

Peer outliers and temporal changes are exploratory. They are not agricultural
thresholds obtained from an external scientific reference. The thresholds are
versioned investigation policies selected for this prototype.

`climate_month_gap` covers incomplete groups that exist in the source. It does not
generate a full expected grid/scenario/calendar to detect an entirely absent year.
The model does not yet detect missing energy-meter months, wrong refrigerants or
GoO mismatches: those feeds and operating-period/equipment rules are not imported.

See the [decision-context guide](DECISION_CONTEXT.md) for the added master/scenario
rules and interpretation. Action-screening candidates are a separate table:
possible assessment leads, not data-quality errors or approved interventions.

## Finding and evidence contract

`quality_finding` records the rule/version, target entity or raw record, expected
key for an absent record, year, field, observed/expected JSON and explanation.
`quality_evidence` links relevant source or modeled records and their roles.
Peer comparisons retain all reference peers; area checks retain crop-group evidence.
These links support backward and forward lineage without claiming causality.

`quality_scope` identifies field/year/catchment contexts affected by a finding.
Farm reports and farm purchases can affect multiple fields or catchments. Counts
must use distinct finding IDs; summing scoped field rows inflates finding counts.
An absence finding can have no target entity but still carry declared-field evidence.
Static soil-P findings have a NULL finding year and separate annual scopes.
Climate month/value findings currently remain grid/scenario-level findings in
query 07. Propagation of those findings through grid mappings into catchment/year
quality counts is not implemented; mapping-distance/missing-mapping findings can
have field scopes. Query 08 is therefore a scoped investigation summary, not a
complete audit of every upstream issue affecting weather exposure.

## Review workflow

Findings start `unreviewed`. Review is recorded as an append-only row in
`quality_review`, with named reviewer, UTC time, note and status (`confirmed`,
`dismissed`, `needs_investigation`). The latest review ID determines current status
in `quality_finding_context`. Current detectors do not approve their own findings.

Example for an expert using their SQLite client (bind actual values):

```sql
INSERT INTO quality_review(finding_id,status,reviewer,reviewed_at_utc,note)
VALUES(:finding_id,:status,:reviewer,:utc_timestamp,:evidence_backed_note);
```

`correction_proposal` stores original/proposed JSON values, field, reason, proposer,
time, status and reviewer. Approval metadata is required for approved/rejected
proposals. **There is no correction-application engine yet**: approvals do not
rewrite raw or modeled values. Implement an explicit approved-corrections view
or new model version before using corrected values in decisions.

The prototype records review/proposal tables but does not enforce append-only
permissions against a user with direct SQLite write access. Preserve the database
before a rebuild: reviews, proposals and saved runs are not automatically migrated
to the newly built analytical snapshot. The source archive does preserve versions.

## Useful investigations

```bash
python3 tools/query_nature_model.py query 07_quality_findings --params '{"year":2025,"rule_id":"peer_outlier","limit":25}'
python3 tools/query_nature_model.py query 06_area_discrepancies --params '{"year":2025}'
python3 tools/query_nature_model.py query 08_catchment_quality --params '{"year":2025,"catchment_id":"CA28"}'
```

Query 07 includes static findings when a year is selected. Query 08 uses actual
field-year scopes and excludes dismissed findings. Neither is a catchment pollution
ranking. Read the [query contracts](API_QUERY_CONTRACTS.md) before aggregating results.
