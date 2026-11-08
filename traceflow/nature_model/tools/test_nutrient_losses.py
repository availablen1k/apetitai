import json
import math
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from build_nutrient_inputs import build as build_inputs
from build_nutrient_losses import CONFIG, aggregate, build, estimate, input_point
from test_nutrient_inputs import NutrientInputFixture


class LossKernelTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads(CONFIG.read_text())
        self.driver = dict(area_ha=10,dist_to_water_m=0,annual_precip_mm=1000,
            normal_precip_mm=1000,normal_year_count=30,months_present=12,
            retention=0.2,crop='pea',soil_class_soilmap='clay',slope_pct=2,clay_pct_soilmap=30)

    def test_reference_mass_units_delivery_and_retention_once(self):
        p = estimate(self.driver,'P',15,self.config,'central')
        n = estimate(self.driver,'N',100,self.config,'central')
        self.assertAlmostEqual(p['field_loss_kg_ha_year'],1.1)
        self.assertAlmostEqual(p['field_loss_kg'],11)
        self.assertAlmostEqual(p['delivered_kg'],8.8)
        self.assertAlmostEqual(n['delivered_kg'],120)
        distant = estimate(dict(self.driver,dist_to_water_m=1000),'P',15,self.config,'central')
        self.assertAlmostEqual(distant['delivered_kg'],8.8*math.exp(-1))
        doubled = estimate(dict(self.driver,area_ha=20),'P',15,self.config,'central')
        self.assertAlmostEqual(doubled['delivered_kg'],17.6)
        retained = estimate(dict(self.driver,retention=1),'P',15,self.config,'central')
        self.assertEqual(retained['delivered_kg'],0)

    def test_missing_invalid_and_dry_weather_are_distinct(self):
        for overrides in ({'annual_precip_mm':None},{'normal_year_count':29},
                          {'months_present':11},{'dist_to_water_m':-1},{'retention':1.2}):
            row = estimate(dict(self.driver,**overrides),'P',15,self.config,'central')
            self.assertEqual((row['status'],row['delivered_kg']),('unavailable',None))
        dry = estimate(dict(self.driver,annual_precip_mm=0),'P',15,self.config,'central')
        self.assertEqual((dry['status'],dry['delivered_kg']),('estimated_unvalidated',0))
        self.assertIsNone(estimate(self.driver,'P',None,self.config,'central')['delivered_kg'])
        self.assertIsNone(estimate(self.driver,'P',float('nan'),self.config,'central')['delivered_kg'])
        bad_slope = dict(self.driver,slope_pct=None)
        self.assertIsNone(estimate(bad_slope,'P',15,self.config,'central')['delivered_kg'])
        self.assertIsNotNone(estimate(bad_slope,'N',100,self.config,'central')['delivered_kg'])

    def test_zero_application_does_not_become_zero_leaching_or_an_action_benefit(self):
        row = estimate(dict(self.driver,buffer_strip=1,catch_crop=1),'N',0,self.config,'central')
        self.assertGreater(row['delivered_kg'],0)
        comparison = estimate(dict(self.driver,buffer_strip=0,catch_crop=0),'N',0,self.config,'central')
        self.assertEqual(row['delivered_kg'],comparison['delivered_kg'])

    def test_stress_cases_are_ordered_and_retention_is_bounded(self):
        driver = dict(self.driver,dist_to_water_m=500,soil_class_soilmap='organic')
        values = [estimate(driver,'N',100,self.config,case)['delivered_kg'] for case in ('low','central','high')]
        self.assertLess(values[0],values[1])
        self.assertLess(values[1],values[2])
        for case,retention in [('low',0.99),('high',0.01)]:
            row = estimate(dict(driver,retention=retention),'N',100,self.config,case)
            self.assertGreaterEqual(row['retention_fraction'],0)
            self.assertLessEqual(row['retention_fraction'],1)

    def test_estimated_components_are_stressed_through_derived_n(self):
        observed = dict(value=10,use_state='provisional',value_kind='observed')
        estimated = dict(value=20,lower_value=5,upper_value=35,use_state='provisional',value_kind='estimated')
        derived = dict(value=30,use_state='provisional',value_kind='derived')
        values = dict(o=observed,e=estimated,d=derived)
        for point,expected in [('donor_lower',15),('central',30),('donor_upper',45)]:
            self.assertEqual(input_point('d',values,{'d':['o','e']},point),expected)
        values['e']['use_state'] = 'blocked_missing'
        self.assertIsNone(input_point('d',values,{'d':['o','e']},'central'))

    def test_partial_and_empty_scope_mass_stays_unknown(self):
        fields = {p:dict(selection_status='selected') for p in ('a','b')}
        rows = [dict(parcel_id=p,year=2025,nutrient='P',input_variant='reported_only',
            input_point='central',stress_case='central',area_ha=10,
            **estimate(self.driver,'P',15 if p=='a' else None,self.config,'central')) for p in fields]
        catchment = dict(catchment_id='C1',nutrient_retention_frac_estimate=0.2)
        summary = aggregate(fields,rows,catchment,None,self.config)
        for group in summary:
            self.assertIsNone(group['scope_delivered_kg'])
            self.assertAlmostEqual(group['available_fields_delivered_kg'],8.8)
            self.assertEqual(group['coverage_pct'],50)
            self.assertIsNone(group['monitored_whole_catchment_kg'])
        for row in rows:
            row.update(status='unavailable',delivered_kg=None)
        self.assertTrue(all(r['available_fields_delivered_kg'] is None for r in aggregate(fields,rows,catchment,None,self.config)))


class LossArtifactTests(NutrientInputFixture):
    def setUp(self):
        super().setUp()
        self.db.execute("INSERT INTO build_run VALUES('fixture','2026-11-07','{}','{}')")
        self.put('climate_grid_cell',['G1'],dict(cell_id='G1',region='R',lat=60,lon=24,
            continentality=0,elevation_m=50))
        for year in list(range(1991,2021))+[2025]:
            self.put('weather_annual',['G1','historical',year],dict(cell_id='G1',scenario='historical',year=year,
                months_present=12,apr_sep_months_present=6,annual_precip_mm=1000,annual_pet_mm=500,
                apr_sep_precip_mm=600,apr_sep_pet_mm=300))
        for parcel in ('P1','P2','P3','P4','P5'):
            self.put('parcel_climate_mapping',[parcel],dict(parcel_id=parcel,cell_id='G1',
                distance_km=1,method='fixture',mapping_status='assumed'))
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root/'source.sqlite'
        self.input_dir = self.root/'inputs'
        self.db.commit()
        with closing(sqlite3.connect(self.source)) as source:
            self.db.backup(source)
        with patch('build_nutrient_inputs.check',return_value={'ready':True}):
            build_inputs(self.source,self.input_dir)

    def test_complete_artifact_reconciles_and_copies_weather_evidence(self):
        input_file = self.input_dir/'inputs.sqlite'
        base_bytes,input_bytes = self.source.read_bytes(),input_file.read_bytes()
        with patch('build_nutrient_losses.check',return_value={'ready':True}):
            report = build(self.source,input_file,self.root/'pilot','C1')
            self.assertEqual(report['field_loss_records'],5*3*3*3*2)
            with self.assertRaises(FileExistsError):
                build(self.source,input_file,self.root/'pilot','C1')
        self.assertEqual(self.source.read_bytes(),base_bytes)
        self.assertEqual(input_file.read_bytes(),input_bytes)
        with closing(sqlite3.connect(self.root/'pilot/pilot.sqlite')) as pilot:
            self.assertFalse(pilot.execute('PRAGMA foreign_key_check').fetchall())
            self.assertEqual(pilot.execute("SELECT COUNT(DISTINCT entity_id) FROM loss_driver_evidence WHERE role='normal_period_weather'").fetchone()[0],30)
            self.assertGreater(pilot.execute('SELECT COUNT(*) FROM evidence_record').fetchone()[0],0)
            self.assertEqual(pilot.execute('SELECT COUNT(*) FROM loss_input').fetchone()[0],270)
            # A field can have available P and unavailable N independently.
            p = pilot.execute("SELECT status FROM field_loss WHERE parcel_id='P1' AND nutrient='P' LIMIT 1").fetchone()[0]
            n = pilot.execute("SELECT status FROM field_loss WHERE parcel_id='P1' AND nutrient='N' LIMIT 1").fetchone()[0]
            self.assertEqual((p,n),('estimated_unvalidated','unavailable'))

    def test_rejects_source_version_mismatch_and_future_plans(self):
        with closing(sqlite3.connect(self.source)) as db, db:
            db.execute("UPDATE build_run SET built_at_utc='changed'")
        with patch('build_nutrient_losses.check',return_value={'ready':True}):
            with self.assertRaisesRegex(ValueError,'different base build'):
                build(self.source,self.input_dir/'inputs.sqlite',self.root/'pilot','C1')
            for year in (2018,2028):
                with self.assertRaisesRegex(ValueError,'historical declared year'):
                    build(self.source,self.input_dir/'inputs.sqlite',self.root/'future','C1',year)
        self.assertFalse((self.root/'pilot').exists())

    def test_monitoring_never_changes_field_estimates(self):
        with patch('build_nutrient_losses.check',return_value={'ready':True}):
            build(self.source,self.input_dir/'inputs.sqlite',self.root/'first','C1')
        # Add monitoring to the same fixture build; input rows are untouched.
        with closing(sqlite3.connect(self.source)) as db, db:
            db.row_factory = sqlite3.Row
            # Supply auditable monitor entity/record context for this fixture.
            db.execute("INSERT INTO catchment_monitoring VALUES('C1',2025,99999,999999,'fixture context')")
            db.execute("INSERT INTO entity_record VALUES('monitor','catchment_monitoring','[\"C1\",2025]')")
            db.execute("UPDATE entity_record SET entity_id='catchment_monitoring:[\"C1\",2025]' WHERE entity_id='monitor'")
        with patch('build_nutrient_losses.check',return_value={'ready':True}):
            build(self.source,self.input_dir/'inputs.sqlite',self.root/'second','C1')
        def results(path):
            with closing(sqlite3.connect(path)) as db:
                return db.execute('SELECT loss_id,delivered_kg FROM field_loss ORDER BY loss_id').fetchall()
        self.assertEqual(results(self.root/'first/pilot.sqlite'),results(self.root/'second/pilot.sqlite'))


if __name__=='__main__':
    unittest.main()
