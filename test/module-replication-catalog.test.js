'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rawCatalog = require('../config/module-replication-catalog.json');
const taskEvidence = require('../config/task-subform-reconciliation.json');
const dataCompleteness = require('../config/data-completeness.json');
const {
  EXPECTED_SCHEDULED_DATASETS,
  assertNoSensitiveData,
  buildModuleReplicationCatalog,
  getModuleReplicationCatalog,
  getModuleReplicationDataset,
} = require('../lib/module-replication-catalog');

const root = path.resolve(__dirname, '..');
const sourceCapture = JSON.parse(fs.readFileSync(
  path.join(root, '.private', 'zoho-discovery', 'latest.json'),
  'utf8',
));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function generated(type) {
  return ['field_tracker', 'linking', 'subform'].includes(type);
}

test('catalog enumerates every and only API-supported captured record dataset', () => {
  const catalog = getModuleReplicationCatalog();
  const capturedNames = sourceCapture.global.modules.data.modules
    .filter(module => module.api_name && module.api_supported !== false)
    .map(module => module.api_name)
    .sort();
  const catalogNames = catalog.datasets.map(dataset => dataset.api_name).sort();

  assert.equal(sourceCapture.global.modules.data.modules.length, 153);
  assert.equal(capturedNames.length, 122);
  assert.deepEqual(catalogNames, capturedNames);
  assert.equal(new Set(catalogNames).size, 122);
  assert.deepEqual(catalog.scope, {
    source_module_definition_count: 153,
    api_supported_dataset_count: 122,
    api_unsupported_definition_count: 31,
    scheduled_dataset_count: 16,
    unscheduled_dataset_count: 106,
  });
});

test('ordinary count and unavailable classifications match the read-only source capture exactly', () => {
  const catalog = getModuleReplicationCatalog();
  const laterEvidence = new Set(['Tasks', 'Product_Details', 'Product_Details1', 'Project_Details', 'Project_Detail', 'Notes']);
  const byName = new Map(catalog.datasets.map(dataset => [dataset.api_name, dataset]));

  for (const entry of sourceCapture.modules) {
    const name = entry.module.api_name;
    if (laterEvidence.has(name)) continue;
    const dataset = byName.get(name);
    const isGenerated = generated(entry.module.generated_type);
    assert.equal(dataset.generated_type, entry.module.generated_type, name);
    assert.equal(dataset.generated, isGenerated, name);
    assert.equal(dataset.replication.state, 'unresolved', name);
    if (entry.source_count.ok) {
      assert.equal(dataset.source_count_observation.availability, 'observed_count', name);
      assert.equal(dataset.source_count_observation.count, entry.source_count.count, name);
      assert.equal(dataset.replication.classification,
        isGenerated ? 'generated_count_only_unresolved' : 'count_only_unresolved', name);
    } else {
      assert.equal(dataset.source_count_observation.availability, 'unavailable', name);
      assert.equal(dataset.source_count_observation.count, null, name);
      assert.equal(dataset.source_count_observation.http_status, entry.source_count.status, name);
      assert.equal(dataset.replication.classification,
        isGenerated ? 'generated_source_unavailable_unresolved' : 'source_unavailable_unresolved', name);
    }
  }
});

test('same-epoch active-ID audits are preserved without hiding count-scope gaps', () => {
  const catalog = getModuleReplicationCatalog();
  for (const evidence of taskEvidence.datasets) {
    const dataset = getModuleReplicationDataset(evidence.module);
    assert.equal(dataset.source_count_observation.count, evidence.source_count_endpoint, evidence.module);
    assert.equal(dataset.replication.active_id_evidence.source_active_ids, evidence.source_active_ids, evidence.module);
    assert.equal(dataset.replication.active_id_evidence.local_source_active_ids, evidence.local_after, evidence.module);
    assert.equal(dataset.replication.active_id_evidence.count_only_unavailable, evidence.count_only_unavailable, evidence.module);
    assert.equal(dataset.replication.active_id_evidence.source_only_active_ids, 0, evidence.module);
    assert.equal(dataset.replication.active_id_evidence.local_only_active_ids, 0, evidence.module);
  }

  const tasks = getModuleReplicationDataset('Tasks');
  assert.equal(tasks.replication.state, 'reconciled');
  assert.equal(tasks.replication.classification, 'reconciled_active_ids');

  const notes = getModuleReplicationDataset('Notes');
  assert.equal(notes.source_count_observation.count, dataCompleteness.notes.source_count_endpoint);
  assert.equal(notes.replication.active_id_evidence.source_active_ids, dataCompleteness.notes.source_active_id_count);
  assert.equal(notes.replication.active_id_evidence.local_source_active_ids, dataCompleteness.notes.local_source_derived_id_count);
  assert.equal(notes.replication.active_id_evidence.count_only_unavailable, 150);
  assert.equal(notes.replication.state, 'unresolved');
  assert.equal(notes.replication.classification, 'active_id_parity_count_scope_unresolved');

  for (const module of ['Product_Details', 'Product_Details1', 'Project_Details', 'Project_Detail']) {
    assert.equal(getModuleReplicationDataset(module).replication.state, 'unresolved');
  }
  assert.equal(catalog.summary.classification_counts.active_id_parity_count_scope_unresolved, 5);
});

test('count-only, unavailable, generated, and observed-zero scopes all fail closed', () => {
  const catalog = getModuleReplicationCatalog();
  assert.deepEqual(catalog.summary.state_counts, { reconciled: 1, unresolved: 121 });
  assert.deepEqual(catalog.summary.source_count_observations, {
    observed: 37,
    unavailable: 85,
    observed_zero_but_unresolved: 12,
  });
  assert.equal(catalog.summary.generated_datasets, 22);
  assert.ok(catalog.datasets.filter(dataset => dataset.generated)
    .every(dataset => dataset.replication.state === 'unresolved'));
  assert.ok(catalog.datasets.filter(dataset => dataset.source_count_observation.availability === 'unavailable')
    .every(dataset => dataset.source_count_observation.count === null
      && dataset.replication.state === 'unresolved'));
  assert.ok(catalog.datasets.filter(dataset => dataset.source_count_observation.count === 0)
    .every(dataset => dataset.replication.state === 'unresolved'));
});

test('scheduler coverage is explicit but the catalog does not authorize new scheduling', () => {
  const catalog = getModuleReplicationCatalog();
  assert.deepEqual(catalog.scheduled_datasets, EXPECTED_SCHEDULED_DATASETS);
  assert.equal(catalog.datasets.filter(dataset => dataset.scheduled).length, 16);
  assert.equal(catalog.datasets.filter(dataset => !dataset.scheduled).length, 106);
  assert.equal(catalog.summary.scheduled_datasets, 16);
  assert.equal(catalog.summary.unscheduled_datasets, 106);

  const implementation = fs.readFileSync(path.join(root, 'lib', 'module-replication-catalog.js'), 'utf8');
  assert.doesNotMatch(implementation, /\bfetch\s*\(|https?:\/\//i);
  assert.doesNotMatch(implementation, /create|update|upsert|delete|scheduleModule/i);
});

test('catalog rejects invented zeroes, duplicate scopes, erased count gaps, and sensitive data', () => {
  const inventedZero = clone(rawCatalog);
  inventedZero.datasets_by_classification.source_unavailable_unresolved[0].source_count = 0;
  assert.throws(() => buildModuleReplicationCatalog(inventedZero), /inventing zero/);

  const duplicate = clone(rawCatalog);
  duplicate.datasets_by_classification.count_only_unresolved[1].api_name =
    duplicate.datasets_by_classification.count_only_unresolved[0].api_name;
  assert.throws(() => buildModuleReplicationCatalog(duplicate), /duplicate API names/);

  const erasedGap = clone(rawCatalog);
  const firstGap = erasedGap.datasets_by_classification.active_id_parity_count_scope_unresolved[0];
  firstGap.source_count = firstGap.source_active_ids;
  firstGap.count_only_unavailable = 0;
  assert.throws(() => buildModuleReplicationCatalog(erasedGap), /preserve its unresolved count-scope gap/);

  assert.throws(() => assertNoSensitiveData({ password: 'not-public' }), /forbidden sensitive key/);
  assert.throws(() => assertNoSensitiveData({ evidence: 'https://example.invalid' }), /forbidden sensitive value/);

  const embeddedSensitiveData = clone(rawCatalog);
  embeddedSensitiveData.url = 'https://example.invalid';
  assert.throws(() => buildModuleReplicationCatalog(embeddedSensitiveData), /forbidden sensitive key/);
});

test('published catalog is privacy-safe, immutable, and provides bounded lookup', () => {
  const catalog = getModuleReplicationCatalog();
  assertNoSensitiveData(catalog);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.datasets), true);
  assert.equal(Object.isFrozen(catalog.datasets[0].replication), true);
  assert.equal(getModuleReplicationDataset('Tasks').api_name, 'Tasks');
  assert.equal(getModuleReplicationDataset('Unknown_Module'), null);
  assert.throws(() => getModuleReplicationDataset('../unsafe'), /safe API name/);

  const serialized = JSON.stringify(rawCatalog);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\/(?:Users|home|var|tmp|opt|etc)\//i);
  assert.doesNotMatch(serialized, /\.private\//i);
  assert.doesNotMatch(serialized, /\borg\d{6,}\b/i);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(serialized, /\b\d{15,25}\b/);
});

test('server and Automation UI expose the catalog without widening scheduler authority or fabricating parity', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

  assert.match(server, /getModuleReplicationCatalog/);
  assert.match(server, /app\.get\('\/api\/meta\/module_replication_catalog'/);
  assert.match(app, /\/api\/meta\/module_replication_catalog/);
  assert.match(app, /122 API-Supported Modules/);
  assert.match(app, /Only Tasks currently has same-epoch active-ID parity/);
  assert.match(app, /other 121 datasets remain unresolved/);
  assert.match(app, /does not authorize widening the existing 16-dataset scheduler/);
  assert.match(app, /Evidence unavailable · no dataset is treated as reconciled/);
});
