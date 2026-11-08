import unittest
from unittest.mock import patch
from nature_scenarios import load_scenarios,PATHS,matches
from test_nature_quality import small_model
from build_nature_model import MODEL
from build_farming_2025 import DATA


class ScenarioTests(unittest.TestCase):
    def test_screen_predicates_preserve_unknown_soil_and_existing_catch_crops(self):
        row=dict(p_test_mgl_latest=None,crop='pea',catch_crop=1,soil_class_soilmap='clay')
        self.assertTrue(matches('missing_soil_p',row))
        self.assertFalse(matches('early_crop_without_catch_crop',row))
        self.assertFalse(matches('mapped_organic_soil',row))
        self.assertTrue(matches('early_crop_without_catch_crop',dict(row,catch_crop=0)))
        self.assertFalse(matches('root_crop',row))
        self.assertTrue(matches('root_crop',dict(row,crop='carrot')))

    def test_scenario_data_retains_interpretation_and_draft_inconsistency(self):
        db,b=small_model();b.data=DATA
        load_scenarios(b,MODEL/'action_screening_rules.json')
        self.assertEqual(db.execute('SELECT COUNT(*) FROM action_lever').fetchone()[0],30)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM transition_scenario').fetchone()[0],49)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM structural_event').fetchone()[0],12)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM contract_price').fetchone()[0],54)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM published_inventory').fetchone()[0],5)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM draft_report_line').fetchone()[0],4)
        self.assertEqual(db.execute("SELECT tco2e FROM draft_report_line WHERE line='total_market_based'").fetchone()[0],18784173)
        finding=db.execute("SELECT * FROM quality_finding WHERE rule_id='draft_total_mismatch'").fetchone()
        self.assertIsNotNone(finding)
        self.assertEqual(db.execute("SELECT abatement_tco2e_2030_design FROM action_lever WHERE lever_id='L27'").fetchone()[0],0)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM nature_action_rule').fetchone()[0],5)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM nature_action_candidate').fetchone()[0],0)
        db.close()


if __name__=='__main__':unittest.main()
