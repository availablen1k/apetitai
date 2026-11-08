"""Build a traceable 2025 field view. Python 3 standard library; no imputation."""
import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

from paths import ROOT,DATA
SOURCES = {
    'history': '03_farming/parcel_crop_history_and_plan.csv',
    'farms': '01_master/farm_registry.csv',
    'parcels': '01_master/parcels.csv',
    'catchments': '06_nature/catchments.csv',
    'fi': '03_farming/farm_survey_fi.csv',
    'se': '03_farming/foodhills_odlingsdata_se.csv',
}
# Canonical management measurements shared with fields. Empty means unknown.
MEASUREMENTS = {
    'soil_type_reported': ('string', None),
    'n_mineral_kg_ha': ('number', 'kg N/ha'),
    'n_manure_kg_ha': ('number', 'kg N/ha'),
    'n_applied_kg_ha': ('number', 'kg N/ha'),
    'p_kg_ha': ('number', 'kg P/ha'),
    'fertiliser_product': ('string', None),
    'diesel_l_ha': ('number', 'L/ha'),
    'lime_t_ha': ('number', 't/ha'),
    'sprays': ('number', 'passes'),
    'irrigated': ('boolean', None),
    'catch_crop_share': ('number', 'fraction'),
    'yield_t_ha': ('number', 't harvested/ha'),
}


def boolean(value):
    if value == '':
        return ''
    mapping = {'True': 'true', 'False': 'false', 'ja': 'true', 'nej': 'false'}
    if value not in mapping:
        raise ValueError(f'Unrecognised boolean: {value!r}')
    return mapping[value]


def numeric(value):
    return str(Decimal(value.replace(',', '.'))) if value != '' else ''


def load(data, name):
    with (data / SOURCES[name]).open(encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f, delimiter=';' if name == 'se' else ',')
        for row in reader:
            yield dict(row, source_file=SOURCES[name], source_csv_line=reader.line_num)


def index(rows, fields):
    result = {}
    for row in rows:
        key = tuple(row[f] for f in fields)
        if key in result:
            raise ValueError(f'Duplicate key {fields}: {key}')
        result[key] = row
    return result


def observation(row, country):
    se = country == 'SE'
    if se and row['gröda'] != 'Ärt (frysärt)':
        raise ValueError(f'Unmapped Swedish crop: {row["gröda"]}')
    farm = row['odlar_id'] if se else row['farm_id']
    crop = 'pea' if se else row['crop']
    year = row['skördeår'] if se else row['year']
    record_key = f'{farm}:pea:{year}' if se else row['survey_id']
    obs = {
        'observation_id': f'{country.lower()}:{record_key}',
        'farm_id': farm, 'crop': crop, 'year': year,
        'source_kind': 'se_grower_report' if se else 'fi_survey',
        'source_file': row['source_file'], 'source_csv_line': row['source_csv_line'],
        'source_record_key': record_key,
        'reported_area_ha': numeric(row['areal_ha'] if se else row['area_ha']),
        'delivered_t': numeric(row['levererad_mängd_ton']) if se else '',
    }
    for name, (kind, _) in MEASUREMENTS.items():
        source_name = {'diesel_l_ha': 'diesel_l_ha', 'irrigated': 'bevattnad',
                       'n_applied_kg_ha': 'kvävegiva_kg_ha'}.get(name) if se else name
        value = row.get(source_name, '')
        obs[name] = boolean(value) if kind == 'boolean' else numeric(value) if kind == 'number' else value
    # FI has separate mineral/manure N rates; do not manufacture a total observation.
    return obs


def build(data=DATA, year=2025):
    """Build one requested year; the standalone CSV export defaults to 2025."""
    year = str(year)
    farms = index(load(data, 'farms'), ['farm_id'])
    parcels = index(load(data, 'parcels'), ['parcel_id'])
    catchments = index(load(data, 'catchments'), ['catchment_id'])
    history = [r for r in load(data, 'history') if r['year'] == year]
    if not history:
        raise ValueError(f'No {year} history rows')
    index(history, ['parcel_id', 'year'])
    observations = [observation(r, country) for name, country, year_key in
                    [('fi', 'FI', 'year'), ('se', 'SE', 'skördeår')]
                    for r in load(data, name) if r[year_key] == year]
    obs_index = index(observations, ['farm_id', 'crop', 'year'])
    index(observations, ['observation_id'])
    group_areas = defaultdict(Decimal)
    for h in history:
        p = parcels[(h['parcel_id'],)]
        if p['farm_id'] != h['farm_id']:
            raise ValueError(f'Parcel owner mismatch: {h["parcel_id"]}')
        area = Decimal(p['area_ha'])
        if area <= 0:
            raise ValueError(f'Nonpositive mapped area: {h["parcel_id"]}')
        group_areas[(h['farm_id'], h['crop'], h['year'])] += area
    history_keys = set(group_areas)
    for o in observations:
        if (o['farm_id'],) not in farms or (o['farm_id'], o['crop'], o['year']) not in history_keys:
            raise ValueError(f'Observation has no matching farm/crop history: {o["observation_id"]}')

    fields = []
    for h in sorted(history, key=lambda r: r['parcel_id']):
        p = parcels[(h['parcel_id'],)]
        f = farms[(h['farm_id'],)]
        c = catchments[(p['catchment_id'],)]
        key = (h['farm_id'], h['crop'], h['year'])
        o = obs_index.get(key)
        if o and ((o['source_kind'] == 'fi_survey') != (f['country'] == 'FI')):
            raise ValueError(f'Observation country mismatch: {o["observation_id"]}')
        contract = h['crop'] in f['contract_crops'].split(';')
        group_area = group_areas[key]
        reported_area = Decimal(o['reported_area_ha']) if o and o['reported_area_ha'] else None
        row = {
            'parcel_id': h['parcel_id'], 'farm_id': h['farm_id'], 'year': year,
            'crop': h['crop'], 'crop_status': h['status'],
            'parcel_catch_crop': boolean(h['catch_crop']),
            'country': f['country'], 'farm_region': f['region'],
            'is_contract_crop_provisional': str(contract).lower(),
            'parcel_area_ha': numeric(p['area_ha']),
            'farm_crop_mapped_area_ha': str(group_area),
            'parcel_share_of_farm_crop_area': str(Decimal(p['area_ha']) / group_area),
            'parcel_lat': numeric(p['lat']), 'parcel_lon': numeric(p['lon']),
            'soil_class_soilmap': p['soil_class_soilmap'],
            'clay_pct_soilmap': numeric(p['clay_pct_soilmap']),
            'slope_pct': numeric(p['slope_pct']), 'dist_to_water_m': numeric(p['dist_to_water_m']),
            'drainage': p['drainage'], 'p_test_mgl_latest': numeric(p['p_test_mgl_latest']),
            'soil_p_missing': str(p['p_test_mgl_latest'] == '').lower(),
            'buffer_strip': boolean(p['buffer_strip']), 'catchment_id': p['catchment_id'],
            'catchment_region': c['region'], 'receiving_water_type': c['receiving_water_type'],
            'ecological_status_class': c['ecological_status_class'],
            'nutrient_retention_frac_estimate': numeric(c['nutrient_retention_frac_estimate']),
            'p_sensitivity': numeric(c['p_sensitivity']),
            'management_observation_id': o['observation_id'] if o else '',
            'management_status': 'reported_at_farm_crop_year' if o else 'missing_observation',
            'management_source_file': o['source_file'] if o else '',
            'management_source_csv_line': o['source_csv_line'] if o else '',
            'area_difference_over_5pct': str(abs(reported_area - group_area) / group_area > Decimal('.05')).lower()
                if reported_area is not None else '',
            'management_review_status': 'unreviewed' if o else 'not_applicable',
        }
        for name in MEASUREMENTS:
            row['reported_' + name] = o[name] if o else ''
        row['missing_management_fields'] = ';'.join(name for name in MEASUREMENTS if not o or o[name] == '')
        row['missing_management_reason'] = ('not_collected_in_source' if o else
                                            'no_matching_report' if contract else 'no_matching_report_noncontract_crop')
        for prefix, source in [('history', h), ('parcel', p), ('farm', f), ('catchment', c)]:
            row[prefix + '_source_file'] = source['source_file']
            row[prefix + '_source_csv_line'] = source['source_csv_line']
        fields.append(row)
    return fields, sorted(observations, key=lambda r: r['observation_id'])


def summary(fields, observations):
    coverage = {}
    for country in sorted({r['country'] for r in fields}):
        rows = [r for r in fields if r['country'] == country and r['is_contract_crop_provisional'] == 'true']
        coverage[country] = {
            'contract_fields': len(rows),
            'mapped_area_ha': str(sum((Decimal(r['parcel_area_ha']) for r in rows), Decimal(0))),
            'fields_with_management_observation': sum(bool(r['management_observation_id']) for r in rows),
            'fields_missing_soil_p': sum(r['soil_p_missing'] == 'true' for r in rows),
            'missing_management_fields': {name: sum(r['reported_' + name] == '' for r in rows) for name in MEASUREMENTS},
        }
    return {'year': 2025, 'field_rows': len(fields), 'observation_rows': len(observations),
            'fields_by_crop': dict(sorted(Counter(r['crop'] for r in fields).items())),
            'contract_coverage_by_country': coverage}


def write_csv(path, rows):
    with path.open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=DATA)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'analysis/farming/2025')
    args = parser.parse_args()
    fields, observations = build(args.data_dir)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(args.output_dir / 'field_year_2025.csv', fields)
    write_csv(args.output_dir / 'farm_crop_observations_2025.csv', observations)
    report = summary(fields, observations)
    report['source_sha256'] = {path: hashlib.sha256((args.data_dir / path).read_bytes()).hexdigest()
                               for path in SOURCES.values()}
    report['builder_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    (args.output_dir / 'summary.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
