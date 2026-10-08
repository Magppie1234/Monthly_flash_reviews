'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { publicErrorResponse } = require('../lib/public-error-response');
const { BlueprintAtomicRuntimeError } = require('../lib/blueprint-atomic-runtime');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('unknown database, host, SQL, and credential-shaped failures use one fixed public response', () => {
  for (const message of [
    'db 500: select secret from private_table where token=private-value',
    'connect ECONNREFUSED postgres://user:password@private-host:5432/database',
    'upstream https://private-project.supabase.co returned authorization=private-value',
    'atomic raw response: api_key=private-value',
  ]) {
    const error = new Error(message);
    const response = publicErrorResponse(error);
    assert.deepEqual(response, {
      status: 500,
      body: { error: 'The request could not be completed safely.', code: 'INTERNAL_ERROR' },
    });
    assert.doesNotMatch(JSON.stringify(response), /select secret|postgres|password|private-host|supabase|authorization|api_key|private-value/i);
  }
});

test('only a controlled reviewed class may expose a safe 502 contract', () => {
  const controlled = new BlueprintAtomicRuntimeError(
    'BLUEPRINT_ATOMIC_EXECUTION_FAILED',
    'The atomic Blueprint transition was not committed.',
    502,
  );
  assert.deepEqual(publicErrorResponse(controlled, { controlledClass: true }), {
    status: 502,
    body: {
      error: 'The atomic Blueprint transition was not committed.',
      code: 'BLUEPRINT_ATOMIC_EXECUTION_FAILED',
    },
  });

  const arbitrary = new Error('A seemingly safe upstream failure.');
  arbitrary.status = 502;
  arbitrary.code = 'UPSTREAM_FAILURE';
  assert.deepEqual(publicErrorResponse(arbitrary), {
    status: 500,
    body: { error: 'The request could not be completed safely.', code: 'INTERNAL_ERROR' },
  });
});

test('a safe bounded status and code may expose controlled copy but never unsafe details', () => {
  const safe = new Error('Transition is not eligible from the record’s current state.');
  safe.status = 409;
  safe.code = 'TRANSITION_NOT_ELIGIBLE';
  assert.deepEqual(publicErrorResponse(safe), {
    status: 409,
    body: { error: safe.message, code: safe.code },
  });

  const unsafe = new Error('Request failed at private-host.supabase.co with token=private-value');
  unsafe.status = 409;
  unsafe.code = 'TRANSITION_NOT_ELIGIBLE';
  assert.equal(publicErrorResponse(unsafe).body.code, 'INTERNAL_ERROR');

  const controlled = new Error('Blueprint input is invalid.');
  controlled.status = 422;
  controlled.code = 'BLUEPRINT_VALIDATION';
  controlled.details = [{ field: 'Stage', code: 'required', message: 'Stage is required.' }];
  assert.deepEqual(publicErrorResponse(controlled, { controlledClass: true, includeDetails: true }), {
    status: 422,
    body: {
      error: 'Blueprint input is invalid.',
      code: 'BLUEPRINT_VALIDATION',
      details: [{ field: 'Stage', code: 'required', message: 'Stage is required.' }],
    },
  });

  controlled.details = { token: 'private-value' };
  assert.equal(Object.prototype.hasOwnProperty.call(
    publicErrorResponse(controlled, { controlledClass: true, includeDetails: true }).body,
    'details',
  ), false);
});

test('global server wrapper delegates every rejected route to the fail-closed public mapper', () => {
  const start = serverSource.indexOf('const wrap =');
  const end = serverSource.indexOf('const activeBlueprintsFor', start);
  const wrapper = serverSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(wrapper, /publicErrorResponse\(error/);
  assert.doesNotMatch(wrapper, /String\(error\.message|String\(e\.message/);
  assert.doesNotMatch(wrapper, /res\.status\(error\.status \|\| 500\)/);
  assert.doesNotMatch(wrapper, /console\.(?:log|error)/);
});
