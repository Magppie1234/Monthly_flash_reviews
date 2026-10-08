'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'database', 'migrations', '20260830_source_deletion_archive.sql'),
  'utf8',
);
const functionNames = [
  'crm_archive_source_record',
  'crm_bulk_upsert',
  'crm_insert',
  'crm_acquire_replication_lease',
  'crm_release_replication_lease',
];

function functionDefinition(source, name) {
  const expression = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\nAS \\$function\\$\\n[\\s\\S]*?\\n\\$function\\$;`,
  );
  const matches = [...String(source).matchAll(new RegExp(expression.source, 'g'))];
  assert.equal(matches.length, 1, `${name} must have one exact definition`);
  return matches[0][0];
}

function assertInOrder(source, fragments) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1);
    assert.ok(next > cursor, `Expected SQL fragment after prior step: ${fragment}`);
    cursor = next;
  }
}

const archive = functionDefinition(migration, 'crm_archive_source_record');
const bulk = functionDefinition(migration, 'crm_bulk_upsert');
const localInsert = functionDefinition(migration, 'crm_insert');
const acquireLease = functionDefinition(migration, 'crm_acquire_replication_lease');
const releaseLease = functionDefinition(migration, 'crm_release_replication_lease');

test('staged migration is atomic, preconditioned, and contains no deployment/customer payload', () => {
  const executable = migration.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('--'));
  assert.equal(executable[0], 'BEGIN;');
  assert.equal(executable.at(-1), 'COMMIT;');
  assert.equal((migration.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) || []).length, 1);
  assert.match(migration, /Installation preconditions \(fail closed if any are missing\)/);
  assert.match(migration, /Every crm_bulk_upsert row carries that source_org_id and an exact source_seen_at/);
  assert.match(migration, /Existing rows with NULL source_seen_at are intentionally not backfilled/);
  assert.match(migration, /DO \$source_deletion_install_preflight\$/);
  assert.match(migration, /message = 'source-deletion installation precondition failed'/);
  assert.doesNotMatch(migration, /https?:\/\//i);
  assert.doesNotMatch(migration, /__REPLACE_AT_DEPLOYMENT__/);
  assert.doesNotMatch(migration, /\b[1-9][0-9]{14,}\b/, 'must not embed CRM record or organization numbers');
});

test('bootstrap and migration expose byte-identical definitions for every replaced or new RPC', () => {
  for (const name of functionNames) {
    assert.equal(functionDefinition(schema, name), functionDefinition(migration, name), name);
  }
});

test('archive table preserves exact snapshots and one reversible current deletion state', () => {
  assert.match(migration, /ALTER TABLE public\.crm_records[\s\S]*ADD COLUMN IF NOT EXISTS source_seen_at timestamp with time zone/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.crm_record_tombstones/);
  assert.match(migration, /record_snapshot jsonb NOT NULL/);
  assert.match(migration, /record_snapshot ->> 'module' = module/);
  assert.match(migration, /record_snapshot ->> 'id' = record_id/);
  assert.match(migration, /record_snapshot -> 'data' ->> 'id' = record_id/);
  assert.match(migration, /CONSTRAINT crm_record_tombstones_record_id_format CHECK \(record_id ~ '\^\[0-9\]\{8,32\}\$'\)/);
  assert.match(migration, /deletion_type IN \('recycle', 'permanent'\)/);
  assert.match(migration, /CONSTRAINT crm_record_tombstones_deletion_event_key UNIQUE \([\s\S]*source_org_id, module, record_id, deleted_time, deletion_type/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS crm_record_tombstones_current_idx[\s\S]*WHERE reactivated_at IS NULL AND superseded_at IS NULL/);
  assert.match(migration, /row_present AND snapshot_source_seen_at IS NOT NULL/);
  assert.match(migration, /NOT row_present[\s\S]*record_snapshot = jsonb_build_object/);
  assert.match(migration, /reactivated_at timestamp with time zone/);
  assert.match(migration, /superseded_at timestamp with time zone/);
  assert.doesNotMatch(
    migration.match(/CONSTRAINT crm_record_tombstones_module_safe[\s\S]*?\)\),/)[0],
    /'Notes'/,
    'Notes is not documented by the official deleted-records endpoint',
  );
});

test('archive validates authentication, identifiers, org lock, and both expected timestamps before mutation', () => {
  assertInOrder(archive, [
    'from public.crm_secret where secret = s',
    "message = 'unauthorized'",
    "p_source_org_id !~ '^org[0-9]{8,32}$'",
    "p_record_id !~ '^[0-9]{8,32}$'",
    "message = 'invalid source-deletion archive arguments'",
    "where m.key = 'source_replication_lock'",
    "v_lock ->> 'source_org_id' is distinct from p_source_org_id",
    'pg_catalog.pg_advisory_xact_lock(',
    'from public.crm_record_tombstones as t',
    'for update;',
    'from public.crm_records as r',
    'for update;',
    'v_record.modified_time is distinct from p_expected_modified_time',
    'v_record.source_seen_at is distinct from p_expected_source_seen_at',
    'insert into public.crm_record_tombstones',
  ]);
  assert.match(archive, /v_record\.source_seen_at > p_observed_at[\s\S]*v_record\.modified_time > p_deleted_time[\s\S]*'noop_stale'/);
  assert.match(archive, /v_record\.data \? '__local'[\s\S]*v_record\.data \? '__test'/);
  assert.match(archive, /message = 'source-deletion target is protected'/);
  assert.doesNotMatch(archive, /'Notes'/);
});

test('an identical current tombstone is idempotent only when no active row exists', () => {
  assertInOrder(archive, [
    'from public.crm_record_tombstones as t',
    'from public.crm_records as r',
    'v_has_record := found;',
    'if v_has_current',
    'if v_has_record then',
    "message = 'source-deletion active-row tombstone conflict'",
    "'outcome', 'already_archived'",
  ]);
  const alreadyArchivedAt = archive.indexOf("'outcome', 'already_archived'");
  const firstMutationAt = archive.indexOf('update public.crm_record_tombstones');
  assert.ok(alreadyArchivedAt < firstMutationAt);
  assert.equal((archive.match(/'already_archived'/g) || []).length, 1);
  assert.equal((archive.match(/insert into public\.crm_replication_leases/g) || []).length, 0);
});

test('archive records an absent authoritative event or atomically snapshots and removes an active row', () => {
  assert.match(archive, /v_snapshot := to_jsonb\(v_record\)/);
  assert.match(archive, /jsonb_build_object\([\s\S]*'module', p_module,[\s\S]*'id', p_record_id,[\s\S]*'data', jsonb_build_object\('id', p_record_id\)/);
  assertInOrder(archive, [
    'insert into public.crm_record_tombstones',
    'delete from public.crm_records',
    'insert into public.crm_audit',
    'return jsonb_build_object(',
  ]);
  assert.match(archive, /'source_archived'.*'source_deleted_absent'/s);
  assert.match(archive, /'archived'.*'tombstone_recorded'/s);
  assert.doesNotMatch(archive, /record_snapshot[\s\S]*insert into public\.crm_audit[\s\S]*record_snapshot/);
});

test('bulk upsert validates the complete batch before writes, blocks stale replays, and reactivates once', () => {
  assert.match(bulk, /jsonb_array_length\(rows\) > 1000/);
  assert.match(bulk, /v_row ->> 'source_org_id' is distinct from v_source_org_id/);
  assert.match(bulk, /v_module !~ '\^\[A-Za-z\]\[A-Za-z0-9_\$\]\{0,159\}\$'/);
  assert.doesNotMatch(bulk, /v_module not in/);
  for (const sourceModule of [
    'Service_Managements', 'Product_Details', 'Product_Details1', 'Project_Details', 'Project_Detail', 'Notes',
  ]) {
    assert.match(sourceModule, /^[A-Za-z][A-Za-z0-9_$]{0,159}$/);
  }
  assert.match(bulk, /nullif\(v_row ->> 'source_seen_at', ''\) is null/);
  const loops = [...bulk.matchAll(/for v_row in select value from jsonb_array_elements\(rows\)/g)];
  assert.equal(loops.length, 2);
  const invalidRow = bulk.indexOf("message = 'invalid source upsert row'");
  const firstWrite = Math.min(
    bulk.indexOf('update public.crm_record_tombstones'),
    bulk.indexOf('insert into public.crm_records'),
    bulk.indexOf('insert into public.crm_audit'),
  );
  assert.ok(invalidRow < loops[1].index && loops[1].index < firstWrite);
  assertInOrder(bulk.slice(loops[1].index), [
    'pg_catalog.pg_advisory_xact_lock(',
    'from public.crm_record_tombstones as t',
    'for update;',
  ]);
  assert.match(bulk, /if found and v_source_seen_at <= v_tombstone\.observed_at then[\s\S]*continue;/);
  assert.match(bulk, /set reactivated_at = v_source_seen_at,[\s\S]*reactivated_by_modified_time = v_modified_time,[\s\S]*reactivated_by_source_seen_at = v_source_seen_at/);
  assert.match(bulk, /'source_reactivated'/);
  assert.match(bulk, /where crm_records\.source_seen_at is null[\s\S]*excluded\.source_seen_at > crm_records\.source_seen_at/);
  assert.equal((bulk.match(/insert into public\.crm_audit/g) || []).length, 1);
});

test('local insert can never introduce a source-shaped numeric record ID', () => {
  assertInOrder(localInsert, [
    'from public.crm_secret where secret = s',
    "p_id !~ '^(local|local-note)-[A-Za-z0-9][A-Za-z0-9._:-]{0,188}$'",
    "message = 'invalid local record identity'",
    'insert into public.crm_records',
  ]);
  assert.match(localInsert, /d ->> 'id' is distinct from p_id/);
  assert.match(localInsert, /dv\.o_owner, null/);
});

test('fixed-key lease RPCs are secret checked, UUID owned, bounded, and owner released', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.crm_replication_leases/);
  assert.match(migration, /owner_id uuid NOT NULL/);
  assert.match(migration, /lease_key = 'source-deletion-sync-v1'/);
  assert.match(acquireLease, /p_ttl_seconds < 5 or p_ttl_seconds > 300/);
  assert.match(acquireLease, /crm_replication_leases\.expires_at <= v_now[\s\S]*crm_replication_leases\.owner_id = excluded\.owner_id/);
  assert.equal((acquireLease.match(/insert into public\.crm_replication_leases/g) || []).length, 1);
  assert.match(releaseLease, /where lease_key = 'source-deletion-sync-v1' and owner_id = p_owner_id/);
  assert.equal((releaseLease.match(/delete from public\.crm_replication_leases/g) || []).length, 1);
});

test('new tables are forced-RLS private and RPC grants are signature-specific after broad bootstrap grants', () => {
  for (const source of [schema, migration]) {
    assert.match(source, /ALTER TABLE public\.(?:"crm_record_tombstones"|crm_record_tombstones) FORCE ROW LEVEL SECURITY/);
    assert.match(source, /ALTER TABLE public\.(?:"crm_replication_leases"|crm_replication_leases) FORCE ROW LEVEL SECURITY/);
    assert.match(source, /REVOKE ALL PRIVILEGES ON TABLE public\.crm_record_tombstones[\s\S]*FROM PUBLIC, anon, authenticated, service_role CASCADE/);
    assert.match(source, /REVOKE ALL PRIVILEGES ON TABLE public\.crm_replication_leases[\s\S]*FROM PUBLIC, anon, authenticated, service_role CASCADE/);
    assert.match(source, /REVOKE ALL PRIVILEGES ON FUNCTION public\.crm_archive_source_record\([\s\S]*FROM PUBLIC CASCADE/);
    assert.match(source, /GRANT EXECUTE ON FUNCTION public\.crm_archive_source_record\([\s\S]*TO anon, authenticated, service_role/);
  }
  const broadGrantAt = schema.lastIndexOf('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public');
  const privateTableRevokeAt = schema.lastIndexOf('REVOKE ALL PRIVILEGES ON TABLE public.crm_record_tombstones');
  assert.ok(privateTableRevokeAt > broadGrantAt, 'private-table revokes must be final in bootstrap order');
});

test('RPC bodies have no dynamic SQL, external effects, commits, or swallowed errors', () => {
  for (const body of [archive, bulk, localInsert, acquireLease, releaseLease]) {
    assert.doesNotMatch(body, /\bexecute\b/i);
    assert.doesNotMatch(body, /\b(?:http|dblink|pg_notify|net\.)\b/i);
    assert.doesNotMatch(body, /^\s*(?:commit|rollback)\b/im);
    assert.doesNotMatch(body, /exception\s+when/i);
  }
  assert.doesNotMatch(archive, /delete from public\.crm_record_tombstones/i);
});
