"""Optional local full-database XZ export/restore; generated artifacts stay ignored."""
import argparse
import hashlib
import json
import lzma
import os
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime,timezone
from pathlib import Path

from paths import ROOT

DIRECTORY=ROOT/'analysis/nature'
MAX_GIT_FILE_BYTES=100*1024*1024


def checksum(path):
    digest=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()


def validate_sqlite(path):
    with closing(sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('SQLite integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('SQLite foreign key check failed')


def export_database(database,artifact,manifest,max_bytes=MAX_GIT_FILE_BYTES):
    if len({p.resolve() for p in (database,artifact,manifest)})!=3:
        raise ValueError('Database, artifact and manifest must use distinct paths')
    if not database.is_file():raise FileNotFoundError(database)
    artifact.parent.mkdir(parents=True,exist_ok=True)
    manifest.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.database-share-',dir=artifact.parent) as temporary:
        temporary=Path(temporary);backup=temporary/'nature.sqlite';compressed=temporary/'nature.sqlite.xz'
        # Consistent snapshot even if the working database has committed WAL state.
        with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True)) as source:
            with closing(sqlite3.connect(backup)) as target:source.backup(target)
        validate_sqlite(backup)
        with backup.open('rb') as raw,lzma.open(compressed,'wb',preset=3) as output:
            for chunk in iter(lambda:raw.read(1024*1024),b''):output.write(chunk)
        if compressed.stat().st_size>=max_bytes:
            raise ValueError('Compressed snapshot exceeds the configured transfer-size limit; existing local export was not replaced.')
        with closing(sqlite3.connect(backup)) as db:
            tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            counts={table:db.execute('SELECT COUNT(*) FROM "'+table.replace('"','""')+'"').fetchone()[0] for table in tables}
            build_id=db.execute('SELECT build_id FROM build_run').fetchone()[0] if 'build_run' in tables else None
        report={'format':'sqlite-xz-v1','created_at_utc':datetime.now(timezone.utc).isoformat(),
                'artifact_file':artifact.name,'artifact_bytes':compressed.stat().st_size,'artifact_sha256':checksum(compressed),
                'database_file':database.name,'database_bytes':backup.stat().st_size,'database_sha256':checksum(backup),
                'build_id':build_id,'table_rows':counts,
                'scope':'Full consistent analytical database snapshot, including current saved runs and review/proposal state. Independent source archive and backups are not included.'}
        encoded=json.dumps(report,indent=2)+'\n'
        os.replace(compressed,artifact)
        # Keep local artifact/manifest together. Hash checks reject a mismatched pair.
        manifest.write_text(encoded,encoding='utf-8')
        return report


def restore_database(artifact,manifest,database,replace=False):
    if len({p.resolve() for p in (database,artifact,manifest)})!=3:
        raise ValueError('Database, artifact and manifest must use distinct paths')
    if database.exists() and not replace:
        raise FileExistsError('Working database already exists. Snapshot valuable local state first; use --replace only intentionally.')
    report=json.loads(manifest.read_text(encoding='utf-8'))
    if report['format']!='sqlite-xz-v1':raise ValueError('Unsupported snapshot format')
    if artifact.stat().st_size!=report['artifact_bytes'] or checksum(artifact)!=report['artifact_sha256']:
        raise ValueError('Compressed artifact does not match its manifest')
    database.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.database-share-',dir=database.parent) as temporary:
        restored=Path(temporary)/'nature.sqlite';written=0
        with lzma.open(artifact,'rb') as source,restored.open('wb') as output:
            for chunk in iter(lambda:source.read(1024*1024),b''):
                written+=len(chunk)
                if written>report['database_bytes']:raise ValueError('Expanded data exceeds manifest size')
                output.write(chunk)
        if written!=report['database_bytes'] or checksum(restored)!=report['database_sha256']:
            raise ValueError('Restored database does not match its manifest')
        validate_sqlite(restored)
        os.replace(restored,database)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['export','restore'])
    parser.add_argument('--database',type=Path,default=DIRECTORY/'nature.sqlite')
    parser.add_argument('--artifact',type=Path,default=DIRECTORY/'nature.sqlite.xz')
    parser.add_argument('--manifest',type=Path,default=DIRECTORY/'database_snapshot.json')
    parser.add_argument('--replace',action='store_true',help='Restore over an existing DB only after preserving valuable state')
    args=parser.parse_args()
    try:
        if args.command=='export':
            report=export_database(args.database,args.artifact,args.manifest)
            print(f'Local snapshot: {args.artifact} ({report["artifact_bytes"]/1024/1024:.2f} MiB)')
        else:
            report=restore_database(args.artifact,args.manifest,args.database,args.replace)
            print(f'Restored: {args.database} ({report["database_bytes"]/1024/1024:.2f} MiB), integrity and SHA-256 verified')
    except (FileExistsError,FileNotFoundError,ValueError,lzma.LZMAError,sqlite3.DatabaseError) as error:
        parser.exit(2,str(error)+'\n')


if __name__=='__main__':main()
