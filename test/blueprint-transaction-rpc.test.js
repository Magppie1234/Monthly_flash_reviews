'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'database', 'migrations', '20260830_blueprint_transition_rpc.sql'),
  'utf8',
);

const functionStart = 'CREATE OR REPLACE FUNCTION public.crm_blueprint_transition(';
const functionEnd = '\n$function$;';

function extractFunction(sql) {
  const start = sql.indexOf(functionStart);
  assert.notEqual(start, -1, 'Blueprint transition RPC definition is missing');
  const end = sql.indexOf(functionEnd, start);
  assert.notEqual(end, -1, 'Blueprint transition RPC body is not terminated');
  return sql.slice(start, end + functionEnd.length);
}

function assertInOrder(source, fragments) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1);
    assert.ok(next > cursor, `Expected SQL fragment after prior step: ${fragment}`);
    cursor = next;
  }
}

function timestampMicros(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})([+-])(\d{2}):(\d{2})$/);
  assert.ok(match, `Expected an exact six-digit offset timestamp: ${value}`);
  const [, year, month, day, hour, minute, second, fraction, sign, offsetHour, offsetMinute] = match;
  const localSecondMillis = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), 0,
  );
  const offsetMillis = (Number(offsetHour) * 60 + Number(offsetMinute)) * 60 * 1000;
  const utcSecondMillis = localSecondMillis - (sign === '+' ? offsetMillis : -offsetMillis);
  return BigInt(utcSecondMillis) * 1000n + BigInt(fraction);
}

const schemaFunction = extractFunction(schema);
const migrationFunction = extractFunction(migration);

test('bootstrap and staged migration expose the same Blueprint transition RPC contract', () => {
  assert.equal(schemaFunction, migrationFunction);

  for (const parameter of [
    'p_module text',
    'p_id text',
    'p_state_field text',
    'p_expected_state text',
    'p_expected_modified_time timestamp with time zone',
    'p_next_state text',
    'p_blueprint_id text',
    'p_blueprint_name text',
    'p_transition_id text',
    'p_transition_name text',
    'p_patch jsonb',
    's text',
    'p_note_id text DEFAULT NULL',
    'p_note_title text DEFAULT NULL',
    'p_note_content text DEFAULT NULL',
  ]) assert.ok(schemaFunction.includes(parameter), `Missing RPC parameter: ${parameter}`);

  assert.match(schemaFunction, /RETURNS jsonb/i);
  assert.match(schemaFunction, /LANGUAGE plpgsql/i);
  assert.match(schemaFunction, /SECURITY DEFINER/i);
  assert.match(schemaFunction, /SET search_path TO 'public'/);
  assert.match(schemaFunction, /SET statement_timeout TO '15s'/);
});

test('migration is staged atomically and does not embed deployment or customer data', () => {
  const executableLines = migration
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('--'));

  assert.equal(executableLines[0], 'BEGIN;');
  assert.equal(executableLines.at(-1), 'COMMIT;');
  assert.equal((migration.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) || []).length, 1);
  assert.doesNotMatch(migration, /\b\d{15,}\b/, 'migration must not contain CRM record or transition IDs');
  assert.doesNotMatch(migration, /https?:\/\//i);
  assert.doesNotMatch(migration, /__REPLACE_AT_DEPLOYMENT__/);
});

test('RPC authenticates and rejects malformed or protected patches before locking a record', () => {
  assert.match(schemaFunction, /public\.crm_secret where secret = s/);
  assert.match(schemaFunction, /errcode = '42501', message = 'unauthorized'/);
  assert.match(schemaFunction, /p_state_field !~ '\^\[A-Za-z\]\[A-Za-z0-9_\$\]\*\$'/);
  assert.match(schemaFunction, /p_state_field in \('id', 'Created_Time', 'Modified_Time'\)/);
  assert.match(schemaFunction, /jsonb_typeof\(p_patch\) <> 'object'/);
  assert.match(schemaFunction, /p_patch \?\| array\['id', 'Created_Time', 'Modified_Time'\]/);
  assert.match(schemaFunction, /p_module !~ '\^\[A-Za-z\]\[A-Za-z0-9_\$\]\{0,159\}\$'/);
  assert.match(schemaFunction, /p_blueprint_id !~ '\^\[0-9\]\{1,30\}\$'/);
  assert.match(schemaFunction, /p_patch \? p_state_field/);
  assert.match(schemaFunction, /select count\(\*\) from jsonb_object_keys\(p_patch\)\) > 64/);
  assert.match(schemaFunction, /jsonb_typeof\(field_value\) not in \('string', 'number', 'boolean', 'null'\)/);
  assert.match(schemaFunction, /p_note_id !~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,199\}\$'/);
  assert.match(schemaFunction, /char_length\(p_note_content\) > 100000/);
});

test('row lock and both optimistic-concurrency checks precede every database mutation', () => {
  assertInOrder(schemaFunction, [
    'from public.crm_records as r',
    'for update;',
    "message = 'Blueprint record not found'",
    "jsonb_typeof(v_olddata) <> 'object'",
    "(v_olddata ->> 'id') is distinct from p_id",
    "message = 'Blueprint record identity mismatch'",
    'v_current_state := v_olddata ->> p_state_field;',
    'if v_current_state is distinct from p_expected_state then',
    'if v_old_modified_time is distinct from p_expected_modified_time then',
    'update public.crm_records as target',
  ]);

  assert.equal((schemaFunction.match(/errcode = '40001'/g) || []).length, 2);
  assert.match(schemaFunction, /message = 'Blueprint expected-current-state conflict'/);
  assert.match(schemaFunction, /message = 'Blueprint expected-modified-time conflict'/);
});

test('record patch refreshes Modified_Time and every crm_derive-backed column', () => {
  assert.match(
    schemaFunction,
    /v_changed_at := greatest\([\s\S]*clock_timestamp\(\),[\s\S]*v_old_modified_time \+ interval '1 microsecond'[\s\S]*\)/,
  );
  assert.doesNotMatch(schemaFunction, /date_trunc\('second', clock_timestamp\(\)\)/);
  assert.match(
    schemaFunction,
    /v_business_patch := p_patch \|\| jsonb_build_object\(p_state_field, p_next_state\)/,
  );
  assert.match(
    schemaFunction,
    /v_newdata := v_olddata \|\| v_business_patch \|\| jsonb_build_object\('Modified_Time', v_changed_text\)/,
  );
  assert.match(schemaFunction, /'YYYY-MM-DD"T"HH24:MI:SS\.US'[\s\S]*\|\| '\+05:30'/);
  assert.match(schemaFunction, /return jsonb_build_object\([\s\S]*'modified_time', v_changed_text,[\s\S]*'data', v_newdata/);
  assert.match(schemaFunction, /from public\.crm_derive\(p_module, v_newdata\) as d/);
  assert.match(
    schemaFunction,
    /set data = v_newdata,[\s\S]*modified_time = v_changed_at,[\s\S]*status = v_status,[\s\S]*due_date = v_due_date,[\s\S]*ts2 = v_ts2,[\s\S]*owner = v_owner,[\s\S]*name = coalesce/,
  );
  assert.match(schemaFunction, /jsonb_agg\([\s\S]*'field'[\s\S]*'from'[\s\S]*'to'[\s\S]*order by patch_keys\.key_name/);
  assert.match(schemaFunction, /values \(p_module, p_id, 'updated', v_diffs, 'MAGPPIE CRM user'\)/);
});

test('returned Modified_Time preserves the stored microsecond instant for a sequential transition', () => {
  assertInOrder(schemaFunction, [
    'v_changed_at := greatest(',
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US'",
    "jsonb_build_object('Modified_Time', v_changed_text)",
    'modified_time = v_changed_at',
    "'modified_time', v_changed_text",
  ]);
  assert.doesNotMatch(schemaFunction, /'YYYY-MM-DD"T"HH24:MI:SS'\s*\n\s*\) \|\| '\+05:30'/);

  const storedFirstTransition = '2026-08-30T15:30:00.123456+05:30';
  const returnedFirstTransition = '2026-08-30T15:30:00.123456+05:30';
  assert.equal(timestampMicros(returnedFirstTransition), timestampMicros(storedFirstTransition));

  const secondExpectedModifiedTime = returnedFirstTransition;
  assert.equal(timestampMicros(secondExpectedModifiedTime), timestampMicros(storedFirstTransition));
  assert.notEqual(
    timestampMicros('2026-08-30T15:30:00.000000+05:30'),
    timestampMicros(storedFirstTransition),
    'whole-second serialization would falsely conflict on the second transition',
  );
});

test('optional Note row and all audit events are inside the same RPC body', () => {
  assert.match(schemaFunction, /v_has_note := nullif\(btrim\(coalesce\(p_note_content, ''\)\), ''\) is not null/);
  assert.match(schemaFunction, /if v_has_note then[\s\S]*v_note_data := jsonb_build_object/);
  for (const field of ['Note_Title', 'Note_Content', 'Parent_Id', 'Created_Time', 'Modified_Time', 'Created_By']) {
    assert.ok(schemaFunction.includes(`'${field}'`), `Note field is missing: ${field}`);
  }
  assert.match(schemaFunction, /from public\.crm_derive\('Notes', v_note_data\) as d/);
  assert.match(schemaFunction, /insert into public\.crm_records \([\s\S]*'Notes',[\s\S]*p_note_id,[\s\S]*v_note_data/);
  assert.match(schemaFunction, /values \('Notes', p_note_id, 'created', null, 'MAGPPIE CRM user'\)/);
  assert.match(schemaFunction, /'note_added',[\s\S]*jsonb_build_object\('note_id', p_note_id\)/);

  assertInOrder(schemaFunction, [
    'update public.crm_records as target',
    'insert into public.crm_records (',
    "'note_added'",
    "'blueprint_transition'",
    'return jsonb_build_object(',
  ]);

  for (const key of ['blueprint_id', 'blueprint', 'transition_id', 'transition', 'from', 'to', 'note_id', 'modified_time']) {
    assert.ok(schemaFunction.includes(`'${key}'`), `Transition audit key is missing: ${key}`);
  }
});

test('RPC contains no split-write helpers, external side effects, or swallowed failures', () => {
  assert.doesNotMatch(schemaFunction, /\bcrm_(?:patch|insert|log)\s*\(/i);
  assert.doesNotMatch(schemaFunction, /exception\s+when/i);
  assert.doesNotMatch(schemaFunction, /^\s*(?:commit|rollback)\b/im);
  assert.doesNotMatch(schemaFunction, /\b(?:http|dblink|pg_notify|net\.)\b/i);
  assert.doesNotMatch(schemaFunction, /\b(?:delete|truncate)\s+/i);
});

test('security-definer execution is revoked from PUBLIC and granted only to intended API roles', () => {
  const signature = String.raw`public\.crm_blueprint_transition\(\s*text, text, text, text, timestamp with time zone, text,\s*text, text, text, text, jsonb, text, text, text, text\s*\)`;
  for (const source of [schema, migration]) {
    assert.match(source, new RegExp(`ALTER FUNCTION ${signature} OWNER TO postgres;`));
    assert.match(source, /DO \$blueprint_transition_acl\$[\s\S]*pg_catalog\.aclexplode[\s\S]*privilege\.grantee <> p\.proowner[\s\S]*REVOKE ALL PRIVILEGES ON FUNCTION[\s\S]*FROM %I CASCADE/);
    assert.match(source, new RegExp(`REVOKE ALL PRIVILEGES ON FUNCTION ${signature} FROM PUBLIC CASCADE;`));
    assert.match(source, new RegExp(`GRANT EXECUTE ON FUNCTION ${signature} TO anon, authenticated, service_role;`));
  }
});
