import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from build_nature_model import Builder,MODEL,query_results
from capture_nature_sources import capture
from nature_quality import register,run_farming_quality
from nature_queries import parameters,execute,definition_from_db


def small_model():
    db=sqlite3.connect(':memory:')
    db.row_factory=sqlite3.Row
    db.executescript((MODEL/'schema.sql').read_text())
    db.executescript((MODEL/'extensions.sql').read_text())
    db.executescript((MODEL/'decision_context.sql').read_text())
    db.executemany('INSERT INTO transformation VALUES(?,?)',[(s,s) for s in ['copy_typed','quality_detection']])
    register(db)
    db.execute("INSERT INTO source_file VALUES('source','fixture.csv','source',1,'csv')")
    return db,Builder(db,Path('/tmp'))


class QualityTests(unittest.TestCase):
    def test_duplicate_is_quarantined_and_both_source_records_survive(self):
        db,b=small_model()
        row={'farm_id':'F1','country':'FI','region':'FI_SW','segment':'veg','contract_crops':'pea'}
        first=b.raw('source','csv_line:2',row)
        second=b.raw('source','csv_line:3',row)
        self.assertTrue(b.insert('farm',['F1'],row,first))
        self.assertIsNone(b.insert('farm',['F1'],row,second))
        self.assertEqual(db.execute('SELECT COUNT(*) FROM source_record').fetchone()[0],2)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM farm').fetchone()[0],1)
        self.assertEqual(db.execute('SELECT rule_id FROM quality_finding').fetchone()[0],'duplicate_key')
        self.assertEqual(db.execute('SELECT source_record_id FROM quarantine_record').fetchone()[0],second)
        db.close()

    def test_archive_preserves_versions_independently_of_typed_model(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);source=root/'farm.csv';archive=root/'sources.sqlite'
            source.write_text('farm_id,country\nF1,FI\nF1,FI\n')
            with patch('capture_nature_sources.BASE',['farm.csv']):
                capture(root,archive,'quality')
                source.write_text('farm_id,country\nF1,SE\n')
                capture(root,archive,'quality')
            with closing(sqlite3.connect(archive)) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM source_file').fetchone()[0],2)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM source_record').fetchone()[0],3)

    def test_parameter_validation_rejects_unknown_and_wrong_types(self):
        definition={'parameters':{'year':{'type':'integer','default':2025,'minimum':1900,'maximum':2200}}}
        self.assertEqual(parameters(definition,{'year':2018}),{'year':2018})
        for supplied in [{'year':'2018 OR 1=1'},{'year':True},{'year':3000},{'unknown':1}]:
            with self.assertRaises(ValueError): parameters(definition,supplied)
        date_schema={'parameters':{'date':{'type':'string','format':'date','nullable':False}}}
        self.assertEqual(parameters(date_schema,{'date':'2025-11-27'}),{'date':'2025-11-27'})
        for date in ['20251127','2025-13-01','yesterday']:
            with self.assertRaises(ValueError):parameters(date_schema,{'date':date})

    def test_saved_empty_result_keeps_execution_and_csv_header(self):
        db,b=small_model()
        definition={'id':'empty','description':'empty','parameters':{},
                    'sql':"SELECT 'a' AS result_key WHERE 0",'lineage_sql':'SELECT entity_id AS result_key,entity_id FROM entity_record WHERE 0'}
        columns,rows,run=execute(db,definition,save=True)
        self.assertEqual(columns,['result_key']);self.assertEqual(rows,[])
        self.assertTrue(db.execute('SELECT 1 FROM query_run WHERE query_run_id=?',(run,)).fetchone())
        db.close()

    def test_review_state_is_snapshotted_at_saved_execution(self):
        db,b=small_model()
        row={'farm_id':'F1','country':'FI','region':'FI_SW','segment':'veg','contract_crops':'pea'}
        a=b.raw('source','csv_line:2',row);c=b.raw('source','csv_line:3',row)
        b.insert('farm',['F1'],row,a);b.insert('farm',['F1'],row,c)
        fid=db.execute('SELECT finding_id FROM quality_finding').fetchone()[0]
        db.execute("INSERT INTO quality_review(finding_id,status,reviewer,reviewed_at_utc,note) VALUES(?,'confirmed','Expert','2026-11-07T12:00:00+00:00','Checked source')",(fid,))
        definition={'id':'review','description':'review','parameters':{},
                    'sql':'SELECT finding_id AS result_key,review_status FROM quality_finding_context',
                    'lineage_sql':"SELECT json_extract(key_json,'$[0]') AS result_key,entity_id FROM entity_record WHERE table_name='quality_finding'"}
        _,rows,run=execute(db,definition,save=True)
        db.execute("INSERT INTO quality_review(finding_id,status,reviewer,reviewed_at_utc,note) VALUES(?,'dismissed','Expert','2026-11-07T13:00:00+00:00','New evidence')",(fid,))
        self.assertEqual(rows[0]['review_status'],'confirmed')
        self.assertEqual(db.execute('SELECT status FROM query_review_snapshot WHERE query_run_id=?',(run,)).fetchone()[0],'confirmed')
        self.assertEqual(db.execute('SELECT review_status FROM quality_finding_context').fetchone()[0],'dismissed')
        db.close()


if __name__=='__main__': unittest.main()
