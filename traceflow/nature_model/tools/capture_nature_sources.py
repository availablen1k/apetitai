"""Durable, versioned source capture, independent of successful typed modelling."""
import argparse
import csv
import hashlib
import json
import math
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from build_farming_2025 import DATA, ROOT

BASE = ['01_master/farm_registry.csv','01_master/parcels.csv','06_nature/catchments.csv',
        '03_farming/farm_survey_fi.csv','03_farming/foodhills_odlingsdata_se.csv',
        '03_farming/parcel_crop_history_and_plan.csv','03_farming/current_calculator_footprints.csv',
        '06_nature/monitored_catchment_loads.csv','06_nature/origin_state_of_nature_indicative.csv',
        '06_nature/parcels.geojson','06_nature/catchments.geojson']
CLIMATE = ['01_master/climate_grid_cells.csv','04_climate/weather_monthly_1991_2060.csv',
           '04_climate/climate_change_signals.csv']
SOURCING = ['01_master/materials.csv','01_master/suppliers.csv',
           '02_raw_feeds/erp_purchase_lines_2021_2025.csv']
MASTERS=['01_master/sites.csv','01_master/emission_factor_library.csv']
FRAMEWORKS=['07_frameworks/source_registry.csv','07_frameworks/framework_digest.md',
            '../docs/NATURE_SBTN.md','../docs/METHODOLOGY.md','../docs/SIMULATION_DESIGN.md']
SCENARIOS=['05_scenarios/'+name+'.csv' for name in ['decarbonisation_levers','structural_events',
           'transition_scenarios','contract_prices_and_replacement_premiums','published_inventory_history','draft_report_summary_2025']]
STAGES=['quality','climate','sourcing','masters','frameworks','decisions']


def snapshot(value):
    if isinstance(value,float) and not math.isfinite(value):
        return {'$source_nonfinite_number':str(value)}
    if isinstance(value,dict):
        return {k:snapshot(v) for k,v in value.items()}
    if isinstance(value,list):
        return [snapshot(v) for v in value]
    return value


def capture(data, destination, stage='decisions'):
    level=STAGES.index(stage)
    paths=BASE.copy()
    for i,extra in enumerate([CLIMATE,SOURCING,MASTERS,FRAMEWORKS,SCENARIOS],1):
        if level>=i: paths+=extra
    destination.parent.mkdir(parents=True,exist_ok=True)
    manifest={}
    with closing(sqlite3.connect(destination)) as db:
        db.executescript('''CREATE TABLE IF NOT EXISTS source_file(
            source_id TEXT PRIMARY KEY, relative_path TEXT NOT NULL, sha256 TEXT NOT NULL,
            bytes INTEGER NOT NULL, format TEXT NOT NULL, captured_at_utc TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS source_record(source_record_id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL REFERENCES source_file, locator TEXT NOT NULL, raw_json TEXT NOT NULL,
                UNIQUE(source_id,locator));''')
        db.execute('PRAGMA foreign_keys=ON')
        for relative in paths:
            path=data/relative
            sha=hashlib.sha256(path.read_bytes()).hexdigest()
            manifest[relative]=sha
            # A previously captured immutable content version can be reused.
            if db.execute('SELECT 1 FROM source_file WHERE source_id=?',(sha,)).fetchone():
                continue
            db.execute('INSERT INTO source_file VALUES(?,?,?,?,?,?)',
                       (sha,relative,sha,path.stat().st_size,path.suffix[1:],datetime.now(timezone.utc).isoformat()))
            def store(locator,row):
                db.execute('INSERT INTO source_record VALUES(?,?,?,?)',
                           (sha+':'+locator,sha,locator,json.dumps(snapshot(row),ensure_ascii=False,allow_nan=False,separators=(',',':'))))
            if path.suffix=='.csv':
                with path.open(encoding='utf-8-sig',newline='') as f:
                    reader=csv.DictReader(f,delimiter=';' if 'foodhills_' in relative else ',')
                    for row in reader:
                        store('csv_line:'+str(reader.line_num),row)
            elif path.suffix=='.geojson':
                document=json.loads(path.read_text(encoding='utf-8'))
                store('/crs',document['crs'])
                for i,feature in enumerate(document['features']):
                    store('/features/'+str(i),feature)
            elif path.suffix=='.md':
                store('document',{'text':path.read_text(encoding='utf-8')})
            else:
                raise ValueError('Unsupported source format: '+str(path))
            db.commit()  # Each complete file version survives later model failures.
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,default=DATA)
    parser.add_argument('--archive',type=Path,default=ROOT/'analysis/nature/sources.sqlite')
    parser.add_argument('--stage',choices=STAGES,default='decisions')
    args=parser.parse_args()
    print(json.dumps(capture(args.data_dir,args.archive,args.stage),indent=2))


if __name__=='__main__':
    main()
