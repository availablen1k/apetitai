"""Build an immutable, provisional nutrient-input experiment from a read-only base DB."""
import argparse
import csv
import hashlib
import json
import math
import sqlite3
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from uuid import uuid4

from check_environment import check
from paths import ROOT, DATA, code_reference

MODEL = ROOT / 'model/nature'
POLICY = MODEL / 'nutrient_input_policy.json'
BASE_INPUTS = ('p_kg_ha', 'n_mineral_kg_ha', 'n_manure_kg_ha',
               'n_applied_kg_ha', 'yield_t_ha', 'p_test_mgl_latest')
TOTAL_N = 'n_total_candidate_kg_ha'


def packed(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def entity(table, key):
    # Base entity IDs use compact JSON with the supplied key order.
    return table + ':' + json.dumps(key, ensure_ascii=False, separators=(',', ':'))


def valid(value, name):
    return value is not None and math.isfinite(value) and (value > 0 if name == 'yield_t_ha' else value >= 0)


def quantile(values, fraction):
    """Linear interpolation between ordered values at index (n-1)*fraction."""
    ordered = sorted(values)
    index = (len(ordered)-1)*fraction
    low = int(index)
    high = min(low+1, len(ordered)-1)
    return ordered[low] + (ordered[high]-ordered[low])*(index-low)


class PeerPools:
    def __init__(self, reports, parcels, policy, flagged_entities):
        self.policy = policy
        self.groups = defaultdict(list)
        self.cache = {}
        for report in reports:
            for name in BASE_INPUTS[:-1]:
                if valid(report[name], name):
                    key = (name, report['country'], report['crop'], report['year'])
                    eid = entity('farm_crop_observation', [report['observation_id']])
                    self.groups[key].append((report['farm_id'], report[name], eid, eid in flagged_entities))
        for parcel in parcels:
            name = 'p_test_mgl_latest'
            if valid(parcel[name], name):
                key = (name, parcel['country'], parcel['catchment_id'], parcel['soil_class_soilmap'])
                eid = entity('parcel', [parcel['parcel_id']])
                self.groups[key].append((parcel['farm_id'], parcel[name], eid, eid in flagged_entities))

    def estimate(self, row, name, proxy=False):
        country = self.policy['proxy']['donor_country'] if proxy else row['country']
        key = ((name, country, row['catchment_id'], row['soil_class_soilmap'])
               if name == 'p_test_mgl_latest' else (name, country, row['crop'], row['year']))
        cache_key = (key, row['farm_id'])
        if cache_key not in self.cache:
            donors = [d for d in self.groups[key] if d[0] != row['farm_id']]
            if len(donors) < self.policy['minimum_donors']:
                self.cache[cache_key] = None
            else:
                values = [d[1] for d in donors]
                qlow, qhigh = self.policy['quantiles']
                self.cache[cache_key] = dict(value=median(values), lower_value=quantile(values, qlow),
                    upper_value=quantile(values, qhigh), donors=[d[2] for d in donors],
                    donor_quality_flagged_count=sum(d[3] for d in donors))
        return self.cache[cache_key]


def prepare(source, year, policy):
    """Calculate in memory; never apply corrections, approve inputs, or write to source."""
    rows = [dict(r) for r in source.execute('''SELECT n.*
        FROM nutrient_input_context n
        WHERE n.year=? AND n.crop_status='declared'
          AND n.contract_selection_status IN ('selected','unknown_contract_list')
        ORDER BY n.parcel_id,n.input_name''', (year,))]
    if not rows:
        raise ValueError('No declared fields in the requested year and scope; future plans are not actuals')
    reports = [dict(r) for r in source.execute('''SELECT o.*,f.country
        FROM farm_crop_observation o JOIN farm f USING(farm_id) WHERE o.year=?''', (year,))]
    parcels = [dict(r) for r in source.execute('''SELECT p.*,f.country
        FROM parcel p JOIN farm f USING(farm_id)''')]
    open_findings = [dict(r) for r in source.execute("SELECT * FROM quality_finding_context WHERE review_status!='dismissed'")]
    open_ids = {r['finding_id'] for r in open_findings}
    flagged = {r['entity_id'] for r in open_findings}
    entity_findings = defaultdict(set)
    for r in open_findings:
        if r['entity_id']:
            entity_findings[r['entity_id']].add(r['finding_id'])
    for r in source.execute('SELECT * FROM quality_evidence'):
        if r['finding_id'] in open_ids:
            flagged.add(r['entity_id'])
            if r['entity_id']:
                entity_findings[r['entity_id']].add(r['finding_id'])
    scoped_findings = defaultdict(set)
    for r in source.execute('SELECT * FROM quality_scope WHERE year=?', (year,)):
        if r['finding_id'] in open_ids:
            scoped_findings[r['parcel_id']].add(r['finding_id'])
    pools = PeerPools(reports, parcels, policy, flagged)
    fields = {}
    values, evidence, dependencies = [], set(), set()
    for row in rows:
        fields[row['parcel_id']] = dict(parcel_id=row['parcel_id'], year=year, farm_id=row['farm_id'],
            catchment_id=row['catchment_id'], country=row['country'], crop=row['crop'],
            selection_status=row['contract_selection_status'], area_ha=row['area_ha'],
            area_discrepancy=row['area_difference_over_5pct'],
            quality_findings_json=packed(sorted(scoped_findings[row['parcel_id']])))
        for variant in policy['variants']:
            name, original = row['input_name'], row['input_value']
            iid = packed([row['parcel_id'], year, variant, name])
            record = dict(input_id=iid, parcel_id=row['parcel_id'], variant=variant, input_name=name,
                unit=row['unit'], original_value=original, value=original,
                value_kind='unavailable' if original is None else 'observed',
                availability_status=row['availability_status'], use_state='provisional',
                reason='reported_value' if original is not None else row['availability_status'],
                method_version='reported_identity_v1', policy_version=policy['version'],
                review_state=policy['review_state'], uncertainty_kind='measurement_uncertainty_not_quantified',
                lower_value=None, upper_value=None, donor_count=0, donor_quality_flagged_count=0,
                depends_on_estimate=0)
            # A recorded invalid value is retained, not replaced by a plausible peer.
            if original is not None and not valid(original, name):
                record.update(use_state='blocked_invalid', reason='negative_rate_or_nonpositive_yield')
            elif original is None:
                record.update(use_state='blocked_missing', uncertainty_kind='unknown')
                proxy = (variant == 'se_pea_proxy' and row['country'] == policy['proxy']['target_country']
                         and row['crop'] == policy['proxy']['crop'] and name in policy['proxy']['inputs'])
                estimate = pools.estimate(row, name, proxy=proxy) if variant != 'reported_only' else None
                if estimate:
                    record.update({k:v for k,v in estimate.items() if k != 'donors'})
                    record.update(value_kind='estimated', use_state='provisional',
                        reason='cross_country_pea_proxy' if proxy else 'same_country_peer_median',
                        method_version=policy['method_version'], donor_count=len(estimate['donors']),
                        depends_on_estimate=1,
                        uncertainty_kind='donor_q10_q90_spread_not_prediction_interval')
                    for eid in estimate['donors']:
                        evidence.add((iid, eid, 'proxy_donor' if proxy else 'peer_donor'))
                        for fid in entity_findings[eid]:
                            evidence.add((iid,entity('quality_finding',[fid]),'donor_quality_context'))
                elif variant != 'reported_only':
                    record['reason'] = 'insufficient_compatible_donors:' + row['availability_status']
            if name == 'p_test_mgl_latest' and original is not None:
                record['reason'] = 'latest_static_test_date_unknown'
                record['uncertainty_kind'] = 'measurement_and_temporal_uncertainty_not_quantified'
            evidence.add((iid, entity('parcel_crop_year', [row['parcel_id'], year]), 'target_field_year'))
            for fid in scoped_findings[row['parcel_id']]:
                evidence.add((iid, entity('quality_finding', [fid]), 'target_quality_context'))
            values.append(record)
    by_key = {(r['parcel_id'], r['variant'], r['input_name']): r for r in values}
    for parcel_id, field in fields.items():
        for variant in policy['variants']:
            names = ('n_mineral_kg_ha','n_manure_kg_ha') if field['country']=='FI' else ('n_applied_kg_ha',)
            parts = [by_key[parcel_id, variant, name] for name in names]
            complete = all(p['value'] is not None and p['use_state']!='blocked_invalid' for p in parts)
            iid = packed([parcel_id, year, variant, TOTAL_N])
            record = dict(input_id=iid, parcel_id=parcel_id, variant=variant, input_name=TOTAL_N,
                unit='kg N/ha', original_value=None,
                value=sum(p['value'] for p in parts) if complete else None,
                value_kind='derived' if complete else 'unavailable', availability_status='derived_candidate',
                use_state='provisional' if complete else 'blocked_missing_or_invalid_component',
                reason='fi_mineral_plus_manure' if field['country']=='FI' else 'se_rate_total_interpretation_unverified',
                method_version='n_total_candidate_v1', policy_version=policy['version'], review_state=policy['review_state'],
                uncertainty_kind='component_measurement_and_semantic_uncertainty_not_quantified',
                lower_value=None, upper_value=None, donor_count=0, donor_quality_flagged_count=0,
                depends_on_estimate=int(any(p['depends_on_estimate'] for p in parts)))
            for part in parts:
                dependencies.add((iid, part['input_id']))
            values.append(record)
    evaluation = evaluate(reports, pools)
    return fields, values, evidence, dependencies, evaluation


def evaluate(reports, pools):
    """Leave-farm-out self-report consistency check; not validation of truth or SE transfer."""
    groups = defaultdict(list)
    eligible = defaultdict(int)
    for report in reports:
        for name in BASE_INPUTS[:-1]:
            if not valid(report[name], name):
                continue
            key = (report['country'],report['crop'],name)
            eligible[key] += 1
            errors = groups[key]
            estimate = pools.estimate(report, name)
            if estimate:
                observed = report[name]
                errors.append((estimate['value']-observed,
                    estimate['lower_value'] <= observed <= estimate['upper_value']))
    return [dict(country=country,crop=crop,input_name=name,
                 unit='t harvested/ha' if name=='yield_t_ha' else 'kg P/ha' if name=='p_kg_ha' else 'kg N/ha',
                 eligible_report_count=eligible[country,crop,name],report_count=len(errors),
                 mean_absolute_error=sum(abs(e[0]) for e in errors)/len(errors) if errors else None,
                 mean_error=sum(e[0] for e in errors)/len(errors) if errors else None,
                 donor_spread_coverage=sum(e[1] for e in errors)/len(errors) if errors else None,
                 policy_version=pools.policy['version'],method_version=pools.policy['method_version'],
                 evaluation_scope='leave_farm_out_self_report_consistency_not_ground_truth')
            for (country,crop,name),errors in sorted(groups.items())]


def sensitivity(fields, values):
    groups = defaultdict(list)
    for row in values:
        f = fields[row['parcel_id']]
        for scope in ('registry_selected','registry_plus_unknown'):
            if scope == 'registry_selected' and f['selection_status'] != 'selected':
                continue
            groups[scope,row['variant'],row['input_name']].append((row,f))
    result = []
    for (scope,variant,name),group in sorted(groups.items()):
        usable = [(r,f) for r,f in group if r['value'] is not None and r['use_state']=='provisional']
        area = sum(f['area_ha'] for _,f in group)
        covered_area = sum(f['area_ha'] for _,f in usable)
        result.append(dict(scope=scope,variant=variant,input_name=name,field_count=len(group),
            total_area_ha=round(area,6),available_area_ha=round(covered_area,6),
            blocked_area_ha=round(area-covered_area,6),coverage_pct=round(100*covered_area/area,4),
            estimated_area_ha=round(sum(f['area_ha'] for r,f in usable if r['value_kind']=='estimated'),6),
            depends_on_estimate_area_ha=round(sum(f['area_ha'] for r,f in usable if r['depends_on_estimate']),6),
            quality_flagged_available_area_ha=round(sum(f['area_ha'] for r,f in usable if json.loads(f['quality_findings_json'])),6),
            area_discrepancy_available_area_ha=round(sum(f['area_ha'] for r,f in usable if f['area_discrepancy']==1),6),
            area_weighted_available_value=(sum(r['value']*f['area_ha'] for r,f in usable)/covered_area if covered_area else None),
            policy_version=group[0][0]['policy_version'],review_state=group[0][0]['review_state']))
    return result


def insert_rows(db, table, rows):
    if not rows:
        return
    columns = list(rows[0])
    db.executemany(f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
                   [[row[c] for c in columns] for row in rows])


def copy_evidence(source, destination, evidence):
    """Keep recursive source ancestry in the experiment so base rebuilds cannot erase it."""
    ids = {eid for _,eid,_ in evidence}
    edges = [tuple(r) for r in source.execute('SELECT * FROM record_dependency')]
    parents = defaultdict(list)
    for child,parent,_ in edges:
        parents[child].append(parent)
    todo = list(ids)
    while todo:
        for parent in parents[todo.pop()]:
            if parent not in ids:
                ids.add(parent)
                todo.append(parent)
    destination.executemany('INSERT INTO evidence_entity VALUES(?,?,?)',
        [tuple(r) for r in source.execute('SELECT * FROM entity_record') if r['entity_id'] in ids])
    destination.executemany('INSERT INTO evidence_dependency VALUES(?,?,?)',
        [r for r in edges if r[0] in ids])
    links = [tuple(r) for r in source.execute('SELECT * FROM record_source') if r['entity_id'] in ids]
    record_ids = {r[1] for r in links}
    records = [tuple(r) for r in source.execute('SELECT * FROM source_record') if r['source_record_id'] in record_ids]
    source_ids = {r[1] for r in records}
    destination.executemany('INSERT INTO evidence_source VALUES(?,?,?,?,?)',
        [tuple(r) for r in source.execute('SELECT * FROM source_file') if r['source_id'] in source_ids])
    destination.executemany('INSERT INTO evidence_record VALUES(?,?,?,?)', records)
    destination.executemany('INSERT INTO evidence_link VALUES(?,?,?)', links)


def write_csv(path, rows):
    if rows:
        with path.open('w',newline='',encoding='utf-8') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)


def build(database, output, year=2025, data=DATA):
    if type(year) is not int or not 1900 <= year <= 2200:
        raise ValueError('Year must be an integer from 1900 to 2200')
    preflight = check(data,database)
    if not preflight['ready']:
        raise ValueError('Base preflight failed: ' + '; '.join(preflight['failures']))
    # Exclusive directory creation preserves previous experiments and audit state.
    output.mkdir(parents=True,exist_ok=False)
    policy = json.loads(POLICY.read_text())
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)) as source:
        source.row_factory = sqlite3.Row
        source.execute('BEGIN')
        fields,values,evidence,dependencies,evaluation = prepare(source,year,policy)
        summary = sensitivity(fields,values)
        with closing(sqlite3.connect(output/'inputs.sqlite')) as destination, destination:
            destination.executescript((MODEL/'nutrient_inputs.sql').read_text())
            paths = [Path(__file__).resolve(),POLICY,MODEL/'nutrient_inputs.sql',MODEL/'NUTRIENT_MODEL_INPUT_POLICY.md']
            paths += [data/path for path in policy['evidence_documents']]
            hashes = {code_reference(p,data):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
            destination.execute('INSERT INTO input_run VALUES(?,?,?,?,?,?,?,?,?)',
                ('nutrient-inputs:'+uuid4().hex,datetime.now(timezone.utc).isoformat(),year,packed(policy),packed(hashes),
                 packed(dict(source.execute('SELECT * FROM build_run').fetchone())),
                 packed([dict(r) for r in source.execute('SELECT * FROM source_file ORDER BY relative_path')]),
                 packed([dict(r) for r in source.execute('SELECT * FROM quality_review ORDER BY review_id')]),
                 packed([dict(r) for r in source.execute('SELECT * FROM correction_proposal ORDER BY proposal_id')])))
            insert_rows(destination,'field_scope',list(fields.values()))
            insert_rows(destination,'input_value',values)
            copy_evidence(source,destination,evidence)
            destination.executemany('INSERT INTO input_evidence VALUES(?,?,?)',sorted(evidence))
            destination.executemany('INSERT INTO input_dependency VALUES(?,?)',sorted(dependencies))
            destination.executemany('INSERT INTO evidence_column_rule VALUES(?,?,?,?)',
                                    source.execute('SELECT * FROM column_lineage'))
            destination.executemany('INSERT INTO evidence_transformation VALUES(?,?)',
                                    source.execute('SELECT * FROM transformation'))
            destination.executemany('INSERT INTO evidence_method_document VALUES(?,?,?)',
                [(path,hashlib.sha256((data/path).read_bytes()).hexdigest(),(data/path).read_text())
                 for path in policy['evidence_documents']])
            policy_doc = MODEL/'NUTRIENT_MODEL_INPUT_POLICY.md'
            destination.execute('INSERT INTO evidence_method_document VALUES(?,?,?)',
                (code_reference(policy_doc),hashlib.sha256(policy_doc.read_bytes()).hexdigest(),policy_doc.read_text()))
            if destination.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('Input evidence has broken references')
            if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Input artifact integrity check failed')
            no_evidence = destination.execute('''SELECT COUNT(*) FROM input_value v
                WHERE NOT EXISTS(SELECT 1 FROM input_evidence e WHERE e.input_id=v.input_id)
                  AND NOT EXISTS(SELECT 1 FROM input_dependency d WHERE d.child_input_id=v.input_id)''').fetchone()[0]
            if no_evidence:
                raise ValueError('Inputs without evidence')
            if len(values) != len(fields)*len(policy['variants'])*(len(BASE_INPUTS)+1):
                raise ValueError('Incomplete field/input/variant population')
            bad_donor_counts = destination.execute('''SELECT COUNT(*) FROM input_value v
                WHERE v.value_kind='estimated' AND v.donor_count !=
                  (SELECT COUNT(*) FROM input_evidence e WHERE e.input_id=v.input_id
                   AND e.role IN ('peer_donor','proxy_donor'))''').fetchone()[0]
            if bad_donor_counts:
                raise ValueError('Estimate donor counts do not match evidence')
            for row in summary:
                if abs(row['total_area_ha']-row['available_area_ha']-row['blocked_area_ha'])>0.00001:
                    raise ValueError('Input area is not conserved')
            validation = dict(year=year,policy_version=policy['version'],review_state=policy['review_state'],
                fields=len(fields),input_records=len(values),variants=policy['variants'],
                evidence_entities=destination.execute('SELECT COUNT(*) FROM evidence_entity').fetchone()[0],
                raw_evidence_records=destination.execute('SELECT COUNT(*) FROM evidence_record').fetchone()[0],
                foreign_keys='passed',integrity='passed',input_evidence='passed',area_conservation='passed',
                field_input_population='passed',donor_evidence_counts='passed',
                limitations=['Peer spread is not a calibrated prediction interval',
                              'Leave-farm-out checks evaluate self-report consistency, not truth or cross-country transfer',
                              'No approved corrections applied; no nutrient losses calculated'])
        write_csv(output/'sensitivity.csv',summary)
        write_csv(output/'peer_evaluation.csv',evaluation)
        (output/'validation.json').write_text(json.dumps(validation,indent=2)+'\n')
    return validation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,default=ROOT/'analysis/nature/nature.sqlite')
    parser.add_argument('--data-dir',type=Path,default=DATA)
    parser.add_argument('--year',type=int,default=2025)
    parser.add_argument('--output',type=Path)
    args = parser.parse_args()
    output = args.output or ROOT/'analysis/nature/input_runs'/f'{args.year}-{uuid4().hex[:12]}'
    try:
        report = build(args.database,output,args.year,args.data_dir)
    except (ValueError,FileExistsError) as error:
        parser.error(str(error))
    print(json.dumps(dict(output=str(output),**report),indent=2))


if __name__=='__main__':
    main()
