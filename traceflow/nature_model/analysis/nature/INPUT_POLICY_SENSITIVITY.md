# Input-policy sensitivity — provisional 2025 experiment

Executable policy **0.2.0**, review state **provisional_unreviewed**. This
experiment turns the open input questions into explicit, reproducible alternatives.
It does not approve those alternatives or estimate nutrients delivered to water.

The primary scope remains 2,410 declared, registry-selected fields / **12,926.27 ha**.
Including unknown registry lists gives 2,899 fields / **15,465.21 ha**, an additional
489 fields / 2,538.94 ha. Neither scope is confirmed annual contract coverage.
ERP absence/returns do not change membership.

| Input | Reported-only available ha (%) | Same-country peers ha (%) | With SE pea proxy ha (%) |
|---|---:|---:|---:|
| P application | 5,795.06 (44.83%) | 7,953.17 (61.53%) | 12,926.27 (100%) |
| Harvested yield | 5,795.06 (44.83%) | 7,953.17 (61.53%) | 12,926.27 (100%) |
| Latest static soil P | 10,737.93 (83.07%) | 12,873.71 (99.59%) | 12,873.71 (99.59%) |
| Applied-N candidate | 10,768.16 (83.30%) | 12,926.27 (100%) | 12,926.27 (100%) |

“Available” means numerically present and not blocked by sign/yield checks. It
does not mean scientifically eligible or approved. Applied-N candidates combine
FI mineral/manure components and alias the SE application rate with an explicit
unverified-interpretation label. They are neither N surplus nor nutrient loss.

Same-country peers supply provisional P/yield values for the 2,158.11 ha lacking
Finnish reports. Filling the remaining 4,973.10 ha uses Finnish pea reports as
a **cross-country proxy**, which has no Swedish P/yield validation target. All
7,131.21 ha filled in that variant remain explicitly estimated. Soil P remains
unavailable on **10 selected fields / 52.56 ha** because their compatible donor
pools are too small. Estimated N components affect 398 selected fields /
2,158.11 ha and remain linked from the derived N candidates.

Scope uncertainty matters: under the population including unknown registry lists,
P coverage is **37.47% / 51.43% / 83.58%** for the three variants. None silently
fills other crops from pea values. Mapped hectares are preserved as denominators
even when candidates remain unavailable.

The area-weighted available P rate changes from **14.63 to 14.58 to 13.42 kg P/ha**.
These means describe different covered populations. They are not whole-population
rates, physical field losses or kg reaching water. Source/report area discrepancies
affect **246.22 ha** of available P in each variant; the values remain unchanged.
Under country peers, **3,655.91 ha** of available P has some open field-scoped
quality finding, including missingness. These flags overlap and are not confirmed
bad records or input-specific error counts.

Estimates use at least eight distinct reports in the same country/crop/year,
excluding the target farm; static soil tests instead match country/catchment/map
class and exclude the target farm. Donor median and 10th/90th-percentile spread
are retained with every donor's source evidence. No future-year report, replicated
field label, hidden development answer, zero filling or automatic outlier deletion
enters the estimates.

Leave-farm-out consistency checks against observed FI pea P reports cover
**84 reports**, with mean absolute error **1.89 kg P/ha** and donor-spread coverage
**78.57%**. Other crop results are in the evaluation CSV. This tests agreement
with self-reports, not missing-case accuracy, physical truth or transfer to Sweden.
Donor spread is not a calibrated prediction interval. There is no independent
annual soil-test target in the supplied data.

For P/N model development, use the country-peer case as a provisional comparison
baseline and retain the SE proxy as an explicit sensitivity case. Any downstream
model requiring unavailable inputs must preserve unknown outputs or state and
evaluate an additional treatment. Before decision use, confirm annual scope and
SE N semantics, validate/replace the cross-country proxy, review soil alternatives
and quantify applicability/nonresponse uncertainty. Scientific approval remains
open; real reviews still require P0 preservation.

Reproduce from the model folder:

```bash
python3 tools/check_environment.py --verify-existing
python3 tools/build_nutrient_inputs.py --year 2025
```

The new run contains 60,879 field/input/variant records, 16,355 copied evidence
entities and 15,708 raw source records. The base is opened read-only; existing runs
are refused rather than overwritten. Inputs, component dependencies, donor/target
quality evidence and raw ancestry stay in the local `inputs.sqlite`. The
[policy](../../model/nature/NUTRIENT_MODEL_INPUT_POLICY.md) specifies units,
missingness, uncertainty and provenance. Tracked outputs are small snapshots:
[sensitivity](nutrient_policy_sensitivity.csv),
[peer evaluation](nutrient_peer_evaluation.csv), and
[artifact validation](nutrient_policy_validation.json).
