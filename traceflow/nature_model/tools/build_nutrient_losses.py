"""Uncalibrated catchment pilot: separate field loss, distance delivery and retention."""
import argparse
import hashlib
import json
import math
import sqlite3
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from build_nutrient_inputs import entity, insert_rows, packed, write_csv
from check_environment import check
from paths import ROOT, DATA, code_reference

MODEL = ROOT/'model/nature'
CONFIG = MODEL/'nutrient_loss_model.json'
CROPS = {'pea','wheat','barley','grass_ley','oats','fallow','spinach','potato','carrot','turnip_rape'}
SOILS = {'clay','fine_sand','silt','sand','organic'}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            digest.update(chunk)
    return digest.hexdigest()


def finite(value, minimum=None, maximum=None):
    return (isinstance(value,(int,float)) and math.isfinite(value)
            and (minimum is None or value>=minimum) and (maximum is None or value<=maximum))


def input_point(input_id, values, dependencies, point, seen=None):
    """Stress estimated components; an observed input's unknown error is not invented."""
    seen = set() if seen is None else seen
    if input_id in seen:
        raise ValueError('Cyclic input dependencies')
    row = values[input_id]
    if row['use_state']!='provisional' or row['value'] is None:
        return None
    if row['value_kind']=='derived':
        parents = dependencies.get(input_id,[])
        if not parents:
            raise ValueError('Derived input has no components')
        parts = [input_point(parent,values,dependencies,point,seen|{input_id}) for parent in parents]
        return None if any(p is None for p in parts) else sum(parts)
    key = ('lower_value' if point=='donor_lower' else 'upper_value') if row['value_kind']=='estimated' and point!='central' else 'value'
    value = row[key]
    return value if finite(value,0) else None


def estimate(driver, nutrient, source_value, config, stress_case):
    """Pure numeric kernel; every modifier is recorded and explicitly uncalibrated."""
    case = config['stress_cases'][stress_case]
    problems = []
    for name in ('area_ha','dist_to_water_m','annual_precip_mm','retention'):
        if not finite(driver.get(name),0):
            problems.append(name)
    if finite(driver.get('area_ha'),0) and driver['area_ha']==0:
        problems.append('area_ha')
    if not finite(driver.get('normal_precip_mm'),0) or driver.get('normal_precip_mm',0)==0:
        problems.append('normal_precip_mm')
    if driver.get('normal_year_count') != config['normal_years'][1]-config['normal_years'][0]+1:
        problems.append('normal_year_count')
    if driver.get('months_present') != 12:
        problems.append('historical_weather_completeness')
    if not finite(driver.get('retention'),0,1):
        problems.append('retention_fraction')
    if driver.get('crop') not in CROPS or driver.get('soil_class_soilmap') not in SOILS:
        problems.append('unsupported_crop_or_soil')
    if nutrient=='P':
        for name,maximum in [('slope_pct',None),('clay_pct_soilmap',100)]:
            if not finite(driver.get(name),0,maximum):
                problems.append(name)
    if not finite(source_value,0):
        problems.append('soil_p_input' if nutrient=='P' else 'applied_n_candidate')
    if problems:
        return dict(status='unavailable',reason=','.join(sorted(set(problems))),
                    field_loss_kg_ha_year=None,field_loss_kg=None,delivery_fraction=None,
                    retention_fraction=None,pre_retention_kg=None,delivered_kg=None,factors_json=packed({}))
    p = config['assumed_parameters']
    reference = p['soil_p_reference_mg_l'] if nutrient=='P' else p['n_application_reference_kg_ha']
    source_factor = max(p['source_factor_bounds'][0],min(p['source_factor_bounds'][1],
        p['source_factor_intercept']+p['source_factor_weight']*source_value/reference))
    factors = dict(reference_field_loss_kg_ha_year=config['base_field_loss_kg_ha_year'][nutrient],
        rain_ratio=driver['annual_precip_mm']/driver['normal_precip_mm'],source_value=source_value,
        source_factor=source_factor,terrain_factor=1.0,crop_factor=1.0,organic_factor=1.0,
        field_loss_scale=case['field_loss_scale'],delivery_length_m=case['delivery_length_m'],
        buffer_effect_applied=False,catch_crop_effect_applied=False,drainage_effect_applied=False)
    if nutrient=='P':
        factors['terrain_factor'] = ((1+p['slope_weight_per_pct']*driver['slope_pct']+
            p['clay_weight_per_pct']*driver['clay_pct_soilmap']) /
            (1+p['slope_weight_per_pct']*p['reference_slope_pct']+p['clay_weight_per_pct']*p['reference_clay_pct']))
        factors['crop_factor'] = p['p_root_crop_factor'] if driver['crop'] in p['root_crops'] else 1.0
    else:
        factors['organic_factor'] = case['organic_n_factor'] if driver['soil_class_soilmap']=='organic' else 1.0
    rate = math.prod(factors[key] for key in ('reference_field_loss_kg_ha_year','rain_ratio',
        'source_factor','terrain_factor','crop_factor','organic_factor','field_loss_scale'))
    loss = rate*driver['area_ha']
    delivery = math.exp(-driver['dist_to_water_m']/case['delivery_length_m'])
    retention = min(1,max(0,driver['retention']+case['retention_delta']))
    before_retention = loss*delivery
    return dict(status='estimated_unvalidated',reason='assumed_export_coefficient_model',
        field_loss_kg_ha_year=rate,field_loss_kg=loss,delivery_fraction=delivery,
        retention_fraction=retention,pre_retention_kg=before_retention,
        delivered_kg=before_retention*(1-retention),factors_json=packed(factors))


def drivers(source, fields, year, config):
    result, evidence = {}, set()
    normal_cache = {}
    catchment_ids = {f['catchment_id'] for f in fields.values()}
    if len(catchment_ids)!=1:
        raise ValueError('Pilot requires exactly one catchment')
    catchment_id = next(iter(catchment_ids))
    catchment = dict(source.execute('SELECT * FROM catchment WHERE catchment_id=?',(catchment_id,)).fetchone())
    monitoring = source.execute('SELECT * FROM catchment_monitoring WHERE catchment_id=? AND year=?',(catchment_id,year)).fetchone()
    for parcel_id,field in fields.items():
        parcel = dict(source.execute('SELECT * FROM parcel WHERE parcel_id=?',(parcel_id,)).fetchone())
        crop = dict(source.execute('SELECT * FROM parcel_crop_year WHERE parcel_id=? AND year=?',(parcel_id,year)).fetchone())
        if crop['crop_status']!='declared' or crop['crop']!=field['crop'] or parcel['area_ha']!=field['area_ha']:
            raise ValueError('Input field differs from matching declared base field')
        mapping = source.execute('SELECT * FROM parcel_climate_mapping WHERE parcel_id=?',(parcel_id,)).fetchone()
        cell = mapping['cell_id'] if mapping else None
        current = source.execute("SELECT * FROM weather_annual WHERE cell_id=? AND scenario='historical' AND year=?",(cell,year)).fetchone()
        if cell not in normal_cache:
            annual = [dict(r) for r in source.execute('''SELECT * FROM weather_annual
                WHERE cell_id=? AND scenario='historical' AND year BETWEEN ? AND ? ORDER BY year''',
                (cell,*config['normal_years']))]
            complete = [r for r in annual if r['months_present']==12 and finite(r['annual_precip_mm'],0)]
            normal_cache[cell] = (annual,complete)
        annual,complete = normal_cache[cell]
        driver = dict(parcel, crop=field['crop'],catch_crop=crop['catch_crop'],
            retention=catchment['nutrient_retention_frac_estimate'],
            annual_precip_mm=current['annual_precip_mm'] if current else None,
            months_present=current['months_present'] if current else None,
            normal_precip_mm=sum(r['annual_precip_mm'] for r in complete)/len(complete) if complete else None,
            normal_year_count=len(complete),cell_id=cell,mapping=dict(mapping) if mapping else None,
            normal_years=config['normal_years'],weather_scenario='historical')
        result[parcel_id] = driver
        for table,key,role in [('parcel',[parcel_id],'spatial_driver'),
            ('parcel_crop_year',[parcel_id,year],'crop_context'),('catchment',[catchment_id],'retention_context')]:
            evidence.add((parcel_id,entity(table,key),role))
        if mapping:
            evidence.add((parcel_id,entity('parcel_climate_mapping',[parcel_id]),'assumed_weather_mapping'))
        if current:
            evidence.add((parcel_id,entity('weather_annual',[cell,'historical',year]),'historical_year_weather'))
        for record in annual:
            evidence.add((parcel_id,entity('weather_annual',[cell,'historical',record['year']]),'normal_period_weather'))
        if monitoring:
            evidence.add((parcel_id,entity('catchment_monitoring',[catchment_id,year]),'whole_catchment_monitoring_context_only'))
    return result,evidence,catchment,dict(monitoring) if monitoring else None


def copy_context(source, target, roots):
    """Merge additional base ancestry with the copied input artifact's existing evidence."""
    ids = set(roots)
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
    target.executemany('INSERT OR IGNORE INTO evidence_entity VALUES(?,?,?)',
        [tuple(r) for r in source.execute('SELECT * FROM entity_record') if r['entity_id'] in ids])
    target.executemany('INSERT OR IGNORE INTO evidence_dependency VALUES(?,?,?)',[r for r in edges if r[0] in ids])
    links = [tuple(r) for r in source.execute('SELECT * FROM record_source') if r['entity_id'] in ids]
    record_ids = {r[1] for r in links}
    records = [tuple(r) for r in source.execute('SELECT * FROM source_record') if r['source_record_id'] in record_ids]
    source_ids = {r[1] for r in records}
    target.executemany('INSERT OR IGNORE INTO evidence_source VALUES(?,?,?,?,?)',
        [tuple(r) for r in source.execute('SELECT * FROM source_file') if r['source_id'] in source_ids])
    target.executemany('INSERT OR IGNORE INTO evidence_record VALUES(?,?,?,?)',records)
    target.executemany('INSERT OR IGNORE INTO evidence_link VALUES(?,?,?)',links)


def aggregate(fields, losses, catchment, monitoring, config):
    groups = defaultdict(list)
    for loss in losses:
        for scope in config['scope_variants']:
            if scope=='registry_selected' and fields[loss['parcel_id']]['selection_status']!='selected':
                continue
            groups[scope,loss['nutrient'],loss['input_variant'],loss['input_point'],loss['stress_case']].append(loss)
    result = []
    for (scope,nutrient,variant,point,case),rows in sorted(groups.items()):
        available = [r for r in rows if r['status']=='estimated_unvalidated']
        total_area = sum(r['area_ha'] for r in rows)
        known_area = sum(r['area_ha'] for r in available)
        subtotal = sum(r['delivered_kg'] for r in available) if available else None
        observed = monitoring['total_p_load_kg' if nutrient=='P' else 'total_n_load_kg'] if monitoring else None
        result.append(dict(catchment_id=catchment['catchment_id'],year=rows[0]['year'],
            scope=scope,nutrient=nutrient,input_variant=variant,input_point=point,stress_case=case,
            field_count=len(rows),available_field_count=len(available),unavailable_field_count=len(rows)-len(available),
            total_area_ha=total_area,available_area_ha=known_area,coverage_pct=100*known_area/total_area,
            available_fields_loss_kg=sum(r['field_loss_kg'] for r in available) if available else None,
            available_fields_pre_retention_kg=sum(r['pre_retention_kg'] for r in available) if available else None,
            available_fields_delivered_kg=subtotal,
            scope_delivered_kg=subtotal if len(available)==len(rows) else None,
            area_only_reference_kg=total_area*config['base_field_loss_kg_ha_year'][nutrient]*(1-catchment['nutrient_retention_frac_estimate']),
            monitored_whole_catchment_kg=observed,monitoring_method=monitoring['method'] if monitoring else None,
            other_farmland_load_kg=None,natural_background_load_kg=None,
            model_id=config['model_id'],model_version=config['version'],weather_scenario='historical',scientific_status=config['review_state']))
    return result


def require_matching_base(source, metadata, year):
    if metadata['year']!=year:
        raise ValueError('Input artifact year does not match pilot year')
    current = dict(source.execute('SELECT * FROM build_run').fetchone())
    if json.loads(metadata['source_build_json']) != current:
        raise ValueError('Input artifact refers to a different base build; generate matching inputs')
    checks = [('source_files_json','SELECT * FROM source_file ORDER BY relative_path'),
              ('source_reviews_json','SELECT * FROM quality_review ORDER BY review_id'),
              ('source_proposals_json','SELECT * FROM correction_proposal ORDER BY proposal_id')]
    for key,sql in checks:
        if json.loads(metadata[key]) != [dict(r) for r in source.execute(sql)]:
            raise ValueError('Input artifact/base context differs: '+key)


def validate(db, fields, losses, summary, config, variants):
    if db.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('Broken pilot evidence/input references')
    if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
        raise ValueError('Pilot integrity check failed')
    expected = len(fields)*len(variants)*len(config['input_points'])*len(config['stress_cases'])*2
    if len(losses)!=expected:
        raise ValueError('Incomplete pilot population')
    if db.execute('''SELECT COUNT(*) FROM field_loss f WHERE NOT EXISTS
        (SELECT 1 FROM loss_input i WHERE i.loss_id=f.loss_id)''').fetchone()[0]:
        raise ValueError('Field loss without input lineage')
    for row in losses:
        if row['status']=='unavailable':
            if row['delivered_kg'] is not None:
                raise ValueError('Unavailable field must retain unknown mass')
            continue
        pairs = [(row['field_loss_kg'],row['field_loss_kg_ha_year']*row['area_ha']),
                 (row['pre_retention_kg'],row['field_loss_kg']*row['delivery_fraction']),
                 (row['delivered_kg'],row['pre_retention_kg']*(1-row['retention_fraction']))]
        if any(not math.isclose(a,b,rel_tol=1e-12,abs_tol=1e-10) for a,b in pairs):
            raise ValueError('Field mass reconciliation failed')
        if not 0<=row['delivered_kg']<=row['pre_retention_kg']+1e-10 or row['pre_retention_kg']>row['field_loss_kg']+1e-10:
            raise ValueError('Transport/retention must not increase mass')
    for row in summary:
        matching = [r for r in losses if r['nutrient']==row['nutrient'] and r['input_variant']==row['input_variant']
            and r['input_point']==row['input_point'] and r['stress_case']==row['stress_case']
            and (row['scope']!='registry_selected' or fields[r['parcel_id']]['selection_status']=='selected')]
        available = [r for r in matching if r['status']=='estimated_unvalidated']
        expected_mass = sum(r['delivered_kg'] for r in available) if available else None
        if expected_mass != row['available_fields_delivered_kg']:
            raise ValueError('Field-to-catchment reconciliation failed')
        if row['unavailable_field_count'] and row['scope_delivered_kg'] is not None:
            raise ValueError('Incomplete scope cannot have a known total')
    return dict(fields=len(fields),field_loss_records=len(losses),summary_rows=len(summary),
        foreign_keys='passed',integrity='passed',field_mass_reconciliation='passed',
        catchment_reconciliation='passed',population='passed',unknown_totals='passed',
        scientific_validation='not_performed',ranking='not_implemented')


def build(database, inputs, output, catchment_id='CA01', year=2025, data=DATA):
    if type(year) is not int or not 2021<=year<=2026:
        raise ValueError('Pilot requires a historical declared year after the normal period (2021–2026)')
    preflight = check(data,database)
    if not preflight['ready']:
        raise ValueError('Base preflight failed: '+'; '.join(preflight['failures']))
    validation_path = inputs.parent/'validation.json'
    input_validation = json.loads(validation_path.read_text())
    for name in ('foreign_keys','integrity','input_evidence','area_conservation','field_input_population','donor_evidence_counts'):
        if input_validation.get(name)!='passed':
            raise ValueError('Input experiment lacks completed validation: '+name)
    config = json.loads(CONFIG.read_text())
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)) as source, \
         closing(sqlite3.connect(inputs.resolve().as_uri()+'?mode=ro',uri=True)) as input_db:
        source.row_factory = input_db.row_factory = sqlite3.Row
        source.execute('BEGIN')
        input_db.execute('BEGIN')
        metadata = dict(input_db.execute('SELECT * FROM input_run').fetchone())
        policy = json.loads(metadata['policy_json'])
        if policy.get('policy_id')!='nutrient_model_inputs' or policy.get('version')!='0.2.0':
            raise ValueError('Unsupported model-input policy version')
        require_matching_base(source,metadata,year)
        if input_db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or input_db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Input artifact integrity/reference check failed')
        fields = {r['parcel_id']:dict(r) for r in input_db.execute('SELECT * FROM field_scope WHERE catchment_id=?',(catchment_id,))}
        if not fields:
            raise ValueError('No scoped declared fields in catchment: '+catchment_id)
        values = {r['input_id']:dict(r) for r in input_db.execute('SELECT * FROM input_value') if r['parcel_id'] in fields}
        by_key = {(r['parcel_id'],r['variant'],r['input_name']):r['input_id'] for r in values.values()}
        dependencies = defaultdict(list)
        for row in input_db.execute('SELECT * FROM input_dependency'):
            if row['child_input_id'] in values:
                dependencies[row['child_input_id']].append(row['parent_input_id'])
        variants = json.loads(metadata['policy_json'])['variants']
        context,evidence,catchment,monitoring = drivers(source,fields,year,config)
        losses, input_links = [], []
        for parcel_id,field in fields.items():
            for variant in variants:
                for point in config['input_points']:
                    for case in config['stress_cases']:
                        for nutrient,name in [('P','p_test_mgl_latest'),('N','n_total_candidate_kg_ha')]:
                            iid = by_key[parcel_id,variant,name]
                            value = input_point(iid,values,dependencies,point)
                            lid = packed([parcel_id,year,nutrient,variant,point,case,config['version']])
                            loss = dict(loss_id=lid,parcel_id=parcel_id,year=year,nutrient=nutrient,
                                input_variant=variant,input_point=point,stress_case=case,
                                model_version=config['version'],weather_scenario='historical',area_ha=field['area_ha'],
                                **estimate(context[parcel_id],nutrient,value,config,case))
                            losses.append(loss)
                            input_links.append((lid,iid,'soil_p' if nutrient=='P' else 'applied_n_intensity'))
        summary = aggregate(fields,losses,catchment,monitoring,config)
        for row in summary:
            row['input_policy_version'] = policy['version']
        output.mkdir(parents=True,exist_ok=False)
        with closing(sqlite3.connect(output/'pilot.sqlite')) as target:
            input_db.backup(target)
            target.executescript((MODEL/'nutrient_loss.sql').read_text())
            with target:
                paths = [Path(__file__).resolve(),CONFIG,MODEL/'nutrient_loss.sql',
                    MODEL/'NUTRIENT_LOSS_METHOD.md',MODEL/'NUTRIENT_LOSS_EVIDENCE.json',ROOT/'tools/build_nutrient_inputs.py',
                    data.parent/'docs/SIMULATION_DESIGN.md']
                hashes = {code_reference(p,data):sha256(p) for p in paths}
                target.execute('INSERT INTO loss_run VALUES(?,?,?,?,?,?,?,?,?,?)',
                    ('loss-pilot:'+uuid4().hex,datetime.now(timezone.utc).isoformat(),year,catchment_id,
                     packed(config),packed(hashes),sha256(inputs),metadata['run_id'],metadata['source_build_json'],config['review_state']))
                insert_rows(target,'loss_driver',[dict(parcel_id=p,year=year,weather_scenario='historical',drivers_json=packed(d)) for p,d in context.items()])
                copy_context(source,target,{eid for _,eid,_ in evidence})
                target.executemany('INSERT INTO loss_driver_evidence VALUES(?,?,?)',sorted(evidence))
                insert_rows(target,'field_loss',losses)
                target.executemany('INSERT INTO loss_input VALUES(?,?,?)',input_links)
                for path in (CONFIG,MODEL/'NUTRIENT_LOSS_METHOD.md',MODEL/'NUTRIENT_LOSS_EVIDENCE.json',data.parent/'docs/SIMULATION_DESIGN.md'):
                    target.execute('INSERT INTO evidence_method_document VALUES(?,?,?)',(code_reference(path,data),sha256(path),path.read_text()))
                report = validate(target,fields,losses,summary,config,variants)
        write_csv(output/'field_contributions.csv',losses)
        write_csv(output/'catchment_summary.csv',summary)
        report.update(year=year,catchment_id=catchment_id,model_version=config['version'],
            input_policy_version=json.loads(metadata['policy_json'])['version'],weather_scenario='historical',
            scientific_status=config['review_state'],base_modified=False,inputs_modified=False)
        (output/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,default=ROOT/'analysis/nature/nature.sqlite')
    parser.add_argument('--inputs',type=Path,required=True)
    parser.add_argument('--data-dir',type=Path,default=DATA)
    parser.add_argument('--year',type=int,default=2025)
    parser.add_argument('--catchment-id',default='CA01')
    parser.add_argument('--output',type=Path)
    args = parser.parse_args()
    output = args.output or ROOT/'analysis/nature/loss_runs'/f'{args.catchment_id}-{args.year}-{uuid4().hex[:12]}'
    try:
        report = build(args.database,args.inputs,output,args.catchment_id,args.year,args.data_dir)
    except (ValueError,FileExistsError,FileNotFoundError) as error:
        parser.error(str(error))
    print(json.dumps(dict(output=str(output),**report),indent=2))


if __name__=='__main__':
    main()
