#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const TABLES = ['crm_secret', 'crm_records', 'crm_meta', 'crm_audit'];
const FUNCTIONS = ['crm_derive', 'crm_sql', 'crm_bulk_upsert', 'crm_meta_upsert', 'crm_insert', 'crm_patch', 'crm_log'];
const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.CRM_SQL_SECRET;
if (!SUPA || !KEY || !SECRET) throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, and CRM_SQL_SECRET are required');

const qIdent = value => `"${String(value).replace(/"/g, '""')}"`;
const qLit = value => `'${String(value).replace(/'/g, "''")}'`;
const list = values => values.map(qLit).join(', ');

async function sql(query) {
  const response = await fetch(`${SUPA}/rest/v1/rpc/crm_sql`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, s: SECRET }),
  });
  if (!response.ok) throw new Error(`Local schema query failed (${response.status})`);
  return response.json();
}

function sanitize(text) {
  let output = String(text || '');
  for (const value of [
    process.env.CRM_SQL_SECRET,
    process.env.SUPABASE_ANON_KEY,
    process.env.ZOHO_CLIENT_SECRET,
    process.env.ZOHO_REFRESH_TOKEN,
    process.env.ACCESS_CODE,
  ].filter(Boolean)) output = output.split(value).join('__REPLACE_AT_DEPLOYMENT__');
  return output;
}

function addConstraint(row) {
  const table = `public.${qIdent(row.table_name)}`;
  const name = qIdent(row.constraint_name);
  return `DO $migration$ BEGIN\n  ALTER TABLE ${table} ADD CONSTRAINT ${name} ${row.definition};\nEXCEPTION WHEN duplicate_object THEN NULL; END $migration$;`;
}

async function main() {
  const tableList = list(TABLES);
  const functionList = list(FUNCTIONS);
  const [columns, constraints, indexes, tableSecurity, policies, functions, tableGrants, routineGrants] = await Promise.all([
    sql(`select c.relname as table_name, a.attnum as ordinal_position, a.attname as column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type, a.attnotnull as not_null, a.attidentity as identity_kind, pg_get_expr(ad.adbin, ad.adrelid) as column_default from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef ad on ad.adrelid=c.oid and ad.adnum=a.attnum where n.nspname='public' and c.relname in (${tableList}) order by c.relname, a.attnum`),
    sql(`select c.relname as table_name, con.conname as constraint_name, pg_get_constraintdef(con.oid, true) as definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${tableList}) order by c.relname, con.conname`),
    sql(`select tablename as table_name, indexname as index_name, indexdef as definition from pg_indexes pi where schemaname='public' and tablename in (${tableList}) and not exists (select 1 from pg_constraint con join pg_class idx on idx.oid=con.conindid where idx.relname=pi.indexname) order by tablename, indexname`),
    sql(`select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${tableList}) order by c.relname`),
    sql(`select tablename as table_name, policyname as policy_name, permissive, roles, cmd, qual, with_check from pg_policies where schemaname='public' and tablename in (${tableList}) order by tablename, policyname`),
    sql(`select p.proname as function_name, pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functionList}) order by p.proname, pg_get_function_identity_arguments(p.oid)`),
    sql(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in (${tableList}) and grantee in ('anon','authenticated','service_role') order by table_name, grantee, privilege_type`),
    sql(`select routine_name, grantee, privilege_type from information_schema.role_routine_grants where routine_schema='public' and routine_name in (${functionList}) and grantee in ('anon','authenticated','service_role') order by routine_name, grantee, privilege_type`),
  ]);

  const missingTables = TABLES.filter(table => !columns.some(column => column.table_name === table));
  const missingFunctions = FUNCTIONS.filter(fn => !functions.some(item => item.function_name === fn));
  if (missingTables.length || missingFunctions.length) throw new Error(`Incomplete schema visibility. Missing tables: ${missingTables.join(', ') || 'none'}; functions: ${missingFunctions.join(', ') || 'none'}`);

  const lines = [
    '-- MAGPPIE CRM sanitized local database bootstrap',
    '-- Generated from the existing local-replica database. No customer rows are included.',
    '-- Replace every __REPLACE_AT_DEPLOYMENT__ placeholder with a new deployment-only secret before applying.',
    '', 'BEGIN;', '', 'CREATE EXTENSION IF NOT EXISTS pg_trgm;', '',
  ];

  for (const table of TABLES) {
    const fields = columns.filter(column => column.table_name === table).map(column => {
      const defaultSql = column.column_default ? ` DEFAULT ${column.column_default}` : '';
      const identitySql = column.identity_kind === 'a' ? ' GENERATED ALWAYS AS IDENTITY' : (column.identity_kind === 'd' ? ' GENERATED BY DEFAULT AS IDENTITY' : '');
      return `  ${qIdent(column.column_name)} ${column.data_type}${identitySql}${defaultSql}${column.not_null ? ' NOT NULL' : ''}`;
    });
    lines.push(`CREATE TABLE IF NOT EXISTS public.${qIdent(table)} (`, fields.join(',\n'), ');', '');
  }

  for (const constraint of constraints) lines.push(addConstraint(constraint), '');
  for (const index of indexes) {
    const definition = String(index.definition).replace(/^CREATE (UNIQUE )?INDEX /, (_, unique) => `CREATE ${unique || ''}INDEX IF NOT EXISTS `);
    lines.push(`${definition};`, '');
  }

  for (const row of tableSecurity) {
    if (row.rls_enabled) lines.push(`ALTER TABLE public.${qIdent(row.table_name)} ENABLE ROW LEVEL SECURITY;`);
    if (row.rls_forced) lines.push(`ALTER TABLE public.${qIdent(row.table_name)} FORCE ROW LEVEL SECURITY;`);
  }
  if (tableSecurity.some(row => row.rls_enabled || row.rls_forced)) lines.push('');

  for (const policy of policies) {
    const roles = Array.isArray(policy.roles) ? policy.roles.map(qIdent).join(', ') : 'PUBLIC';
    lines.push(`DROP POLICY IF EXISTS ${qIdent(policy.policy_name)} ON public.${qIdent(policy.table_name)};`);
    lines.push(`CREATE POLICY ${qIdent(policy.policy_name)} ON public.${qIdent(policy.table_name)} AS ${policy.permissive === 'PERMISSIVE' ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${policy.cmd} TO ${roles}${policy.qual ? ` USING (${policy.qual})` : ''}${policy.with_check ? ` WITH CHECK (${policy.with_check})` : ''};`, '');
  }

  lines.push(`INSERT INTO public.crm_secret (secret) VALUES ('__REPLACE_AT_DEPLOYMENT__') ON CONFLICT DO NOTHING;`, '');
  for (const functionName of FUNCTIONS) {
    for (const fn of functions.filter(item => item.function_name === functionName)) lines.push(sanitize(fn.definition).trim().replace(/;?$/, ';'), '');
  }
  for (const grant of tableGrants) lines.push(`GRANT ${grant.privilege_type} ON TABLE public.${qIdent(grant.table_name)} TO ${qIdent(grant.grantee)};`);
  for (const key of new Set(routineGrants.map(grant => `${grant.privilege_type}|${grant.grantee}`))) {
    const [privilege, grantee] = key.split('|');
    lines.push(`GRANT ${privilege} ON ALL FUNCTIONS IN SCHEMA public TO ${qIdent(grantee)};`);
  }
  lines.push('', 'COMMIT;', '');

  const output = sanitize(lines.join('\n'));
  const knownSecrets = [KEY, SECRET, process.env.ZOHO_CLIENT_SECRET, process.env.ZOHO_REFRESH_TOKEN, process.env.ACCESS_CODE].filter(Boolean);
  if (knownSecrets.some(value => output.includes(value))) throw new Error('Secret-sanitization check failed; schema was not written');

  const outDir = path.join(ROOT, 'database');
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, 'schema.sql');
  fs.writeFileSync(target, output, 'utf8');
  console.log(`Sanitized schema exported: ${TABLES.length} tables, ${constraints.length} constraints, ${indexes.length} indexes, ${functions.length} functions, ${policies.length} policies.`);
}

main().catch(error => {
  console.error(`Schema export failed: ${error.message}`);
  process.exitCode = 1;
});
