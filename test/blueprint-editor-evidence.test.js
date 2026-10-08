'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const blueprints = require('../config/blueprints.json');
const {
  DEALS_BLUEPRINT_ID,
  BlueprintEditorEvidenceError,
  normalizeCriteria,
  normalizeDealsEditorEvidence,
  normalizeDuringInput,
  normalizeOwners,
  validateDealsEditorArtifact,
} = require('../lib/blueprint-editor-evidence');

const artifactPath = path.join(__dirname, '..', '.private', 'zoho-discovery', 'deals-blueprint-phases-2026-08-30.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const blueprint = blueprints.blueprints.find(item => String(item.id) === DEALS_BLUEPRINT_ID);

test('Deals editor evidence reconciles exactly to all 80 authoritative graph transitions', () => {
  const ordered = validateDealsEditorArtifact(artifact, blueprint);
  assert.equal(ordered.length, 80);
  assert.deepEqual(new Set(ordered.map(item => String(item.id))), new Set(blueprint.transitions.map(item => String(item.id))));
});

test('Deals editor evidence normalizes mandatory fields and associated items without source identities', () => {
  const normalized = normalizeDealsEditorEvidence(artifact, blueprint);
  assert.equal(Object.keys(normalized.transitions).length, 80);
  assert.equal(normalized.phase_coverage, 'Specified: 80 of 80 transitions');
  assert.ok(Object.values(normalized.transitions).every(item => item.local_execution === 'Blocked'));
  assert.ok(Object.values(normalized.transitions).every(item => item.source_evidence.method === 'authenticated-read-only-ui-get'));
  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(serialized, /https?:\/\/|Zoho-oauthtoken|client_secret|refresh_token|\/Users\//i);
  assert.doesNotMatch(serialized, /Gursharan|Sachin|Mehul/i);
  assert.match(serialized, /Specific Users \(2\)/);
  assert.match(serialized, /Roles \(2\)/);
  assert.match(serialized, /Attachments/);
  assert.match(serialized, /Notes/);
});

test('Deals editor display-only criteria remain visible for audit and fail closed', () => {
  const fields = new Map([['Product Type', 'Product_Type'], ['Revision Type', 'Revision_Type']]);
  assert.deepEqual(normalizeCriteria('Product Type is SUNROOOF', fields), {
    criteria: [],
    criteria_display_text: 'Product Type is SUNROOOF',
    criteria_logic_supported: false,
  });
  assert.equal(normalizeCriteria("Product Type isn't SUNROOOF AND Number of Design Revisions > 0", fields).criteria_logic_supported, false);
  assert.equal(normalizeCriteria('Designer Name is Empty', fields).criteria_logic_supported, false);
});

test('Deals editor input normalizer preserves explicit mandatory evidence and rejects unknown types', () => {
  assert.deepEqual(normalizeDuringInput({
    Type: 'Field',
    IsNonMandatory: false,
    field: { api_name: 'Expected_Design_Date', field_label: 'Expected Design Date', data_type: 'date' },
  }, 0), {
    kind: 'field', api_name: 'Expected_Design_Date', label: 'Expected Design Date', data_type: 'date', required: true, sequence: 1,
  });
  assert.throws(() => normalizeDuringInput({ Type: 'Unknown' }, 0), error => error instanceof BlueprintEditorEvidenceError && error.code === 'DURING_TYPE_UNSUPPORTED');
});

test('Deals owner normalization exposes categories and counts only', () => {
  assert.deepEqual(normalizeOwners([
    { id: '-2', type: 'RecordOwner' },
    { id: '-1', type: 'User' },
    { id: '1', name: 'Private User', type: 'User' },
    { id: '2', type: 'Role' },
  ]), ['Record Owner', 'All Users', 'Specific Users (1)', 'Roles (1)']);
});
