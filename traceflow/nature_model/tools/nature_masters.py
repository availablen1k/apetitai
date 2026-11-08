"""Complete masters and preserve explicit, non-computational reference resolution."""
from decimal import Decimal
from nature_quality import register,finding
import json

SITES='01_master/sites.csv'
FACTORS='01_master/emission_factor_library.csv'
RULES={
 'master_reference_unresolved':('missing_reference','warning','Material/plant reference does not resolve; original ID retained.',{}),
 'farm_coordinate_review':('coordinate_review','warning','Farm coordinate outside broad country review box; possible swap, not a confirmed error.',
                            {'FI':[59,72,19,33],'SE':[55,71,10,25]})
}


def integral_year(value):
    if value=='': return None
    number=Decimal(value)
    if number!=number.to_integral_value(): raise ValueError('Nonintegral site boundary year')
    return int(number)


def load_masters(b):
    db=b.db;register(db,RULES)
    db.execute('INSERT INTO transformation VALUES(?,?)',('master_resolution','Exact master-key lookup; FARM means farm-specific method; no emissions calculation or historical scope filtering.'))
    for row,raw in b.csv(SITES):
        try: values=dict(row,in_group_from=integral_year(row['in_group_from']),in_group_to=integral_year(row['in_group_to']))
        except (ValueError,ArithmeticError) as error:
            b.reject('site',raw,str(error));continue
        b.insert('site',[row['site_id']],values,raw)
    for row,raw in b.csv(FACTORS): b.insert('emission_factor',[row['ef_id']],row,raw)
    sites={r[0] for r in db.execute('SELECT site_id FROM site')}
    factors={r[0] for r in db.execute('SELECT ef_id FROM emission_factor')}
    for row in db.execute('SELECT * FROM material').fetchall():
        ef=row['default_ef_id'];factor=ef if ef in factors else None
        status='farm_specific_method' if ef=='FARM' else 'library_factor' if factor else 'unresolved'
        eid=b.insert('material_factor_resolution',[row['material_id']],dict(material_id=row['material_id'],reported_ef_id=ef,factor_id=factor,resolution_status=status))
        b.dependency(eid,'material',[row['material_id']],'reported default factor reference')
        if factor:b.dependency(eid,'emission_factor',[factor],'exact factor lookup; units retained')
        if status=='unresolved': finding(b,'master_reference_unresolved',entity=eid,field='default_ef_id',observed=ef,expected='library factor or FARM',explanation='No factor guessed.')
        site=row['receiving_site'] if row['receiving_site'] in sites else None
        eid=b.insert('material_site_resolution',[row['material_id']],dict(material_id=row['material_id'],reported_site_id=row['receiving_site'],site_id=site,resolution_status='resolved' if site else 'unresolved'))
        b.dependency(eid,'material',[row['material_id']],'reported receiving site')
        if site:b.dependency(eid,'site',[site],'exact receiving-site lookup')
        else:finding(b,'master_reference_unresolved',entity=eid,field='receiving_site',observed=row['receiving_site'],expected='site master key',explanation='Receiving site unresolved.')
    for row in db.execute('SELECT purchase_record_id,plant FROM erp_purchase').fetchall():
        site=row['plant'] if row['plant'] in sites else None
        eid=b.insert('erp_site_resolution',[row['purchase_record_id']],dict(purchase_record_id=row['purchase_record_id'],reported_plant=row['plant'],site_id=site,resolution_status='resolved' if site else 'unresolved'))
        b.dependency(eid,'erp_purchase',[row['purchase_record_id']],'reported plant reference')
        if site:b.dependency(eid,'site',[site],'exact plant lookup; no scope exclusions applied')
        else:finding(b,'master_reference_unresolved',entity=eid,field='plant',observed=row['plant'],expected='site master key',explanation='Reported plant unresolved.')
    boxes=RULES['farm_coordinate_review'][3]
    for f in db.execute('SELECT farm_id,country,lat,lon FROM farm').fetchall():
        if f['lat'] is None or f['lon'] is None or f['country'] not in boxes:continue
        lo,hi,left,right=boxes[f['country']]
        if not (lo<=f['lat']<=hi and left<=f['lon']<=right):
            finding(b,'farm_coordinate_review',entity='farm:'+json.dumps([f['farm_id']],separators=(',',':')),field='lat/lon',
                    observed={'lat':f['lat'],'lon':f['lon']},expected={'country_review_box':boxes[f['country']]},
                    explanation='Broad heuristic box, not a country polygon. Original coordinates preserved; parcel mapping is unchanged.')
    for table,path in [('site',SITES),('emission_factor',FACTORS)]:
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            rule='integer-valued year text to INTEGER; blank to NULL' if col['name'] in ('in_group_from','in_group_to') else 'copy_typed'
            db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',(table,col['name'],path+':'+col['name'],rule))
    for table,expression in [('material_factor_resolution','material.default_ef_id -> library key or explicit FARM method'),
                             ('material_site_resolution','material.receiving_site -> site key'),('erp_site_resolution','erp_purchase.plant -> site key')]:
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',(table,col['name'],expression,'master_resolution'))
