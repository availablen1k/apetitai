import csv
import unittest
from build_farming_2025 import DATA
from nature_masters import integral_year,load_masters
from test_nature_quality import small_model


class MasterTests(unittest.TestCase):
    def test_site_years_are_integral_without_rounding(self):
        self.assertEqual(integral_year('2026.0'),2026)
        self.assertIsNone(integral_year(''))
        with self.assertRaises(ValueError):integral_year('2026.5')

    def test_library_factor_and_farm_method_are_distinct(self):
        db,b=small_model();b.data=DATA
        with (DATA/'01_master/materials.csv').open() as f:
            for row in csv.DictReader(f):
                if row['material_id'] in ('M101','M110'): b.insert('material',[row['material_id']],row)
        load_masters(b)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM site').fetchone()[0],5)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM emission_factor').fetchone()[0],84)
        farm=db.execute("SELECT * FROM material_factor_resolution WHERE material_id='M110'").fetchone()
        self.assertEqual(farm['resolution_status'],'farm_specific_method');self.assertIsNone(farm['factor_id'])
        normal=db.execute("SELECT * FROM material_factor_resolution WHERE material_id='M101'").fetchone()
        self.assertEqual(normal['resolution_status'],'library_factor');self.assertIsNotNone(normal['factor_id'])
        self.assertEqual(db.execute("SELECT in_group_to FROM site WHERE site_id='S-PUD'").fetchone()[0],2026)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM quality_finding').fetchone()[0],0)
        db.close()


if __name__=='__main__':unittest.main()
