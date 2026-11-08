"""Check runtime, external dataset and optional existing build; no database rebuild."""
import argparse
import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

from capture_nature_sources import BASE,CLIMATE,SOURCING,MASTERS,FRAMEWORKS,SCENARIOS
from paths import ROOT,DATA,resolve_code_reference


def check(data=DATA,database=None):
    failures=[]
    if sys.version_info<(3,9):failures.append('Python 3.9 or newer is required')
    with closing(sqlite3.connect(':memory:')) as db:
        try:db.execute("SELECT json_array('check',2025)").fetchone()
        except sqlite3.OperationalError:failures.append('SQLite JSON functions are unavailable')
    if sqlite3.sqlite_version_info<(3,33,0):failures.append('SQLite 3.33 or newer is required')
    required=BASE+CLIMATE+SOURCING+MASTERS+FRAMEWORKS+SCENARIOS
    for relative in required:
        if not (data/relative).is_file():failures.append('Missing dataset input: '+relative)
    for relative in ['tools/ccn_tools/factors.py','tools/ccn_tools/io.py']:
        if not (data.parent/relative).is_file():failures.append('Missing dataset reference code: '+relative)
    if database is not None:
        if not database.is_file():failures.append('Database not built: '+str(database))
        else:
            try:
                with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)) as db:
                    for path,expected in db.execute('SELECT relative_path,sha256 FROM source_file'):
                        source=data/path
                        if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=expected:
                            failures.append('Dataset source changed: '+path)
                    hashes=json.loads(db.execute('SELECT code_hashes_json FROM build_run').fetchone()[0])
                    for reference,expected in hashes.items():
                        source=resolve_code_reference(reference,data)
                        if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=expected:
                            failures.append('Model/reference code changed: '+reference)
                    if db.execute('PRAGMA foreign_key_check').fetchall():failures.append('Foreign key violations in database')
            except (sqlite3.DatabaseError,ValueError,TypeError) as error:
                failures.append('Cannot verify existing database: '+str(error))
    return {'ready':not failures,'python':sys.version.split()[0],'sqlite':sqlite3.sqlite_version,
            'package_root':str(ROOT),'data_dir':str(data),'required_data_files':len(required),
            'existing_database_checked':database is not None,'failures':failures}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,default=DATA)
    parser.add_argument('--verify-existing',action='store_true')
    parser.add_argument('--database',type=Path,default=ROOT/'analysis/nature/nature.sqlite')
    args=parser.parse_args()
    report=check(args.data_dir,args.database if args.verify_existing else None)
    print(json.dumps(report,indent=2))
    if not report['ready']:raise SystemExit(1)


if __name__=='__main__':main()
