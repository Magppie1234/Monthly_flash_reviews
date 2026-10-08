'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = require('../config/metadata-parity-audit.json');
const {
  assertNoSensitivePublicData,
  buildMetadataParityAudit,
  validateMetadataParityAudit,
  createMetadataParityAdapter,
} = require('../lib/metadata-parity');
const {
  LOCAL_METADATA_SQL,
  LOCAL_METADATA_BATCH_SIZE,
  assertReadOnlyQuery,
  metadataValueQuery,
  readLocalMetadataRows,
} = require('../scripts/audit-metadata-parity');

const root = path.resolve(__dirname, '..');

function exactCounts(area, expected) {
  assert.deepEqual({
    source: area.source_definitions,
    local: area.local_definitions,
    matched: area.matched_definitions,
    sourceOnly: area.source_only,
    localOnly: area.local_only,
    drift: area.semantic_drift,
  }, expected);
}

function exactStatuses(capture, expected) {
  assert.deepEqual(capture.status_counts, expected.map(([http_status, requests]) => ({ http_status, requests })));
}

function collectKeys(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectKeys(item, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    output.push(key.toLowerCase());
    collectKeys(child, output);
  }
  return output;
}

test('public audit contains the exact captured metadata parity counts', () => {
  validateMetadataParityAudit(audit);
  exactCounts(audit.areas.modules, { source: 153, local: 153, matched: 153, sourceOnly: 0, localOnly: 0, drift: 0 });
  exactCounts(audit.areas.fields, { source: 2377, local: 2377, matched: 2377, sourceOnly: 0, localOnly: 0, drift: 0 });
  exactCounts(audit.areas.layouts, { source: 70, local: 70, matched: 70, sourceOnly: 0, localOnly: 0, drift: 0 });
  exactCounts(audit.areas.picklists, { source: 387, local: 381, matched: 381, sourceOnly: 6, localOnly: 0, drift: 0 });
  exactCounts(audit.areas.pipelines, { source: 0, local: 0, matched: 0, sourceOnly: 0, localOnly: 0, drift: 0 });
  exactCounts(audit.areas.custom_views, { source: 386, local: 386, matched: 386, sourceOnly: 0, localOnly: 0, drift: 2 });
  exactCounts(audit.areas.related_lists, { source: 375, local: 375, matched: 375, sourceOnly: 0, localOnly: 0, drift: 0 });
  assert.deepEqual(audit.areas.custom_views.drift_attributes, [{ attribute: 'default', definitions: 2 }]);
  assert.deepEqual(audit.areas.custom_views.criteria_coverage, {
    captured_rows: 386,
    captured_rows_with_criteria: 0,
    local_rows_with_criteria: 252,
  });
});

test('source capture status totals preserve incomplete-evidence blockers exactly', () => {
  exactStatuses(audit.areas.modules.source_capture, [[200, 1]]);
  exactStatuses(audit.areas.fields.source_capture, [[200, 120], [204, 1], [400, 1]]);
  exactStatuses(audit.areas.layouts.source_capture, [[200, 67], [204, 8], [400, 47]]);
  exactStatuses(audit.areas.picklists.source_capture.global_picklists, [[200, 1]]);
  exactStatuses(audit.areas.pipelines.source_capture, [[204, 1], [400, 69]]);
  exactStatuses(audit.areas.custom_views.source_capture, [[200, 41], [204, 80], [400, 1]]);
  exactStatuses(audit.areas.related_lists.source_capture, [[200, 29], [204, 92], [400, 1]]);
  assert.equal(audit.areas.pipelines.source_capture.successful_requests, 1);
  assert.equal(audit.areas.pipelines.source_capture.failed_requests, 69);
  assert.equal(audit.areas.pipelines.status, 'Blocked');
});

test('picklist definition and field-option coverage is exact and global values remain unclaimed', () => {
  exactCounts(audit.areas.picklists.components.field_picklists, {
    source: 381, local: 381, matched: 381, sourceOnly: 0, localOnly: 0, drift: 0,
  });
  exactCounts(audit.areas.picklists.components.global_picklists, {
    source: 6, local: 0, matched: 0, sourceOnly: 6, localOnly: 0, drift: 0,
  });
  assert.deepEqual(audit.areas.picklists.option_coverage, {
    source_field_option_values: 31807,
    local_field_option_values: 31807,
    matched_field_option_values: 31807,
    source_only_field_option_values: 0,
    local_only_field_option_values: 0,
    field_option_semantic_drift: 0,
    source_definitions_with_values: 379,
    local_definitions_with_values: 379,
    captured_global_option_values: false,
  });
});

test('aggregate scope rows reconcile exactly to every area total', () => {
  for (const key of ['fields', 'layouts', 'pipelines', 'custom_views', 'related_lists']) {
    const area = audit.areas[key];
    const sums = area.affected_scopes.reduce((result, scope) => {
      result.sourceOnly += scope.source_only;
      result.localOnly += scope.local_only;
      result.drift += scope.semantic_drift;
      return result;
    }, { sourceOnly: 0, localOnly: 0, drift: 0 });
    assert.deepEqual(sums, {
      sourceOnly: area.source_only,
      localOnly: area.local_only,
      drift: area.semantic_drift,
    });
  }
});

test('public metadata evidence excludes records, identities, raw IDs, links, credentials, paths, and hashes', () => {
  const forbiddenKeys = new Set([
    'id', 'ids', 'source_id', 'source_ids', 'organization', 'organization_id', 'org_id',
    'url', 'urls', 'href', 'hrefs', 'path', 'paths', 'private_path', 'credential',
    'credentials', 'secret', 'token', 'hash', 'sha256', 'customer_data', 'identities',
  ]);
  assert.equal(collectKeys(audit).find(key => forbiddenKeys.has(key)), undefined);
  const document = fs.readFileSync(path.join(root, 'ZOHO_METADATA_PARITY_AUDIT.md'), 'utf8');
  const serialized = `${JSON.stringify(audit)}\n${document}`;
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\/(?:Users|home|var|tmp|opt|etc)\//i);
  assert.doesNotMatch(serialized, /\.private\//i);
  assert.doesNotMatch(serialized, /\borg\d{6,}\b/i);
  assert.doesNotMatch(serialized, /\b\d{15,}\b/);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(serialized, /\b[A-F0-9]{32,128}\b/i);
});

test('internal ID matching never copies private source material into the public audit', () => {
  const rawId = '1234567890123456789';
  const privateUrl = 'https://example.invalid/private';
  const snapshot = {
    global: {
      modules: { ok: true, status: 200, data: { modules: [{ id: rawId, api_name: 'Deals', web_link: privateUrl, status: 'visible' }] } },
      global_picklists: { ok: true, status: 200, data: { global_picklists: [{ id: rawId, api_name: 'Stage_Global' }] } },
    },
    modules: [{
      module: { api_name: 'Deals' },
      results: {
        fields: { ok: true, status: 200, data: { fields: [{ id: rawId, api_name: 'Stage', data_type: 'picklist', owner: { email: 'private@example.invalid' }, pick_list_values: [{ id: rawId, actual_value: 'Open', display_value: 'Open' }] }] } },
        layouts: { ok: true, status: 200, data: { layouts: [{ id: rawId, name: 'Standard', visible: true }] } },
        views: { ok: true, status: 200, data: { custom_views: [{ id: rawId, name: 'All', default: true }] } },
        related_lists: { ok: true, status: 200, data: { related_lists: [{ id: rawId, name: 'Notes', status: 'visible' }] } },
        pipelines: [{ ok: false, status: 400, endpoint: privateUrl, data: null }],
      },
    }],
  };
  const rows = [
    { key: 'modules', data: { modules: [{ id: rawId, api_name: 'Deals', web_link: privateUrl, status: 'visible' }] } },
    { key: 'fields:Deals', data: { fields: [{ id: rawId, api_name: 'Stage', data_type: 'picklist', pick_list_values: [{ id: rawId, actual_value: 'Open', display_value: 'Open' }] }] } },
    { key: 'layouts:Deals', data: { layouts: [{ id: rawId, name: 'Standard', visible: true }] } },
    { key: 'views:Deals', data: { custom_views: [{ id: rawId, name: 'All', default: false, criteria: { customer_name: 'Private' } }] } },
    { key: 'related_lists:Deals', data: { related_lists: [{ id: rawId, name: 'Notes', status: 'visible' }] } },
  ];
  const output = buildMetadataParityAudit(snapshot, rows, '2026-08-30T00:00:00.000Z');
  assert.equal(output.areas.custom_views.semantic_drift, 1);
  assert.equal(output.areas.pipelines.status, 'Blocked');
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes(rawId), false);
  assert.equal(serialized.includes(privateUrl), false);
  assert.doesNotMatch(serialized, /private@example\.invalid|customer_name/i);
  assertNoSensitivePublicData(output);
});

test('local inspection is restricted to SELECT-only crm_meta access', async () => {
  assert.equal(assertReadOnlyQuery(LOCAL_METADATA_SQL), LOCAL_METADATA_SQL);
  assert.equal(LOCAL_METADATA_BATCH_SIZE, 12);
  assert.match(metadataValueQuery(['fields:Deals', 'layouts:Deals']), /^select key, data from crm_meta/i);
  assert.throws(() => metadataValueQuery(['fields:Deals', 'unsafe:key:value']), /invalid/i);
  assert.throws(() => assertReadOnlyQuery('update crm_meta set data = null'), /SELECT-only/i);
  assert.throws(() => assertReadOnlyQuery('select * from crm_records'), /approved crm_meta scope/i);

  const original = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
    secret: process.env.CRM_SQL_SECRET,
  };
  process.env.SUPABASE_URL = 'https://metadata-audit.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-key';
  process.env.CRM_SQL_SECRET = 'test-secret';
  try {
    let request;
    const rows = await readLocalMetadataRows(async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => [] };
    });
    assert.deepEqual(rows, []);
    assert.equal(request.options.method, 'POST');
    const body = JSON.parse(request.options.body);
    assert.equal(body.q, LOCAL_METADATA_SQL);
    assert.match(body.q, /^select\b/i);
    assert.doesNotMatch(body.q, /crm_records|\busers\b|crm_secret/i);
  } finally {
    for (const [name, value] of [
      ['SUPABASE_URL', original.url],
      ['SUPABASE_ANON_KEY', original.key],
      ['CRM_SQL_SECRET', original.secret],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('runtime adapter is immutable and all fetch/update/delete methods fail closed', () => {
  const adapter = createMetadataParityAdapter();
  assert.equal(adapter.getAudit().parity_status, 'Blocked');
  assert.equal(Object.isFrozen(adapter), true);
  for (const method of ['fetchSourceMetadata', 'applyLocalMetadataUpdate', 'deleteLocalMetadata']) {
    assert.throws(() => adapter[method](), error => error?.code === 'METADATA_MUTATION_BLOCKED');
  }
  const enabled = structuredClone(audit);
  enabled.mutation_boundary.local_metadata_writes_enabled = true;
  assert.throws(() => validateMetadataParityAudit(enabled), /fail-closed/i);

  const unreconciled = structuredClone(audit);
  unreconciled.areas.fields.source_only += 1;
  assert.throws(() => validateMetadataParityAudit(unreconciled), /do not reconcile/i);
});
