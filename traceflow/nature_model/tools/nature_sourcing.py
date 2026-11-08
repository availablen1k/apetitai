"""Reported ERP sourcing, reversible format conversion and conservative quality checks."""
import ast
import json
import statistics
from datetime import date

from nature_quality import register,finding

MATERIALS='01_master/materials.csv'
SUPPLIERS='01_master/suppliers.csv'
ERP='02_raw_feeds/erp_purchase_lines_2021_2025.csv'
RULES={
 'erp_business_duplicate':('duplicate_record','warning','Repeated document/line or matching receipt signature; retain all source rows.',{}),
 'erp_unknown_reference':('missing_reference','warning','Source material/supplier does not resolve to the imported masters or farm registry.',{}),
 'erp_unsupported_unit_currency':('unit_or_currency_review','warning','Unknown unit or currency prevents a documented conversion.',{}),
 'erp_sign_review':('sign_review','warning','Receipt/return sign pattern requires review; returns are not automatically errors.',{}),
 'erp_price_outlier':('outlier_implausible','warning','Normalised receipt price differs more than fourfold from material/year peers; unit/currency/material issues are possible, not diagnosed.',{'minimum_peers':8,'low_ratio':0.25,'high_ratio':4}),
 'erp_material_text':('material_mismatch','warning','Free-text description differs from material master; may be a legitimate description variant.',{}),
}
CROPS={'M100':'turnip_rape','M110':'pea','M111':'potato','M112':'carrot','M113':'spinach'}


def currency_factors(root):
    path=root/'tools/ccn_tools/factors.py'
    for node in ast.parse(path.read_text()).body:
        if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FX_PER_EUR' for t in node.targets):
            return ast.literal_eval(node.value)
    raise ValueError('Package reference FX assumptions not found')


def load_sourcing(b):
    db=b.db
    register(db,RULES)
    db.execute('INSERT INTO transformation VALUES(?,?)',('erp_format','Preserve raw signed quantities and currencies; KG -> kg, TO -> kg x1000, EUR spend -> no mass; amount / package reference FX assumption, not dated market FX.'))
    for table,path,key in [('material',MATERIALS,'material_id'),('supplier',SUPPLIERS,'supplier_id')]:
        for row,raw in b.csv(path): b.insert(table,[row[key]],row,raw)
    reference='APETIT_CLIMATE_NATURE_NAVIGATOR_2026/tools/ccn_tools/factors.py:FX_PER_EUR'
    factors=currency_factors(b.data.parent)
    for currency,rate in factors.items():
        b.insert('fx_reference_assumption',[currency],{'currency':currency,'units_per_eur':rate,
                 'source_reference':reference,'interpretation':'package fixed reference assumption; not historical FX'})
    materials={r['material_id']:r for r in db.execute('SELECT * FROM material')}
    suppliers={r['supplier_id']:r for r in db.execute('SELECT * FROM supplier')}
    farms={r[0] for r in db.execute('SELECT farm_id FROM farm')}
    for material,crop in CROPS.items():
        if material in materials:
            eid=b.insert('material_crop_mapping',[material],dict(material_id=material,crop=crop,
                         source_reference='package tools/ccn_tools/io.py:naive_farm_footprints crop_mat'))
            b.dependency(eid,'material',[material],'explicit package crop/material mapping')
    seen_business={};seen_signature={}
    for row,raw in b.csv(ERP):
        try:
            year=date.fromisoformat(row['posting_date']).year
            quantity=float(row['quantity']);amount=float(row['net_amount'])
            unit=row['uom'];currency=row['currency'];movement=int(row['movement_type'])
            mass=quantity if unit=='KG' else quantity*1000 if unit=='TO' else None
            eur=amount/factors[currency] if currency in factors else None
            farm=row['supplier_id'] if row['supplier_id'] in farms else None
            resolved_supplier=row['supplier_id'] if row['supplier_id'] in suppliers else None
            material=row['material_id'] if row['material_id'] in materials else None
            values=dict(row,purchase_record_id=raw,year=year,resolved_material_id=material,
                        resolved_supplier_id=resolved_supplier,farm_id=farm,quantity_kg=mass,
                        amount_eur_reference_rate=eur,fx_currency=currency if currency in factors else None)
            eid=b.insert('erp_purchase',[raw],values,raw,'erp_format')
            if not eid: continue
        except (ValueError,KeyError,TypeError,OverflowError) as error:
            b.reject('erp_purchase',raw,str(error));continue
        if material: b.dependency(eid,'material',[material],'material identity')
        if material in CROPS: b.dependency(eid,'material_crop_mapping',[material],'explicit farm crop interpretation')
        if resolved_supplier: b.dependency(eid,'supplier',[resolved_supplier],'supplier identity')
        if farm: b.dependency(eid,'farm',[farm],'supplier ID matches farm registry')
        if currency in factors: b.dependency(eid,'fx_reference_assumption',[currency],'reference currency conversion')
        if material is None or (farm is None and resolved_supplier is None):
            finding(b,'erp_unknown_reference',entity=eid,raw=raw,year=year,
                    observed={'material_id':row['material_id'],'supplier_id':row['supplier_id']},
                    expected='known material and supplier or farm',explanation='Original identifiers retained; unresolved foreign key is NULL.')
        if unit not in ('KG','TO','EUR') or currency not in factors:
            finding(b,'erp_unsupported_unit_currency',entity=eid,raw=raw,year=year,observed={'uom':unit,'currency':currency},
                    expected={'uom':['KG','TO','EUR'],'currency':list(factors)},explanation='Conversion unavailable; do not assume a unit or currency.')
        if (movement==122 and (quantity>0 or amount>0)) or (movement==101 and (quantity<0 or amount<0)):
            finding(b,'erp_sign_review',entity=eid,raw=raw,year=year,observed={'quantity':quantity,'net_amount':amount,'movement_type':movement},
                    expected='normally signed receipt or negative return',explanation='No sign correction applied.')
        business=(row['doc_no'],row['line_no'])
        signature=tuple(row[k] for k in ['posting_date','supplier_id','material_id','quantity','uom','net_amount','currency','movement_type'])
        earlier=seen_business.get(business) or (seen_signature.get(signature) if movement==101 else None)
        if earlier:
            finding(b,'erp_business_duplicate',entity=eid,raw=raw,year=year,observed={'doc_no':business[0],'line_no':business[1]},
                    expected='distinct business event',explanation='Repeated business key or identical same-day receipt signature; may need expert reconciliation.',
                    evidence=[(earlier,None,'earlier matching purchase')])
        seen_business.setdefault(business,eid)
        if movement==101: seen_signature.setdefault(signature,eid)
        if material and row['material_text'].strip()!=materials[material]['erp_name'].strip():
            finding(b,'erp_material_text',entity=eid,raw=raw,year=year,field='material_text',observed=row['material_text'],expected=materials[material]['erp_name'],
                    explanation='Exact text differs; aliases have not been curated.')
    groups={}
    for r in db.execute('''SELECT * FROM erp_purchase WHERE movement_type=101 AND quantity_kg>0
                            AND amount_eur_reference_rate>0'''):
        groups.setdefault((r['material_id'],r['year']),[]).append(r)
    for peers in groups.values():
        if len(peers)<8: continue
        median=statistics.median(r['amount_eur_reference_rate']/r['quantity_kg'] for r in peers)
        for r in peers:
            price=r['amount_eur_reference_rate']/r['quantity_kg']
            if price/median<.25 or price/median>4:
                eid='erp_purchase:'+json.dumps([r['purchase_record_id']],separators=(',',':'))
                finding(b,'erp_price_outlier',entity=eid,year=r['year'],field='reference_eur_per_kg',observed=price,
                        expected={'peer_median':median,'peer_count':len(peers)},explanation='Possible unit, currency, material or decimal issue; fixed FX assumptions also affect comparisons.',
                        evidence=[('erp_purchase:'+json.dumps([p['purchase_record_id']],separators=(',',':')),None,'material/year price peers') for p in peers])
    for table,path in [('material',MATERIALS),('supplier',SUPPLIERS),('erp_purchase',ERP)]:
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            name=col['name']
            derived={
                'purchase_record_id':'source file hash + physical CSV line','year':'year(posting_date)',
                'resolved_material_id':'material_id if master resolves, else NULL','resolved_supplier_id':'supplier_id if supplier master resolves, else NULL',
                'farm_id':'supplier_id if farm registry resolves, else NULL','quantity_kg':'quantity for KG; quantity*1000 for TO; NULL for spend/unsupported',
                'amount_eur_reference_rate':'net_amount / fx_reference_assumption.units_per_eur','fx_currency':'currency if package reference FX exists, else NULL'}
            db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',(table,name,derived.get(name,path+':'+name),'erp_format' if table=='erp_purchase' else 'copy_typed'))
    for table in ['fx_reference_assumption','material_crop_mapping']:
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',(table,col['name'],'explicit package code assumption; see source_reference','copy reference assumption; not measurement'))
