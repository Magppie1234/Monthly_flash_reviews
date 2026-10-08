'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertNoSecrets,
  assertOrganizationMatch,
  buildCapturedMetadataHydrationPlan,
} = require('../lib/captured-metadata-hydration');

function snapshot(overrides = {}) {
  return {
    source_mode: 'read-only',
    organization_verified: true,
    organization: { id: 'org-1' },
    modules: [{
      module: { api_name: 'Leads' },
      results: {
        fields: { ok: true, status: 200, data: { fields: [{ api_name: 'Last_Name' }] } },
        layouts: { ok: true, status: 200, data: { layouts: [{ id: 'layout-1', name: 'Standard' }] } },
        views: { ok: true, status: 200, data: { custom_views: [{ id: 'view-1', name: 'All Leads' }] } },
        related_lists: { ok: true, status: 204, data: null },
      },
    }],
    ...overrides,
  };
}

test('builds missing-only metadata hydration entries and normalizes successful empty captures', () => {
  const plan = buildCapturedMetadataHydrationPlan(snapshot(), ['fields:Leads']);
  assert.equal(plan.entries.length, 3);
  assert.deepEqual(plan.entries.map(entry => entry.key).sort(), [
    'layouts:Leads',
    'related_lists:Leads',
    'views:Leads',
  ]);
  assert.deepEqual(plan.entries.find(entry => entry.key === 'related_lists:Leads').data, { related_lists: [] });
  assert.equal(plan.coverage.fields.preserved_existing, 1);
  assert.equal(plan.coverage.layouts.definitions_planned, 1);
  assert.equal(plan.overwrite_existing, false);
});

test('skips failed source captures instead of fabricating empty local metadata', () => {
  const input = snapshot();
  input.modules[0].results.layouts = { ok: false, status: 400, data: { layouts: [] } };
  const plan = buildCapturedMetadataHydrationPlan(input, []);
  assert.equal(plan.entries.some(entry => entry.key === 'layouts:Leads'), false);
  assert.equal(plan.coverage.layouts.capture_unavailable, 1);
});

test('requires the verified read-only snapshot to match the local organization', () => {
  assert.equal(assertOrganizationMatch(snapshot(), { org: [{ id: 'org-1' }] }), true);
  assert.equal(assertOrganizationMatch({ ...snapshot(), organization: { ok: true, data: { org: [{ id: 'org-1' }] } } }, { org: [{ id: 'org-1' }] }), true);
  assert.throws(() => assertOrganizationMatch(snapshot(), { org: [{ id: 'org-2' }] }), /do not match/);
  assert.throws(() => assertOrganizationMatch(snapshot({ organization_verified: false }), { org: [{ id: 'org-1' }] }), /not a verified read-only/);
});

test('rejects secret-shaped keys and values before creating a write plan', () => {
  assert.throws(() => assertNoSecrets({ access_token: 'not-even-a-real-value' }), /forbidden key/);
  assert.throws(() => assertNoSecrets({ value: 'Bearer abcdefghijklmnop' }), /credential-shaped/);
  const input = snapshot();
  input.modules[0].results.fields.data.fields[0].password = 'unsafe';
  assert.throws(() => buildCapturedMetadataHydrationPlan(input, []), /forbidden key/);
});

test('rejects duplicate or unsafe module scopes', () => {
  const duplicate = snapshot();
  duplicate.modules.push(duplicate.modules[0]);
  assert.throws(() => buildCapturedMetadataHydrationPlan(duplicate, []), /duplicate module/);
  const unsafe = snapshot();
  unsafe.modules[0].module.api_name = 'Leads;drop';
  assert.throws(() => buildCapturedMetadataHydrationPlan(unsafe, []), /unsafe module/);
});
