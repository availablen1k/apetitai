"""Monthly climate ingestion and explicitly assumed nearest-grid field exposure."""
import calendar
import json
import math

from nature_quality import register,finding

GRID='01_master/climate_grid_cells.csv'
WEATHER='04_climate/weather_monthly_1991_2060.csv'
SIGNALS='04_climate/climate_change_signals.csv'
RULES={
 'climate_month_gap':('missing_record','warning','Annual/month-window feature incomplete; feature remains NULL.',{}),
 'climate_value':('outlier_implausible','warning','Negative precipitation/PET, or hot-day count outside calendar bounds.',{}),
 'climate_mapping_distance':('spatial_mapping_review','warning','Nearest same-region grid centre farther than 25 km; assumed mapping needs review.',{'distance_km':25}),
 'climate_mapping_missing':('missing_record','error','No climate grid cells in the field owner region.',{}),
}


def distance(lat1,lon1,lat2,lon2):
    a,b=math.radians(lat1),math.radians(lat2)
    dlat,dlon=math.radians(lat2-lat1),math.radians(lon2-lon1)
    h=math.sin(dlat/2)**2+math.cos(a)*math.cos(b)*math.sin(dlon/2)**2
    return 6371.0088*2*math.asin(min(1,math.sqrt(h)))


def load_climate(b):
    db=b.db
    register(db,RULES)
    db.executemany('INSERT INTO transformation VALUES(?,?)',[
        ('nearest_grid','Minimum haversine distance to a grid centre in the farm registry region; tie by cell ID. Static, assumed exposure, not observed field weather.'),
        ('annual_weather','Sum monthly precipitation/PET by grid/scenario/year; require all 12 months, or all Apr-Sep months for that window; missing feature -> NULL.')])
    for row,raw in b.csv(GRID):
        b.insert('climate_grid_cell',[row['cell_id']],row,raw)
    for row,raw in b.csv(WEATHER):
        try: key=[row['cell_id'],row['scenario'],int(row['year']),int(row['month'])]
        except (KeyError,ValueError) as error:
            b.reject('weather_monthly',raw,str(error));continue
        eid=b.insert('weather_monthly',key,row,raw)
        if not eid: continue
        b.dependency(eid,'climate_grid_cell',[row['cell_id']],'grid identity')
        invalid=float(row['precip_mm'])<0 or float(row['pet_mm'])<0 or not (0<=int(row['hot_days_tmax_ge_27'])<=calendar.monthrange(key[2],key[3])[1])
        if invalid:
            finding(b,'climate_value',entity=eid,year=key[2],observed=row,expected='nonnegative precipitation/PET and valid calendar hot-day count',explanation='Inspect source weather values.')
    for row,raw in b.csv(SIGNALS):
        try: key=[row['scenario'],row['period'],int(row['month'])]
        except (KeyError,ValueError) as error:
            b.reject('climate_change_signal',raw,str(error));continue
        b.insert('climate_change_signal',key,row,raw)
    cells=[dict(r) for r in db.execute('SELECT * FROM climate_grid_cell ORDER BY cell_id')]
    for p in db.execute('SELECT p.*,f.region FROM parcel p JOIN farm f USING(farm_id)').fetchall():
        candidates=[c for c in cells if c['region']==p['region']]
        if not candidates:
            finding(b,'climate_mapping_missing',entity='parcel:'+json.dumps([p['parcel_id']],separators=(',',':')),
                    expected_key={'parcel_id':p['parcel_id'],'region':p['region']},explanation='No same-region climate cells.')
            continue
        nearest=min(candidates,key=lambda c:(distance(p['lat'],p['lon'],c['lat'],c['lon']),c['cell_id']))
        km=distance(p['lat'],p['lon'],nearest['lat'],nearest['lon'])
        eid=b.insert('parcel_climate_mapping',[p['parcel_id']],{'parcel_id':p['parcel_id'],'cell_id':nearest['cell_id'],
                     'distance_km':km,'method':'nearest_same_region_haversine_v1','mapping_status':'assumed'},transformation='nearest_grid')
        b.dependency(eid,'parcel',[p['parcel_id']],'field centroid')
        b.dependency(eid,'climate_grid_cell',[nearest['cell_id']],'selected same-region grid centre; candidate set identified by grid source hash')
        if km>25:
            finding(b,'climate_mapping_distance',entity=eid,observed={'distance_km':km},expected={'max_review_distance_km':25},explanation='Mapping is approximate; check grid coverage.')
    rows=db.execute('''SELECT cell_id,scenario,year,COUNT(*) AS months_present,
        SUM(month BETWEEN 4 AND 9) AS apr_sep_months_present,
        CASE WHEN COUNT(*)=12 THEN SUM(precip_mm) END AS annual_precip_mm,
        CASE WHEN COUNT(*)=12 THEN SUM(pet_mm) END AS annual_pet_mm,
        CASE WHEN SUM(month BETWEEN 4 AND 9)=6 THEN SUM(CASE WHEN month BETWEEN 4 AND 9 THEN precip_mm ELSE 0 END) END AS apr_sep_precip_mm,
        CASE WHEN SUM(month BETWEEN 4 AND 9)=6 THEN SUM(CASE WHEN month BETWEEN 4 AND 9 THEN pet_mm ELSE 0 END) END AS apr_sep_pet_mm
        FROM weather_monthly GROUP BY cell_id,scenario,year''').fetchall()
    for row in rows:
        key=[row['cell_id'],row['scenario'],row['year']]
        eid=b.insert('weather_annual',key,dict(row),transformation='annual_weather')
        for month in db.execute('SELECT month FROM weather_monthly WHERE cell_id=? AND scenario=? AND year=?',key).fetchall():
            b.dependency(eid,'weather_monthly',key+[month[0]],'monthly input to annual and Apr-Sep sums')
        if row['months_present']!=12:
            finding(b,'climate_month_gap',entity=eid,year=row['year'],observed={'months_present':row['months_present']},
                    expected={'months_present':12},explanation='Annual features remain NULL rather than partial-year sums.')
    # Register every new column, including derivations and non-measurement identity.
    for table,path in [('climate_grid_cell',GRID),('weather_monthly',WEATHER),('climate_change_signal',SIGNALS)]:
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',(table,col['name'],path+':'+col['name'],'copy_typed'))
    for table,rule,expression in [('parcel_climate_mapping','nearest_grid','parcel centroid + climate_grid_cell centres in farm.region'),
                                  ('weather_annual','annual_weather','weather_monthly grouped by cell_id,scenario,year; complete-month sums')]:
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',(table,col['name'],expression,rule))
