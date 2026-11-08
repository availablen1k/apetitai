"""Data-contract and join checks for the 2025 farming view."""
import unittest
from collections import defaultdict
from decimal import Decimal

from build_farming_2025 import DATA, build, index, load, observation


class FarmingViewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fields, cls.observations = build()
        cls.obs = {o['observation_id']: o for o in cls.observations}

    def test_left_join_preserves_all_2025_fields_and_area(self):
        source_history = [r for r in load(DATA, 'history') if r['year'] == '2025']
        source_parcels = {r['parcel_id']: r for r in load(DATA, 'parcels')}
        self.assertEqual({r['parcel_id'] for r in source_history}, {r['parcel_id'] for r in self.fields})
        self.assertEqual(len(source_history), len(self.fields))
        source_area = sum(Decimal(source_parcels[r['parcel_id']]['area_ha']) for r in source_history)
        self.assertEqual(source_area, sum(Decimal(r['parcel_area_ha']) for r in self.fields))
        self.assertTrue(all(r['year'] == '2025' and r['crop_status'] == 'declared' for r in self.fields))

    def test_observations_match_crop_and_year_without_field_totals(self):
        for row in self.fields:
            if row['management_observation_id']:
                obs = self.obs[row['management_observation_id']]
                self.assertEqual((row['farm_id'], row['crop'], row['year']),
                                 (obs['farm_id'], obs['crop'], obs['year']))
            self.assertNotIn('reported_area_ha', row)
            self.assertNotIn('delivered_t', row)

    def test_missing_observations_and_measured_zero_are_distinct(self):
        missing = [r for r in self.fields if r['is_contract_crop_provisional'] == 'true'
                   and r['country'] == 'FI' and not r['management_observation_id']]
        self.assertEqual(len(missing), 398)
        self.assertTrue(all(r['reported_p_kg_ha'] == '' for r in missing))
        measured_zero = [r for r in self.fields if r['management_observation_id']
                         and r['reported_n_manure_kg_ha'] != ''
                         and Decimal(r['reported_n_manure_kg_ha']) == 0]
        self.assertTrue(measured_zero)
        self.assertTrue(all('n_manure_kg_ha' not in r['missing_management_fields'].split(';')
                            for r in measured_zero))

    def test_swedish_schema_does_not_invent_phosphorus_or_yield(self):
        for row in self.fields:
            if row['country'] == 'SE' and row['management_observation_id']:
                self.assertEqual(row['reported_p_kg_ha'], '')
                self.assertEqual(row['reported_yield_t_ha'], '')
                self.assertEqual(row['reported_n_mineral_kg_ha'], '')
                self.assertNotEqual(row['reported_n_applied_kg_ha'], '')
        raw = next(r for r in load(DATA, 'se') if r['skördeår'] == '2025')
        normalized = observation(raw, 'SE')
        self.assertEqual(Decimal(normalized['reported_area_ha']), Decimal(raw['areal_ha'].replace(',', '.')))
        self.assertEqual(normalized['irrigated'], {'ja': 'true', 'nej': 'false'}[raw['bevattnad']])

    def test_allocation_weights_conserve_each_farm_crop_group(self):
        weights = defaultdict(Decimal)
        for row in self.fields:
            weights[(row['farm_id'], row['crop'], row['year'])] += Decimal(row['parcel_share_of_farm_crop_area'])
        self.assertTrue(all(abs(total - 1) < Decimal('1e-24') for total in weights.values()))

    def test_area_discrepancy_is_preserved_for_review(self):
        rows = [r for r in self.fields if r['management_observation_id'] == 'fi:FS00009']
        self.assertEqual({r['parcel_id'] for r in rows}, {'F0001-P09', 'F0001-P14'})
        self.assertEqual(sum(Decimal(r['parcel_area_ha']) for r in rows), Decimal('9.31'))
        self.assertEqual(self.obs['fi:FS00009']['reported_area_ha'], '12.56')
        self.assertTrue(all(r['area_difference_over_5pct'] == 'true'
                            and r['management_review_status'] == 'unreviewed' for r in rows))

    def test_duplicate_keys_rejected_and_unsupported_codes_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate key'):
            index([{'parcel_id': 'P1'}, {'parcel_id': 'P1'}], ['parcel_id'])
        raw = next(load(DATA, 'se'))
        with self.assertRaisesRegex(ValueError, 'Unmapped Swedish crop'):
            observation(dict(raw, gröda='unknown'), 'SE')

    def test_source_lineage_resolves(self):
        for name, prefix, id_field in [('parcels', 'parcel', 'parcel_id'),
                                       ('history', 'history', 'parcel_id'),
                                       ('farms', 'farm', 'farm_id'),
                                       ('catchments', 'catchment', 'catchment_id')]:
            source = {r['source_csv_line']: r for r in load(DATA, name)}
            for row in self.fields:
                record = source[row[prefix + '_source_csv_line']]
                self.assertEqual(record[id_field], row[id_field])
                self.assertEqual(record['source_file'], row[prefix + '_source_file'])


if __name__ == '__main__':
    unittest.main()
