import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).resolve().parents[1] / 'scripts/recover-offline-export.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryTests(unittest.TestCase):
    def test_strings_lookups_decimal_and_empty(self):
        raw = ('Record Id,Name,Parent.id,Parent,Cost,Enabled,Day,At,Team\n'
               'zcrm_90071992547409931234,"A, B",zcrm_90071992547409939999,P,9999999999999999.01,false,,2026-08-08 12:30:00,A;B\n').encode()
        fields = [{'api_name': api, 'field_label': label, 'data_type': kind} for api, label, kind in [
            ('Name', 'Name', 'text'), ('Parent_Id', 'Parent', 'lookup'), ('Cost', 'Cost', 'currency'),
            ('Enabled', 'Enabled', 'boolean'), ('Day', 'Day', 'date'), ('At', 'At', 'datetime'), ('Team', 'Team', 'multiselectpicklist')]]
        rows, report = recovery.parse_export(raw, fields, 'Asia/Kolkata')
        row = rows[0]
        self.assertEqual(row['id'], '90071992547409931234')
        self.assertEqual(row['Parent_Id'], {'id': '90071992547409939999', 'name': 'P'})
        self.assertEqual(row['Cost'], '9999999999999999.01')
        self.assertIs(row['Enabled'], False)
        self.assertEqual(row['Day'], '')
        self.assertEqual(row['At'], '2026-08-08T12:30:00+05:30')
        self.assertEqual(row['Team'], ['A', 'B'])
        self.assertFalse(report['conversion_issues'])

    def test_invalid_ids_duplicates_and_rows_rejected(self):
        for raw in [b'Record Id\n9.007E17\n', b'Record Id\n123456789\n123456789\n', b'Record Id,Name\n123456789\n']:
            with self.assertRaises(ValueError):
                recovery.parse_export(raw, [], 'Asia/Kolkata')

    def test_unknown_and_ambiguous_fields_not_guessed(self):
        rows, report = recovery.parse_export(b'Record Id,Missing,Clash\n123456789,secret,value\n', [
            {'api_name': 'One', 'field_label': 'Clash'}, {'api_name': 'Two', 'field_label': 'Clash'}], 'Asia/Kolkata')
        self.assertEqual(rows, [{'id': '123456789'}])
        self.assertEqual(report['unmapped_headers'], ['Missing', 'Clash'])

    def test_invalid_date_is_reported_not_normalized(self):
        rows, report = recovery.parse_export(b'Record Id,Day\n123456789,2026-02-30\n',
            [{'api_name': 'Day', 'field_label': 'Day', 'data_type': 'date'}], 'Asia/Kolkata')
        self.assertNotIn('Day', rows[0])
        self.assertEqual(report['conversion_issues'][0]['reason'], 'VALUE_CONVERSION_UNRESOLVED')


if __name__ == '__main__':
    unittest.main()
