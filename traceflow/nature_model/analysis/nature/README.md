# Generated nature outputs

See the [model guide](../../model/nature/README.md) for build instructions,
dictionary, query catalogue, assumptions and lineage documentation.

`nature.sqlite` is generated locally and ignored by Git. `sources.sqlite` is an
independent source archive retained across analytical rebuilds. The `queries/` CSVs
contain twenty-two saved catalogue outputs; `validation.json` records build checks,
coverage and quality-rule counts.

[Nutrient-input coverage](NUTRIENT_INPUT_COVERAGE.md) summarizes query 22's
2025 baseline, including affected hectares and the unreviewed policy status.
[P1 verification](nutrient_input_verification.json) records the current checks;
`handover_verification.json` retains the earlier packaging verification.

[Input-policy sensitivity](INPUT_POLICY_SENSITIVITY.md) describes the subsequent
provisional 0.2.0 experiment. `nutrient_policy_sensitivity.csv` and
`nutrient_peer_evaluation.csv` are small snapshots from its completed 2025 run;
`nutrient_policy_validation.json` records artifact checks. Reproduce with
`python3 tools/build_nutrient_inputs.py --year 2025`. Full input/evidence SQLite
artifacts remain local in ignored `input_runs/`; earlier runs are not overwritten.

[Nutrient-loss pilot](NUTRIENT_LOSS_PILOT.md) describes the uncalibrated CA01 2025
experiment. `nutrient_loss_pilot_summary.csv` contains grouped scope/policy/donor/
method sensitivity; `nutrient_loss_pilot_fields.csv` is the central country-peer
field subset. `nutrient_loss_pilot_validation.json` records reconciliation and test
checks, not scientific validation. Full SQLite artifacts and contribution CSVs
remain ignored in `loss_runs/`; reproduce using `tools/build_nutrient_losses.py`
with a matching input run. Values in these outputs are unvalidated estimates.

Database binaries and compressed snapshots are not included in Git. From the
model folder run `python3 tools/build_nature_model.py` after cloning to create
`nature.sqlite` and `sources.sqlite` locally. Optional local compressed exports
and their manifests are ignored too.

Blank CSV cells mean SQL NULL. These results describe synthetic data and provisional
selection; they are not pollution estimates, final priority ranks or actual Apetit impacts.

The database retains all farming years: crop assignments 2012–2031, management
observations 2012–2026 (Sweden starts in 2018), and existing Finnish calculator
footprints 2012–2026. Use `field_context` and a `WHERE year = ...` filter for mining.
The existing query CSVs remain focused examples, including the explicit 2025 filters.

Monthly climate observations cover 1991–2060 with scenarios retained. The focused
ERP import covers all supplied 2021–2025 records, materials and suppliers. See the
[query contracts](../../model/nature/API_QUERY_CONTRACTS.md) for filters and the
[quality guide](../../model/nature/DATA_QUALITY.md) for investigation findings.

All master CSVs, scenario CSVs and framework sources are now included. The
[decision-context guide](../../model/nature/DECISION_CONTEXT.md) explains source
references, scenario assumptions and field-based leads for five nature actions.
These are unreviewed screening results, not nutrient estimates or priority ranks.
