import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from database_artifact import export_database,restore_database,checksum


class DatabaseArtifactTests(unittest.TestCase):
    def fixture(self,folder):
        source=folder/'source.sqlite'
        with closing(sqlite3.connect(source)) as db:
            db.execute('CREATE TABLE evidence(value TEXT)')
            db.execute("INSERT INTO evidence VALUES('keep the full database')");db.commit()
        artifact=folder/'nature.sqlite.xz';manifest=folder/'database_snapshot.json'
        return source,artifact,manifest

    def test_round_trip_preserves_full_state_and_verified_hash(self):
        with tempfile.TemporaryDirectory() as t:
            folder=Path(t);source,artifact,manifest=self.fixture(folder)
            report=export_database(source,artifact,manifest)
            restored=folder/'restored.sqlite';restore_database(artifact,manifest,restored)
            self.assertEqual(checksum(restored),report['database_sha256'])
            self.assertEqual(report['table_rows'],{'evidence':1})
            with closing(sqlite3.connect(restored)) as db:
                self.assertEqual(db.execute('SELECT value FROM evidence').fetchone()[0],'keep the full database')

    def test_restore_never_silently_replaces_working_state(self):
        with tempfile.TemporaryDirectory() as t:
            folder=Path(t);source,artifact,manifest=self.fixture(folder)
            export_database(source,artifact,manifest)
            with self.assertRaises(FileExistsError):restore_database(artifact,manifest,source)

    def test_corruption_rejected_without_clobbering_existing_database(self):
        with tempfile.TemporaryDirectory() as t:
            folder=Path(t);source,artifact,manifest=self.fixture(folder)
            export_database(source,artifact,manifest);before=checksum(source)
            artifact.write_bytes(b'corrupted')
            with self.assertRaises(ValueError):restore_database(artifact,manifest,source,replace=True)
            self.assertEqual(checksum(source),before)

    def test_oversized_export_preserves_existing_shared_artifact(self):
        with tempfile.TemporaryDirectory() as t:
            folder=Path(t);source,artifact,manifest=self.fixture(folder)
            export_database(source,artifact,manifest);before=artifact.read_bytes();metadata=manifest.read_bytes()
            with self.assertRaises(ValueError):export_database(source,artifact,manifest,max_bytes=1)
            self.assertEqual(artifact.read_bytes(),before);self.assertEqual(manifest.read_bytes(),metadata)

    def test_source_path_cannot_be_replaced_by_compressed_output(self):
        with tempfile.TemporaryDirectory() as t:
            folder=Path(t);source,artifact,manifest=self.fixture(folder);before=checksum(source)
            with self.assertRaises(ValueError):export_database(source,source,manifest)
            with self.assertRaises(ValueError):restore_database(artifact,manifest,artifact,replace=True)
            self.assertEqual(checksum(source),before)


if __name__=='__main__':unittest.main()
