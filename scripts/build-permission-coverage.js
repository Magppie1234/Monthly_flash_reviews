'use strict';

const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const ROOT = path.resolve(__dirname, '..');
const PRIVATE_SNAPSHOT = path.join(ROOT, '.private', 'zoho-discovery', 'latest.json');
const SERVER_PATH = path.join(ROOT, 'server.js');
const VALIDATION_PATH = path.join(ROOT, 'lib', 'crm-validation.js');
const DATABASE_PATH = path.join(ROOT, 'database', 'schema.sql');
const CONFIG_PATH = path.join(ROOT, 'config', 'permission-coverage.json');
const DOCUMENT_PATH = path.join(ROOT, 'LOCAL_PERMISSION_COVERAGE.md');

function array(value) {
  return Array.isArray(value) ? value : [];
}

function extract(response, key) {
  return array(response?.data?.[key]);
}

function countBy(values, selector) {
  const counts = new Map();
  values.forEach(value => {
    const key = selector(value);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function buildRoleCatalog(rawRoles) {
  const nameById = new Map(rawRoles.map(role => [String(role.id), role.name || role.display_label]));
  return rawRoles.map(role => {
    const reportingReference = role.reporting_to;
    const reportingTo = reportingReference?.name
      || reportingReference?.display_label
      || nameById.get(String(reportingReference?.id || reportingReference || ''))
      || null;
    return {
      name: role.name || role.display_label,
      reporting_to: reportingTo,
      share_with_peers: role.share_with_peers === true,
      forecast_manager: role.forecast_manager === true,
      local_hierarchy_enforced: false,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function buildProfileCatalog(rawProfiles, profileDetails) {
  return profileDetails.map((result, index) => {
    if (!result?.ok) throw new Error('A captured profile detail is unavailable.');
    const profile = array(result?.data?.profiles)[0] || rawProfiles[index];
    if (!profile?.name) throw new Error('A captured profile has no safe name.');
    const byModule = new Map();
    array(profile.permissions_details).forEach(permission => {
      if (!permission.module) return;
      if (!byModule.has(permission.module)) byModule.set(permission.module, {});
      const action = String(permission.display_label || '').toLowerCase();
      if (['view', 'create', 'edit', 'delete'].includes(action)) {
        byModule.get(permission.module)[action] = permission.enabled === true;
      }
    });
    return {
      name: profile.name,
      type: profile.type || 'unknown',
      custom: profile.custom === true,
      local_assignment_enabled: false,
      module_permissions: [...byModule.entries()]
        .map(([module, actions]) => ({
          module,
          view: actions.view === true,
          create: actions.create === true,
          edit: actions.edit === true,
          delete: actions.delete === true,
          local_enforcement: 'Blocked',
        }))
        .sort((a, b) => a.module.localeCompare(b.module)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function buildFieldExceptions(moduleDiscovery) {
  const grouped = new Map();
  moduleDiscovery.forEach(moduleResult => {
    const moduleName = moduleResult?.module?.api_name;
    if (!moduleName) return;
    const fields = extract(moduleResult?.results?.fields, 'fields');
    fields.forEach(field => {
      array(field.profiles)
        .filter(profile => profile.permission_type && profile.permission_type !== 'read_write')
        .forEach(profile => {
          const key = `${moduleName}\u0000${field.api_name}`;
          if (!grouped.has(key)) grouped.set(key, { module: moduleName, field: field.api_name, profile_permissions: [] });
          grouped.get(key).profile_permissions.push({
            profile: profile.name,
            permission: profile.permission_type,
            local_enforcement: 'Blocked',
          });
        });
    });
  });
  return [...grouped.values()]
    .map(group => ({
      ...group,
      profile_permissions: group.profile_permissions.sort((a, b) => a.profile.localeCompare(b.profile) || a.permission.localeCompare(b.permission)),
    }))
    .sort((a, b) => a.module.localeCompare(b.module) || a.field.localeCompare(b.field));
}

function safeUserAggregates(rawUsers, profileNames, roleNames) {
  const allowedProfiles = new Set(profileNames);
  const allowedRoles = new Set(roleNames);
  const status = countBy(rawUsers, user => ['active', 'deleted', 'disabled'].includes(user.status) ? user.status : 'other');
  const byProfile = countBy(rawUsers, user => {
    const name = user.profile?.name || user.profile?.display_label;
    return allowedProfiles.has(name) ? name : 'Unmapped source profile';
  });
  const byRole = countBy(rawUsers, user => {
    const name = user.role?.name || user.role?.display_label;
    return allowedRoles.has(name) ? name : 'Unmapped source role';
  });
  return {
    total: rawUsers.length,
    status,
    by_profile: byProfile,
    by_role: byRole,
    local_users_mapped: 0,
    individual_records_included: false,
  };
}

function assertSourceCounts({ roles, profiles, users, profileCatalog, fieldExceptions }) {
  const moduleRows = profileCatalog.flatMap(profile => profile.module_permissions);
  const exceptionAssignments = fieldExceptions.flatMap(group => group.profile_permissions);
  const counts = {
    roles: roles.length,
    profiles: profiles.length,
    users: users.length,
    profile_detail_responses: profileCatalog.length,
    profile_module_assignments: moduleRows.length,
    modules_in_profile_matrix: new Set(moduleRows.map(row => row.module)).size,
    field_exception_groups: fieldExceptions.length,
    field_exception_assignments: exceptionAssignments.length,
    modules_with_field_exceptions: new Set(fieldExceptions.map(group => group.module)).size,
    fields_with_exceptions: fieldExceptions.length,
    field_profile_labels: new Set(exceptionAssignments.map(item => item.profile)).size,
    hidden_field_assignments: exceptionAssignments.filter(item => item.permission === 'hidden').length,
    read_only_field_assignments: exceptionAssignments.filter(item => item.permission === 'read_only').length,
  };
  const expected = {
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
  };
  Object.entries(expected).forEach(([key, value]) => {
    if (counts[key] !== value) throw new Error(`Source permission count drifted for ${key}.`);
  });
  return counts;
}

function implementationAudit() {
  const server = fs.readFileSync(SERVER_PATH, 'utf8');
  const validation = fs.readFileSync(VALIDATION_PATH, 'utf8');
  const database = fs.readFileSync(DATABASE_PATH, 'utf8');
  const requiredMarkers = [
    [server, "const ACCESS_CODE = process.env.ACCESS_CODE || ''"],
    [server, "const HOST = process.env.CLONE_HOST || '127.0.0.1'"],
    [server, "if (!ACCESS_CODE) return next()"],
    [validation, 'field.read_only || field.virtual_field'],
    [database, 'ENABLE ROW LEVEL SECURITY'],
    [database, 'SECURITY DEFINER'],
    [database, "if not exists (select 1 from crm_secret where secret = s)"],
  ];
  if (requiredMarkers.some(([text, marker]) => !text.includes(marker))) {
    throw new Error('Local enforcement evidence changed; manual audit is required.');
  }
  if (/\breq\.(?:user|principal|auth_context)\b/i.test(server)) {
    throw new Error('A local user principal now appears to exist; permission coverage must be re-audited.');
  }
  return {
    current_effective_model: {
      model: 'Shared local session with no individual principal',
      default_bind_scope: 'Loopback',
      shared_access_gate_present: true,
      shared_access_gate_configured: Boolean(process.env.ACCESS_CODE),
      per_user_authentication: false,
      verified_session_principal: false,
      profile_assignment: false,
      role_assignment: false,
      record_owner_mapping: false,
    },
    implemented_global_safeguards: [
      {
        control: 'Loopback server bind by default',
        status: 'Implemented',
        permission_parity: false,
        note: 'Reduces network exposure but does not identify or authorize a user.',
      },
      {
        control: 'Optional shared access-code gate',
        status: Boolean(process.env.ACCESS_CODE) ? 'Configured' : 'Present but not configured',
        permission_parity: false,
        note: 'All holders are indistinguishable and receive the same application access.',
      },
      {
        control: 'Database service-secret and row-level-security boundary',
        status: 'Implemented',
        permission_parity: false,
        note: 'Protects direct database access but represents the server service, not a CRM end user.',
      },
      {
        control: 'Global schema and layout validation',
        status: 'Implemented',
        permission_parity: false,
        note: 'Rejects unknown, formula, virtual, and globally read-only fields, but does not apply profile-specific field exceptions.',
      },
      {
        control: 'Local record delete route',
        status: 'Not implemented',
        permission_parity: false,
        note: 'Delete is globally unavailable rather than allowed or denied according to the source profile.',
      },
      {
        control: 'Zoho source writes',
        status: 'Blocked',
        permission_parity: false,
        note: 'The source transport is read-only; this is a data-safety boundary, not local user authorization.',
      },
    ],
    source_permission_enforcement: {
      role_hierarchy_nodes_enforced: 0,
      profiles_assignable_to_local_principals: 0,
      profile_module_assignments_enforced: 0,
      field_exception_assignments_enforced: 0,
      source_users_mapped_to_local_principals: 0,
      record_owner_rules_enforced: false,
      peer_sharing_enforced: false,
      record_sharing_rules_enforced: false,
      territory_rules_enforced: false,
      metadata_visibility_filtered_by_profile: false,
      record_reads_filtered_by_profile_or_role: false,
      record_creates_authorized_by_profile: false,
      record_edits_authorized_by_profile: false,
      note_writes_authorized_by_profile: false,
      blueprint_transitions_authorized_by_profile_or_owner: false,
      audit_actor_bound_to_verified_user: false,
      status: 'Blocked',
    },
  };
}

function assertArtifactSafe(value) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    /https?:\/\//i,
    /\bwww\./i,
    /\/(?:Users|home|var|tmp|opt|etc)\//i,
    /\.private\//i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:authorization|bearer|password|secret|token|credential)\s*[:=]\s*\S+/i,
    /\b\d{15,25}\b/,
  ];
  if (forbidden.some(pattern => pattern.test(serialized))) {
    throw new Error('Permission coverage failed the public-artifact safety scan.');
  }
  const forbiddenKeys = /"(?:id|ids|user_name|full_name|first_name|last_name|email|phone|mobile|alias|source_endpoint|private_path)"\s*:/i;
  if (forbiddenKeys.test(serialized)) throw new Error('Permission coverage contains an identity or private-source key.');
}

function buildPermissionCoverage() {
  const snapshot = JSON.parse(fs.readFileSync(PRIVATE_SNAPSHOT, 'utf8'));
  const global = snapshot.global || {};
  const rawRoles = extract(global.roles, 'roles');
  const rawProfiles = extract(global.profiles, 'profiles');
  const rawUsers = extract(global.users, 'users');
  const roles = buildRoleCatalog(rawRoles);
  const profiles = buildProfileCatalog(rawProfiles, array(global.profile_details));
  const fieldExceptions = buildFieldExceptions(array(snapshot.modules));
  const sourceCounts = assertSourceCounts({ roles, profiles, users: rawUsers, profileCatalog: profiles, fieldExceptions });
  const profileNames = profiles.map(profile => profile.name);
  const roleNames = roles.map(role => role.name);
  const exceptionProfileLabels = [...new Set(fieldExceptions.flatMap(group => group.profile_permissions.map(item => item.profile)))].sort();
  const unresolvedFieldProfileLabels = exceptionProfileLabels.filter(name => !profileNames.includes(name));
  const local = implementationAudit();
  const coverage = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_snapshot_generated_at: snapshot.generated_at,
    source_mode: 'read-only',
    audit_mode: 'Offline static comparison of captured permission metadata to local authorization code; no source contact or mutation.',
    source_coverage: {
      ...sourceCounts,
      permission_types: {
        hidden: sourceCounts.hidden_field_assignments,
        read_only: sourceCounts.read_only_field_assignments,
      },
      profile_module_actions: {
        allowed: {
          view: profiles.flatMap(profile => profile.module_permissions).filter(row => row.view).length,
          create: profiles.flatMap(profile => profile.module_permissions).filter(row => row.create).length,
          edit: profiles.flatMap(profile => profile.module_permissions).filter(row => row.edit).length,
          delete: profiles.flatMap(profile => profile.module_permissions).filter(row => row.delete).length,
        },
        denied: {
          view: profiles.flatMap(profile => profile.module_permissions).filter(row => !row.view).length,
          create: profiles.flatMap(profile => profile.module_permissions).filter(row => !row.create).length,
          edit: profiles.flatMap(profile => profile.module_permissions).filter(row => !row.edit).length,
          delete: profiles.flatMap(profile => profile.module_permissions).filter(row => !row.delete).length,
        },
      },
      record_level_sharing: 'Not captured',
      territories: 'Blocked in source discovery',
      status: 'Catalog reconciled; enforcement blocked',
    },
    roles,
    profiles,
    source_user_aggregates: safeUserAggregates(rawUsers, profileNames, roleNames),
    field_permission_model: {
      omission_semantics: 'Fields without an exception are read/write for the returned source profile metadata.',
      profile_labels: exceptionProfileLabels,
      unresolved_profile_labels: unresolvedFieldProfileLabels,
      exceptions: fieldExceptions,
    },
    local_authorization: local,
    identity_provider_decision: {
      status: 'Required',
      identity_provider: 'Unselected',
      local_principal_model: 'Not implemented',
      source_user_mapping: 'Not implemented',
      source_profile_mapping: 'Not implemented',
      source_role_mapping: 'Not implemented',
      inactive_and_deleted_user_policy: 'Not decided',
      required_decision: 'Choose an identity provider and a stable local subject, then explicitly map each authorized local principal to one source user, profile, and role before enabling profile-sensitive reads or writes.',
    },
    enforcement_boundary: {
      local_permission_enforcement_enabled: false,
      inferred_profile_headers_trusted: false,
      caller_supplied_role_or_profile_trusted: false,
      default_permission_decision: 'Deny',
      status: 'Blocked',
      reason: 'No verified local principal-to-source user, profile, and role mapping exists.',
    },
    privacy: {
      user_identities_included: false,
      user_records_included: false,
      user_ids_included: false,
      role_ids_included: false,
      profile_ids_included: false,
      emails_included: false,
      credentials_included: false,
      private_paths_included: false,
    },
  };
  assertArtifactSafe(coverage);
  return coverage;
}

function summarizeProfile(profile) {
  const rows = profile.module_permissions;
  return {
    profile: profile.name,
    view: rows.filter(row => row.view).length,
    create: rows.filter(row => row.create).length,
    edit: rows.filter(row => row.edit).length,
    delete: rows.filter(row => row.delete).length,
    modules: rows.length,
  };
}

function buildMarkdown(coverage) {
  const profileSummary = coverage.profiles.map(summarizeProfile);
  const exceptionAssignments = coverage.field_permission_model.exceptions.flatMap(group => group.profile_permissions);
  const exceptionByProfile = coverage.field_permission_model.profile_labels.map(profile => ({
    profile,
    hidden: exceptionAssignments.filter(item => item.profile === profile && item.permission === 'hidden').length,
    read_only: exceptionAssignments.filter(item => item.profile === profile && item.permission === 'read_only').length,
  }));
  const lines = [
    '# Local Permission Coverage',
    '',
    '> This is an offline, identity-free comparison of the captured Zoho permission catalog with the localhost authorization implementation. No Zoho request or mutation was made.',
    '',
    '## Outcome',
    '',
    'The source catalog is structurally reconciled, but localhost does not have an individual user principal. Consequently, none of the source role hierarchy, profile-module permissions, field-level exceptions, ownership rules, or sharing rules are currently enforced per user. Every permission decision exposed by the adapter defaults to deny until an identity provider and explicit user mapping are implemented.',
    '',
    '| Coverage item | Source evidence | Enforced locally | Status |',
    '|---|---:|---:|---|',
    `| Roles | ${coverage.source_coverage.roles} | ${coverage.local_authorization.source_permission_enforcement.role_hierarchy_nodes_enforced} | Blocked |`,
    `| Profiles | ${coverage.source_coverage.profiles} | ${coverage.local_authorization.source_permission_enforcement.profiles_assignable_to_local_principals} | Blocked |`,
    `| Aggregated source users | ${coverage.source_coverage.users} | ${coverage.local_authorization.source_permission_enforcement.source_users_mapped_to_local_principals} | Blocked |`,
    `| Profile-module assignments | ${coverage.source_coverage.profile_module_assignments} | ${coverage.local_authorization.source_permission_enforcement.profile_module_assignments_enforced} | Blocked |`,
    `| Field exception assignments | ${coverage.source_coverage.field_exception_assignments} | ${coverage.local_authorization.source_permission_enforcement.field_exception_assignments_enforced} | Blocked |`,
    '| Record-level sharing | Not captured | No | Blocked |',
    '| Territory rules | Source discovery blocked | No | Blocked |',
    '',
    '## Exact source catalog',
    '',
    `- ${coverage.source_coverage.roles} roles and ${coverage.source_coverage.profiles} profiles were captured; all ${coverage.source_coverage.profile_detail_responses} profile-detail responses are available.`,
    `- The profile matrix contains ${coverage.source_coverage.profile_module_assignments} assignments across ${coverage.source_coverage.modules_in_profile_matrix} modules.`,
    `- The field catalog contains ${coverage.source_coverage.field_exception_assignments} exception assignments grouped into ${coverage.source_coverage.field_exception_groups} module-field pairs across ${coverage.source_coverage.modules_with_field_exceptions} modules.`,
    `- Field exceptions comprise ${coverage.source_coverage.permission_types.hidden} hidden and ${coverage.source_coverage.permission_types.read_only} read-only assignments.`,
    `- ${coverage.source_coverage.field_profile_labels} profile labels occur in field metadata; ${coverage.field_permission_model.unresolved_profile_labels.length} are additional source labels not present in the 11-profile CRM catalog and therefore remain unresolved.`,
    '',
    '## Role hierarchy',
    '',
    '| Role | Reports to | Share with peers | Local hierarchy enforcement |',
    '|---|---|---|---|',
    ...coverage.roles.map(role => `| ${role.name} | ${role.reporting_to || 'Root'} | ${role.share_with_peers ? 'Yes' : 'No'} | Blocked |`),
    '',
    '## Profile-module permission summary',
    '',
    'Counts below are source grants out of 46 captured modules per profile. The full sanitized matrix is retained in the JSON artifact.',
    '',
    '| Profile | View | Create | Edit | Delete | Modules | Local enforcement |',
    '|---|---:|---:|---:|---:|---:|---|',
    ...profileSummary.map(row => `| ${row.profile} | ${row.view} | ${row.create} | ${row.edit} | ${row.delete} | ${row.modules} | Blocked |`),
    '',
    '## Field-level exception summary',
    '',
    '| Source profile label | Hidden | Read-only | Local enforcement |',
    '|---|---:|---:|---|',
    ...exceptionByProfile.map(row => `| ${row.profile} | ${row.hidden} | ${row.read_only} | Blocked |`),
    '',
    'Additional field-metadata labels not present in the captured CRM profile list: ' + (coverage.field_permission_model.unresolved_profile_labels.join(', ') || 'None') + '.',
    '',
    '## What localhost currently enforces',
    '',
    ...coverage.local_authorization.implemented_global_safeguards.map(item => `- **${item.control}:** ${item.status}. ${item.note}`),
    '',
    'These are global safety controls. None establishes a verified CRM user, profile, or role.',
    '',
    '## Missing authorization decision',
    '',
    coverage.identity_provider_decision.required_decision,
    '',
    'The decision must also define disabled and deleted user handling, owner reassignment, role-hierarchy inheritance, peer sharing, record-sharing rules, metadata filtering, audit identity, and how profile changes invalidate active sessions. Caller-supplied role or profile headers must not be trusted.',
    '',
    '## Privacy and execution boundary',
    '',
    '- No user record, user name, email, phone number, credential, source ID, role ID, profile ID, endpoint, or private path is included.',
    '- User information appears only as aggregate counts by captured role, profile, and account status.',
    '- The permission adapter is informational and fail-closed; it does not enable local authorization.',
    '- Until verified identity mapping exists, every user-specific permission evaluation returns `Deny`.',
    '',
  ];
  return lines.join('\n');
}

function main() {
  const coverage = buildPermissionCoverage();
  const markdown = buildMarkdown(coverage);
  assertArtifactSafe(markdown);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(coverage, null, 2)}\n`, { mode: 0o644 });
  fs.writeFileSync(DOCUMENT_PATH, `${markdown}\n`, { mode: 0o644 });
  process.stdout.write(`Permission coverage built: ${coverage.source_coverage.profile_module_assignments} module assignments and ${coverage.source_coverage.field_exception_assignments} field exceptions cataloged; 0 enforced per user.\n`);
}

if (require.main === module) main();

module.exports = {
  buildPermissionCoverage,
  buildMarkdown,
};
