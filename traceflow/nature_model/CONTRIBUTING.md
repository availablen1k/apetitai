# Team workflow

Focus changes on a defensible water/biodiversity decision. Tools use Python stdlib
and SQLite, without dependency installation. Scientific assumptions need explicit
ownership and expert assessment.

## Before editing

1. Read status/roadmap and the relevant model docs.
2. Run preflight; identify your source version and local DB.
3. Snapshot important review/proposal/query state before rebuilding.
4. Run appropriate existing tests before interpreting failures as your changes.
5. Agree on the question, output grain, units and acceptance criteria.

## Add/change a query

- Define question and stable result key/grain first.
- Add catalogue parameters/defaults/types and explicit NULL handling.
- Bind values; never concatenate user text into SQL.
- Add contributor SQL with matching filters. Saved lineage covers the returned page.
- Document units, denominators, rounding, ordering and pagination.
- Check fanout: aggregate purchases/monitoring before attaching to fields.
- Keep year/scenario and declared/planned distinctions.
- Add a meaningful conservation, missingness or evidence-path test.
- Regenerate snapshots and explain changed results in the PR.

## Add a source/model/transformation

- Capture raw records/version before typed import.
- Define keys, relationships, units, temporal meaning and missingness.
- Specify first-accepted/quarantine behaviour; no silent correction/deduplication.
- Register column lineage and relevant method/evidence context.
- Include source/config/code hashes and validation.
- Update dictionary, architecture, status and coverage docs.
- For estimates, document version, uncertainty and evaluation.

Do not use development answer keys as unlabeled features or unfetched framework
pointers as verified requirements. Do not convert programme costs/CO2e into
per-field water or biodiversity benefits without a separate defensible method.

## Checks

```bash
python3 -m unittest discover -s tools -p 'test_*.py'

# Focused examples while changing one area:
python3 -m unittest discover -s tools -p 'test_nature_quality.py'
python3 -m unittest discover -s tools -p 'test_nature_scenarios.py'
python3 -m unittest discover -s tools -p 'test_handover_package.py'
```

Full integration tests require the challenge package and build temporary outputs.
They do not change original inputs or the shared local DB. Broaden/repeat tests
when changes, failures or unresolved concerns justify it.

## Git and PRs

Use the team's feature-branch/PR workflow. Commit code, SQL, config, tests, docs
and small reports. Do not commit database binaries, compressed snapshots/manifests,
source archives, sidecars, backups, credentials or large derived field CSVs.
Teammates rebuild locally using the tracked instructions and challenge dataset.

Describe the concrete problem/result, source/assumption/unit changes, relevant
checks, changed query outputs, limits and remaining roadmap items. Update
[STATUS](STATUS.md) and [ROADMAP](ROADMAP.md) when work is actually complete.

A data import is not a validated impact model; a screening lead is not an approved
intervention. Preserve that distinction in code, documents and demos.
