"""Evidence-backed review candidates. Heuristics never correct source values."""
import hashlib
import json
import statistics


RULES={
 'ingest_rejection':('invalid_record','error','Typed-model rejection; raw source is retained.',{}),
 'duplicate_key':('duplicate_record','error','Repeated natural key; first accepted record retained, later record quarantined.',{}),
 'missing_management':('missing_record','warning','No report for declared provisional contract farm/crop/year; future plans excluded.',{}),
 'missing_soil_p':('missing_value','warning','Latest mapped soil P is unavailable.',{}),
 'area_difference':('area_mismatch','warning','Reported area differs from mapped crop area; candidate, not confirmed error.',{'relative_threshold':0.05}),
 'peer_outlier':('outlier_implausible','warning','Crop/country/year peer median and MAD outlier; candidate only.',{'minimum_peers':8,'scaled_mad_threshold':6,'mad_scale':1.4826}),
 'temporal_change':('abrupt_change','warning','Yield changes by more than factor 3 between consecutive calendar years on the same farm/crop.',{'ratio_threshold':3}),
 'negative_management':('outlier_implausible','warning','Negative management rate, or nonpositive harvested yield.',{}),
}


def register(db, rules=RULES):
    for rule,(kind,severity,description,parameters) in rules.items():
        db.execute('INSERT OR IGNORE INTO quality_rule VALUES(?,?,?,?,?,?)',
                   (rule,'1.0',kind,severity,description,json.dumps(parameters,sort_keys=True)))


def finding(b,rule,entity=None,raw=None,expected_key=None,year=None,field=None,
            observed=None,expected=None,explanation='',evidence=(),scope=()):
    payload=json.dumps([rule,entity,raw,expected_key,year,field],sort_keys=True,ensure_ascii=False)
    fid=hashlib.sha256(payload.encode()).hexdigest()
    db=b.db
    db.execute('INSERT OR IGNORE INTO quality_finding VALUES(?,?,?,?,?,?,?,?,?,?,?)',
               (fid,rule,'1.0',entity,raw,json.dumps(expected_key) if expected_key is not None else None,
                year,field,json.dumps(observed,allow_nan=False),json.dumps(expected,allow_nan=False),explanation))
    eid='quality_finding:'+json.dumps([fid],separators=(',',':'))
    db.execute('INSERT OR IGNORE INTO entity_record VALUES(?,?,?)',(eid,'quality_finding',json.dumps([fid],separators=(',',':'))))
    links=list(evidence)
    if entity: links.append((entity,None,'affected entity'))
    if raw: links.append((None,raw,'original source record'))
    for parent,source,role in links:
        db.execute('INSERT INTO quality_evidence VALUES(?,?,?,?)',(fid,source,parent,role))
        if parent:
            db.execute('INSERT OR IGNORE INTO record_dependency VALUES(?,?,?)',(eid,parent,role))
        if source:
            db.execute('INSERT OR IGNORE INTO record_source VALUES(?,?,?)',(eid,source,'quality_detection'))
    if not scope and entity:
        record=db.execute('SELECT table_name,key_json FROM entity_record WHERE entity_id=?',(entity,)).fetchone()
        keys=json.loads(record['key_json']) if record else []
        if record and record['table_name']=='farm_crop_observation':
            scope=db.execute('''SELECT y.parcel_id,y.year,p.catchment_id FROM parcel_crop_year y JOIN parcel p USING(parcel_id)
                                 WHERE y.observation_id=?''',(keys[0],)).fetchall()
        elif record and record['table_name'] in ('parcel','parcel_climate_mapping'):
            scope=db.execute('SELECT parcel_id,year,catchment_id FROM field_context WHERE parcel_id=?',(keys[0],)).fetchall()
        elif record and record['table_name']=='farm':
            scope=db.execute('SELECT parcel_id,year,catchment_id FROM field_context WHERE farm_id=?',(keys[0],)).fetchall()
        elif record and record['table_name']=='erp_purchase':
            scope=db.execute('''SELECT f.parcel_id,f.year,f.catchment_id FROM erp_purchase e
               JOIN material_crop_mapping m ON m.material_id=e.resolved_material_id
               JOIN field_context f ON f.farm_id=e.farm_id AND f.crop=m.crop AND f.year=e.year
               WHERE e.purchase_record_id=?''',(keys[0],)).fetchall()
    for parcel,season,catchment in scope:
        db.execute('INSERT OR IGNORE INTO quality_scope VALUES(?,?,?,?)',(fid,parcel,season,catchment))
    return fid


def run_farming_quality(b):
    db=b.db
    register(db)
    for row in db.execute('SELECT parcel_id FROM parcel WHERE p_test_mgl_latest IS NULL').fetchall():
        finding(b,'missing_soil_p',entity='parcel:'+json.dumps([row[0]],separators=(',',':')),
                field='p_test_mgl_latest',expected='soil P measurement',explanation='A missing input, not zero soil phosphorus.')
    groups=db.execute('''SELECT farm_id,crop,year FROM field_context
           WHERE is_contract_crop_provisional=1 AND crop_status='declared' AND observation_id IS NULL
           GROUP BY farm_id,crop,year''').fetchall()
    for row in groups:
        peers=db.execute('''SELECT y.parcel_id,y.year,p.catchment_id FROM parcel_crop_year y JOIN parcel p USING(parcel_id)
            WHERE p.farm_id=? AND y.crop=? AND y.year=?''',tuple(row)).fetchall()
        evidence=[('parcel_crop_year:'+json.dumps([p[0],p[1]],separators=(',',':')),None,'declared crop without report') for p in peers]
        finding(b,'missing_management',expected_key=dict(row),year=row['year'],field='observation_id',
                expected='matching farm/crop/year report',explanation='Report absent; no imputation performed.',evidence=evidence,scope=peers)
    observations=db.execute('''SELECT o.*,f.country FROM farm_crop_observation o JOIN farm f USING(farm_id)''').fetchall()
    for row in observations:
        eid='farm_crop_observation:'+json.dumps([row['observation_id']],separators=(',',':'))
        mismatch=db.execute('SELECT 1 FROM parcel_crop_year WHERE observation_id=? AND area_difference_over_5pct=1 LIMIT 1',(row['observation_id'],)).fetchone()
        if mismatch:
            peers=db.execute('''SELECT p.area_ha,y.parcel_id,y.year FROM parcel_crop_year y JOIN parcel p USING(parcel_id)
                               WHERE observation_id=?''',(row['observation_id'],)).fetchall()
            evidence=[('parcel_crop_year:'+json.dumps([p['parcel_id'],p['year']],separators=(',',':')),None,'mapped crop-area comparison') for p in peers]
            finding(b,'area_difference',entity=eid,year=row['year'],field='reported_area_ha',observed=row['reported_area_ha'],
                    expected={'mapped_area_ha':round(sum(p['area_ha'] for p in peers),8)},
                    explanation='Absolute area difference exceeds 5% of mapped group area.',evidence=evidence)
        for field in ['n_mineral_kg_ha','n_manure_kg_ha','n_applied_kg_ha','p_kg_ha','diesel_l_ha','lime_t_ha','sprays','yield_t_ha']:
            value=row[field]
            if value is not None and (value<0 or (field=='yield_t_ha' and value==0)):
                finding(b,'negative_management',entity=eid,year=row['year'],field=field,observed=value,
                        expected='positive yield / nonnegative activity rate',explanation='Check sign or measurement interpretation.')
    for field in ['yield_t_ha','n_mineral_kg_ha','n_manure_kg_ha','n_applied_kg_ha','p_kg_ha','diesel_l_ha']:
        groups={}
        for row in observations:
            if row[field] is not None:
                groups.setdefault((row['country'],row['crop'],row['year']),[]).append(row)
        for peers in groups.values():
            if len(peers)<8: continue
            median=statistics.median(r[field] for r in peers)
            mad=statistics.median(abs(r[field]-median) for r in peers)
            if mad==0: continue
            for row in peers:
                if abs(row[field]-median)>6*1.4826*mad:
                    evidence=[('farm_crop_observation:'+json.dumps([p['observation_id']],separators=(',',':')),None,'peer reference distribution') for p in peers]
                    finding(b,'peer_outlier',entity='farm_crop_observation:'+json.dumps([row['observation_id']],separators=(',',':')),
                            year=row['year'],field=field,observed=row[field],expected={'median':median,'mad':mad,'peer_count':len(peers)},
                            explanation='Outside six scaled MADs; investigate rather than automatically remove.',evidence=evidence)
    prior={}
    for row in sorted(observations,key=lambda r:(r['farm_id'],r['crop'],r['year'])):
        key=(row['farm_id'],row['crop'])
        previous=prior.get(key)
        value=row['yield_t_ha']
        if previous and previous['year']==row['year']-1 and value is not None and value>0 and previous['yield_t_ha'] and previous['yield_t_ha']>0:
            ratio=value/previous['yield_t_ha']
            if ratio>3 or ratio<1/3:
                finding(b,'temporal_change',entity='farm_crop_observation:'+json.dumps([row['observation_id']],separators=(',',':')),
                        year=row['year'],field='yield_t_ha',observed=value,expected={'previous_year':previous['year'],'previous_yield':previous['yield_t_ha']},
                        explanation='More than threefold change; weather or crop failure may legitimately explain it.',
                        evidence=[('farm_crop_observation:'+json.dumps([previous['observation_id']],separators=(',',':')),None,'previous consecutive season')])
        prior[key]=row
