'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const rawCoverage = require('../config/permission-coverage.json');
const {
  buildPermissionCoverage,
  evaluatePermissionRequest,
  getPermissionCoverage,
} = require('../lib/permission-coverage');

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

test('captured roles, profiles, users, and module permissions reconcile exactly', () => {
  const coverage = getPermissionCoverage();
  assert.equal(coverage.source_mode, 'read-only');
  assert.equal(coverage.source_coverage.roles, 14);
  assert.equal(coverage.source_coverage.profiles, 11);
  assert.equal(coverage.source_coverage.users, 63);
  assert.equal(coverage.source_coverage.profile_detail_responses, 11);
  assert.equal(coverage.source_coverage.profile_module_assignments, 506);
  assert.equal(coverage.source_coverage.modules_in_profile_matrix, 46);
  assert.equal(coverage.roles.length, 14);
  assert.equal(coverage.profiles.length, 11);
  assert.equal(new Set(coverage.roles.map(role => role.name)).size, 14);
  assert.equal(new Set(coverage.profiles.map(profile => profile.name)).size, 11);
  assert.ok(coverage.profiles.every(profile => profile.module_permissions.length === 46));
  assert.equal(coverage.profiles.flatMap(profile => profile.module_permissions).length, 506);
  const roleNames = new Set(coverage.roles.map(role => role.name));
  assert.ok(coverage.roles.every(role => role.reporting_to === null || roleNames.has(role.reporting_to)));
});

test('source action totals and field exception assignments reconcile exactly', () => {
  const coverage = getPermissionCoverage();
  assert.deepEqual(coverage.source_coverage.profile_module_actions, {
    allowed: { view: 361, create: 271, edit: 260, delete: 152 },
    denied: { view: 145, create: 235, edit: 246, delete: 354 },
  });
  assert.deepEqual(coverage.source_coverage.permission_types, { hidden: 928, read_only: 1908 });
  assert.equal(coverage.source_coverage.field_exception_groups, 273);
  assert.equal(coverage.source_coverage.field_exception_assignments, 2836);
  assert.equal(coverage.source_coverage.modules_with_field_exceptions, 50);
  assert.equal(coverage.field_permission_model.exceptions.length, 273);
  const assignments = coverage.field_permission_model.exceptions.flatMap(group => group.profile_permissions);
  assert.equal(assignments.length, 2836);
  assert.equal(assignments.filter(item => item.permission === 'hidden').length, 928);
  assert.equal(assignments.filter(item => item.permission === 'read_only').length, 1908);
  assert.equal(coverage.field_permission_model.profile_labels.length, 16);
  assert.deepEqual(coverage.field_permission_model.unresolved_profile_labels, [
    'Admins',
    'Managers',
    'Members',
    'Participants',
    'Requesters',
  ]);
});

test('user evidence is aggregate-only and contains no identities or source IDs', () => {
  const coverage = getPermissionCoverage();
  assert.deepEqual(coverage.source_user_aggregates.status, {
    active: 32,
    deleted: 4,
    disabled: 27,
  });
  const sum = value => Object.values(value).reduce((total, count) => total + count, 0);
  assert.equal(sum(coverage.source_user_aggregates.by_profile), 63);
  assert.equal(sum(coverage.source_user_aggregates.by_role), 63);
  assert.equal(coverage.source_user_aggregates.local_users_mapped, 0);
  assert.equal(coverage.source_user_aggregates.individual_records_included, false);
  assert.ok(Object.values(coverage.privacy).every(value => value === false));

  const forbiddenKeys = new Set([
    'alias', 'api_key', 'authorization', 'credential', 'credentials', 'email', 'endpoint',
    'first_name', 'full_name', 'id', 'last_name', 'mobile', 'password', 'phone',
    'private_path', 'profile_id', 'role_id', 'secret', 'source_endpoint', 'source_id',
    'token', 'user_id', 'user_name', 'url',
  ]);
  const exposedKey = collectKeys(coverage).find(key => forbiddenKeys.has(key.toLowerCase()));
  assert.equal(exposedKey, undefined);
  const serialized = JSON.stringify(coverage);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\bwww\./i);
  assert.doesNotMatch(serialized, /\/(?:Users|home|var|tmp|opt|etc)\//i);
  assert.doesNotMatch(serialized, /\.private\//i);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(serialized, /\b\d{15,25}\b/);
});

test('local authorization truth remains explicit and fail-closed', () => {
  const coverage = getPermissionCoverage();
  assert.deepEqual(coverage.local_authorization.current_effective_model, {
    model: 'Shared local session with no individual principal',
    default_bind_scope: 'Loopback',
    shared_access_gate_present: true,
    shared_access_gate_configured: false,
    per_user_authentication: false,
    verified_session_principal: false,
    profile_assignment: false,
    role_assignment: false,
    record_owner_mapping: false,
  });
  const enforcement = coverage.local_authorization.source_permission_enforcement;
  assert.equal(enforcement.role_hierarchy_nodes_enforced, 0);
  assert.equal(enforcement.profiles_assignable_to_local_principals, 0);
  assert.equal(enforcement.profile_module_assignments_enforced, 0);
  assert.equal(enforcement.field_exception_assignments_enforced, 0);
  assert.equal(enforcement.source_users_mapped_to_local_principals, 0);
  assert.ok(Object.entries(enforcement)
    .filter(([key]) => key.endsWith('_enforced') || key.endsWith('_profile') || key.endsWith('_role') || key.endsWith('_user'))
    .every(([, value]) => value === false || value === 0));
  assert.equal(enforcement.status, 'Blocked');
  assert.deepEqual(coverage.enforcement_boundary, {
    local_permission_enforcement_enabled: false,
    inferred_profile_headers_trusted: false,
    caller_supplied_role_or_profile_trusted: false,
    default_permission_decision: 'Deny',
    status: 'Blocked',
    reason: 'No verified local principal-to-source user, profile, and role mapping exists.',
  });
});

test('identity provider and source-user mapping remain an explicit unresolved decision', () => {
  const coverage = getPermissionCoverage();
  assert.equal(coverage.identity_provider_decision.status, 'Required');
  assert.equal(coverage.identity_provider_decision.identity_provider, 'Unselected');
  assert.equal(coverage.identity_provider_decision.local_principal_model, 'Not implemented');
  assert.equal(coverage.identity_provider_decision.source_user_mapping, 'Not implemented');
  assert.equal(coverage.identity_provider_decision.source_profile_mapping, 'Not implemented');
  assert.equal(coverage.identity_provider_decision.source_role_mapping, 'Not implemented');
  assert.equal(coverage.identity_provider_decision.inactive_and_deleted_user_policy, 'Not decided');
});

test('permission evaluator denies every caller-supplied role or profile claim', () => {
  const attempts = [
    {},
    { profile: 'Administrator', module: 'Leads', action: 'view' },
    { role: 'CEO', module: 'Contacts', action: 'edit' },
    { headers: { profile: 'Administrator' }, module: 'Deals', action: 'create' },
  ];
  attempts.forEach(attempt => {
    assert.deepEqual(evaluatePermissionRequest(attempt), {
      allowed: false,
      status: 'Blocked',
      code: 'LOCAL_IDENTITY_MAPPING_REQUIRED',
      reason: 'No verified local principal-to-source user, profile, and role mapping exists.',
    });
  });
});

test('runtime adapter returns a fresh explicit allowlist', () => {
  const first = getPermissionCoverage();
  const second = getPermissionCoverage();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.roles, second.roles);
  assert.notStrictEqual(first.profiles[0].module_permissions, second.profiles[0].module_permissions);
  assert.notStrictEqual(first.field_permission_model.exceptions, second.field_permission_model.exceptions);
  first.roles[0].name = 'Mutated';
  first.profiles[0].module_permissions[0].view = !first.profiles[0].module_permissions[0].view;
  assert.notEqual(second.roles[0].name, 'Mutated');

  const input = structuredClone(rawCoverage);
  input.unreviewed_metadata = 'omit me';
  input.roles[0].unreviewed_metadata = 'omit me';
  const output = buildPermissionCoverage(input);
  assert.equal(output.unreviewed_metadata, undefined);
  assert.equal(output.roles[0].unreviewed_metadata, undefined);
});

test('runtime adapter rejects count drift, enabled enforcement, identities, and sensitive values', () => {
  const missingRole = structuredClone(rawCoverage);
  missingRole.roles.pop();
  assert.throws(() => buildPermissionCoverage(missingRole), /role catalog|reconcile/i);

  const enabledPermission = structuredClone(rawCoverage);
  enabledPermission.profiles[0].module_permissions[0].local_enforcement = 'Implemented';
  assert.throws(() => buildPermissionCoverage(enabledPermission), /blocked locally/i);

  const enabledBoundary = structuredClone(rawCoverage);
  enabledBoundary.enforcement_boundary.local_permission_enforcement_enabled = true;
  assert.throws(() => buildPermissionCoverage(enabledBoundary), /fail-closed/i);

  const withIdentity = structuredClone(rawCoverage);
  withIdentity.user_name = 'Synthetic Person';
  assert.throws(() => buildPermissionCoverage(withIdentity), /forbidden identity/i);

  const withRawId = structuredClone(rawCoverage);
  withRawId.identity_provider_decision.required_decision = 'Map source 1032257000000000001';
  assert.throws(() => buildPermissionCoverage(withRawId), /forbidden identity|sensitive value/i);

  const withPrivatePath = structuredClone(rawCoverage);
  withPrivatePath.identity_provider_decision.required_decision = 'Read /Users/example/private.json';
  assert.throws(() => buildPermissionCoverage(withPrivatePath), /forbidden identity|sensitive value/i);
});
