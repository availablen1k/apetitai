import unittest
from unittest.mock import patch
from nature_climate import distance,load_climate,GRID,WEATHER,SIGNALS
from test_nature_quality import small_model


class ClimateTests(unittest.TestCase):
    def test_haversine_distance_and_coordinate_order(self):
        self.assertEqual(distance(61,22,61,22),0)
        self.assertAlmostEqual(distance(0,0,0,1),111.195,places=2)
        self.assertAlmostEqual(distance(61,22,60,23),distance(60,23,61,22),places=10)

    def test_scenario_is_part_of_the_weather_key(self):
        db,b=small_model()
        b.insert('climate_grid_cell',['G'],dict(cell_id='G',region='FI_SW',lat=61,lon=22,continentality=0,elevation_m=0))
        for scenario in ['ssp126','ssp245','ssp585']:
            row=dict(cell_id='G',scenario=scenario,year=2030,month=1,tmean_c=0,tmax_c_max=5,precip_mm=20,pet_mm=0,hot_days_tmax_ge_27=0)
            b.insert('weather_monthly',['G',scenario,2030,1],row)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM weather_monthly').fetchone()[0],3)
        db.close()

    def test_incomplete_year_is_null_but_complete_calendar_window_is_available(self):
        db,b=small_model()
        grid=dict(cell_id='G',region='FI_SW',lat=61,lon=22,continentality=0,elevation_m=0)
        weather=[dict(cell_id='G',scenario='historical',year=2025,month=m,tmean_c=0,tmax_c_max=5,
                      precip_mm=10,pet_mm=2,hot_days_tmax_ge_27=0) for m in range(1,12)]
        records={GRID:[grid],WEATHER:weather,SIGNALS:[]}
        serial=[0]
        def feed(path):
            for row in records[path]:
                serial[0]+=1
                yield row,b.raw('source','csv_line:'+str(serial[0]),row)
        with patch.object(b,'csv',side_effect=feed): load_climate(b)
        row=db.execute('SELECT * FROM weather_annual').fetchone()
        self.assertEqual(row['months_present'],11)
        self.assertIsNone(row['annual_precip_mm'])
        self.assertEqual(row['apr_sep_precip_mm'],60)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM quality_finding WHERE rule_id='climate_month_gap'").fetchone()[0],1)
        db.close()


if __name__=='__main__': unittest.main()
