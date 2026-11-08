import unittest
from nature_frameworks import sections,load_frameworks
from test_nature_quality import small_model
from build_farming_2025 import DATA
from build_nature_model import MODEL
from query_nature_model import method_context


class FrameworkTests(unittest.TestCase):
    def test_heading_ranges_preserve_exact_section_text(self):
        text='# Title\nIntro\n\n## Data\nBody\n## Method\nLast\n'
        result=list(sections(text))
        self.assertEqual(''.join(r['section_text'] for r in result),text)
        for part in result:
            self.assertEqual(part['section_text'],''.join(text.splitlines(keepends=True)[part['start_line']-1:part['end_line']]))

    def test_local_context_never_claims_external_verification(self):
        db,b=small_model();b.data=DATA
        load_frameworks(b,MODEL/'knowledge_map.json')
        self.assertEqual(db.execute('SELECT COUNT(*) FROM reference_source').fetchone()[0],36)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM evidence_document').fetchone()[0],4)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM reference_source WHERE verification_status!='not_fetched_or_verified'").fetchone()[0],0)
        self.assertEqual(db.execute("SELECT implementation_status FROM method_context WHERE method_id='nature_pressure_state'").fetchone()[0],'planned_not_implemented')
        context=method_context(db,{'parcel_climate_mapping'})
        self.assertTrue(context['evidence'])
        self.assertEqual(context['methods'][0]['implementation_status'],'implemented_assumption')
        self.assertTrue(all(e['document_sha256'] for e in context['evidence']))
        db.close()


if __name__=='__main__':unittest.main()
