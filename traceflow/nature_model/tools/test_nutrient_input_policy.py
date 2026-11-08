import json
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from build_nutrient_inputs import POLICY, PeerPools, build, entity, prepare, sensitivity
from nature_quality import finding
from test_nutrient_inputs import NutrientInputFixture


class InputPolicyTests(NutrientInputFixture):
    def setUp(self):
        super().setUp()
        self.policy = json.loads(POLICY.read_text())

    def donor(self, index, crop='carrot', country='FI', year=2025, value=10):
        farm = f'D{country}{index}'
        self.put('farm',[farm],dict(farm_id=farm,country=country,region='R',segment='veg',contract_crops=crop))
        self.put('farm_crop_observation',[farm],dict(observation_id=farm,farm_id=farm,crop=crop,
            year=year,source_kind='fi_survey' if country=='FI' else 'se_grower_report',
            p_kg_ha=value,n_mineral_kg_ha=value,n_manure_kg_ha=0,yield_t_ha=value))

    def calculate(self, year=2025):
        return prepare(self.db,year,self.policy)

    def test_peer_median_keeps_zeros_and_blocks_invalid_values(self):
        for index in range(8):
            self.donor(index,value=10+index)
        fields,values,evidence,dependencies,_ = self.calculate()
        lookup = {(r['parcel_id'],r['variant'],r['input_name']):r for r in values}
        self.assertEqual(lookup['P3','reported_only','p_kg_ha']['value'],None)
        estimate = lookup['P3','country_peers','p_kg_ha']
        self.assertEqual((estimate['value'],estimate['donor_count']),(13.5,8))
        self.assertAlmostEqual(estimate['lower_value'],10.7)
        self.assertAlmostEqual(estimate['upper_value'],16.3)
        self.assertEqual(lookup['P1','country_peers','p_kg_ha']['value_kind'],'observed')
        self.assertEqual(lookup['P1','country_peers','p_kg_ha']['value'],0)
        negative = lookup['P1','country_peers','n_mineral_kg_ha']
        self.assertEqual((negative['value'],negative['use_state']),(-2,'blocked_invalid'))
        self.assertIsNone(lookup['P1','country_peers','n_total_candidate_kg_ha']['value'])
        self.assertEqual(lookup['P3','country_peers','n_total_candidate_kg_ha']['value'],13.5)
        total = lookup['P3','country_peers','n_total_candidate_kg_ha']
        self.assertEqual({parent for child,parent in dependencies if child==total['input_id']},
                         {lookup['P3','country_peers',name]['input_id'] for name in ('n_mineral_kg_ha','n_manure_kg_ha')})
        self.assertEqual(len([e for e in evidence if e[0]==estimate['input_id'] and e[2]=='peer_donor']),8)

    def test_report_pools_exclude_target_farm_and_other_years(self):
        reports = [dict(observation_id=str(i),farm_id=str(i),country='FI',crop='pea',year=2025,
                   p_kg_ha=i,n_mineral_kg_ha=None,n_manure_kg_ha=None,n_applied_kg_ha=None,yield_t_ha=None)
                   for i in range(9)]
        reports.append(dict(reports[-1],observation_id='future',farm_id='future',year=2026,p_kg_ha=999))
        pools = PeerPools(reports,[],self.policy,set())
        target = dict(country='FI',crop='pea',year=2025,farm_id='0')
        estimate = pools.estimate(target,'p_kg_ha')
        self.assertEqual(len(estimate['donors']),8)
        self.assertEqual(estimate['value'],4.5)
        self.assertNotIn(entity('farm_crop_observation',['0']),estimate['donors'])
        self.assertNotIn(entity('farm_crop_observation',['future']),estimate['donors'])

    def test_se_proxy_is_separate_and_does_not_invent_manure(self):
        for index in range(8):
            self.donor(index,crop='pea',value=10+index)
        _,values,_,_,evaluation = self.calculate()
        lookup = {(r['parcel_id'],r['variant'],r['input_name']):r for r in values}
        self.assertIsNone(lookup['P4','country_peers','p_kg_ha']['value'])
        proxy = lookup['P4','se_pea_proxy','p_kg_ha']
        self.assertEqual(proxy['reason'],'cross_country_pea_proxy')
        # O1's pea P=0 is one genuine report despite belonging to two fields.
        self.assertEqual(proxy['donor_count'],9)
        self.assertEqual(proxy['value'],13)
        self.assertIsNone(lookup['P4','se_pea_proxy','n_manure_kg_ha']['value'])
        self.assertEqual(lookup['P4','se_pea_proxy','n_total_candidate_kg_ha']['value'],0)
        self.assertFalse(any(r['country']=='SE' and r['input_name']=='p_kg_ha' for r in evaluation))

    def test_flagged_donor_stays_visible_with_quality_evidence(self):
        for index in range(8):
            self.donor(index,value=1000 if index==0 else 10)
        donor_id = entity('farm_crop_observation',['DFI0'])
        finding(self.builder,'peer_outlier',entity=donor_id,year=2025,field='p_kg_ha',
                explanation='Synthetic test outlier, not an approved error')
        _,values,evidence,_,_ = self.calculate()
        record = next(r for r in values if r['parcel_id']=='P3' and r['variant']=='country_peers' and r['input_name']=='p_kg_ha')
        self.assertEqual((record['donor_count'],record['donor_quality_flagged_count']),(8,1))
        self.assertIn((record['input_id'],donor_id,'peer_donor'),evidence)
        self.assertTrue(any(iid==record['input_id'] and role=='donor_quality_context' for iid,_,role in evidence))

    def test_insufficient_donors_and_scope_sensitivity_preserve_denominators(self):
        for index in range(7):
            self.donor(index)
        fields,values,_,_,_ = self.calculate()
        record = next(r for r in values if r['parcel_id']=='P3' and r['variant']=='country_peers' and r['input_name']=='p_kg_ha')
        self.assertIsNone(record['value'])
        report = sensitivity(fields,values)
        for row in report:
            self.assertEqual(row['total_area_ha'],8 if row['scope']=='registry_selected' else 10)
            self.assertAlmostEqual(row['available_area_ha']+row['blocked_area_ha'],row['total_area_ha'])
        with self.assertRaises(ValueError):
            self.calculate(2028)

    def test_soil_groups_exclude_same_farm_and_other_catchments(self):
        parcels = [dict(parcel_id=str(i),farm_id=str(i),country='FI',catchment_id='C1',
                        soil_class_soilmap='clay',p_test_mgl_latest=i+1) for i in range(9)]
        parcels.append(dict(parcels[0],parcel_id='sibling',p_test_mgl_latest=999))
        parcels.append(dict(parcels[-1],parcel_id='other',farm_id='other',catchment_id='C2'))
        pools = PeerPools([],parcels,self.policy,set())
        estimate = pools.estimate(parcels[0],'p_test_mgl_latest')
        self.assertEqual(len(estimate['donors']),8)
        self.assertEqual(estimate['value'],5.5)
        self.assertNotIn(entity('parcel',['sibling']),estimate['donors'])
        self.assertNotIn(entity('parcel',['other']),estimate['donors'])

    def test_artifact_keeps_evidence_and_never_overwrites_source_or_existing_run(self):
        self.db.execute("INSERT INTO build_run VALUES('fixture','2026-11-07','{}','{}')")
        with tempfile.TemporaryDirectory() as tmp:
            source_path = Path(tmp)/'source.sqlite'
            output = Path(tmp)/'experiment'
            self.db.commit()
            with closing(sqlite3.connect(source_path)) as source:
                self.db.backup(source)
            before = source_path.read_bytes()
            with patch('build_nutrient_inputs.check',return_value={'ready':True}):
                report = build(source_path,output)
                self.assertEqual(report['input_records'],5*3*7)
                self.assertGreater(report['raw_evidence_records'],0)
                with self.assertRaises(FileExistsError):
                    build(source_path,output)
            self.assertEqual(source_path.read_bytes(),before)
            with closing(sqlite3.connect(output/'inputs.sqlite')) as artifact:
                source_id = artifact.execute('SELECT source_record_id FROM evidence_record LIMIT 1').fetchone()[0]
                original = artifact.execute('SELECT raw_json FROM evidence_record WHERE source_record_id=?',(source_id,)).fetchone()[0]
                with closing(sqlite3.connect(source_path)) as changed_source, changed_source:
                    changed_source.execute('UPDATE source_record SET raw_json=? WHERE source_record_id=?',('{"changed":true}',source_id))
                self.assertEqual(artifact.execute('SELECT raw_json FROM evidence_record WHERE source_record_id=?',(source_id,)).fetchone()[0],original)
                self.assertFalse(artifact.execute('PRAGMA foreign_key_check').fetchall())
                self.assertEqual(artifact.execute('SELECT COUNT(*) FROM evidence_method_document').fetchone()[0],4)
