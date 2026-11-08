import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from paths import ROOT,DATA,code_reference,resolve_code_reference
from check_environment import check
from create_snapshot import snapshot


class HandoverTests(unittest.TestCase):
    def test_code_reference_paths_are_portable_and_round_trip(self):
        source=ROOT/'tools/nature_queries.py'
        self.assertEqual(code_reference(source),'tools/nature_queries.py')
        self.assertEqual(resolve_code_reference(code_reference(source)),source)
        reference=DATA.parent/'tools/ccn_tools/factors.py'
        self.assertEqual(code_reference(reference),'dataset/tools/ccn_tools/factors.py')
        self.assertEqual(resolve_code_reference(code_reference(reference)),reference)

    def test_environment_reports_missing_dependency(self):
        with tempfile.TemporaryDirectory() as t:
            result=check(Path(t)/'data')
            self.assertFalse(result['ready'])
            self.assertTrue(any('Missing dataset input' in s for s in result['failures']))

    def test_copied_folder_works_with_explicit_dataset_from_another_cwd(self):
        with tempfile.TemporaryDirectory() as t:
            port=Path(t)/'portable_model'
            shutil.copytree(ROOT,port,ignore=shutil.ignore_patterns('analysis','backups','__pycache__','.git'))
            env=dict(os.environ,APETIT_DATA_DIR=str(DATA))
            completed=subprocess.run([sys.executable,str(port/'tools/check_environment.py')],
                                     cwd=t,env=env,text=True,capture_output=True,check=True)
            report=json.loads(completed.stdout)
            self.assertTrue(report['ready'])
            self.assertEqual(report['package_root'],str(port.resolve()))

    def test_manual_snapshot_preserves_saved_state_without_overwriting(self):
        with tempfile.TemporaryDirectory() as t:
            source=Path(t)/'source.sqlite';destination=Path(t)/'snapshot'
            with closing(sqlite3.connect(source)) as db:
                db.execute('CREATE TABLE review(note TEXT)')
                db.execute("INSERT INTO review VALUES('keep this decision')");db.commit()
            saved=snapshot(source,destination)
            with closing(sqlite3.connect(source)) as db:
                db.execute('DELETE FROM review');db.commit()
            with closing(sqlite3.connect(saved)) as db:
                self.assertEqual(db.execute('SELECT note FROM review').fetchone()[0],'keep this decision')
            with self.assertRaises(FileExistsError):snapshot(source,destination)


if __name__=='__main__':unittest.main()
