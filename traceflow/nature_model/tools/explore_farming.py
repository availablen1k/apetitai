"""Profile the supplied farming data without modifying it. Python 3 stdlib only."""
import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


from paths import ROOT,DATA


def read(relative, delimiter=','):
    with (DATA / relative).open(encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f, delimiter=delimiter))


def key(row):
    return row['farm_id'], row['crop'], row['year']


def duplicate_count(rows, fields):
    return len(rows) - len({tuple(r[f] for f in fields) for r in rows})


def profile(rows, keys, year_field='year'):
    columns = {}
    for column in rows[0]:
        values = [r[column] for r in rows if r[column] != '']
        counts = Counter(values)
        info = {'missing': len(rows) - len(values), 'distinct': len(counts)}
        if len(counts) <= 20:
            info['values'] = dict(sorted(counts.items()))
        try:
            numbers = [float(v.replace(',', '.')) for v in values]
            if numbers:
                info['numeric_min'] = min(numbers)
                info['numeric_max'] = max(numbers)
        except ValueError:
            pass
        columns[column] = info
    return {
        'rows': len(rows), 'candidate_key': keys,
        'duplicate_key_rows': duplicate_count(rows, keys),
        'rows_by_year': dict(sorted(Counter(r[year_field] for r in rows).items())),
        'columns': columns,
    }


def explore():
    survey = read('03_farming/farm_survey_fi.csv')
    swedish = read('03_farming/foodhills_odlingsdata_se.csv', ';')
    history = read('03_farming/parcel_crop_history_and_plan.csv')
    footprints = read('03_farming/current_calculator_footprints.csv')
    farms = {r['farm_id']: r for r in read('01_master/farm_registry.csv')}
    parcels = {r['parcel_id']: r for r in read('01_master/parcels.csv')}
    catchments = {r['catchment_id']: r for r in read('06_nature/catchments.csv')}
    survey_keys = {key(r) for r in survey}
    footprint_keys = {key(r) for r in footprints}
    swedish_keys = {(r['odlar_id'], 'pea', r['skördeår']) for r in swedish}
    history_keys = {key(r) for r in history}
    groups = defaultdict(list)
    for r in history:
        groups[key(r)].append(r)

    coverage = {}
    for year in sorted({r['year'] for r in history}):
        year_groups = [k for k in groups if k[2] == year]
        result = {}
        for country, available in [('FI', survey_keys), ('SE', swedish_keys)]:
            contract_groups = [k for k in year_groups
                               if farms[k[0]]['country'] == country
                               and k[1] in farms[k[0]]['contract_crops'].split(';')]
            total_area = sum(float(parcels[r['parcel_id']]['area_ha'])
                             for k in contract_groups for r in groups[k])
            matched_area = sum(float(parcels[r['parcel_id']]['area_ha'])
                               for k in contract_groups if k in available for r in groups[k])
            result[country] = {
                'contract_farm_crop_year_groups': len(contract_groups),
                'groups_with_observation': sum(k in available for k in contract_groups),
                'parcel_area_ha': round(total_area, 2),
                'parcel_area_with_observation_ha': round(matched_area, 2),
            }
        coverage[year] = result

    mismatches = []
    for r in survey:
        if key(r) not in groups:
            continue
        area = sum(float(parcels[h['parcel_id']]['area_ha']) for h in groups[key(r)])
        reported = float(r['area_ha'])
        if area and abs(reported - area) / area > 0.05:
            mismatches.append({'survey_id': r['survey_id'], 'farm_id': r['farm_id'],
                               'crop': r['crop'], 'year': r['year'],
                               'reported_area_ha': reported, 'parcel_area_ha': round(area, 2)})

    farm_catchments = defaultdict(set)
    for r in parcels.values():
        farm_catchments[r['farm_id']].add(r['catchment_id'])
    example_key = next(k for k in groups if k[2] == '2025' and k in survey_keys)
    example_survey = next(r for r in survey if key(r) == example_key)
    return {
        'scope': 'Raw-data exploration; no cleaning, nutrient estimation or ranking.',
        'tables': {
            'farm_survey_fi': profile(survey, ['survey_id']),
            'foodhills_odlingsdata_se': profile(swedish, ['odlar_id', 'gröda', 'skördeår'], 'skördeår'),
            'parcel_crop_history_and_plan': profile(history, ['parcel_id', 'year']),
            'current_calculator_footprints': profile(footprints, ['farm_id', 'crop', 'year']),
        },
        'relationships': {
            'survey_duplicate_farm_crop_year_rows': duplicate_count(survey, ['farm_id', 'crop', 'year']),
            'history_unknown_farm_rows': sum(r['farm_id'] not in farms for r in history),
            'history_unknown_parcel_rows': sum(r['parcel_id'] not in parcels for r in history),
            'history_farm_parcel_owner_mismatch_rows': sum(
                r['farm_id'] != parcels[r['parcel_id']]['farm_id'] for r in history if r['parcel_id'] in parcels),
            'survey_unknown_farm_rows': sum(r['farm_id'] not in farms for r in survey),
            'swedish_unknown_farm_rows': sum(r['odlar_id'] not in farms for r in swedish),
            'parcel_unknown_catchment_rows': sum(r['catchment_id'] not in catchments for r in parcels.values()),
            'survey_keys_without_history': len(survey_keys - history_keys),
            'swedish_keys_without_history': len(swedish_keys - history_keys),
            'footprint_keys_without_survey': len(footprint_keys - survey_keys),
            'survey_keys_without_footprint': len(survey_keys - footprint_keys),
            'farms_spanning_multiple_catchments': sum(len(v) > 1 for v in farm_catchments.values()),
        },
        'contract_crop_selection': 'Provisional: history.crop in farm_registry.contract_crops for that farm; static registry, not proof of annual delivery.',
        'contract_crop_coverage_by_year': coverage,
        'survey_area_difference_over_5pct': {'count': len(mismatches), 'examples': mismatches[:10]},
        'parcel_soil_p_missing': sum(r['p_test_mgl_latest'] == '' for r in parcels.values()),
        'example_2025_join': {
            'survey': example_survey,
            'parcels': [dict(h, area_ha=parcels[h['parcel_id']]['area_ha'],
                             catchment_id=parcels[h['parcel_id']]['catchment_id'])
                        for h in groups[example_key]],
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'analysis/farming/profile.json')
    args = parser.parse_args()
    report = explore()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {args.output}')
    print(json.dumps({k: report[k] for k in ['relationships', 'survey_area_difference_over_5pct', 'example_2025_join']}, ensure_ascii=False, indent=2))
    print('2025 contract crop coverage:')
    print(json.dumps(report['contract_crop_coverage_by_year']['2025'], indent=2))


if __name__ == '__main__':
    main()
