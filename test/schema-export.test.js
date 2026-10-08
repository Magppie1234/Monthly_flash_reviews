'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');

test('sanitized database bootstrap contains the required contract and no known secret', () => {
  for (const table of ['crm_secret', 'crm_records', 'crm_meta', 'crm_audit']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS public\\."${table}"`));
  }
  for (const fn of ['crm_derive', 'crm_sql', 'crm_bulk_upsert', 'crm_meta_upsert', 'crm_insert', 'crm_patch', 'crm_blueprint_transition', 'crm_log']) {
    assert.match(schema, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
  }
  assert.match(schema, /__REPLACE_AT_DEPLOYMENT__/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS crm_records_analytics_cover_idx[\s\S]*INCLUDE \(id, status, created_time, modified_time, due_date, ts2\)[\s\S]*WHERE module IN \('Leads', 'Contacts', 'Deals', 'Tasks', 'Calls', 'Events'\)/);
  const topLevelInserts = schema.split('\n').filter(line => /^INSERT INTO/i.test(line));
  assert.deepEqual(topLevelInserts, ["INSERT INTO public.crm_secret (secret) VALUES ('__REPLACE_AT_DEPLOYMENT__') ON CONFLICT DO NOTHING;"], 'schema must not contain CRM data inserts');
  for (const secret of [
    process.env.CRM_SQL_SECRET,
    process.env.SUPABASE_ANON_KEY,
    process.env.ZOHO_CLIENT_SECRET,
    process.env.ZOHO_REFRESH_TOKEN,
    process.env.ACCESS_CODE,
  ].filter(value => value && value.length >= 8)) assert.equal(schema.includes(secret), false, 'known secret leaked into schema');
});
