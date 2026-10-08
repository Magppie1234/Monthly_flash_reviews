'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CustomViewFilterError, compileCustomViewFilter } = require('../lib/custom-view-filter');

const fields = [
  { api_name: 'Status', data_type: 'picklist' },
  { api_name: 'Amount', data_type: 'currency' },
  { api_name: 'Owner', data_type: 'ownerlookup' },
  { api_name: 'Full_Name', data_type: 'text' },
  { api_name: 'Layout', data_type: 'layout' },
  { api_name: 'Outgoing_Call_Status', data_type: 'picklist' },
];

const compile = (criteria, overrides = {}) => compileCustomViewFilter({
  module: 'Deals',
  cvid: 'view-1',
  views: [{ id: 'view-1', criteria }],
  fields,
  ...overrides,
});

function assertFilterError(fn, code, status) {
  assert.throws(fn, error => {
    assert.equal(error instanceof CustomViewFilterError, true);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test('compiles supported nested criteria and numeric comparisons', () => {
  const result = compile({
    group_operator: 'AND',
    group: [
      { field: { api_name: 'Status' }, comparator: 'equal', value: 'Open' },
      { field: { api_name: 'Amount' }, comparator: 'greater_equal', value: '250000' },
    ],
  });
  assert.equal(result.sql, "(data->>'Status' = 'Open' and nullif(data->>'Amount','')::numeric >= 250000)");
});

test('compiles lookup object criteria against the selected lookup property', () => {
  const result = compile({ field: { api_name: 'Owner' }, comparator: 'equal', value: { id: '1032257000000413001', name: 'Example' } });
  assert.equal(result.sql, "data->'Owner'->>'id' = '1032257000000413001'");
});

test('compiles Zoho equal and not_equal value arrays as membership criteria', () => {
  const equalResult = compile({
    field: { api_name: 'Status' },
    comparator: 'equal',
    value: ['Open', 'Won'],
  });
  assert.equal(equalResult.sql, "data->>'Status' in ('Open','Won')");

  const notEqualResult = compile({
    field: { api_name: 'Status' },
    comparator: 'not_equal',
    value: ['Dead', 'Closed'],
  });
  assert.equal(notEqualResult.sql, "(data->>'Status' is null or data->>'Status' not in ('Dead','Closed'))");

  const lookupResult = compile({
    field: { api_name: 'Owner' },
    comparator: 'not_equal',
    value: [
      { id: '1032257000000413001', name: 'Example' },
      { id: '1032257000000413002', name: 'Second' },
    ],
  });
  assert.equal(
    lookupResult.sql,
    "(data->'Owner'->>'id' is null or data->'Owner'->>'id' not in ('1032257000000413001','1032257000000413002'))",
  );
});

test('compiles the exact Zoho empty sentinel for observed equal and not_equal scalar criteria', () => {
  assert.equal(
    compile({ field: { api_name: 'Status' }, comparator: 'equal', value: '${EMPTY}' }).sql,
    "(data->>'Status' is null or data->>'Status' = '')",
  );
  assert.equal(
    compile({ field: { api_name: 'Full_Name' }, comparator: 'not_equal', value: '${EMPTY}' }).sql,
    "data->>'Full_Name' is not null and data->>'Full_Name' != ''",
  );
  assert.equal(
    compile({ field: { api_name: 'Amount' }, comparator: 'equal', value: '${EMPTY}' }).sql,
    "(data->>'Amount' is null or data->>'Amount' = '')",
  );
  assert.equal(
    compile({ field: { api_name: 'Owner' }, comparator: 'not_equal', value: '${EMPTY}' }).sql,
    "data->'Owner'->>'name' is not null and data->'Owner'->>'name' != ''",
  );
});

test('compiles the mirrored Completed Calls system-view empty criterion without weakening its group logic', () => {
  const result = compile({
    group_operator: 'OR',
    group: [
      {
        group_operator: 'AND',
        group: [
          { field: { api_name: 'Outgoing_Call_Status' }, comparator: 'not_equal', value: 'Scheduled' },
          { field: { api_name: 'Outgoing_Call_Status' }, comparator: 'not_equal', value: 'Overdue' },
        ],
      },
      { field: { api_name: 'Outgoing_Call_Status' }, comparator: 'equal', value: '${EMPTY}' },
    ],
  });
  assert.equal(
    result.sql,
    "(((data->>'Outgoing_Call_Status' is distinct from 'Scheduled') and (data->>'Outgoing_Call_Status' is distinct from 'Overdue')) or (data->>'Outgoing_Call_Status' is null or data->>'Outgoing_Call_Status' = ''))",
  );
});

test('compiles mirrored layout references by their stable id', () => {
  const result = compile({
    field: { api_name: 'Layout' },
    comparator: 'equal',
    value: { id: '1032257000005515301', name: 'Developer/Pro-Retail' },
  });
  assert.equal(result.sql, "data->'Layout'->>'id' = '1032257000005515301'");
});

test('accepts an explicitly unfiltered view while rejecting incomplete view metadata', () => {
  assert.equal(compile(null).sql, null);
  assertFilterError(
    () => compileCustomViewFilter({ module: 'Deals', cvid: 'view-1', views: [{ id: 'view-1' }], fields }),
    'CUSTOM_VIEW_CRITERIA_UNAVAILABLE',
    422,
  );
});

test('rejects missing custom views and unavailable metadata before querying records', () => {
  assertFilterError(
    () => compileCustomViewFilter({ module: 'Deals', cvid: 'missing', views: [{ id: 'view-1', criteria: null }], fields }),
    'CUSTOM_VIEW_NOT_FOUND',
    404,
  );
  assertFilterError(
    () => compileCustomViewFilter({ module: 'Deals', cvid: 'view-1', views: null, fields }),
    'CUSTOM_VIEW_METADATA_UNAVAILABLE',
    503,
  );
});

test('fails closed for disrupted, dynamic, unknown-field, and unsupported criteria', () => {
  const invalid = [
    { field: { api_name: 'Status' }, comparator: 'equal', value: 'Open', $disrupted: true },
    { field: { api_name: 'Status' }, comparator: 'equal', value: '${CURRENTUSER}' },
    { field: { api_name: 'Owner' }, comparator: 'equal', value: { name: '${CURRENTUSER}' } },
    { field: { api_name: 'Status' }, comparator: 'equal', value: ['Open', '${EMPTY}'] },
    { field: { api_name: 'Status' }, comparator: 'contains', value: '${EMPTY}' },
    { field: { api_name: 'Status' }, comparator: 'equal', value: '${EMPTY}-suffix' },
    { field: { api_name: 'Missing_Field' }, comparator: 'equal', value: 'Open' },
    { field: { api_name: 'Status' }, comparator: 'yesterday', value: 'Open' },
    { group_operator: 'XOR', group: [{ field: { api_name: 'Status' }, comparator: 'equal', value: 'Open' }] },
    { group_operator: 'AND', group: [] },
  ];
  for (const criteria of invalid) {
    assertFilterError(() => compile(criteria), 'CUSTOM_VIEW_CRITERIA_UNSUPPORTED', 422);
  }
});

test('rejects malformed ranges, lists, and numeric values', () => {
  const invalid = [
    { field: { api_name: 'Amount' }, comparator: 'between', value: ['1'] },
    { field: { api_name: 'Status' }, comparator: 'in', value: [] },
    { field: { api_name: 'Amount' }, comparator: 'greater_than', value: 'not-a-number' },
    { field: { api_name: 'Owner' }, comparator: 'in', value: [{ id: '123456789012345' }, { name: 'Example' }] },
  ];
  for (const criteria of invalid) {
    assertFilterError(() => compile(criteria), 'CUSTOM_VIEW_CRITERIA_UNSUPPORTED', 422);
  }
});
