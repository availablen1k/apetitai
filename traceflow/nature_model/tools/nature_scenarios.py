"""Scenario/action context and deliberately unquantified field screening leads."""
import json
from datetime import date
from nature_frameworks import identity
from nature_quality import register,finding

PATHS={
 'action_lever':'05_scenarios/decarbonisation_levers.csv',
 'structural_event':'05_scenarios/structural_events.csv',
 'transition_scenario':'05_scenarios/transition_scenarios.csv',
 'contract_price':'05_scenarios/contract_prices_and_replacement_premiums.csv',
 'published_inventory':'05_scenarios/published_inventory_history.csv',
 'draft_report_line':'05_scenarios/draft_report_summary_2025.csv'
}
KEYS={'action_lever':['lever_id'],'transition_scenario':['scenario','year'],'contract_price':['year','item'],
      'published_inventory':['year'],'draft_report_line':['year','line']}
RULES={
 'draft_total_mismatch':('total_mismatch','warning','Draft total differs from sum of its own S1 + S2 market + S3 rows; no replacement with published values.',{}),
 'scenario_proxy_unresolved':('missing_reference','warning','Transition SSP proxy has no matching imported weather scenario.',{})
}


def matches(predicate,row):
    if predicate=='missing_soil_p':return row['p_test_mgl_latest'] is None
    if predicate=='early_crop_without_catch_crop':return row['crop'] in ('pea','spinach') and row['catch_crop']==0
    if predicate=='mapped_organic_soil':return row['soil_class_soilmap']=='organic'
    if predicate=='root_crop':return row['crop'] in ('carrot','potato')
    raise ValueError('Unknown action-screen predicate: '+predicate)


def screen_actions(b,config):
    db=b.db
    rules=json.loads(config.read_text())
    db.execute('INSERT INTO transformation VALUES(?,?)',('nature_screen','Explicit prototype field predicates plus uncertain mapped context; unreviewed assessment leads only; no efficacy, suitability approval or delivered-load estimates.'))
    for rule in rules:
        eid=b.insert('nature_action_rule',[rule['rule_id']],rule)
        b.dependency(eid,'action_lever',[rule['lever_id']],'explicit curated nature-related action link')
    fields=db.execute('''SELECT y.*,p.p_test_mgl_latest,p.soil_class_soilmap FROM parcel_crop_year y
                         JOIN parcel p USING(parcel_id) WHERE y.is_contract_crop_provisional=1''').fetchall()
    for row in fields:
        for rule in rules:
            if not matches(rule['predicate'],row):continue
            key=[row['parcel_id'],row['year'],rule['lever_id']]
            eid=b.insert('nature_action_candidate',key,dict(parcel_id=row['parcel_id'],year=row['year'],lever_id=rule['lever_id'],
                         rule_id=rule['rule_id'],rule_version=rule['version'],reason=rule['description'],review_status='unreviewed'))
            b.dependency(eid,'parcel_crop_year',[row['parcel_id'],row['year']],'field/year crop, selection, observed/planned status and parcel attributes')
            b.dependency(eid,'nature_action_rule',[rule['rule_id']],'versioned prototype screening predicate and prerequisite')
    for table in ['nature_action_rule','nature_action_candidate']:
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',(table,col['name'],
                       'action_screening_rules.json + selected field/year and parcel attributes','nature_screen'))


def load_scenarios(b,config):
    db=b.db;register(db,RULES)
    for table,path in PATHS.items():
        for row,raw in b.csv(path):
            values=dict(row)
            try:
                if table=='structural_event':
                    date.fromisoformat(row['date'])
                    values['event_id']=identity('EV',row['date']+'\n'+row['event'])
                    key=[values['event_id']]
                else:key=[int(row[c]) if c=='year' else row[c] for c in KEYS[table]]
            except (ValueError,KeyError) as error:
                b.reject(table,raw,str(error));continue
            b.insert(table,key,values,raw)
        for col in db.execute(f'PRAGMA table_info({table})').fetchall():
            expr='hash of date + event text' if col['name']=='event_id' else path+':'+col['name']
            db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',(table,col['name'],expr,'copy_typed; retain reported/illustrative/preliminary interpretation'))
    for row in db.execute('SELECT DISTINCT item FROM contract_price').fetchall():
        item=row['item']
        # Only the six explicitly understood teaching labels are mapped.
        if item not in ('pea','potato','carrot','spinach','turnip_rape','pea_SE'):continue
        b.insert('price_crop_mapping',[item],dict(item=item,crop='pea' if item=='pea_SE' else item,
                  country='SE' if item=='pea_SE' else 'FI',interpretation='explicit package crop-price label mapping; not a future price forecast'))
    for col in db.execute('PRAGMA table_info(price_crop_mapping)').fetchall():
        db.execute('INSERT INTO column_lineage VALUES(?,?,?,?)',('price_crop_mapping',col['name'],'explicit six-label mapping in nature_scenarios.py','reference mapping, no extrapolation'))
    scenarios={r[0] for r in db.execute('SELECT DISTINCT scenario FROM weather_monthly')}
    for row in db.execute('SELECT scenario,year,physical_pathway_proxy FROM transition_scenario').fetchall():
        if row['physical_pathway_proxy'] not in scenarios:
            finding(b,'scenario_proxy_unresolved',entity='transition_scenario:'+json.dumps([row['scenario'],row['year']],separators=(',',':')),
                    year=row['year'],observed=row['physical_pathway_proxy'],expected=sorted(scenarios),explanation='No scenario equivalence or interpolation inferred.')
    for yearrow in db.execute('SELECT DISTINCT year FROM draft_report_line').fetchall():
        year=yearrow[0]
        lines={r['line']:r for r in db.execute('SELECT * FROM draft_report_line WHERE year=?',(year,))}
        required=['scope1','scope2_market','scope3','total_market_based']
        if all(k in lines for k in required):
            calculated=sum(lines[k]['tco2e'] for k in required[:3])
            total=lines['total_market_based']['tco2e']
            if abs(total-calculated)>1e-6:
                finding(b,'draft_total_mismatch',entity='draft_report_line:'+json.dumps([year,'total_market_based'],separators=(',',':')),
                        year=year,field='tco2e',observed=total,expected={'sum_of_report_components':calculated},
                        explanation='Internal arithmetic inconsistency; reported values retained. Published history and synthetic truth are different datasets.',
                        evidence=[('draft_report_line:'+json.dumps([year,k],separators=(',',':')),None,'reported component') for k in required[:3]])
    screen_actions(b,config)
