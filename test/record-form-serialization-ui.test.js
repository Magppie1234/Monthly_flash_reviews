'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ValidationError, validatePayload } = require('../lib/crm-validation');

const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'app.js'), 'utf8');
const serializerStart = appSource.indexOf('function recordFormValueForPayload(');
const serializerEnd = appSource.indexOf('\n\nasync function openForm(', serializerStart);
const serializerSource = appSource.slice(serializerStart, serializerEnd);
const recordFormValueForPayload = vm.runInNewContext(`(${serializerSource})`);
const cellSerializerStart = appSource.indexOf('function cellToZoho(');
const cellSerializerEnd = appSource.indexOf('\n\nfunction makeCellEditor(', cellSerializerStart);
const cellSerializerSource = appSource.slice(cellSerializerStart, cellSerializerEnd);
const cellToZoho = vm.runInNewContext(`(${cellSerializerSource})`);

const numericFields = [
  { api_name: 'Count', field_label: 'Count', data_type: 'integer' },
  { api_name: 'External_Number', field_label: 'External Number', data_type: 'bigint' },
];

test('record form preserves a fractional integer for authoritative server rejection', () => {
  assert.ok(serializerStart >= 0 && serializerEnd > serializerStart);
  const serialized = recordFormValueForPayload('1.9', 'integer');

  assert.equal(serialized, '1.9');
  assert.throws(
    () => validatePayload(numericFields, { Count: serialized }),
    error => error instanceof ValidationError
      && error.errors.some(item => item.field === 'Count' && item.code === 'invalid_integer'),
  );
});

test('record form preserves unsafe bigint digits through JSON and server validation', () => {
  const unsafeBigint = '900719925474099312345678901';
  const serialized = recordFormValueForPayload(unsafeBigint, 'bigint');
  const requestBody = JSON.parse(JSON.stringify({ External_Number: serialized }));

  assert.equal(serialized, unsafeBigint);
  assert.equal(requestBody.External_Number, unsafeBigint);
  assert.equal(validatePayload(numericFields, requestBody).External_Number, unsafeBigint);
});

test('create and edit submission use the exact record-form serializer without parseInt coercion', () => {
  const formStart = appSource.indexOf('async function openForm(');
  const formEnd = appSource.indexOf('/* ---------- CRM assistant ---------- */', formStart);
  const formSource = appSource.slice(formStart, formEnd);

  assert.match(formSource, /v = recordFormValueForPayload\(v, dt\)/);
  assert.doesNotMatch(formSource, /parseInt\s*\(/);
});

test('Excel inline editing preserves a fractional integer for authoritative server rejection', () => {
  assert.ok(cellSerializerStart >= 0 && cellSerializerEnd > cellSerializerStart);
  const serialized = cellToZoho('1.9', { data_type: 'integer' });

  assert.equal(serialized, '1.9');
  assert.throws(
    () => validatePayload(numericFields, { Count: serialized }),
    error => error instanceof ValidationError
      && error.errors.some(item => item.field === 'Count' && item.code === 'invalid_integer'),
  );
  assert.doesNotMatch(cellSerializerSource, /parseInt\s*\(/);
});

test('Excel inline editing preserves unsafe bigint digits through JSON and server validation', () => {
  const unsafeBigint = '900719925474099312345678901';
  const serialized = cellToZoho(unsafeBigint, { data_type: 'bigint' });
  const requestBody = JSON.parse(JSON.stringify({ External_Number: serialized }));

  assert.equal(serialized, unsafeBigint);
  assert.equal(requestBody.External_Number, unsafeBigint);
  assert.equal(validatePayload(numericFields, requestBody).External_Number, unsafeBigint);
});
