"""Coverage partitions, schema missingness, shared-report grain and evidence paths."""
import json
import unittest

from build_nature_model import MODEL, entity_id
from nature_queries import execute
from nature_quality import finding
from test_nature_quality import small_model


def definition():
    entry = next(q for q in json.loads((MODEL/'queries/catalog.json').read_text())
                 if q['id'] == '22_nutrient_input_readiness')
    return dict(entry, sql=(MODEL/'queries'/f"{entry['id']}.sql").read_text(),
                lineage_sql=(MODEL/'queries'/entry['lineage']).read_text())


class NutrientInputFixture(unittest.TestCase):
    def setUp(self):
        self.db, self.builder = small_model()
        self.addCleanup(self.db.close)
        self.db.execute("INSERT INTO transformation VALUES('field_join','fixture join')")
        self.put('catchment', ['C1'], dict(catchment_id='C1', region='R',
                 receiving_water_type='lake', ecological_status_class='moderate',
                 nutrient_retention_frac_estimate=0.2, catchment_area_km2=100,
                 field_area_total_ha=100, p_sensitivity=1, monitoring_station=0))
        for farm, country, contracts in [('F1','FI','pea'), ('F2','SE','pea'), ('F3','FI',None)]:
            self.put('farm', [farm], dict(farm_id=farm,country=country,region='R',
                                         segment='veg',contract_crops=contracts))
        self.put('farm_crop_observation', ['O1'], dict(observation_id='O1',farm_id='F1',
                 crop='pea',year=2025,source_kind='fi_survey',p_kg_ha=0,
                 n_mineral_kg_ha=-2,n_manure_kg_ha=0,yield_t_ha=None))
        self.put('farm_crop_observation', ['O2'], dict(observation_id='O2',farm_id='F2',
                 crop='pea',year=2025,source_kind='se_grower_report',n_applied_kg_ha=0))
        # Two fields share O1; another supported crop has no report.
        for parcel, farm, crop, report, soil in [('P1','F1','pea','O1',0),
                ('P2','F1','pea','O1',None), ('P3','F1','carrot',None,5),
                ('P4','F2','pea','O2',5), ('P5','F3','pea',None,5)]:
            self.put('parcel', [parcel], dict(parcel_id=parcel,farm_id=farm,catchment_id='C1',
                     lat=60,lon=24,area_ha=2,soil_class_soilmap='clay',clay_pct_soilmap=20,
                     slope_pct=1,dist_to_water_m=100,drainage='tile',
                     p_test_mgl_latest=soil,buffer_strip=0))
            for year in (2025,2028):
                self.put('parcel_crop_year', [parcel,year], dict(parcel_id=parcel,year=year,
                         crop=crop,crop_status='declared' if year==2025 else 'planned',
                         catch_crop=0,is_contract_crop_provisional=int(farm!='F3'),
                         observation_id=report if year==2025 else None,
                         management_review_status='unreviewed'))
                child=entity_id('parcel_crop_year',[parcel,year])
                self.builder.dependency(child,'parcel',[parcel],'fixture parcel')
                if report and year==2025:
                    self.builder.dependency(child,'farm_crop_observation',[report],'fixture report')

    def put(self, table, key, row):
        raw=self.builder.raw('source',f'fixture:{table}:{key}',row)
        return self.builder.insert(table,key,row,raw)


class NutrientInputTests(NutrientInputFixture):
    def rows(self, **params):
        return execute(self.db,definition(),params)[1]

    def test_schema_gaps_report_gaps_zero_negative_and_static_missingness(self):
        def statuses(**params):
            return {r['availability_status']:r['field_count'] for r in self.rows(**params)}
        self.assertEqual(statuses(country='FI',crop='pea',input_name='p_kg_ha'),{'reported_zero':2})
        self.assertEqual(statuses(country='FI',crop='pea',input_name='n_mineral_kg_ha'),{'reported_negative':2})
        self.assertEqual(statuses(country='FI',crop='pea',input_name='yield_t_ha'),{'missing_value':2})
        self.assertEqual(statuses(country='FI',crop='carrot',input_name='p_kg_ha'),{'missing_report':1})
        self.assertEqual(statuses(country='SE',input_name='p_kg_ha'),{'not_collected_by_schema':1})
        self.assertEqual(statuses(country='SE',input_name='n_applied_kg_ha'),{'reported_zero':1})
        self.assertEqual(statuses(country='FI',crop='carrot',input_name='n_applied_kg_ha'),{'not_collected_by_schema':1})
        self.assertEqual(statuses(country='FI',crop='pea',input_name='p_test_mgl_latest'),
                         {'missing_value':1,'reported_zero':1})

    def test_area_partition_report_grain_scope_and_plans(self):
        rows=self.rows(selection_status=None)
        for input_name in definition()['parameters']['input_name']['enum']:
            group=[r for r in rows if r['input_name']==input_name]
            self.assertEqual(sum(r['field_count'] for r in group),5)
            self.assertEqual(sum(r['mapped_area_ha'] for r in group),10)
        shared=self.rows(country='FI',crop='pea',input_name='p_kg_ha')[0]
        self.assertEqual((shared['field_count'],shared['distinct_report_count']),(2,1))
        self.assertEqual(sum(r['field_count'] for r in self.rows(input_name='p_kg_ha')),4)
        self.assertEqual(self.rows(input_name='p_kg_ha',selection_status='unknown_contract_list')[0]['field_count'],1)
        planned=self.rows(year=2028,crop_status='planned',input_name='p_kg_ha')
        self.assertTrue(all(r['availability_status']=='not_observed_plan' for r in planned))
        soil=self.rows(year=2028,crop_status='planned',input_name='p_test_mgl_latest')
        self.assertTrue(all(r['input_origin']=='static_parcel' for r in soil))
        self.assertEqual(self.rows(year=2028),[])
        self.assertEqual(self.rows(catchment_id='absent'),[])

    def test_saved_contributors_match_filters_and_quality_review_snapshot(self):
        finding(self.builder,'missing_soil_p',entity=entity_id('parcel',['P2']),
                explanation='fixture missing soil P')
        fid=self.db.execute('SELECT finding_id FROM quality_finding').fetchone()[0]
        supplied=dict(country='FI',crop='pea',input_name='p_kg_ha')
        _,rows,run=execute(self.db,definition(),supplied,save=True)
        self.assertEqual(rows[0]['fields_with_open_quality_findings'],1)
        self.assertEqual(rows[0]['fields_with_area_discrepancy'],0)
        parents=self.db.execute('''SELECT e.table_name,e.key_json FROM query_result r
            JOIN record_dependency d ON d.child_entity_id=r.entity_id
            JOIN entity_record e ON e.entity_id=d.parent_entity_id
            WHERE r.query_run_id=?''',(run,)).fetchall()
        self.assertEqual({tuple(json.loads(r['key_json'])) for r in parents if r['table_name']=='parcel_crop_year'},
                         {('P1',2025),('P2',2025)})
        self.assertIn('quality_finding',{r['table_name'] for r in parents})
        self.db.execute("INSERT INTO quality_review VALUES(1,?,'dismissed','Reviewer','2026-11-07','Checked')",(fid,))
        _,later,later_run=execute(self.db,definition(),supplied,save=True)
        self.assertEqual(later[0]['fields_with_open_quality_findings'],0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM query_review_snapshot WHERE query_run_id=?',(later_run,)).fetchone()[0],1)
        self.assertEqual(json.loads(self.db.execute('SELECT values_json FROM query_result WHERE query_run_id=?',(run,)).fetchone()[0])['fields_with_open_quality_findings'],1)


if __name__ == '__main__':
    unittest.main()
