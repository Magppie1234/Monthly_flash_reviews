'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const rawInventory = require('../config/active-function-behavior-inventory.json');
const { buildFunctionBehaviorInventory } = require('../lib/function-behavior-inventory');

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

test('active function behavior coverage reconciles workflow and button scope', () => {
  const output = buildFunctionBehaviorInventory(rawInventory);
  assert.equal(output.source_mode, 'read-only');
  assert.equal(output.coverage.status, 'Reconciled');
  assert.equal(output.coverage.detailed_workflow_rules, 44);
  assert.equal(output.coverage.active_workflow_rules, 39);
  assert.equal(output.coverage.workflow_function_associations, 22);
  assert.equal(output.coverage.unique_workflow_function_actions, 21);
  assert.equal(output.coverage.mapped_workflow_functions, 21);
  assert.equal(output.coverage.custom_function_button_references, 2);
  assert.equal(output.coverage.mapped_button_functions, 2);
  assert.equal(output.coverage.available_function_definitions, 60);
  assert.equal(output.coverage.in_scope_function_definitions, 23);
  assert.equal(output.coverage.analyzed_function_definitions, 23);
  assert.equal(output.coverage.unresolved_in_scope_references, 0);
  assert.equal(output.functions.length, 23);
  assert.equal(output.functions.flatMap(fn => fn.associations).length, 24);
});

test('active function behavior output exposes counts and modules but not field lists or private capture data', () => {
  const output = buildFunctionBehaviorInventory(rawInventory);
  assert.equal(output.affected.module_count, 10);
  assert.deepEqual(output.affected.field_references, {
    read: 106,
    write: 118,
    total: 224,
    unique_read: 73,
    unique_write: 89,
  });
  assert.ok(output.affected.modules.some(item => item.module === 'Contacts' && item.affected_function_count > 0));
  assert.ok(output.functions.every(fn => fn.local_execution === 'Blocked'));
  assert.ok(output.functions.every(fn => Number.isInteger(fn.field_references.read) && Number.isInteger(fn.field_references.write)));

  const forbiddenKeys = new Set([
    'body', 'code', 'content', 'sha256', 'hash', 'file', 'path', 'url', 'endpoint',
    'credential', 'credentials', 'secret', 'secret_scan', 'token', 'connection',
    'connection_dependencies', 'external_services', 'inputs', 'fields_read', 'fields_written',
  ]);
  const exposedKey = collectKeys(output).find(key => forbiddenKeys.has(key.toLowerCase()));
  assert.equal(exposedKey, undefined);

  const serialized = JSON.stringify(output);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\bwww\./i);
  assert.doesNotMatch(serialized, /\/Users\/|\/home\/|\.private\//i);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
});

test('execution boundary remains fail-closed', () => {
  const output = buildFunctionBehaviorInventory(rawInventory);
  assert.deepEqual(output.execution, {
    local_status: 'Blocked',
    local_function_execution_enabled: false,
    source_execution_enabled: false,
    source_writes_enabled: false,
    outbound_delivery_enabled: false,
    reason: 'Behavior metadata is for replication planning only; every function remains fail-closed.',
  });
});

test('public sanitizer redacts URLs, addresses, private paths, and credential-shaped values', () => {
  const output = buildFunctionBehaviorInventory({
    generated_at: '2026-08-29',
    scope: { captured_function_bodies_available: 1 },
    secret_scan: { high: 1, location: '/Users/example/private.js', value: 'do-not-leak' },
    functions: [{
      id: '1',
      display_name: 'Synthetic',
      category: 'Automation',
      behavior: 'Calls https://example.invalid/hook for person@example.com using token=abcdefghijk and Bearer abcdefghijk.',
      blockers: ['Captured at /Users/example/private.js with password: abcdefghijk and digest aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.'],
      associations: [{
        source: 'active_workflow',
        rule_id: '2',
        rule_name: 'Rule',
        rule_module: 'Leads',
        action_id: '3',
        action_name: 'Synthetic',
      }],
      fields_read: ['Email'],
      fields_written: ['Status'],
      modules_read: ['Leads'],
      modules_written: ['Leads'],
    }],
  });
  const serialized = JSON.stringify(output);
  assert.doesNotMatch(serialized, /example\.invalid|person@example\.com|\/Users\/example|abcdefghijk|do-not-leak|a{64}/i);
  assert.doesNotMatch(serialized, /secret_scan|"fields_read"|"fields_written"/i);
  assert.match(serialized, /external target omitted|address omitted|private path omitted|sensitive value omitted/i);
});
