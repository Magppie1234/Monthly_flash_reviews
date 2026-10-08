#!/usr/bin/env python3
"""Independently compare recovered payloads to every mapped CSV cell and ID."""
import csv
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECOVERY = ROOT / '.private/recovered-exports/2026-08-10-full'
SNAPSHOT = ROOT / '.private/offline-snapshot'


def audit():
    manifest = json.loads((RECOVERY / 'manifest.json').read_text())
    result = {'source_org_id': manifest['source_org_id'], 'modules': {}, 'relationships': {}, 'discrepancies': []}
    records = {p.stem: json.loads(p.read_text()) for p in (SNAPSHOT / 'records').glob('*.json')}
    indexes = {m: {row['id']: row for row in rows} for m, rows in records.items()}
    historical = {m: json.loads((RECOVERY / 'records' / (m + '.json')).read_text()) for m in manifest['modules']}
    historical_indexes = {m: {row['id']: row for row in rows} for m, rows in historical.items()}
    for module, scope in manifest['modules'].items():
        mapping = json.loads((RECOVERY / 'mapping' / (module + '.json')).read_text())['mapped_fields']
        source = RECOVERY / 'raw' / scope['source_filename']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == scope['source_sha256']
        with source.open(encoding='utf-8-sig', newline='') as stream:
            raw = list(csv.DictReader(stream))
        source_ids = [row['Record Id'].removeprefix('zcrm_') for row in raw]
        assert len(set(source_ids)) == len(source_ids)
        assert set(source_ids) == set(historical_indexes[module])
        checked = 0
        for row in raw:
            record_id = row['Record Id'].removeprefix('zcrm_')
            target = historical_indexes[module][record_id]
            for header, api in mapping.items():
                actual = target.get(api)
                expected = row[header]
                if api == 'id':
                    comparable = actual
                    expected = expected.removeprefix('zcrm_')
                elif header.endswith('.id'):
                    comparable = actual.get('id', '') if isinstance(actual, dict) else ''
                    expected = expected.removeprefix('zcrm_')
                elif isinstance(actual, dict):
                    comparable = actual.get('name', '')
                elif isinstance(actual, bool):
                    comparable = str(actual).lower()
                elif isinstance(actual, list):
                    comparable = ';'.join(actual)
                elif isinstance(actual, str) and len(expected) == 19 and expected[10] == ' ' and actual.endswith('+05:30'):
                    comparable = actual[:19].replace('T', ' ')
                else:
                    comparable = actual
                checked += 1
                if comparable != expected:
                    result['discrepancies'].append({'module': module, 'id': record_id, 'header': header, 'reason': 'CELL_MISMATCH'})
        result['modules'][module] = {'source_count': len(raw), 'recovered_count': len(historical[module]), 'active_snapshot_count': len(records[module]),
            'source_ids_exact': True, 'mapped_cells_compared': checked,
            'unmapped_headers': scope['unmapped_headers'], 'export_date': scope['export_date']}
    for module, field, parent in [('Visit_Module', 'Client_Name', 'Contacts'),
                                   ('Product_Details1', 'Parent_Id', 'Contacts'),
                                   ('Product_Details1', 'Project_Name', 'Deals'),
                                   ('Service_A_X_Orders', 'Installations_Services', 'Visit_Module'),
                                   ('Service_A_X_Orders', 'Orders_Name', 'Deals')]:
        linked = [row[field]['id'] for row in records[module] if isinstance(row.get(field), dict) and row[field].get('id')]
        absent = sum(key not in indexes.get(parent, {}) for key in linked)
        result['relationships'][module + '.' + field] = {'target': parent, 'references': len(linked),
            'present_in_current_cache': len(linked) - absent, 'missing_from_current_cache': absent}
    pairs = [(row['Installations_Services']['id'], row['Orders_Name']['id']) for row in records['Service_A_X_Orders']]
    result['visit_order_pair_duplicates'] = len(pairs) - len(set(pairs))
    result['discrepancy_count'] = len(result['discrepancies'])
    report = RECOVERY / 'reconciliation.json'
    with report.open('w') as stream:
        os.chmod(report, 0o600)
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({key: value for key, value in result.items() if key != 'discrepancies'}, indent=2))
    if result['discrepancy_count']:
        raise SystemExit('Recovered payload comparison failed')


if __name__ == '__main__':
    audit()
