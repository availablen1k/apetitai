import unittest
from pathlib import Path
from unittest.mock import patch
from test_nature_quality import small_model
from nature_sourcing import currency_factors,load_sourcing,MATERIALS,SUPPLIERS,ERP
from build_farming_2025 import DATA


class SourcingTests(unittest.TestCase):
    def test_package_fx_assumptions_are_read_without_executing_package_code(self):
        self.assertEqual(currency_factors(DATA.parent),{'EUR':1.0,'SEK':11.4,'USD':1.08})

    def test_erp_business_duplicates_can_coexist(self):
        db,b=small_model()
        b.insert('fx_reference_assumption',['EUR'],dict(currency='EUR',units_per_eur=1,source_reference='fixture',interpretation='reference'))
        row=dict(purchase_record_id='one',doc_no='D1',line_no=10,posting_date='2025-01-01',year=2025,
                 company_code='C',plant='P',material_id='unknown',material_text='test',supplier_id='unknown',quantity=2,uom='TO',
                 net_amount=100,currency='EUR',origin_country='FI',lot_id=None,movement_type=101,reference_doc=None,wbs_element=None,
                 resolved_material_id=None,resolved_supplier_id=None,farm_id=None,quantity_kg=2000,amount_eur_reference_rate=100,fx_currency='EUR')
        b.insert('erp_purchase',['one'],row)
        b.insert('erp_purchase',['two'],dict(row,purchase_record_id='two'))
        self.assertEqual(db.execute('SELECT COUNT(*) FROM erp_purchase WHERE doc_no=?',('D1',)).fetchone()[0],2)
        self.assertEqual(db.execute('SELECT SUM(quantity_kg) FROM erp_purchase').fetchone()[0],4000)
        db.close()

    def test_duplicate_returns_unknown_currency_and_spend_remain_investigable(self):
        db,b=small_model()
        material=dict(material_id='M110',erp_name='Peas',name_en='Peas',material_group='vegetables',base_uom='kg',
                      default_ef_id='FARM',receiving_site='S',origin_countries='FI',eudr_commodity=0,sbtn_high_impact_commodity=0)
        b.insert('farm',['F1'],dict(farm_id='F1',country='FI',region='FI_SW',segment='veg',contract_crops='pea'))
        receipt=dict(doc_no='D1',line_no='10',posting_date='2025-01-01',company_code='C',plant='S',material_id='M110',
                     material_text='Peas',supplier_id='F1',quantity='2',uom='KG',net_amount='4',currency='EUR',
                     origin_country='FI',lot_id='',movement_type='101',reference_doc='',wbs_element='')
        rows=[receipt,dict(receipt),dict(receipt,doc_no='D2',quantity='-1',uom='TO',net_amount='-100',movement_type='122'),
              dict(receipt,doc_no='D3',currency='ZZZ'),dict(receipt,doc_no='D4',quantity='100',uom='EUR',net_amount='100')]
        records={MATERIALS:[material],SUPPLIERS:[],ERP:rows}
        serial=[0]
        def feed(path):
            for row in records[path]:
                serial[0]+=1
                yield row,b.raw('source','csv_line:'+str(serial[0]),row)
        with patch.object(b,'csv',side_effect=feed),patch('nature_sourcing.currency_factors',return_value={'EUR':1}):
            load_sourcing(b)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM erp_purchase').fetchone()[0],5)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM quality_finding WHERE rule_id='erp_business_duplicate'").fetchone()[0],1)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM quality_finding WHERE rule_id='erp_sign_review'").fetchone()[0],0)
        self.assertEqual(db.execute("SELECT quantity_kg FROM erp_purchase WHERE doc_no='D2'").fetchone()[0],-1000)
        self.assertIsNone(db.execute("SELECT amount_eur_reference_rate FROM erp_purchase WHERE doc_no='D3'").fetchone()[0])
        self.assertIsNone(db.execute("SELECT quantity_kg FROM erp_purchase WHERE doc_no='D4'").fetchone()[0])
        db.close()


if __name__=='__main__': unittest.main()
