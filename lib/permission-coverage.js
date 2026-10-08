'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'permission-coverage.json');
const RAW_COVERAGE = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const EXPECTED_SOURCE_COUNTS = Object.freeze({
  roles: 14,
  profiles: 11,
  users: 63,
  profile_detail_responses: 11,
  profile_module_assignments: 506,
  modules_in_profile_matrix: 46,
  field_exception_groups: 273,
  field_exception_assignments: 2836,
  modules_with_field_exceptions: 50,
  fields_with_exceptions: 273,
  field_profile_labels: 16,
  hidden_field_assignments: 928,
  read_only_field_assignments: 1908,
});

const EXPECTED_ACTION_COUNTS = Object.freeze({
  allowed: Object.freeze({ view: 361, create: 271, edit: 260, delete: 152 }),
  denied: Object.freeze({ view: 145, create: 235, edit: 246, delete: 354 }),
});

const FORBIDDEN_KEYS = new Set([
  'alias',
  'api_key',
  'authorization',
  'credential',
  'credentials',
  'email',
  'endpoint',
  'first_name',
  'full_name',
  'id',
  'last_name',
  'mobile',
  'password',
  'phone',
  'private_path',
  'profile_id',
  'role_id',
  'secret',
  'source_endpoint',
  'source_id',
  'token',
  'user_id',
  'user_name',
  'url',
]);

const FORBIDDEN_VALUE_PATTERNS = [
  /https?:\/\//i,
  /\bwww\./i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
  /\.private\//i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
  /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i,
  /\b\d{15,25}\b/,
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertNoSensitiveData(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveData);
    return;
  }
  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, child]) => {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new Error('Permission coverage contains a forbidden identity or sensitive key.');
      }
      assertNoSensitiveData(child);
    });
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    throw new Error('Permission coverage contains a forbidden identity or sensitive value.');
  }
}

function object(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function string(value, label, maxLength = 1600) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function nullableString(value, label, maxLength = 240) {
  return value === null ? null : string(value, label, maxLength);
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function integer(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function stringArray(value, label, maxItems = 100) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be a bounded array.`);
  return value.map((item, index) => string(item, `${label}[${index}]`, 320));
}

function countMap(value, label) {
  const input = object(value, label);
  return Object.fromEntries(Object.keys(input).sort().map(key => [string(key, `${label} key`, 240), integer(input[key], `${label}.${key}`)]));
}

function copyRole(value, index) {
  const role = object(value, `roles[${index}]`);
  const output = {
    name: string(role.name, `roles[${index}].name`, 240),
    reporting_to: nullableString(role.reporting_to, `roles[${index}].reporting_to`, 240),
    share_with_peers: boolean(role.share_with_peers, `roles[${index}].share_with_peers`),
    forecast_manager: boolean(role.forecast_manager, `roles[${index}].forecast_manager`),
    local_hierarchy_enforced: boolean(role.local_hierarchy_enforced, `roles[${index}].local_hierarchy_enforced`),
  };
  if (output.local_hierarchy_enforced) throw new Error('Role hierarchy must remain blocked locally.');
  return output;
}

function copyModulePermission(value, profileIndex, rowIndex) {
  const label = `profiles[${profileIndex}].module_permissions[${rowIndex}]`;
  const permission = object(value, label);
  const output = {
    module: string(permission.module, `${label}.module`, 240),
    view: boolean(permission.view, `${label}.view`),
    create: boolean(permission.create, `${label}.create`),
    edit: boolean(permission.edit, `${label}.edit`),
    delete: boolean(permission.delete, `${label}.delete`),
    local_enforcement: string(permission.local_enforcement, `${label}.local_enforcement`, 80),
  };
  if (output.local_enforcement !== 'Blocked') throw new Error(`${label} must remain blocked locally.`);
  return output;
}

function copyProfile(value, index) {
  const profile = object(value, `profiles[${index}]`);
  const rows = Array.isArray(profile.module_permissions)
    ? profile.module_permissions.map((row, rowIndex) => copyModulePermission(row, index, rowIndex))
    : [];
  if (rows.length !== EXPECTED_SOURCE_COUNTS.modules_in_profile_matrix) {
    throw new Error(`profiles[${index}] does not contain the exact module matrix.`);
  }
  const output = {
    name: string(profile.name, `profiles[${index}].name`, 240),
    type: string(profile.type, `profiles[${index}].type`, 120),
    custom: boolean(profile.custom, `profiles[${index}].custom`),
    local_assignment_enabled: boolean(profile.local_assignment_enabled, `profiles[${index}].local_assignment_enabled`),
    module_permissions: rows,
  };
  if (output.local_assignment_enabled) throw new Error('Profile assignment must remain blocked locally.');
  return output;
}

function copyFieldException(value, index) {
  const group = object(value, `field_permission_model.exceptions[${index}]`);
  const assignments = Array.isArray(group.profile_permissions)
    ? group.profile_permissions.map((item, itemIndex) => {
        const label = `field_permission_model.exceptions[${index}].profile_permissions[${itemIndex}]`;
        const assignment = object(item, label);
        const permission = string(assignment.permission, `${label}.permission`, 80);
        const localEnforcement = string(assignment.local_enforcement, `${label}.local_enforcement`, 80);
        if (!['hidden', 'read_only'].includes(permission)) throw new Error(`${label}.permission is unsupported.`);
        if (localEnforcement !== 'Blocked') throw new Error(`${label} must remain blocked locally.`);
        return {
          profile: string(assignment.profile, `${label}.profile`, 240),
          permission,
          local_enforcement: 'Blocked',
        };
      })
    : [];
  if (!assignments.length) throw new Error(`field_permission_model.exceptions[${index}] has no assignments.`);
  return {
    module: string(group.module, `field_permission_model.exceptions[${index}].module`, 240),
    field: string(group.field, `field_permission_model.exceptions[${index}].field`, 240),
    profile_permissions: assignments,
  };
}

function copySourceCoverage(value) {
  const source = object(value, 'source_coverage');
  const output = {};
  Object.entries(EXPECTED_SOURCE_COUNTS).forEach(([key, expected]) => {
    if (source[key] !== expected) throw new Error(`source_coverage.${key} does not match the reconciled count.`);
    output[key] = expected;
  });
  const permissionTypes = object(source.permission_types, 'source_coverage.permission_types');
  if (permissionTypes.hidden !== 928 || permissionTypes.read_only !== 1908) {
    throw new Error('Source permission-type counts do not reconcile.');
  }
  const actions = object(source.profile_module_actions, 'source_coverage.profile_module_actions');
  for (const disposition of ['allowed', 'denied']) {
    const counts = object(actions[disposition], `source_coverage.profile_module_actions.${disposition}`);
    for (const [action, expected] of Object.entries(EXPECTED_ACTION_COUNTS[disposition])) {
      if (counts[action] !== expected) throw new Error(`Source ${disposition} ${action} count does not reconcile.`);
    }
  }
  return {
    ...output,
    permission_types: { hidden: 928, read_only: 1908 },
    profile_module_actions: {
      allowed: { ...EXPECTED_ACTION_COUNTS.allowed },
      denied: { ...EXPECTED_ACTION_COUNTS.denied },
    },
    record_level_sharing: string(source.record_level_sharing, 'source_coverage.record_level_sharing', 160),
    territories: string(source.territories, 'source_coverage.territories', 160),
    status: string(source.status, 'source_coverage.status', 160),
  };
}

function copyUserAggregates(value) {
  const users = object(value, 'source_user_aggregates');
  const output = {
    total: integer(users.total, 'source_user_aggregates.total'),
    status: countMap(users.status, 'source_user_aggregates.status'),
    by_profile: countMap(users.by_profile, 'source_user_aggregates.by_profile'),
    by_role: countMap(users.by_role, 'source_user_aggregates.by_role'),
    local_users_mapped: integer(users.local_users_mapped, 'source_user_aggregates.local_users_mapped'),
    individual_records_included: boolean(users.individual_records_included, 'source_user_aggregates.individual_records_included'),
  };
  const sum = values => Object.values(values).reduce((total, count) => total + count, 0);
  if (output.total !== 63 || sum(output.status) !== 63 || sum(output.by_profile) !== 63 || sum(output.by_role) !== 63) {
    throw new Error('Source user aggregates do not reconcile without identities.');
  }
  if (output.local_users_mapped !== 0 || output.individual_records_included !== false) {
    throw new Error('Source users must remain unmapped and identity-free.');
  }
  return output;
}

function copyGlobalSafeguard(value, index) {
  const item = object(value, `implemented_global_safeguards[${index}]`);
  return {
    control: string(item.control, `implemented_global_safeguards[${index}].control`, 240),
    status: string(item.status, `implemented_global_safeguards[${index}].status`, 160),
    permission_parity: boolean(item.permission_parity, `implemented_global_safeguards[${index}].permission_parity`),
    note: string(item.note, `implemented_global_safeguards[${index}].note`, 800),
  };
}

function copyLocalAuthorization(value) {
  const local = object(value, 'local_authorization');
  const model = object(local.current_effective_model, 'local_authorization.current_effective_model');
  const currentEffectiveModel = {
    model: string(model.model, 'current_effective_model.model', 240),
    default_bind_scope: string(model.default_bind_scope, 'current_effective_model.default_bind_scope', 120),
    shared_access_gate_present: boolean(model.shared_access_gate_present, 'current_effective_model.shared_access_gate_present'),
    shared_access_gate_configured: boolean(model.shared_access_gate_configured, 'current_effective_model.shared_access_gate_configured'),
    per_user_authentication: boolean(model.per_user_authentication, 'current_effective_model.per_user_authentication'),
    verified_session_principal: boolean(model.verified_session_principal, 'current_effective_model.verified_session_principal'),
    profile_assignment: boolean(model.profile_assignment, 'current_effective_model.profile_assignment'),
    role_assignment: boolean(model.role_assignment, 'current_effective_model.role_assignment'),
    record_owner_mapping: boolean(model.record_owner_mapping, 'current_effective_model.record_owner_mapping'),
  };
  if (
    currentEffectiveModel.per_user_authentication
    || currentEffectiveModel.verified_session_principal
    || currentEffectiveModel.profile_assignment
    || currentEffectiveModel.role_assignment
    || currentEffectiveModel.record_owner_mapping
  ) {
    throw new Error('Local identity model changed; permission coverage must be re-audited.');
  }
  const enforcement = object(local.source_permission_enforcement, 'local_authorization.source_permission_enforcement');
  const integerKeys = [
    'role_hierarchy_nodes_enforced',
    'profiles_assignable_to_local_principals',
    'profile_module_assignments_enforced',
    'field_exception_assignments_enforced',
    'source_users_mapped_to_local_principals',
  ];
  const booleanKeys = [
    'record_owner_rules_enforced',
    'peer_sharing_enforced',
    'record_sharing_rules_enforced',
    'territory_rules_enforced',
    'metadata_visibility_filtered_by_profile',
    'record_reads_filtered_by_profile_or_role',
    'record_creates_authorized_by_profile',
    'record_edits_authorized_by_profile',
    'note_writes_authorized_by_profile',
    'blueprint_transitions_authorized_by_profile_or_owner',
    'audit_actor_bound_to_verified_user',
  ];
  const sourcePermissionEnforcement = {};
  integerKeys.forEach(key => {
    const count = integer(enforcement[key], `source_permission_enforcement.${key}`);
    if (count !== 0) throw new Error(`source_permission_enforcement.${key} must remain zero.`);
    sourcePermissionEnforcement[key] = 0;
  });
  booleanKeys.forEach(key => {
    const enabled = boolean(enforcement[key], `source_permission_enforcement.${key}`);
    if (enabled) throw new Error(`source_permission_enforcement.${key} must remain false.`);
    sourcePermissionEnforcement[key] = false;
  });
  sourcePermissionEnforcement.status = string(enforcement.status, 'source_permission_enforcement.status', 80);
  if (sourcePermissionEnforcement.status !== 'Blocked') throw new Error('Local permission enforcement must remain blocked.');
  return {
    current_effective_model: currentEffectiveModel,
    implemented_global_safeguards: Array.isArray(local.implemented_global_safeguards)
      ? local.implemented_global_safeguards.map(copyGlobalSafeguard)
      : [],
    source_permission_enforcement: sourcePermissionEnforcement,
  };
}

function copyIdentityDecision(value) {
  const decision = object(value, 'identity_provider_decision');
  const keys = [
    'status',
    'identity_provider',
    'local_principal_model',
    'source_user_mapping',
    'source_profile_mapping',
    'source_role_mapping',
    'inactive_and_deleted_user_policy',
    'required_decision',
  ];
  const output = Object.fromEntries(keys.map(key => [key, string(decision[key], `identity_provider_decision.${key}`, 1200)]));
  if (
    output.status !== 'Required'
    || output.identity_provider !== 'Unselected'
    || output.local_principal_model !== 'Not implemented'
    || output.source_user_mapping !== 'Not implemented'
    || output.source_profile_mapping !== 'Not implemented'
    || output.source_role_mapping !== 'Not implemented'
  ) {
    throw new Error('Identity-provider and user-mapping decision must remain explicitly unresolved.');
  }
  return output;
}

function copyEnforcementBoundary(value) {
  const boundary = object(value, 'enforcement_boundary');
  const output = {
    local_permission_enforcement_enabled: boolean(boundary.local_permission_enforcement_enabled, 'enforcement_boundary.local_permission_enforcement_enabled'),
    inferred_profile_headers_trusted: boolean(boundary.inferred_profile_headers_trusted, 'enforcement_boundary.inferred_profile_headers_trusted'),
    caller_supplied_role_or_profile_trusted: boolean(boundary.caller_supplied_role_or_profile_trusted, 'enforcement_boundary.caller_supplied_role_or_profile_trusted'),
    default_permission_decision: string(boundary.default_permission_decision, 'enforcement_boundary.default_permission_decision', 80),
    status: string(boundary.status, 'enforcement_boundary.status', 80),
    reason: string(boundary.reason, 'enforcement_boundary.reason', 600),
  };
  if (
    output.local_permission_enforcement_enabled
    || output.inferred_profile_headers_trusted
    || output.caller_supplied_role_or_profile_trusted
    || output.default_permission_decision !== 'Deny'
    || output.status !== 'Blocked'
  ) {
    throw new Error('Permission enforcement boundary must remain fail-closed.');
  }
  return output;
}

function copyPrivacy(value) {
  const privacy = object(value, 'privacy');
  const keys = [
    'user_identities_included',
    'user_records_included',
    'user_ids_included',
    'role_ids_included',
    'profile_ids_included',
    'emails_included',
    'credentials_included',
    'private_paths_included',
  ];
  return Object.fromEntries(keys.map(key => {
    const included = boolean(privacy[key], `privacy.${key}`);
    if (included) throw new Error(`privacy.${key} must remain false.`);
    return [key, false];
  }));
}

function validateDerivedCoverage(roles, profiles, fieldExceptions) {
  if (roles.length !== 14 || new Set(roles.map(role => role.name)).size !== 14) {
    throw new Error('Role catalog does not reconcile.');
  }
  const roleNames = new Set(roles.map(role => role.name));
  if (roles.some(role => role.reporting_to && !roleNames.has(role.reporting_to))) {
    throw new Error('Role hierarchy references an unknown parent.');
  }
  if (profiles.length !== 11 || new Set(profiles.map(profile => profile.name)).size !== 11) {
    throw new Error('Profile catalog does not reconcile.');
  }
  const moduleRows = profiles.flatMap(profile => profile.module_permissions);
  if (moduleRows.length !== 506 || new Set(moduleRows.map(row => row.module)).size !== 46) {
    throw new Error('Profile-module matrix does not reconcile.');
  }
  for (const disposition of ['allowed', 'denied']) {
    for (const [action, expected] of Object.entries(EXPECTED_ACTION_COUNTS[disposition])) {
      const actual = moduleRows.filter(row => disposition === 'allowed' ? row[action] : !row[action]).length;
      if (actual !== expected) throw new Error(`Derived ${disposition} ${action} count does not reconcile.`);
    }
  }
  if (fieldExceptions.length !== 273) throw new Error('Field-exception groups do not reconcile.');
  const assignments = fieldExceptions.flatMap(group => group.profile_permissions);
  if (
    assignments.length !== 2836
    || assignments.filter(item => item.permission === 'hidden').length !== 928
    || assignments.filter(item => item.permission === 'read_only').length !== 1908
  ) {
    throw new Error('Field-exception assignments do not reconcile.');
  }
}

function buildPermissionCoverage(rawCoverage) {
  assertNoSensitiveData(rawCoverage);
  const raw = object(rawCoverage, 'permission coverage');
  if (raw.schema_version !== 1) throw new Error('Permission coverage schema version is unsupported.');
  if (raw.source_mode !== 'read-only') throw new Error('Permission coverage source mode must remain read-only.');
  const roles = Array.isArray(raw.roles) ? raw.roles.map(copyRole) : [];
  const profiles = Array.isArray(raw.profiles) ? raw.profiles.map(copyProfile) : [];
  const fieldModel = object(raw.field_permission_model, 'field_permission_model');
  const fieldExceptions = Array.isArray(fieldModel.exceptions) ? fieldModel.exceptions.map(copyFieldException) : [];
  validateDerivedCoverage(roles, profiles, fieldExceptions);
  const output = {
    schema_version: 1,
    generated_at: string(raw.generated_at, 'generated_at', 80),
    source_snapshot_generated_at: string(raw.source_snapshot_generated_at, 'source_snapshot_generated_at', 80),
    source_mode: 'read-only',
    audit_mode: string(raw.audit_mode, 'audit_mode', 500),
    source_coverage: copySourceCoverage(raw.source_coverage),
    roles,
    profiles,
    source_user_aggregates: copyUserAggregates(raw.source_user_aggregates),
    field_permission_model: {
      omission_semantics: string(fieldModel.omission_semantics, 'field_permission_model.omission_semantics', 500),
      profile_labels: stringArray(fieldModel.profile_labels, 'field_permission_model.profile_labels', 40),
      unresolved_profile_labels: stringArray(fieldModel.unresolved_profile_labels, 'field_permission_model.unresolved_profile_labels', 40),
      exceptions: fieldExceptions,
    },
    local_authorization: copyLocalAuthorization(raw.local_authorization),
    identity_provider_decision: copyIdentityDecision(raw.identity_provider_decision),
    enforcement_boundary: copyEnforcementBoundary(raw.enforcement_boundary),
    privacy: copyPrivacy(raw.privacy),
  };
  if (output.field_permission_model.profile_labels.length !== 16 || output.field_permission_model.unresolved_profile_labels.length !== 5) {
    throw new Error('Field-profile label coverage does not reconcile.');
  }
  assertNoSensitiveData(output);
  return output;
}

function getPermissionCoverage() {
  return buildPermissionCoverage(RAW_COVERAGE);
}

function evaluatePermissionRequest() {
  return {
    allowed: false,
    status: 'Blocked',
    code: 'LOCAL_IDENTITY_MAPPING_REQUIRED',
    reason: 'No verified local principal-to-source user, profile, and role mapping exists.',
  };
}

module.exports = {
  buildPermissionCoverage,
  evaluatePermissionRequest,
  getPermissionCoverage,
};
