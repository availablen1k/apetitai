# Nutrient-input coverage — 2025 build snapshot

Population: **2,410 declared, provisionally selected fields / 12,926.27 mapped ha**.
Synthetic challenge data; static registry selection is not confirmed annual
contract scope. Coverage classification uses draft policy **0.1.0**, unreviewed.

| Input | Reported ha, including zeros | Missing report ha | Schema omission ha | Missing value ha |
|---|---:|---:|---:|---:|
| P application | 5,795.06 | 2,158.11 | 4,973.10 | 0.00 |
| Mineral N | 5,795.06 | 2,158.11 | 4,973.10 | 0.00 |
| Manure N | 5,795.06 | 2,158.11 | 4,973.10 | 0.00 |
| Reported N application rate | 4,973.10 | 0.00 | 7,953.17 | 0.00 |
| Harvested yield | 5,795.06 | 2,158.11 | 4,973.10 | 0.00 |
| Latest static soil P | 10,737.93 | 0.00 | 0.00 | 2,188.34 |

Each row partitions the same mapped area; areas across inputs overlap. Present
values are not reviewed scientific inputs. The N application row describes the
Swedish rate: no Finnish total has been manufactured by adding components. Schema
omission takes precedence over report absence; inspect report gaps separately.

P application is unavailable over **7,131.21 ha**, comprising 398 fields without
Finnish reports and 920 Swedish fields whose reporting schema omits P. Missing
soil-P tests affect **408 fields / 2,188.34 ha**; this area overlaps other gaps.

Reported zeros are retained: manure N is zero across 1,050 fields / 5,558.94 ha;
mineral N across 39 fields / 221.43 ha; Swedish N application across 59 fields /
373.13 ha. These are source values, not filled gaps or approvals.

The next policy decisions concern annual scope, missing Finnish reports, Swedish
P/manure/yield evidence and treatment of static soil P. Inspect quality findings
before deciding whether present values can support estimates. A field can have
several issues, and a positive measurement can remain questionable.

Reproduce the detailed catchment/country/crop/input/status breakdown from the
model folder:

```bash
python3 tools/query_nature_model.py query 22_nutrient_input_readiness --params '{"year":2025}'
```

For this table, group those result rows by `input_name` and
`availability_status`, summing `field_count` and `mapped_area_ha` once per input.
The full detail is in [the query CSV](queries/22_nutrient_input_readiness.csv).
Field-level values are in `nutrient_input_context`; the
[policy](../../model/nature/NUTRIENT_INPUT_POLICY.md) and
[query contract](../../model/nature/API_QUERY_CONTRACTS.md) define precedence,
units, scope and limitations. [Verification](nutrient_input_verification.json)
records the checks for this increment. Nutrient loads, uncertainty and sensitivity
to alternative missing-data treatments remain unfinished.
