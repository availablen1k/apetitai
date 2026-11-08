"""Read-only SQL catalogue and result-lineage explorer for the nature model."""
import argparse
import csv
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

from build_nature_model import OUTPUT, entity_id
from nature_queries import definition_from_db,execute


def connect(path, writable=False):
    db = sqlite3.connect(path.resolve().as_uri() + ('?mode=rw' if writable else '?mode=ro'), uri=True)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db


def method_context(db,tables):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='model_method_link'").fetchone():return {}
    links=[dict(r) for r in db.execute('SELECT * FROM model_method_link ORDER BY table_name,method_id') if r['table_name'] in tables]
    methods={r['method_id'] for r in links}
    evidence=[dict(r) for r in db.execute('''SELECT e.*,s.heading,s.start_line,s.end_line,s.section_text,
         d.relative_path,d.verification_status AS document_verification,f.sha256 AS document_sha256,
         r.source AS external_source,r.url,r.licence,r.verification_status AS reference_verification
         FROM method_evidence e LEFT JOIN evidence_section s USING(section_id)
         LEFT JOIN evidence_document d USING(document_id) LEFT JOIN source_file f ON f.source_id=d.source_id
         LEFT JOIN reference_source r USING(reference_id) ORDER BY e.method_id,e.evidence_id''') if r['method_id'] in methods]
    return {'scope':'Explanatory method/context links; source pointers and prototype policies do not prove compliance or validate an algorithm.',
            'model_links':links,'methods':[dict(r) for r in db.execute('SELECT * FROM method_context ORDER BY method_id') if r['method_id'] in methods],
            'evidence':evidence}


def trace(db, query_id, result_key, run_id=None):
    run = db.execute('SELECT * FROM query_run WHERE query_id=? AND query_run_id=?', (query_id,run_id or query_id+':default')).fetchone()
    if run is None:
        raise ValueError(f'Unknown query: {query_id}')
    start = entity_id('query_result', [run['query_run_id'], result_key])
    result = db.execute('SELECT * FROM query_result WHERE entity_id=?', (start,)).fetchone()
    if result is None:
        raise ValueError(f'No result for key: {result_key}')
    ancestors = [dict(r) for r in db.execute('''WITH RECURSIVE ancestors(entity_id) AS (
        SELECT ? UNION SELECT d.parent_entity_id FROM record_dependency d
        JOIN ancestors a ON d.child_entity_id = a.entity_id
    ) SELECT e.* FROM ancestors a JOIN entity_record e USING(entity_id) ORDER BY e.entity_id''', (start,))]
    # Use a temporary Python set rather than constructing dynamic SQL parameters.
    ids = {r['entity_id'] for r in ancestors}
    links = [dict(r) for r in db.execute('SELECT * FROM record_source ORDER BY entity_id, source_record_id') if r['entity_id'] in ids]
    source_ids = {r['source_record_id'] for r in links}
    records = [dict(r) for r in db.execute('SELECT * FROM source_record ORDER BY source_record_id') if r['source_record_id'] in source_ids]
    files = {r['source_id'] for r in records}
    tables = {r['table_name'] for r in ancestors}
    return {
        'scope': 'Conservative row-level ancestry plus column mapping rules; not per-cell SQL provenance. Missing/excluded records are not enumerated as contributors.',
        'build': dict(db.execute('SELECT * FROM build_run').fetchone()),
        'query_run': dict(run), 'result': dict(result), 'entities': ancestors,
        'method_context':method_context(db,tables),
        'reviews_at_execution':[dict(r) for r in db.execute('SELECT * FROM query_review_snapshot WHERE query_run_id=? ORDER BY review_id',(run['query_run_id'],))],
        'dependencies': [dict(r) for r in db.execute('SELECT * FROM record_dependency ORDER BY child_entity_id, parent_entity_id')
                         if r['child_entity_id'] in ids],
        'record_source_links': links, 'source_records': records,
        'source_files': [dict(r) for r in db.execute('SELECT * FROM source_file ORDER BY relative_path') if r['source_id'] in files],
        'transformations': [dict(r) for r in db.execute('SELECT * FROM transformation ORDER BY transformation_id')],
        'column_rules': [dict(r) for r in db.execute('SELECT * FROM column_lineage ORDER BY table_name, column_name') if r['table_name'] in tables],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=OUTPUT / 'nature.sqlite')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list')
    query = sub.add_parser('query')
    query.add_argument('query_id')
    query.add_argument('--params',default='{}',help='JSON object of validated SQL bind parameters')
    query.add_argument('--save',action='store_true',help='Record this execution, results and contributing entities')
    lineage = sub.add_parser('lineage')
    lineage.add_argument('query_id')
    lineage.add_argument('result_key')
    lineage.add_argument('--output', type=Path, required=True)
    lineage.add_argument('--run-id',help='Saved execution ID; defaults to the build-time execution')
    args = parser.parse_args()
    with closing(connect(args.database,writable=args.command=='query' and args.save)) as db, db:
        if args.command == 'list':
            for row in db.execute('SELECT query_id, description,parameters_json FROM query_definition ORDER BY query_id'):
                print(f'{row["query_id"]}: {row["description"]}')
        elif args.command == 'query':
            try:
                supplied=json.loads(args.params)
                if not isinstance(supplied,dict): raise ValueError('params must be a JSON object')
                columns,rows,run_id=execute(db,definition_from_db(db,args.query_id),supplied,save=args.save)
            except (ValueError,json.JSONDecodeError) as error:
                parser.error(str(error))
            writer = csv.writer(sys.stdout)
            writer.writerow(columns)
            writer.writerows([row[c] for c in columns] for row in rows)
            if run_id: print('Saved query run: '+run_id,file=sys.stderr)
        else:
            report = trace(db, args.query_id, args.result_key,args.run_id)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
            print(f'Wrote lineage for {args.query_id}/{args.result_key}: '
                  f'{len(report["entities"])} entities, {len(report["source_records"])} source records → {args.output}')


if __name__ == '__main__':
    main()
