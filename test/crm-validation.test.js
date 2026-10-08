'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ValidationError, validatePayload } = require('../lib/crm-validation');

const fields = [
  { api_name: 'Name', field_label: 'Name', data_type: 'text', system_mandatory: true, length: 20 },
  { api_name: 'Status', field_label: 'Status', data_type: 'picklist', pick_list_values: [{ actual_value: 'Open', display_value: 'Open' }, { actual_value: 'Done', display_value: 'Completed' }] },
  { api_name: 'Amount', field_label: 'Amount', data_type: 'currency' },
  { api_name: 'Count', field_label: 'Count', data_type: 'integer', length: 3 },
  { api_name: 'Email', field_label: 'Email', data_type: 'email' },
  { api_name: 'Due_Date', field_label: 'Due Date', data_type: 'date' },
  { api_name: 'Created_Time', field_label: 'Created Time', data_type: 'datetime', read_only: true },
];

test('accepts a valid create payload', () => {
  assert.equal(validatePayload(fields, { Name: 'Example', Status: 'Completed', Amount: '100.50', Email: 'a@example.com', Due_Date: '2026-08-29' }, { isCreate: true }).Name, 'Example');
});

test('requires mandatory fields on create', () => {
  assert.throws(() => validatePayload(fields, { Status: 'Open' }, { isCreate: true }), error => error instanceof ValidationError && error.errors.some(item => item.code === 'required'));
});

test('rejects unknown and read-only fields', () => {
  assert.throws(() => validatePayload(fields, { Name: 'Example', Unknown: 1, Created_Time: '2026-08-29T00:00:00Z' }), error => error.errors.some(item => item.code === 'unknown_field') && error.errors.some(item => item.code === 'read_only'));
});

test('rejects invalid configured values', () => {
  assert.throws(() => validatePayload(fields, { Name: 'This name is longer than twenty characters', Status: 'Missing', Amount: 'x', Email: 'invalid', Due_Date: '29-08-2026' }), error => {
    const codes = new Set(error.errors.map(item => item.code));
    return ['too_long', 'invalid_picklist', 'invalid_number', 'invalid_email', 'invalid_date'].every(code => codes.has(code));
  });
});

test('integer fields reject fractions, exponent strings, and values beyond the captured digit limit', () => {
  for (const Count of [1.9, '1.9', '1e2', 1000]) {
    assert.throws(() => validatePayload(fields, { Count }), error => error instanceof ValidationError
      && error.errors.some(item => item.field === 'Count' && ['invalid_integer', 'too_long'].includes(item.code)));
  }
  assert.equal(validatePayload(fields, { Count: 999 }).Count, 999);
  assert.equal(validatePayload(fields, { Count: '007' }).Count, '007');
});
