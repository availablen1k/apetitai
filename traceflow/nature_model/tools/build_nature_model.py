"""Build the documented nature SQLite model and auditable example query results."""
import argparse
import csv
import hashlib
import json
import math
import os
import sqlite3
import tempfile
from decimal import Decimal
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from build_farming_2025 import DATA, ROOT, SOURCES, observation
from capture_nature_sources import capture,STAGES
from nature_quality import register as register_quality, finding, run_farming_quality
from paths import code_reference

MODEL = ROOT / 'model/nature'
OUTPUT = ROOT / 'analysis/nature'


def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def source_snapshot(value):
    """Preserve non-standard source NaN as an explicit tag in valid audit JSON."""
    if isinstance(value, float) and not math.isfinite(value):
        return {'$source_nonfinite_number': str(value)}
    if isinstance(value, dict):
        return {k: source_snapshot(v) for k, v in value.items()}
    if isinstance(value, list):
        return [source_snapshot(v) for v in value]
    return value


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def entity_id(table, key):
    return table + ':' + packed(list(key))


class Builder:
    def __init__(self, connection, data, manifest=None):
        self.db, self.data = connection, data
        self.csv_line_ids = {}
        self.table_columns = {}
        self.manifest = manifest

    def source(self, path):
        source = self.data / path
        source_id = digest(source)
        if self.manifest is not None and self.manifest.get(path) != source_id:
            raise ValueError(f'Source changed after capture: {path}')
        self.db.execute('INSERT INTO source_file VALUES (?,?,?,?,?)',
                        (source_id, path, source_id, source.stat().st_size, source.suffix[1:]))
        return source_id

    def raw(self, source_id, locator, row):
        rid = source_id + ':' + locator
        self.db.execute('INSERT INTO source_record VALUES (?,?,?,?)',
                        (rid, source_id, locator, packed(source_snapshot(row))))
        return rid

    def csv(self, path, delimiter=','):
        sid = self.source(path)
        with (self.data / path).open(encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f, delimiter=delimiter)
            for row in reader:
                rid = self.raw(sid, f'csv_line:{reader.line_num}', row)
                self.csv_line_ids[(path, reader.line_num)] = rid
                yield row, rid

    def insert(self, table, key, values, raw_id=None, transformation='copy_typed'):
        if table not in self.table_columns:
            self.table_columns[table] = self.db.execute(f'PRAGMA table_info({table})').fetchall()
        columns = self.table_columns[table]
        converted = {}
        try:
            for col in columns:
                name, kind = col['name'], col['type']
                value = values.get(name)
                if value is None or value == '':
                    converted[name] = None
                elif kind == 'INTEGER':
                    converted[name] = {'True': 1, 'False': 0, 'true': 1, 'false': 0}.get(value)
                    if converted[name] is None:
                        converted[name] = int(value)
                elif kind == 'REAL':
                    converted[name] = float(value)
                    if not math.isfinite(converted[name]):
                        raise ValueError(f'Non-finite {table}.{name}')
                else:
                    converted[name] = value
            placeholders = ','.join('?' for _ in converted)
            self.db.execute(f'INSERT INTO {table} VALUES ({placeholders})', tuple(converted.values()))
        except (sqlite3.IntegrityError, ValueError, TypeError, KeyError, ArithmeticError) as error:
            if raw_id is None:
                raise
            self.reject(table, raw_id, str(error), key)
            return None
        eid = entity_id(table, key)
        self.db.execute('INSERT INTO entity_record VALUES (?,?,?)', (eid, table, packed(list(key))))
        if raw_id:
            self.db.execute('INSERT INTO record_source VALUES (?,?,?)', (eid, raw_id, transformation))
        return eid

    def reject(self, table, raw_id, reason, key=None):
        self.db.execute('INSERT OR IGNORE INTO quarantine_record VALUES(?,?,?)',(raw_id,table,reason))
        rule = 'duplicate_key' if 'UNIQUE constraint' in reason else 'ingest_rejection'
        finding(self,rule,raw=raw_id,expected_key={'table':table,'key':key},
                observed={'rejection':reason},expected='unique, typed, referentially valid record',explanation=reason)

    def dependency(self, child, table, key, reason):
        if child is None:
            return
        self.db.execute('INSERT OR IGNORE INTO record_dependency VALUES (?,?,?)',
                        (child, entity_id(table, key), reason))

    def geometries(self, table, key_field, path):
        sid = self.source(path)
        document = json.loads((self.data / path).read_text(encoding='utf-8'))
        crs = document['crs']['properties']['name']
        if crs != 'urn:ogc:def:crs:OGC:1.3:CRS84':
            raise ValueError(f'Unsupported CRS: {crs}')
        crs_record = self.raw(sid, '/crs', document['crs'])
        for i, feature in enumerate(document['features']):
            geometry = feature['geometry']
            if geometry['type'] != 'Polygon':
                raise ValueError('Expected Polygon geometry')
            if not geometry['coordinates']:
                raise ValueError('Empty Polygon')
            for ring in geometry['coordinates']:
                if len(ring) < 4 or ring[0] != ring[-1]:
                    raise ValueError('Unclosed or incomplete polygon ring')
                for lon, lat in ring:
                    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                        raise ValueError('Coordinates outside longitude/latitude bounds')
            key = feature['properties'][key_field]
            raw = self.raw(sid, f'/features/{i}', feature)
            eid = self.insert(table, [key], {key_field: key, 'crs': crs, 'geometry_json': packed(geometry)}, raw, 'geometry_link')
            self.db.execute('INSERT INTO record_source VALUES (?,?,?)', (eid, crs_record, 'geometry_link'))
            self.dependency(eid, table.removesuffix('_geometry'), [key], 'geometry linked by supplied identifier')
        parent = table.removesuffix('_geometry')
        missing = self.db.execute(f'SELECT {key_field} FROM {parent} EXCEPT SELECT {key_field} FROM {table}').fetchall()
        if missing:
            raise ValueError(f'Missing {table} IDs: {len(missing)}')


def register_columns(db):
    sources = {'farm': SOURCES['farms'], 'parcel': SOURCES['parcels'],
               'catchment': SOURCES['catchments'],
               'catchment_monitoring': '06_nature/monitored_catchment_loads.csv',
               'origin_nature_indicator': '06_nature/origin_state_of_nature_indicative.csv',
               'current_calculator_footprint': '03_farming/current_calculator_footprints.csv'}
    for table, path in sources.items():
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            if table == 'current_calculator_footprint' and col['name'] == 'observation_id':
                db.execute('INSERT INTO column_lineage VALUES (?,?,?,?)',
                           (table, col['name'], 'farm_crop_observation: exact farm_id + crop + year', 'exact observation key lookup; no carbon recalculation'))
                continue
            db.execute('INSERT INTO column_lineage VALUES (?,?,?,?)',
                       (table, col['name'], path + ':' + col['name'], 'copy_typed: empty to NULL; boolean to 0/1; numeric to SQLite type'))
    se_map = {'farm_id': 'odlar_id', 'crop': 'gröda', 'year': 'skördeår',
              'reported_area_ha': 'areal_ha', 'delivered_t': 'levererad_mängd_ton',
              'n_applied_kg_ha': 'kvävegiva_kg_ha', 'diesel_l_ha': 'diesel_l_ha', 'irrigated': 'bevattnad'}
    for col in db.execute('PRAGMA table_info(farm_crop_observation)').fetchall():
        name = col['name']
        fi_name = {'reported_area_ha': 'area_ha'}.get(name, name)
        expression = {'FI': SOURCES['fi'] + ':' + fi_name if name not in ('n_applied_kg_ha', 'delivered_t', 'source_kind', 'observation_id') else 'not supplied / generated identity',
                      'SE': SOURCES['se'] + ':' + se_map[name] if name in se_map else 'not supplied / generated identity'}
        db.execute('INSERT INTO column_lineage VALUES (?,?,?,?)',
                   ('farm_crop_observation', name, packed(expression), 'normalize_observation; see transformation register and build_farming_2025.observation'))
    expressions = {
        'parcel_id': SOURCES['history'] + ':parcel_id', 'year': SOURCES['history'] + ':year',
        'crop': SOURCES['history'] + ':crop', 'crop_status': SOURCES['history'] + ':status',
        'catch_crop': SOURCES['history'] + ':catch_crop',
        'is_contract_crop_provisional': 'history.crop in farm.contract_crops (semicolon-separated)',
        'observation_id': 'LEFT lookup farm_crop_observation on parcel.farm_id + crop + year',
        'area_difference_over_5pct': 'abs(observation.reported_area_ha - SUM(peer parcel.area_ha)) / SUM(peer parcel.area_ha) > 0.05; NULL without reported area',
        'management_review_status': 'unreviewed if matched report, else not_applicable',
    }
    for name, expression in expressions.items():
        db.execute('INSERT INTO column_lineage VALUES (?,?,?,?)', ('parcel_crop_year', name, expression, 'field_join'))
    for table in ['parcel_geometry', 'catchment_geometry']:
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            name = col['name']
            expression = 'Feature.properties.' + name if name.endswith('_id') else 'Feature.geometry' if name == 'geometry_json' else 'FeatureCollection.crs.properties.name'
            db.execute('INSERT INTO column_lineage VALUES (?,?,?,?)', (table, name, expression, 'geometry_link: join by ID; no spatial reassignment'))


def query_results(db, output):
    from nature_queries import execute, write_csv
    catalog=json.loads((MODEL/'queries/catalog.json').read_text())
    output.mkdir(parents=True,exist_ok=True)
    for query in catalog:
        definition=dict(query,sql=(MODEL/'queries'/(query['id']+'.sql')).read_text(),
                        lineage_sql=(MODEL/'queries'/query['lineage']).read_text())
        db.execute('INSERT INTO query_definition VALUES(?,?,?,?,?,?)',
                   (query['id'],query['description'],query['grain'],packed(query.get('parameters',{})),definition['sql'],definition['lineage_sql']))
        columns,rows,_=execute(db,definition,save=True,run_id=query['id']+':default')
        write_csv(output/(query['id']+'.csv'),columns,rows)


def load_farming(b):
    db=b.db
    observation_ids={}
    for name,sep,country in [('fi',',','FI'),('se',';','SE')]:
        for row,raw in b.csv(SOURCES[name],sep):
            try:
                obs=observation(dict(row,source_file=SOURCES[name],source_csv_line=int(raw.rsplit(':',1)[1])),country)
            except (ValueError,KeyError,TypeError,ArithmeticError) as error:
                b.reject('farm_crop_observation',raw,str(error))
                continue
            eid=b.insert('farm_crop_observation',[obs['observation_id']],obs,raw,'normalize_observation')
            if eid:
                b.dependency(eid,'farm',[obs['farm_id']],'reported farm identity')
                observation_ids[(obs['farm_id'],obs['crop'],obs['year'])]=obs['observation_id']
    for row,raw in b.csv('03_farming/current_calculator_footprints.csv'):
        try:
            obs_id=observation_ids.get((row['farm_id'],row['crop'],row['year']))
            eid=b.insert('current_calculator_footprint',[row['farm_id'],row['crop'],int(row['year'])],dict(row,observation_id=obs_id),raw)
        except (ValueError,KeyError,TypeError) as error:
            b.reject('current_calculator_footprint',raw,str(error));continue
        if eid: b.dependency(eid,'farm_crop_observation',[obs_id],'matching report; existing result, not recomputed')
    parcels={r['parcel_id']:r for r in db.execute('SELECT * FROM parcel')}
    farms={r['farm_id']:r for r in db.execute('SELECT * FROM farm')}
    raw_by_key={}
    groups=defaultdict(list)
    for row,raw in b.csv(SOURCES['history']):
        try:
            year=int(row['year'])
            p=parcels[row['parcel_id']]
            f=farms[p['farm_id']]
            if row['farm_id']!=p['farm_id']: raise ValueError('Parcel owner mismatch')
            crop=row['crop']
            obs=observation_ids.get((p['farm_id'],crop,row['year']))
            values={'parcel_id':row['parcel_id'],'year':year,'crop':crop,'crop_status':row['status'],
                    'catch_crop':row['catch_crop'],'is_contract_crop_provisional':int(crop in (f['contract_crops'] or '').split(';')),
                    'observation_id':obs,'area_difference_over_5pct':None,
                    'management_review_status':'unreviewed' if obs else 'not_applicable'}
            eid=b.insert('parcel_crop_year',[row['parcel_id'],year],values,raw,'field_join')
            if not eid: continue
            raw_by_key[(row['parcel_id'],year)]=raw
            b.dependency(eid,'parcel',[row['parcel_id']],'field attributes and ownership')
            b.dependency(eid,'farm',[p['farm_id']],'static contract-crop membership')
            if obs:
                b.dependency(eid,'farm_crop_observation',[obs],'exact farm/crop/year report lookup')
                groups[(p['farm_id'],crop,year,obs)].append(row['parcel_id'])
        except (ValueError,KeyError,TypeError) as error:
            b.reject('parcel_crop_year',raw,str(error))
    reports={r['observation_id']:r for r in db.execute('SELECT * FROM farm_crop_observation')}
    for (farm,crop,year,obs),peers in groups.items():
        reported=reports[obs]['reported_area_ha']
        if reported is None: continue
        area=sum((Decimal(str(parcels[p]['area_ha'])) for p in peers),Decimal(0))
        mismatch=int(abs(Decimal(str(reported))-area)/area>Decimal('.05'))
        for parcel in peers:
            db.execute('UPDATE parcel_crop_year SET area_difference_over_5pct=? WHERE parcel_id=? AND year=?',(mismatch,parcel,year))
            eid=entity_id('parcel_crop_year',[parcel,year])
            for peer in peers:
                b.dependency(eid,'parcel',[peer],'same-year mapped farm/crop area comparison')
                db.execute('INSERT OR IGNORE INTO record_source VALUES(?,?,?)',(eid,raw_by_key[(peer,year)],'field_join'))


def build_database(destination, output, data=DATA, stage='decisions'):
    manifest=capture(data,output/'sources.sqlite',stage)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='nature-build-', suffix='.sqlite', dir=destination.parent)
    os.close(fd)
    db = sqlite3.connect(temp)
    db.row_factory = sqlite3.Row
    try:
        db.executescript((MODEL / 'schema.sql').read_text())
        db.executescript((MODEL / 'extensions.sql').read_text())
        db.executescript((MODEL / 'decision_context.sql').read_text())
        db.execute('INSERT INTO build_run VALUES (?,?,?,?)',
                   ('nature-decision-context-v4', now(), packed({code_reference(p,data): digest(p) for p in
                    [Path(__file__).resolve(), ROOT / 'tools/build_farming_2025.py', ROOT / 'tools/query_nature_model.py',
                     ROOT/'tools/nature_quality.py',ROOT/'tools/capture_nature_sources.py',ROOT/'tools/nature_queries.py',
                     ROOT/'tools/nature_climate.py',ROOT/'tools/nature_sourcing.py',
                     ROOT/'tools/nature_masters.py',ROOT/'tools/nature_frameworks.py',ROOT/'tools/nature_scenarios.py',
                     data.parent/'tools/ccn_tools/factors.py',data.parent/'tools/ccn_tools/io.py',ROOT/'tools/paths.py',
                     MODEL / 'schema.sql',MODEL/'extensions.sql',MODEL/'decision_context.sql',MODEL/'knowledge_map.json',
                     MODEL/'action_screening_rules.json', MODEL/'NUTRIENT_INPUT_POLICY.md', MODEL / 'queries/catalog.json']}),
                    packed({'farming_years': 'all supplied', 'monitoring_years': 'all supplied', 'imputation': False,'stage':stage})))
        transformations = {
            'copy_typed': 'Same-name CSV fields; empty -> NULL, numbers -> INTEGER/REAL, True/False -> 1/0; no corrections.',
            'normalize_observation': 'FI/SE schema mapping via build_farming_2025.observation; decimal comma -> point, ja/nej -> true/false -> 1/0, freezing-pea label -> pea; absent fields -> NULL.',
            'field_join': 'Keep all crop-history years, including future plans; exact farm+crop+year report lookup; contract flag from static registry crop membership; same-year 5% reported versus mapped group area diagnostic; no imputation.',
            'geometry_link': 'Retain GeoJSON Polygon geometry and CRS84; identity from feature properties; match master by ID, not spatial containment.',
            'quality_detection':'Versioned review-candidate rules; no values changed; evidence and thresholds retained.',
        }
        db.executemany('INSERT INTO transformation VALUES (?,?)', transformations.items())
        register_quality(db)
        b = Builder(db, data,manifest)
        for table, source_name in [('farm', 'farms'), ('catchment', 'catchments'), ('parcel', 'parcels')]:
            key_field = table + '_id'
            for row, rid in b.csv(SOURCES[source_name]):
                eid = b.insert(table, [row[key_field]], row, rid)
                if table == 'parcel':
                    b.dependency(eid, 'farm', [row['farm_id']], 'supplied ownership')
                    b.dependency(eid, 'catchment', [row['catchment_id']], 'supplied catchment assignment')
        load_farming(b)
        for row, rid in b.csv('06_nature/monitored_catchment_loads.csv'):
            eid = b.insert('catchment_monitoring', [row['catchment_id'], int(row['year'])], row, rid)
            b.dependency(eid, 'catchment', [row['catchment_id']], 'monitoring catchment identity')
        for row, rid in b.csv('06_nature/origin_state_of_nature_indicative.csv'):
            b.insert('origin_nature_indicator', [row['origin_country'], row['commodity']], row, rid)
        for table, key in [('parcel_geometry', 'parcel_id'), ('catchment_geometry', 'catchment_id')]:
            b.geometries(table, key, '06_nature/' + ('parcels' if table == 'parcel_geometry' else 'catchments') + '.geojson')
        register_columns(db)
        run_farming_quality(b)
        if STAGES.index(stage)>=STAGES.index('climate'):
            from nature_climate import load_climate
            load_climate(b)
        if STAGES.index(stage)>=STAGES.index('sourcing'):
            from nature_sourcing import load_sourcing
            load_sourcing(b)
        if STAGES.index(stage)>=STAGES.index('masters'):
            from nature_masters import load_masters
            load_masters(b)
        if STAGES.index(stage)>=STAGES.index('frameworks'):
            from nature_frameworks import load_frameworks
            load_frameworks(b,MODEL/'knowledge_map.json')
        if stage=='decisions':
            from nature_scenarios import load_scenarios
            load_scenarios(b,MODEL/'action_screening_rules.json')
        query_results(db, output / 'queries')
        checks = validate(db)
        db.commit()
        (output / 'validation.json').write_text(json.dumps(checks, indent=2) + '\n')
        db.close()
        os.replace(temp, destination)
        return checks
    except BaseException:
        db.close()
        Path(temp).unlink(missing_ok=True)
        raise


def validate(db):
    if db.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('Foreign key check failed')
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('SQLite integrity check failed')
    inconsistent = db.execute('''SELECT COUNT(*) FROM parcel_crop_year y
        JOIN parcel p USING(parcel_id) JOIN farm_crop_observation o ON o.observation_id=y.observation_id
        WHERE p.farm_id != o.farm_id OR y.crop != o.crop OR y.year != o.year''').fetchone()[0]
    if inconsistent:
        raise ValueError('Observation join mismatch')
    orphan_results = db.execute('''SELECT COUNT(*) FROM query_result q WHERE NOT EXISTS
        (SELECT 1 FROM record_dependency d WHERE d.child_entity_id=q.entity_id)''').fetchone()[0]
    if orphan_results:
        raise ValueError('Query results without recorded contributors')
    tables = ['farm', 'parcel', 'parcel_crop_year', 'farm_crop_observation', 'current_calculator_footprint', 'catchment',
              'catchment_monitoring', 'parcel_geometry', 'catchment_geometry', 'origin_nature_indicator',
              'source_file', 'source_record', 'record_dependency', 'column_lineage', 'query_run', 'query_result',
              'quality_rule','quality_finding','quality_scope','quarantine_record',
              'climate_grid_cell','weather_monthly','climate_change_signal','parcel_climate_mapping','weather_annual',
              'material','supplier','erp_purchase','fx_reference_assumption','material_crop_mapping',
              'site','emission_factor','material_factor_resolution','material_site_resolution','erp_site_resolution',
              'reference_source','evidence_document','evidence_section','method_context','method_evidence',
              'action_lever','structural_event','transition_scenario','contract_price','price_crop_mapping',
              'published_inventory','draft_report_line','nature_action_rule','nature_action_candidate']
    return {'foreign_keys': 'passed', 'integrity': 'passed', 'observation_joins': 'passed',
            'query_contributors': 'passed',
            'rows': {t: db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in tables},
            'year_coverage': {t: dict(db.execute(f'SELECT MIN(year) AS first_year, MAX(year) AS last_year, COUNT(DISTINCT year) AS distinct_years FROM {t}').fetchone())
                              for t in ['parcel_crop_year', 'farm_crop_observation', 'current_calculator_footprint', 'catchment_monitoring','weather_monthly','erp_purchase','transition_scenario','contract_price','published_inventory','draft_report_line']},
            'quality_findings_by_rule':dict(db.execute('SELECT rule_id,COUNT(*) FROM quality_finding GROUP BY rule_id'))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', choices=STAGES, default='decisions')
    parser.add_argument('--data-dir', type=Path, default=DATA)
    parser.add_argument('--database', type=Path, default=OUTPUT / 'nature.sqlite')
    parser.add_argument('--output-dir', type=Path, default=OUTPUT)
    args = parser.parse_args()
    print(json.dumps(build_database(args.database, args.output_dir, args.data_dir, args.stage), indent=2))


if __name__ == '__main__':
    main()
