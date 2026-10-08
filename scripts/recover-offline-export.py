#!/usr/bin/env python3
"""Recover provided historical CRM exports privately, without any network access.

Raw CSV bytes and headers are retained, checksummed, and never overwritten.
Only unambiguous metadata labels/API names become executable record fields.
This is historical recovery, not a current-state Zoho reconciliation/import.
"""
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
from datetime import datetime
from zoneinfo import ZoneInfo
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'Zoho_CRM_Complete_AI_Continuation_Pack_2026-08-10/'
SPECS = [
    ('Contacts', 'Qualified_Leads_2026_08_08.csv', 4410, '2026-08-08'),
    ('Deals', 'Orders_2026_08_09.csv', 5768, '2026-08-09'),
    ('Visit_Module', 'Visit_Module_2026_08_08.csv', 6531, '2026-08-08'),
    ('Product_Details1', 'Qualified_Leads_Product_Detail_2026_08_09.csv', 5896, '2026-08-09'),
    ('Service_A_X_Orders', 'Visit_A_X_Orders_2026_08_09.csv', 13483, '2026-08-09'),
]
LOOKUPS = {'lookup', 'ownerlookup', 'userlookup', 'layout'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def ident(value):
    value = re.sub(r'^zcrm_', '', value.strip())
    if not re.fullmatch(r'[0-9]{8,32}', value):
        raise ValueError('Invalid exported identifier')
    return value


def field_map(headers, fields):
    """Exact label first, exact underscore-to-space API spelling second."""
    mapping, unmapped = {}, []
    for header in headers:
        label = header[:-3] if header.endswith('.id') else header
        candidates = [f for f in fields if f.get('field_label') == label]
        if not candidates:
            candidates = [f for f in fields if f.get('api_name', '').replace('_', ' ') == label]
        if header == 'Record Id':
            candidates = [{'api_name': 'id', 'data_type': 'bigint'}]
        if len(candidates) != 1:
            unmapped.append(header)
            continue
        field = candidates[0]
        if header.endswith('.id') and field.get('data_type') not in LOOKUPS:
            unmapped.append(header)
            continue
        mapping[header] = field
    # Two independent display labels must never silently overwrite one API field.
    assignments = {}
    for header, field in mapping.items():
        slot = (field['api_name'], header.endswith('.id'))
        if slot in assignments:
            raise ValueError('Ambiguous export field mapping')
        assignments[slot] = header
    return mapping, unmapped


def convert(value, field, zone):
    if value == '':
        return ''  # CSV cannot distinguish null from empty; preserve its empty cell.
    kind = field.get('data_type')
    if kind == 'boolean':
        if value not in ('true', 'false'):
            raise ValueError('Invalid exported boolean')
        return value == 'true'
    if kind == 'date':
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError('Invalid exported date')
        return datetime.strptime(value, '%Y-%m-%d').date().isoformat()
    if kind == 'datetime':
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo(zone))
        return parsed.isoformat()
    if kind == 'multiselectpicklist':
        return value.split(';')
    # Retain all financial decimal text exactly; never pass IDs/money through float.
    return value


def parse_export(content, fields, zone):
    reader = csv.DictReader(io.StringIO(content.decode('utf-8-sig'), newline=''))
    headers = reader.fieldnames or []
    if len(set(headers)) != len(headers) or 'Record Id' not in headers:
        raise ValueError('Invalid export headers')
    mapping, unmapped = field_map(headers, fields)
    records, seen, issues = [], set(), []
    for number, row in enumerate(reader, 2):
        if None in row or any(value is None for value in row.values()):
            raise ValueError('Malformed export row')
        record_id = ident(row['Record Id'])
        if record_id in seen:
            raise ValueError('Duplicate exported record ID')
        seen.add(record_id)
        record = {'id': record_id}
        for header, field in mapping.items():
            api = field['api_name']
            if api == 'id':
                continue
            if header.endswith('.id'):
                continue  # Process name and ID atomically below.
            value = row[header]
            try:
                if field.get('data_type') in LOOKUPS:
                    raw_id = row.get(header + '.id', '')
                    record[api] = ({'id': ident(raw_id), **({'name': value} if value else {})}
                                   if raw_id else ({'name': value} if value else ''))
                else:
                    record[api] = convert(value, field, zone)
            except ValueError:
                # Keep source bytes intact; do not replace bad data with guessed values.
                issues.append({'row': number, 'field': header, 'reason': 'VALUE_CONVERSION_UNRESOLVED'})
        records.append(record)
    return records, {'headers': headers, 'mapped_fields': {h: f['api_name'] for h, f in mapping.items()},
                     'unmapped_headers': unmapped, 'conversion_issues': issues}


def write_once(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        if path.read_bytes() != content:
            raise ValueError('Existing recovery artifact differs; use a new output directory')
        return
    with open(path, 'xb') as stream:
        os.chmod(path, 0o600)
        stream.write(content)


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def recover(archive, output, metadata):
    discovery = json.loads(metadata.read_text())
    orgs = discovery['organization']['data']['org']
    if len(orgs) != 1 or str(orgs[0].get('zgid')) != '60046349006':
        raise ValueError('Wrong captured CRM organisation')
    zone = orgs[0]['time_zone']
    by_module = {entry['module']['api_name']: entry for entry in discovery['modules']}
    manifest = {'schema_version': 1, 'source_org_id': '60046349006', 'source_kind': 'provided-historical-export',
                'archive_sha256': sha(archive.read_bytes()), 'metadata_sha256': sha(metadata.read_bytes()),
                'source_timezone': zone, 'network_requests': 0, 'modules': {},
                'limitations': ['Historical export only; no present-day source reconciliation.',
                               'CSV blank cells do not distinguish null from empty.',
                               'Naive export timestamps interpreted in captured organisation timezone.',
                               'Export file row order preserved; source subform row order is not proven.',
                               'Unmapped headers remain in immutable raw CSVs; no API fields guessed.']}
    with zipfile.ZipFile(archive) as package:
        evidence = package.read(PREFIX + 'LIVE_CRM_STATE.md')
        if b'Target organisation: `60046349006`' not in evidence:
            raise ValueError('Export package organisation evidence mismatch')
        source_manifest = list(csv.DictReader(io.StringIO(package.read(PREFIX + 'FILE_MANIFEST.tsv').decode('utf-8-sig')), delimiter='\t'))
        source_hashes = {row['relative_path']: row['sha256'] for row in source_manifest}
        write_once(output / 'source-evidence.md', evidence)
        for module, filename, expected, date in SPECS:
            relative = 'private-live-exports/' + filename
            content = package.read(PREFIX + relative)
            if source_hashes.get(relative) != sha(content):
                raise ValueError('Archive source checksum mismatch')
            fields = by_module[module]['results']['fields']['data']['fields']
            records, mapping = parse_export(content, fields, zone)
            if len(records) != expected:
                raise ValueError('Historical export count mismatch')
            if mapping['conversion_issues']:
                raise ValueError('Unresolved export conversions; inspect before publishing')
            payload = json_bytes(records)
            write_once(output / 'raw' / filename, content)
            write_once(output / 'records' / (module + '.json'), payload)
            write_once(output / 'mapping' / (module + '.json'), json_bytes(mapping))
            manifest['modules'][module] = {'record_count': len(records), 'export_date': date,
                'source_filename': filename, 'source_sha256': sha(content), 'payload_sha256': sha(payload),
                'mapped_header_count': len(mapping['mapped_fields']), 'unmapped_headers': mapping['unmapped_headers'],
                'module_id': by_module[module]['module']['id'], 'source_reconciled': False}
    write_once(output / 'manifest.json', json_bytes(manifest))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = recover(args.archive, args.output, ROOT / '.private/zoho-discovery/latest.json')
    print(json.dumps({'source_org_id': result['source_org_id'], 'network_requests': 0,
                      'modules': result['modules']}, indent=2))
