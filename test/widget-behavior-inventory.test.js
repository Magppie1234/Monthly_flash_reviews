'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const inventory = require('../config/widget-behavior-inventory.json');
const {
  SOURCE_WIDGETS,
  normalizeDisplayName,
  validateArchiveEntryNames,
} = require('../scripts/build-widget-behavior-inventory');
const {
  buildWidgetBehaviorInventory,
  getWidgetBehaviorInventory,
} = require('../lib/widget-behavior-inventory');

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectKeys(item, keys));
    return keys;
  }
  if (!value || typeof value !== 'object') return keys;
  Object.entries(value).forEach(([key, child]) => {
    keys.push(key);
    collectKeys(child, keys);
  });
  return keys;
}

test('widget source rows and package captures reconcile exactly', () => {
  assert.equal(inventory.source_mode, 'read-only');
  assert.equal(inventory.reconciliation.status, 'Reconciled');
  assert.equal(inventory.reconciliation.source_widget_rows, 40);
  assert.equal(inventory.reconciliation.zoho_hosted_widgets, 20);
  assert.equal(inventory.reconciliation.external_hosted_widgets, 20);
  assert.equal(inventory.reconciliation.expected_zoho_packages, 20);
  assert.equal(inventory.reconciliation.captured_zoho_packages, 20);
  assert.equal(inventory.reconciliation.validated_zoho_packages, 20);
  assert.equal(inventory.reconciliation.unmatched_zoho_packages, 0);
  assert.equal(inventory.reconciliation.external_packages_unavailable, 20);
  assert.equal(inventory.widgets.length, 40);
  assert.equal(new Set(inventory.widgets.map(widget => widget.id)).size, 40);
  assert.deepEqual(inventory.type_summary, {
    Blueprint: 19,
    Button: 16,
    'Home Page Dashboard': 3,
    Settings: 1,
    'Web Tab': 1,
  });
});

test('all captured packages passed defensive archive validation', () => {
  const captured = inventory.widgets.filter(widget => widget.package.captured);
  const external = inventory.widgets.filter(widget => !widget.package.captured);
  assert.equal(captured.length, 20);
  assert.equal(external.length, 20);
  assert.ok(captured.every(widget => widget.package.archive_validation === 'Passed'));
  assert.ok(captured.every(widget => widget.package.static_analysis === 'Completed without executing widget code'));
  assert.ok(captured.every(widget => widget.package.entries > 0 && widget.package.regular_files > 0));
  assert.ok(external.every(widget => widget.package.archive_validation === 'Not applicable'));
  assert.deepEqual(inventory.archive_safety, {
    crc_test: 'Passed',
    path_traversal: 'None detected',
    absolute_paths: 'None detected',
    backslash_paths: 'None detected',
    symbolic_links: 'None detected',
    duplicate_entries: 'None detected',
    size_limits: 'Passed',
    regular_files: 38,
    total_uncompressed_bytes: 1109175,
    maximum_entries_in_one_package: 4,
    maximum_uncompressed_bytes_in_one_package: 126247,
  });
});

test('widget display-name normalization removes only a trailing Installed status suffix', () => {
  assert.equal(normalizeDisplayName('Designer Form Widget Installed'), 'Designer Form Widget');
  assert.equal(normalizeDisplayName('Service Team AMS Dashboard Installed'), 'Service Team AMS Dashboard');
  assert.equal(normalizeDisplayName('Installed Widget'), 'Installed Widget');
  assert.equal(normalizeDisplayName('Widget Installed Copy'), 'Widget Installed Copy');
  SOURCE_WIDGETS.forEach((sourceWidget, index) => {
    assert.equal(inventory.widgets[index].name, normalizeDisplayName(sourceWidget.sourceDisplayName));
  });
});

test('every widget remains fail-closed and captured behaviors are mapped', () => {
  assert.deepEqual(inventory.execution_boundary, {
    local_widget_execution_enabled: false,
    source_widget_execution_enabled: false,
    source_writes_enabled: false,
    outbound_delivery_enabled: false,
    status: 'Blocked',
    reason: 'The inventory is evidence for replication planning only; every widget remains fail-closed.',
  });
  assert.ok(inventory.widgets.every(widget => widget.local_execution.status === 'Blocked'));
  assert.ok(inventory.widgets.every(widget => widget.local_execution.enabled === false));
  assert.ok(inventory.widgets.every(widget => widget.local_execution.fail_closed === true));
  const captured = inventory.widgets.filter(widget => widget.package.captured);
  assert.ok(captured.every(widget => widget.behavior.purpose));
  assert.ok(captured.every(widget => Array.isArray(widget.behavior.context_modules)));
  assert.ok(captured.every(widget => Array.isArray(widget.behavior.record_actions) && widget.behavior.record_actions.length > 0));
  assert.ok(captured.every(widget => Array.isArray(widget.behavior.mandatory_inputs)));
  assert.ok(captured.every(widget => widget.behavior.local_equivalent_feasibility));
  assert.ok(captured.every(widget => widget.behavior.local_blockers.length > 0));
});

test('Sunrooof review records the complete cross-organization boundary without exposing protected values', () => {
  const widget = inventory.widgets.find(item => item.name === 'Sunrooof Mark Closures');
  assert.ok(widget);
  assert.deepEqual(widget.behavior.modules_written, [
    'Accounts',
    'Contacts',
    'Deals',
    'Product_Items',
    'Payment_Milestones',
    'Attachments',
  ]);
  assert.match(widget.behavior.purpose, /cross-organization Sunrooof CRM records/i);
  assert.ok(widget.behavior.record_actions.some(action => /WorkDrive folder/i.test(action)));
  assert.ok(widget.behavior.record_actions.some(action => /trigger workflows/i.test(action)));
  assert.ok(widget.behavior.dependencies.some(dependency => /both CRM organizations and WorkDrive/i.test(dependency)));
  assert.ok(widget.behavior.local_blockers.some(blocker => /revoked or rotated/i.test(blocker)));
  assert.ok(widget.behavior.local_blockers.some(blocker => /idempotency, rollback/i.test(blocker)));
  assert.equal(widget.local_execution.enabled, false);
  assert.equal(widget.local_execution.fail_closed, true);
});

test('public widget inventory excludes source bodies and sensitive capture metadata', () => {
  const forbiddenKeys = new Set([
    'archive_name', 'body', 'code', 'content', 'credential', 'credentials', 'endpoint',
    'external_url', 'file', 'hash', 'local_path', 'path', 'secret', 'sha256', 'token', 'url',
  ]);
  const exposedKey = collectKeys(inventory).find(key => forbiddenKeys.has(key.toLowerCase()));
  assert.equal(exposedKey, undefined);
  assert.deepEqual(inventory.privacy, {
    widget_code_exposed: false,
    external_targets_exposed: false,
    archive_hashes_exposed: false,
    local_paths_exposed: false,
    credentials_exposed: false,
    personally_identifiable_information_exposed: false,
  });
  const serialized = JSON.stringify(inventory);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\bwww\./i);
  assert.doesNotMatch(serialized, /\/(?:Users|home|var|tmp|opt|etc)\//i);
  assert.doesNotMatch(serialized, /\.private\//i);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(serialized, /\b[A-F0-9]{32,128}\b/i);
});

test('archive entry-name validator rejects traversal, absolute, backslash, and duplicate names', () => {
  assert.equal(validateArchiveEntryNames(['app/', 'app/widget.html']), true);
  assert.throws(() => validateArchiveEntryNames(['../widget.html']), /unsafe entry/i);
  assert.throws(() => validateArchiveEntryNames(['/app/widget.html']), /unsafe entry/i);
  assert.throws(() => validateArchiveEntryNames(['app\\widget.html']), /unsafe entry/i);
  assert.throws(() => validateArchiveEntryNames(['app/widget.html', 'app/widget.html']), /duplicate entry/i);
});

test('runtime adapter returns a fresh explicitly allowlisted coverage payload', () => {
  const first = getWidgetBehaviorInventory();
  const second = getWidgetBehaviorInventory();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.widgets, second.widgets);
  assert.notStrictEqual(first.widgets[0], second.widgets[0]);
  assert.notStrictEqual(first.widgets[0].behavior.context_modules, second.widgets[0].behavior.context_modules);
  assert.equal(first.widgets.length, 40);
  assert.equal(first.reconciliation.validated_zoho_packages, 20);
  assert.equal(first.reconciliation.external_packages_unavailable, 20);
  assert.equal(first.execution_boundary.status, 'Blocked');
  first.widgets[0].name = 'mutated';
  first.widgets[0].behavior.context_modules.push('Synthetic');
  assert.notEqual(second.widgets[0].name, 'mutated');
  assert.doesNotMatch(JSON.stringify(second), /Synthetic/);

  const input = structuredClone(inventory);
  input.unreviewed_metadata = 'must not be copied';
  input.widgets[0].behavior.unreviewed_metadata = 'must not be copied';
  const output = buildWidgetBehaviorInventory(input);
  assert.equal(output.unreviewed_metadata, undefined);
  assert.equal(output.widgets[0].behavior.unreviewed_metadata, undefined);
});

test('runtime adapter rejects exact-count and fail-closed boundary drift', () => {
  const missingWidget = structuredClone(inventory);
  missingWidget.widgets.pop();
  assert.throws(() => buildWidgetBehaviorInventory(missingWidget), /coverage|reconcile/i);

  const enabledWidget = structuredClone(inventory);
  enabledWidget.widgets[0].local_execution.enabled = true;
  assert.throws(() => buildWidgetBehaviorInventory(enabledWidget), /fail-closed/i);

  const sourceWrite = structuredClone(inventory);
  sourceWrite.execution_boundary.source_writes_enabled = true;
  assert.throws(() => buildWidgetBehaviorInventory(sourceWrite), /fail-closed/i);

  const duplicateId = structuredClone(inventory);
  duplicateId.widgets[1].id = duplicateId.widgets[0].id;
  assert.throws(() => buildWidgetBehaviorInventory(duplicateId), /unique|reconcile/i);
});

test('runtime adapter rejects forbidden keys and sensitive-shaped values before exposure', () => {
  const withUrlKey = structuredClone(inventory);
  withUrlKey.widgets[0].behavior.url = 'omitted';
  assert.throws(() => buildWidgetBehaviorInventory(withUrlKey), /forbidden sensitive key/i);

  const withExternalTarget = structuredClone(inventory);
  withExternalTarget.widgets[0].behavior.purpose = 'Open https://example.invalid/widget';
  assert.throws(() => buildWidgetBehaviorInventory(withExternalTarget), /forbidden sensitive value/i);

  const withPrivatePath = structuredClone(inventory);
  withPrivatePath.widgets[0].behavior.local_blockers = ['/Users/example/private/widget.html'];
  assert.throws(() => buildWidgetBehaviorInventory(withPrivatePath), /forbidden sensitive value/i);

  const withCredential = structuredClone(inventory);
  withCredential.widgets[0].behavior.dependencies = ['token=abcdefghijk'];
  assert.throws(() => buildWidgetBehaviorInventory(withCredential), /forbidden sensitive value/i);
});
