"""Validated bind parameters and saved, row-level auditable query executions."""
import csv
import hashlib
import json
from datetime import date,datetime,timezone
from uuid import uuid4


def parameters(definition, supplied=None):
    schema=definition.get('parameters',{})
    supplied=supplied or {}
    if set(supplied)-set(schema): raise ValueError('Unknown parameters: '+', '.join(sorted(set(supplied)-set(schema))))
    result={}
    for name,rule in schema.items():
        value=supplied.get(name,rule.get('default'))
        if value is None:
            if not rule.get('nullable',False): raise ValueError(f'{name} must be supplied')
        elif rule['type']=='integer':
            if type(value) is not int: raise ValueError(f'{name} must be an integer')
            if value<rule.get('minimum',-10**12) or value>rule.get('maximum',10**12): raise ValueError(f'{name} out of range')
        elif rule['type']=='string':
            if not isinstance(value,str): raise ValueError(f'{name} must be a string')
            if rule.get('format')=='date':
                try:valid=date.fromisoformat(value).isoformat()==value
                except ValueError:valid=False
                if not valid:raise ValueError(f'{name} must be a canonical YYYY-MM-DD date')
        if value is not None and 'enum' in rule and value not in rule['enum']: raise ValueError(f'Invalid {name}')
        result[name]=value
    return result


def definition_from_db(db,query_id):
    row=db.execute('SELECT * FROM query_definition WHERE query_id=?',(query_id,)).fetchone()
    if row is None: raise ValueError('Unknown query: '+query_id)
    return {'id':row['query_id'],'description':row['description'],'grain':row['grain'],
            'parameters':json.loads(row['parameters_json']),'sql':row['sql_text'],'lineage_sql':row['lineage_sql_text']}


def execute(db,definition,supplied=None,save=False,run_id=None):
    effective=parameters(definition,supplied)
    cursor=db.execute(definition['sql'],effective)
    columns=[c[0] for c in cursor.description]
    rows=[dict(r) for r in cursor]
    if len({r['result_key'] for r in rows})!=len(rows): raise ValueError('Duplicate result keys')
    if not save: return columns,rows,None
    run_id=run_id or definition['id']+':'+uuid4().hex
    sql,lineage=definition['sql'],definition['lineage_sql']
    db.execute('INSERT INTO query_run VALUES(?,?,?,?,?,?,?,?,?)',
               (run_id,definition['id'],datetime.now(timezone.utc).isoformat(),json.dumps(effective,sort_keys=True),
                sql,hashlib.sha256(sql.encode()).hexdigest(),lineage,hashlib.sha256(lineage.encode()).hexdigest(),definition['description']))
    db.execute('''INSERT INTO query_review_snapshot
        SELECT ?,review_id,finding_id,status,reviewer,reviewed_at_utc,note FROM quality_review''',(run_id,))
    def eid(key): return 'query_result:'+json.dumps([run_id,key],separators=(',',':'))
    for row in rows:
        key=row['result_key']
        db.execute('INSERT INTO entity_record VALUES(?,?,?)',(eid(key),'query_result',json.dumps([run_id,key],separators=(',',':'))))
        db.execute('INSERT INTO query_result VALUES(?,?,?,?)',(eid(key),run_id,key,json.dumps(row,ensure_ascii=False,separators=(',',':'))))
    keys={r['result_key'] for r in rows}
    covered=set()
    for contributor in db.execute(lineage,effective).fetchall():
        key=contributor['result_key']
        # Only materialise lineage for rows on this result page.
        if key not in keys: continue
        db.execute('INSERT OR IGNORE INTO record_dependency VALUES(?,?,?)',
                   (eid(key),contributor['entity_id'],'row-level input to '+definition['id']))
        covered.add(key)
    if covered!=keys: raise ValueError('Missing query-result contributors')
    return columns,rows,run_id


def write_csv(path,columns,rows):
    with path.open('w',encoding='utf-8',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
