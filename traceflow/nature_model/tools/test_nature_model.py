"""Integration tests for nature model, SQL aggregation and auditable lineage."""
import csv
import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from build_nature_model import DATA, build_database
from query_nature_model import connect, trace
from nature_queries import definition_from_db,execute


class NatureModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temp.name)
        cls.path = cls.output / 'nature.sqlite'
        cls.checks = build_database(cls.path, cls.output)
        cls.db = connect(cls.path)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()
        cls.temp.cleanup()

    def test_population_and_referential_integrity(self):
        self.assertEqual(self.checks['rows']['parcel_crop_year'], 284260)
        self.assertEqual(self.checks['rows']['farm_crop_observation'], 6120)
        self.assertEqual(self.checks['rows']['current_calculator_footprint'], 3437)
        self.assertEqual(self.checks['rows']['catchment_monitoring'], 105)
        self.assertEqual(self.checks['rows']['source_file'], 30)
        self.assertFalse(self.db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM field_context_2025').fetchone()[0], 14213)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM field_context').fetchone()[0], 284260)

    def test_area_query_conserves_area_without_monitoring_fanout(self):
        rows = self.db.execute("SELECT values_json FROM query_result WHERE query_run_id='01_contract_area:default'").fetchall()
        self.assertEqual(len(rows), 42)
        self.assertAlmostEqual(sum(json.loads(r[0])['contract_area_ha'] for r in rows), 12926.27, places=6)
        self.assertEqual(sum(json.loads(r[0])['contract_field_count'] for r in rows), 2410)

    def test_missing_unknown_and_zero(self):
        row = self.db.execute('''SELECT SUM(observation_id IS NULL), SUM(reported_p_kg_ha IS NULL)
             FROM field_context_2025 WHERE is_contract_crop_provisional=1''').fetchone()
        self.assertEqual(tuple(row), (398, 1318))
        self.assertGreater(self.db.execute('SELECT COUNT(*) FROM farm_crop_observation WHERE n_applied_kg_ha=0').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM farm WHERE contract_crops IS NULL').fetchone()[0], 23)
        self.assertGreater(self.db.execute("SELECT COUNT(*) FROM field_context_2025 WHERE contract_selection_status='unknown_contract_list'").fetchone()[0], 0)

    def test_nutrient_coverage_conserves_selected_area_for_each_input(self):
        definition=definition_from_db(self.db,'22_nutrient_input_readiness')
        for year in (2018,2025):
            _,rows,_=execute(self.db,definition,{'year':year})
            expected=self.db.execute('''SELECT COUNT(*),SUM(area_ha) FROM field_context
                WHERE year=? AND crop_status='declared' AND is_contract_crop_provisional=1''',(year,)).fetchone()
            for name in definition['parameters']['input_name']['enum']:
                group=[r for r in rows if r['input_name']==name]
                self.assertEqual(sum(r['field_count'] for r in group),expected[0])
                self.assertAlmostEqual(sum(r['mapped_area_ha'] for r in group),expected[1],places=5)
                self.assertTrue(all(r['policy_review_state']=='draft_unreviewed' for r in group))
            p_missing=sum(r['field_count'] for r in rows if r['input_name']=='p_kg_ha'
                          and r['availability_status'] in ('missing_report','missing_value','not_collected_by_schema'))
            actual=self.db.execute('''SELECT COUNT(*) FROM field_context WHERE year=?
                AND is_contract_crop_provisional=1 AND reported_p_kg_ha IS NULL''',(year,)).fetchone()[0]
            self.assertEqual(p_missing,actual)

    def test_nutrient_result_traces_to_report_parcel_and_quality_evidence(self):
        result=self.db.execute('''SELECT result_key FROM query_result
            WHERE query_run_id='22_nutrient_input_readiness:default'
            AND json_extract(values_json,'$.input_name')='p_kg_ha'
            AND json_extract(values_json,'$.availability_status')='reported_positive'
            AND json_extract(values_json,'$.fields_with_open_quality_findings')>0 LIMIT 1''').fetchone()
        self.assertIsNotNone(result)
        report=trace(self.db,'22_nutrient_input_readiness',result[0])
        tables={e['table_name'] for e in report['entities']}
        self.assertTrue({'parcel_crop_year','parcel','farm','farm_crop_observation','quality_finding'}<=tables)
        self.assertTrue(report['source_records'])
        hashes=json.loads(report['build']['code_hashes_json'])
        self.assertIn('model/nature/NUTRIENT_INPUT_POLICY.md',hashes)

    def test_unmonitored_catchments_stay_visible_and_unknown(self):
        rows = [json.loads(r[0]) for r in self.db.execute("SELECT values_json FROM query_result WHERE query_run_id='04_monitoring_change:default'")]
        absent = [r for r in rows if r['observed_year_count'] == 0]
        self.assertEqual(len(absent), 27)
        self.assertTrue(all(r['p_2025_kg'] is None and r['p_change_pct'] is None for r in absent))

    def test_geometry_identity_and_crs(self):
        self.assertEqual(self.checks['rows']['parcel_geometry'], self.checks['rows']['parcel'])
        self.assertEqual(self.checks['rows']['catchment_geometry'], 42)
        self.assertEqual(self.db.execute('SELECT DISTINCT crs FROM parcel_geometry').fetchone()[0], 'urn:ogc:def:crs:OGC:1.3:CRS84')

    def test_each_model_column_has_a_rule(self):
        tables = ['farm','parcel','catchment','farm_crop_observation','parcel_crop_year',
                  'catchment_monitoring','origin_nature_indicator','parcel_geometry','catchment_geometry',
                  'current_calculator_footprint','climate_grid_cell','weather_monthly','weather_annual','climate_change_signal',
                  'parcel_climate_mapping','erp_purchase','material','supplier','material_crop_mapping','fx_reference_assumption',
                  'site','emission_factor','material_factor_resolution','material_site_resolution','erp_site_resolution',
                  'reference_source','evidence_document','evidence_section','method_context','method_evidence',
                  'action_lever','structural_event','transition_scenario','contract_price','price_crop_mapping',
                  'published_inventory','draft_report_line','nature_action_rule','nature_action_candidate']
        for table in tables:
            columns = {r['name'] for r in self.db.execute(f'PRAGMA table_info({table})')}
            documented = {r[0] for r in self.db.execute('SELECT column_name FROM column_lineage WHERE table_name=?', (table,))}
            self.assertEqual(columns, documented)

    def test_monitoring_result_traces_to_exact_source_records(self):
        report = trace(self.db, '04_monitoring_change', 'CA01')
        records = [r for r in report['source_records'] if r['locator'].startswith('csv_line:')]
        payloads = [json.loads(r['raw_json']) for r in records]
        observations = [r for r in payloads if 'total_p_load_kg' in r]
        self.assertEqual(len(observations), 7)
        self.assertTrue(all(r['catchment_id']=='CA01' for r in observations))
        value = json.loads(report['result']['values_json'])
        self.assertEqual(value['p_2025_kg'], float(next(r for r in observations if r['year']=='2025')['total_p_load_kg']))
        self.assertFalse(any(e['table_name']=='parcel' for e in report['entities']))
        self.assertTrue(report['query_run']['lineage_sql_sha256'])

    def test_sources_and_query_text_have_verifiable_hashes(self):
        for row in self.db.execute('SELECT * FROM source_file'):
            self.assertEqual(row['sha256'], hashlib.sha256((DATA/row['relative_path']).read_bytes()).hexdigest())
        for row in self.db.execute('SELECT * FROM query_run'):
            self.assertEqual(row['sql_sha256'], hashlib.sha256(row['sql_text'].encode()).hexdigest())
        source = self.db.execute("SELECT sf.relative_path, sr.locator, sr.raw_json FROM source_record sr JOIN source_file sf USING(source_id) WHERE sf.relative_path LIKE '%monitored_catchment_loads%' LIMIT 1").fetchone()
        with (DATA/source['relative_path']).open(newline='') as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(json.loads(source['raw_json']), rows[int(source['locator'].split(':')[1])-2])

    def test_geojson_nonstandard_nan_is_preserved_as_tag(self):
        count = self.db.execute("SELECT COUNT(*) FROM source_record WHERE raw_json LIKE '%$source_nonfinite_number%'").fetchone()[0]
        self.assertEqual(count, 2518)
        for row in self.db.execute('SELECT raw_json FROM source_record'):
            json.loads(row[0], parse_constant=lambda v: self.fail('Nonstandard JSON token: '+v))

    def test_read_only_access(self):
        with self.assertRaises(sqlite3.OperationalError):
            self.db.execute("DELETE FROM catchment")

    def test_all_years_and_plans_are_preserved(self):
        self.assertEqual(tuple(self.db.execute('SELECT MIN(year),MAX(year),COUNT(DISTINCT year) FROM parcel_crop_year').fetchone()),
                         (2012,2031,20))
        self.assertEqual(tuple(self.db.execute('SELECT MIN(year),MAX(year) FROM farm_crop_observation').fetchone()), (2012,2026))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM parcel_crop_year WHERE crop_status='planned'").fetchone()[0],71065)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM parcel_crop_year WHERE year>2026 AND (observation_id IS NOT NULL OR area_difference_over_5pct IS NOT NULL)').fetchone()[0],0)
        per_year = self.db.execute('SELECT year,COUNT(*) FROM parcel_crop_year GROUP BY year').fetchall()
        self.assertTrue(all(row[1]==14213 for row in per_year))

    def test_all_farming_source_rows_have_snapshots(self):
        for name, count in [('parcel_crop_history_and_plan.csv',284260), ('farm_survey_fi.csv',3437),
                            ('foodhills_odlingsdata_se.csv',2683), ('current_calculator_footprints.csv',3437)]:
            actual = self.db.execute('''SELECT COUNT(*) FROM source_record r JOIN source_file f USING(source_id)
                                        WHERE f.relative_path=?''', ('03_farming/'+name,)).fetchone()[0]
            self.assertEqual(actual,count)

    def test_2025_query_contributors_exclude_other_years(self):
        years = self.db.execute('''SELECT DISTINCT json_extract(e.key_json,'$[1]')
            FROM query_result q JOIN record_dependency d ON d.child_entity_id=q.entity_id
            JOIN entity_record e ON e.entity_id=d.parent_entity_id
            WHERE q.query_run_id='01_contract_area:default' AND e.table_name='parcel_crop_year' ''').fetchall()
        self.assertEqual([r[0] for r in years],[2025])

    def test_historical_lineage_keeps_crop_group_in_the_same_year(self):
        entity = self.db.execute("SELECT entity_id FROM entity_record WHERE table_name='parcel_crop_year' AND json_extract(key_json,'$[1]')=2018 LIMIT 1").fetchone()[0]
        rows = self.db.execute('''WITH RECURSIVE ancestors(entity_id) AS (
            SELECT ? UNION SELECT d.parent_entity_id FROM record_dependency d
            JOIN ancestors a ON d.child_entity_id=a.entity_id
        ) SELECT DISTINCT r.raw_json FROM ancestors a JOIN record_source s USING(entity_id)
          JOIN source_record r USING(source_record_id) JOIN source_file f USING(source_id)
          WHERE f.relative_path='03_farming/parcel_crop_history_and_plan.csv' ''',(entity,)).fetchall()
        self.assertTrue(rows)
        self.assertTrue(all(json.loads(r[0])['year']=='2018' for r in rows))

    def test_existing_footprints_keep_method_and_intensity(self):
        row=self.db.execute('SELECT * FROM current_calculator_footprint ORDER BY farm_id,crop,year LIMIT 1').fetchone()
        with (DATA/'03_farming/current_calculator_footprints.csv').open() as f:
            source=next(r for r in csv.DictReader(f) if (r['farm_id'],r['crop'],int(r['year']))==(row['farm_id'],row['crop'],row['year']))
        self.assertEqual(row['carbon_footprint_kgco2e_per_kg'],float(source['carbon_footprint_kgco2e_per_kg']))
        self.assertEqual(row['calculator_note'],source['calculator_note'])
        self.assertIn('organic-soil',row['calculator_note'])

    def test_quality_candidates_and_scope_are_not_confirmed_errors(self):
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM quality_finding WHERE rule_id='area_difference'").fetchone()[0],85)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM quality_finding WHERE rule_id='missing_management' AND year>2026").fetchone()[0],0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM quality_finding_context WHERE review_status!='unreviewed'").fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM correction_proposal').fetchone()[0],0)

    def test_climate_population_completeness_and_no_scenario_fanout(self):
        self.assertEqual(self.checks['rows']['weather_monthly'],139104)
        self.assertEqual(self.checks['rows']['climate_grid_cell'],84)
        self.assertEqual(self.checks['rows']['climate_change_signal'],36)
        self.assertEqual(self.checks['rows']['parcel_climate_mapping'],14213)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM weather_annual WHERE months_present!=12').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM field_climate_context WHERE year=2028').fetchone()[0],14213*3)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM field_context WHERE year=2028').fetchone()[0],14213)
        self.assertEqual(self.db.execute('''SELECT COUNT(*) FROM parcel_climate_mapping m JOIN parcel p USING(parcel_id)
                       JOIN farm f USING(farm_id) JOIN climate_grid_cell c USING(cell_id) WHERE f.region!=c.region''').fetchone()[0],0)

    def test_erp_mass_and_returns_are_preserved_without_field_fanout(self):
        self.assertEqual(self.checks['rows']['erp_purchase'],7427)
        self.assertEqual(self.checks['rows']['material'],48)
        self.assertEqual(self.checks['rows']['supplier'],86)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM field_sourcing_context').fetchone()[0],284260)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM erp_purchase WHERE uom='EUR' AND quantity_kg IS NOT NULL").fetchone()[0],0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM erp_purchase WHERE uom='TO' AND ABS(quantity_kg-quantity*1000)>0.00001").fetchone()[0],0)
        self.assertGreater(self.db.execute('SELECT COUNT(*) FROM erp_purchase WHERE movement_type=122 AND quantity_kg<0').fetchone()[0],0)

    def test_nondefault_year_and_scenario_execution_has_matching_lineage(self):
        with closing(connect(self.path,writable=True)) as db, db:
            _,rows,run=execute(db,definition_from_db(db,'10_field_weather'),
                               {'year':2028,'scenario':'ssp245','parcel_id':'F0001-P09'},save=True)
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0]['crop_status'],'planned')
            report=trace(db,'10_field_weather',rows[0]['result_key'],run)
            weather=[json.loads(r['raw_json']) for r in report['source_records'] if 'weather_monthly' in next(f['relative_path'] for f in report['source_files'] if f['source_id']==r['source_id'])]
            self.assertEqual(len(weather),12)
            self.assertTrue(all(r['year']=='2028' and r['scenario']=='ssp245' for r in weather))
            stored=json.loads(report['query_run']['parameters_json'])
            self.assertEqual(stored['year'],2028)
            self.assertEqual(stored['scenario'],'ssp245')

    def test_arbitrary_query_year_is_filtered_and_defaults_remain_2025(self):
        definition=definition_from_db(self.db,'01_contract_area')
        _,rows,_=execute(self.db,definition,{'year':2018})
        actual=sum(r['contract_area_ha'] for r in rows)
        expected=self.db.execute('SELECT SUM(area_ha) FROM field_context WHERE year=2018 AND is_contract_crop_provisional=1').fetchone()[0]
        self.assertAlmostEqual(actual,expected,places=6)
        default=json.loads(self.db.execute("SELECT parameters_json FROM query_run WHERE query_run_id='01_contract_area:default'").fetchone()[0])
        self.assertEqual(default,{'year':2025})

    def test_completed_master_and_framework_sources(self):
        self.assertEqual(self.checks['rows']['site'],5)
        self.assertEqual(self.checks['rows']['emission_factor'],84)
        self.assertEqual(self.checks['rows']['reference_source'],36)
        self.assertEqual(self.checks['rows']['evidence_document'],4)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM farm WHERE organic_certified IS NULL OR livestock IS NULL OR joined_year IS NULL OR lat IS NULL OR lon IS NULL').fetchone()[0],0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM material_factor_resolution WHERE resolution_status='unresolved'").fetchone()[0],0)
        self.assertEqual(self.db.execute("SELECT resolution_status FROM material_factor_resolution WHERE material_id='M110'").fetchone()[0],'farm_specific_method')

    def test_action_screen_area_is_conserved_and_not_a_load_estimate(self):
        definition=definition_from_db(self.db,'18_nature_action_opportunities')
        _,rows,_=execute(self.db,definition,{'year':2025,'lever_id':'L10'})
        expected=self.db.execute('''SELECT COUNT(*),SUM(p.area_ha) FROM parcel_crop_year y JOIN parcel p USING(parcel_id)
            WHERE y.year=2025 AND y.crop_status='declared' AND y.is_contract_crop_provisional=1
            AND y.crop IN ('pea','spinach') AND y.catch_crop=0''').fetchone()
        self.assertEqual(sum(r['candidate_field_count'] for r in rows),expected[0])
        self.assertAlmostEqual(sum(r['candidate_area_ha'] for r in rows),expected[1],places=6)
        self.assertTrue(all(r['efficacy_status']=='not_quantified' for r in rows))
        self.assertTrue(all('priority_rank' not in r for r in rows))
        _,pilot,_=execute(self.db,definition,{'year':2025,'planning_year':2027,'lever_id':'L12'})
        self.assertTrue(pilot)
        self.assertTrue(all(r['catalogue_start_year_reached']==0 for r in pilot))

    def test_action_result_traces_fields_lever_and_explanatory_methods(self):
        result=self.db.execute("SELECT result_key FROM query_result WHERE query_run_id='18_nature_action_opportunities:default' AND result_key='CA28:2025:L10'").fetchone()
        self.assertIsNotNone(result)
        report=trace(self.db,'18_nature_action_opportunities',result[0])
        tables={e['table_name'] for e in report['entities']}
        self.assertTrue({'nature_action_candidate','nature_action_rule','action_lever','parcel_crop_year','parcel','catchment'}<=tables)
        context=report['method_context']
        self.assertTrue(any(m['method_id']=='nature_action_screen' and m['implementation_status']=='screening_only' for m in context['methods']))
        self.assertTrue(any(e['reference_verification']=='not_fetched_or_verified' for e in context['evidence']))

    def test_scenario_proxy_and_event_context_do_not_filter_farming(self):
        _,rows,_=execute(self.db,definition_from_db(self.db,'19_scenario_context'))
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['physical_pathway_proxy'],'ssp126')
        self.assertEqual(rows[0]['matching_weather_grid_count'],84)
        self.assertIn('illustrative',rows[0]['value_status'])
        self.assertGreater(self.db.execute("SELECT COUNT(*) FROM farm_crop_observation WHERE source_kind='se_grower_report' AND year<2025").fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT scope3 FROM published_inventory WHERE year=2022').fetchone()[0],201016)
        self.assertEqual(self.db.execute('SELECT scope3_restated FROM published_inventory WHERE year=2022').fetchone()[0],186430)

    def test_method_evidence_recovers_exact_local_source_text(self):
        row=self.db.execute('''SELECT s.*,d.relative_path FROM evidence_section s JOIN evidence_document d USING(document_id)
            WHERE d.relative_path='../docs/NATURE_SBTN.md' AND s.heading='D1 priority formula' ''').fetchone()
        lines=(DATA/row['relative_path']).read_text().splitlines(keepends=True)
        self.assertEqual(row['section_text'],''.join(lines[row['start_line']-1:row['end_line']]))
        self.assertEqual(self.db.execute("SELECT implementation_status FROM method_context WHERE method_id='nature_pressure_state'").fetchone()[0],'planned_not_implemented')


if __name__ == '__main__':
    unittest.main()
