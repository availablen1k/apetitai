"""Manually preserve current SQLite state before rebuilding; not a state migration."""
import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from datetime import datetime,timezone
from pathlib import Path
from uuid import uuid4

from paths import ROOT


def snapshot(database,directory):
    if not database.is_file():raise FileNotFoundError(database)
    directory.mkdir(parents=True,exist_ok=False)
    target=directory/'nature.sqlite'
    try:
        with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)) as source:
            with closing(sqlite3.connect(target)) as destination:
                source.backup(destination)
                if destination.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
                    raise ValueError('Snapshot integrity check failed')
        checksum=hashlib.sha256()
        with target.open('rb') as copied:
            for chunk in iter(lambda:copied.read(1024*1024),b''):checksum.update(chunk)
        report={'created_at_utc':datetime.now(timezone.utc).isoformat(),'database':'nature.sqlite',
                'sha256':checksum.hexdigest(),'bytes':target.stat().st_size,
                'purpose':'Manual full-state snapshot. Rebuilding the main database does not migrate reviews, proposals or saved runs.'}
        (directory/'SNAPSHOT.json').write_text(json.dumps(report,indent=2)+'\n')
        return target
    except BaseException:
        # Keep any partial copy for diagnosis; never overwrite an existing snapshot.
        raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,default=ROOT/'analysis/nature/nature.sqlite')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    directory=args.output or ROOT/'backups'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid4().hex[:8])
    print(snapshot(args.database,directory))


if __name__=='__main__':main()
