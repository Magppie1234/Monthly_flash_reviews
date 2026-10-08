'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { CustomViewFilterError, compileCustomViewFilter } = require('../lib/custom-view-filter');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(ROOT, '.private', 'zoho-discovery', 'latest.json');
const SERVER_PATH = path.join(ROOT, 'server.js');
const VIEW_ENGINE_PATH = path.join(ROOT, 'lib', 'custom-view-filter.js');
const LAYOUT_ENGINE_PATH = path.join(ROOT, 'lib', 'layout-schema.js');
const VALIDATION_ENGINE_PATH = path.join(ROOT, 'lib', 'crm-validation.js');
const CONFIG_PATH = path.join(ROOT, 'config', 'rule-layout-coverage.json');
const DOCUMENT_PATH = path.join(ROOT, 'LOCAL_RULE_LAYOUT_COVERAGE.md');
dotenv.config({ path: path.join(ROOT, '.env') });

const LOCAL_METADATA_INDEX_SQL = "select key from crm_meta where key = 'modules' or key like 'fields:%' or key like 'layouts:%' or key like 'views:%' order by key";
const LOCAL_METADATA_BATCH_SIZE = 12;
const LOCAL_METADATA_MAX_CONCURRENCY = 4;
const SAFE_METADATA_KEY = /^(?:modules|(?:fields|layouts|views):[A-Za-z][A-Za-z0-9_]*)$/;

const EXPECTED = Object.freeze({
  modules: 122,
  layouts: Object.freeze({ endpoint_responses: 122, successful_responses: 75, blocked_responses: 47, definitions_captured: 70, modules_with_definitions: 67, successful_empty_modules: 8 }),
  custom_views: Object.freeze({ endpoint_responses: 122, successful_responses: 121, blocked_responses: 1, definitions_captured: 386, modules_with_definitions: 41, successful_empty_modules: 80 }),
  validation_rules: Object.freeze({ endpoint_responses: 122, successful_responses: 0, blocked_responses: 122, definitions_captured: 0 }),
  assignment_rules: Object.freeze({ endpoint_responses: 122, successful_responses: 12, blocked_responses: 110, definitions_captured: 1, modules_with_definitions: 1, successful_empty_modules: 11 }),
  approval_rules: Object.freeze({ endpoint_responses: 122, successful_responses: 0, blocked_responses: 122, definitions_captured: 0 }),
  pipelines: Object.freeze({ layout_scoped_responses: 70, successful_responses: 1, blocked_responses: 69, definitions_captured: 0, modules_with_responses: 67, modules_with_successful_responses: 1 }),
});

function array(value) {
  return Array.isArray(value) ? value : [];
}

function extract(result, key) {
  return array(result?.data?.[key]);
}

function statusCounts(results) {
  const counts = {};
  results.forEach(result => {
    const status = String(result?.status ?? 'missing');
    counts[status] = (counts[status] || 0) + 1;
  });
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
}

function summarizeModuleEndpoint(modules, resultKey, dataKey) {
  const results = modules.map(module => module?.results?.[resultKey]).filter(Boolean);
  const itemLists = results.map(result => extract(result, dataKey));
  return {
    endpoint_responses: results.length,
    successful_responses: results.filter(result => result.ok === true).length,
    blocked_responses: results.filter(result => result.ok !== true).length,
    responses_by_status: statusCounts(results),
    definitions_captured: itemLists.reduce((total, items) => total + items.length, 0),
    modules_with_definitions: itemLists.filter(items => items.length > 0).length,
    successful_empty_modules: results.filter((result, index) => result.ok === true && itemLists[index].length === 0).length,
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`Offline source count drifted for ${label}.`);
}

function assertExpected(summary, expected, label) {
  Object.entries(expected).forEach(([key, value]) => assertEqual(summary[key], value, `${label}.${key}`));
}

function assertReadOnlyMetadataQuery(query) {
  const normalized = String(query || '').trim();
  if (!/^select\b/i.test(normalized)
      || /;\s*\S/.test(normalized)
      || /\b(?:insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|copy|call|do)\b/i.test(normalized)) {
    throw new Error('Local metadata query is not SELECT-only.');
  }
  if (!/\bfrom\s+crm_meta\b/i.test(normalized)
      || /\b(?:crm_records|crm_secret|crm_audit|auth\.users)\b/i.test(normalized)) {
    throw new Error('Local metadata query exceeds the approved crm_meta scope.');
  }
  return normalized;
}

function metadataValueQuery(keys) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > LOCAL_METADATA_BATCH_SIZE
      || keys.some(key => !SAFE_METADATA_KEY.test(String(key)))) {
    throw new Error('Local metadata key batch is invalid.');
  }
  const values = keys.map(key => `'${String(key).replace(/'/g, "''")}'`).join(',');
  return assertReadOnlyMetadataQuery(`select key, data from crm_meta where key in (${values}) order by key`);
}

function metadataConnection(env = process.env) {
  const base = String(env.SUPABASE_URL || '');
  const apiKey = String(env.SUPABASE_ANON_KEY || '');
  const sqlSecret = String(env.CRM_SQL_SECRET || '');
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('Read-only local metadata connection is not configured.');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co') || !apiKey || !sqlSecret) {
    throw new Error('Read-only local metadata connection failed closed.');
  }
  return { base: parsed.origin, apiKey, sqlSecret };
}

async function readCurrentLocalMetadataRows({ fetchImpl = fetch, env = process.env } = {}) {
  const { base, apiKey, sqlSecret } = metadataConnection(env);
  const query = async statement => {
    const response = await fetchImpl(`${base}/rest/v1/rpc/crm_sql`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: assertReadOnlyMetadataQuery(statement), s: sqlSecret }),
    });
    if (!response.ok) throw new Error(`Read-only local metadata query failed with HTTP ${response.status}.`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Read-only local metadata query returned an invalid shape.');
    return rows;
  };

  const keyRows = await query(LOCAL_METADATA_INDEX_SQL);
  const keys = keyRows.map(row => String(row?.key || ''));
  if (keys.length === 0 || keys.some(key => !SAFE_METADATA_KEY.test(key)) || new Set(keys).size !== keys.length) {
    throw new Error('Read-only local metadata key inventory is invalid.');
  }
  const batches = [];
  for (let index = 0; index < keys.length; index += LOCAL_METADATA_BATCH_SIZE) {
    batches.push(keys.slice(index, index + LOCAL_METADATA_BATCH_SIZE));
  }
  const queue = [...batches];
  const rows = [];
  const workers = Array.from({ length: Math.min(LOCAL_METADATA_MAX_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) rows.push(...await query(metadataValueQuery(queue.shift())));
  });
  await Promise.all(workers);
  const returnedKeys = rows.map(row => String(row?.key || ''));
  if (returnedKeys.length !== keys.length || new Set(returnedKeys).size !== returnedKeys.length
      || returnedKeys.some(key => !keys.includes(key))) {
    throw new Error('Read-only local metadata batches did not reconcile to the key inventory.');
  }
  return rows.sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

function criteriaLeafCount(criteria) {
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) return 0;
  if (Array.isArray(criteria.group)) return criteria.group.reduce((total, child) => total + criteriaLeafCount(child), 0);
  return 1;
}

function dynamicFamilies(value, output = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) output.add(match[1]);
  } else if (Array.isArray(value)) value.forEach(child => dynamicFamilies(child, output));
  else if (value && typeof value === 'object') Object.values(value).forEach(child => dynamicFamilies(child, output));
  return output;
}

function classificationSummary(items) {
  const count = classification => items.filter(item => item.classification === classification).length;
  const executable = count('executable_criteria');
  const unfiltered = count('explicitly_safe_unfiltered');
  const unresolved = count('unresolved_criteria_body');
  const unsupported = count('unsupported_criteria');
  return {
    definitions_reviewed: items.length,
    executable_criteria_definitions: executable,
    explicitly_safe_unfiltered_definitions: unfiltered,
    unresolved_criteria_bodies: unresolved,
    unsupported_criteria_definitions: unsupported,
    compiled_definitions: executable + unfiltered,
    blocked_definitions: unresolved + unsupported,
  };
}

function buildCurrentMirroredRuntimeAudit(metadataRows) {
  if (!Array.isArray(metadataRows)) throw new Error('Current local metadata rows are required.');
  const rowMap = new Map();
  for (const row of metadataRows) {
    const key = String(row?.key || '');
    if (!SAFE_METADATA_KEY.test(key) || rowMap.has(key) || !row?.data || typeof row.data !== 'object' || Array.isArray(row.data)) {
      throw new Error('Current local metadata contains an invalid or duplicate row.');
    }
    rowMap.set(key, row.data);
  }
  const moduleDefinitions = array(rowMap.get('modules')?.modules);
  const moduleNames = moduleDefinitions.map(module => String(module?.api_name || ''));
  if (!moduleNames.length || moduleNames.some(module => !/^[A-Za-z][A-Za-z0-9_]*$/.test(module))
      || new Set(moduleNames).size !== moduleNames.length) {
    throw new Error('Current local module catalog is invalid.');
  }

  const scopeRows = prefix => [...rowMap.entries()].filter(([key]) => key.startsWith(prefix));
  const fieldsRows = scopeRows('fields:');
  const layoutsRows = scopeRows('layouts:');
  const viewsRows = scopeRows('views:');
  const fields = fieldsRows.flatMap(([, data]) => array(data.fields));
  const layouts = layoutsRows.flatMap(([, data]) => array(data.layouts));
  const views = [];
  const errorCodes = {};
  const blockedDefaultFamilies = new Set();

  for (const [key, data] of viewsRows) {
    const module = key.slice('views:'.length);
    const fieldData = rowMap.get(`fields:${module}`);
    const safeFields = array(fieldData?.fields)
      .filter(field => field?.api_name)
      .map(field => ({ api_name: field.api_name, data_type: field.data_type }));
    for (const view of array(data.custom_views)) {
      if (!view || typeof view !== 'object' || Array.isArray(view) || view.id === null || view.id === undefined) {
        throw new Error('Current local custom-view definition is invalid.');
      }
      const hasCriteria = Object.prototype.hasOwnProperty.call(view, 'criteria');
      let classification;
      try {
        const compiled = compileCustomViewFilter({
          module,
          cvid: String(view.id),
          views: [view],
          fields: safeFields,
        });
        classification = compiled.sql === null ? 'explicitly_safe_unfiltered' : 'executable_criteria';
      } catch (error) {
        if (!(error instanceof CustomViewFilterError)) throw error;
        classification = hasCriteria ? 'unsupported_criteria' : 'unresolved_criteria_body';
        errorCodes[error.code] = (errorCodes[error.code] || 0) + 1;
        if (view.default === true && hasCriteria) dynamicFamilies(view.criteria, blockedDefaultFamilies);
      }
      views.push({
        classification,
        has_criteria: hasCriteria && view.criteria !== null,
        criteria_leaf_count: hasCriteria && view.criteria !== null ? criteriaLeafCount(view.criteria) : 0,
        system_defined: view.system_defined === true,
        default: view.default === true,
      });
    }
  }

  const compilation = classificationSummary(views);
  const systemCompilation = classificationSummary(views.filter(view => view.system_defined));
  const defaultCompilation = {
    ...classificationSummary(views.filter(view => view.default)),
    blocking_dynamic_families: [...blockedDefaultFamilies].sort(),
  };
  if (compilation.definitions_reviewed !== views.length
      || compilation.compiled_definitions + compilation.blocked_definitions !== views.length) {
    throw new Error('Current local custom-view compilation counts did not reconcile.');
  }

  const layoutSections = layouts.flatMap(layout => array(layout?.sections));
  const metadataKeyRows = rowMap.size;
  return {
    audit_scope: 'Exact aggregate of hydrated local crm_meta fields, layouts, and custom views; separate from the historical offline source-discovery snapshot.',
    evidence_mode: 'Batched SELECT-only crm_meta reads plus the production custom-view compiler; no CRM records or source requests.',
    local_database_queried_during_generation: true,
    source_contacted_during_generation: false,
    source_mutations: false,
    local_mutations: false,
    batching: {
      metadata_key_rows: metadataKeyRows,
      batch_size: LOCAL_METADATA_BATCH_SIZE,
      value_batches: Math.ceil(metadataKeyRows / LOCAL_METADATA_BATCH_SIZE),
      maximum_concurrency: LOCAL_METADATA_MAX_CONCURRENCY,
    },
    modules_cataloged: moduleDefinitions.length,
    fields: {
      metadata_scopes: fieldsRows.length,
      modules_with_definitions: fieldsRows.filter(([, data]) => array(data.fields).length > 0).length,
      empty_scopes: fieldsRows.filter(([, data]) => array(data.fields).length === 0).length,
      definitions_mirrored: fields.length,
    },
    layouts: {
      metadata_scopes: layoutsRows.length,
      modules_with_definitions: layoutsRows.filter(([, data]) => array(data.layouts).length > 0).length,
      empty_scopes: layoutsRows.filter(([, data]) => array(data.layouts).length === 0).length,
      definitions_mirrored: layouts.length,
      definitions_with_sections_property: layouts.filter(layout => Object.prototype.hasOwnProperty.call(layout, 'sections')).length,
      definitions_with_nonempty_sections: layouts.filter(layout => array(layout.sections).length > 0).length,
      sections_mirrored: layoutSections.length,
      layout_field_references: layoutSections.reduce((total, section) => total + array(section?.fields).length, 0),
    },
    custom_views: {
      metadata_scopes: viewsRows.length,
      modules_with_definitions: viewsRows.filter(([, data]) => array(data.custom_views).length > 0).length,
      empty_scopes: viewsRows.filter(([, data]) => array(data.custom_views).length === 0).length,
      definitions_mirrored: views.length,
      criteria_bearing_definitions: views.filter(view => view.has_criteria).length,
      criteria_leaf_count: views.reduce((total, view) => total + view.criteria_leaf_count, 0),
      compilation,
      system_defined_compilation: systemCompilation,
      default_compilation: defaultCompilation,
      compiler_error_codes: Object.fromEntries(Object.entries(errorCodes).sort(([left], [right]) => left.localeCompare(right))),
      implicit_unsupported_default_behavior: 'Visible fallback to an explicitly safe unfiltered mirrored view.',
      explicit_unsupported_selection_decision: 'Deny',
      source_equivalence: 'Partial; unresolved and unsupported criteria remain blocked.',
      status: 'Partially implemented; fail-closed',
    },
  };
}

function auditLocalImplementation(currentRuntime) {
  const server = fs.readFileSync(SERVER_PATH, 'utf8');
  const viewEngine = fs.readFileSync(VIEW_ENGINE_PATH, 'utf8');
  const layoutEngine = fs.readFileSync(LAYOUT_ENGINE_PATH, 'utf8');
  const validationEngine = fs.readFileSync(VALIDATION_ENGINE_PATH, 'utf8');

  const requiredMarkers = [
    [server, "require('./lib/custom-view-filter')"],
    [server, 'compileCustomViewFilter({'],
    [server, "require('./lib/layout-schema')"],
    [server, 'mergeLayoutFields(fieldMeta?.fields || [], context.layout)'],
    [server, 'validatePayload(fields, payload, { isCreate })'],
    [viewEngine, 'CUSTOM_VIEW_CRITERIA_UNAVAILABLE'],
    [viewEngine, "'equal', 'not_equal', 'contains', 'not_contains', 'starts_with', 'ends_with'"],
    [viewEngine, "'in', 'not_in', 'greater_than', 'greater_equal', 'less_than', 'less_equal', 'between'"],
    [layoutEngine, "reason: layouts.length > 1 ? 'ambiguous_layout' : 'layout_metadata_unavailable'"],
    [layoutEngine, 'function mergeLayoutFields(fields, layout)'],
    [validationEngine, 'field.read_only || field.virtual_field'],
  ];
  if (requiredMarkers.some(([source, marker]) => !source.includes(marker))) {
    throw new Error('Local layout, view, or schema enforcement evidence changed; manual review is required.');
  }

  const unsupportedEngineImports = [
    "require('./lib/validation-rule-engine')",
    "require('./lib/assignment-rule-engine')",
    "require('./lib/approval-rule-engine')",
    "require('./lib/pipeline-engine')",
  ];
  if (unsupportedEngineImports.some(marker => server.includes(marker))) {
    throw new Error('A previously blocked rule engine now appears wired; coverage requires a manual re-audit.');
  }

  return {
    layouts: {
      status: 'Partially implemented',
      source_equivalence: 'Partial',
      exact_or_stored_layout_resolution: true,
      ambiguous_multi_layout_create_decision: 'Deny',
      unknown_layout_decision: 'Deny',
      field_overlay_applied_before_validation: true,
      required_field_enforcement: true,
      read_only_and_virtual_field_enforcement: true,
      layout_profile_visibility_enforced: false,
      layout_action_permissions_enforced: false,
      current_layout_definitions_available: currentRuntime.layouts.definitions_mirrored,
      current_field_definitions_available: currentRuntime.fields.definitions_mirrored,
      note: 'Hydrated local layout and field metadata constrain create and edit validation. Profile visibility and layout action permissions are not locally enforced.',
    },
    custom_views: {
      status: 'Implemented fail-closed',
      source_equivalence: 'Partial; unresolved and unsupported criteria remain blocked',
      nested_groups_supported: true,
      group_operators_supported: ['AND', 'OR'],
      comparators_supported: [
        'equal',
        'not_equal',
        'contains',
        'not_contains',
        'starts_with',
        'ends_with',
        'in',
        'not_in',
        'greater_than',
        'greater_equal',
        'less_than',
        'less_equal',
        'between',
      ],
      explicit_unfiltered_view_supported: true,
      missing_criteria_decision: 'Deny',
      disrupted_criteria_decision: 'Deny',
      dynamic_values_decision: 'Deny',
      unknown_fields_decision: 'Deny',
      unsupported_comparators_decision: 'Deny',
      current_executable_criteria_definitions: currentRuntime.custom_views.compilation.executable_criteria_definitions,
      current_explicitly_safe_unfiltered_definitions: currentRuntime.custom_views.compilation.explicitly_safe_unfiltered_definitions,
      current_unresolved_criteria_bodies: currentRuntime.custom_views.compilation.unresolved_criteria_bodies,
      current_unsupported_criteria_definitions: currentRuntime.custom_views.compilation.unsupported_criteria_definitions,
      current_views_blocked: currentRuntime.custom_views.compilation.blocked_definitions,
      note: 'Every hydrated local view was passed through the production compiler. Explicit null criteria are safely unfiltered; missing, dynamic, disrupted, unavailable-field, and unsupported criteria remain denied.',
    },
    validation_rules: {
      status: 'Blocked',
      source_equivalence: 'Not demonstrated',
      generic_field_and_layout_validation: 'Implemented',
      source_rule_interpreter: false,
      source_definitions_enforced: 0,
      default_execution_decision: 'Deny',
      note: 'Generic type, required-field, picklist, read-only, virtual-field, and layout validation is not a substitute for source validation-rule logic.',
    },
    assignment_rules: {
      status: 'Blocked',
      source_equivalence: 'Not demonstrated',
      source_rule_interpreter: false,
      source_definitions_enforced: 0,
      automatic_assignee_changes_enabled: false,
      caller_asserted_assignment_trusted: false,
      default_execution_decision: 'Deny',
      note: 'The one captured list definition has neither criteria nor action detail in the offline evidence.',
    },
    approval_rules: {
      status: 'Blocked',
      source_equivalence: 'Not demonstrated',
      source_rule_interpreter: false,
      source_definitions_enforced: 0,
      approval_state_mutation_enabled: false,
      caller_asserted_approval_trusted: false,
      default_execution_decision: 'Deny',
      note: 'No approval definition or executable approval evidence is available in the offline snapshot.',
    },
    pipelines: {
      status: 'Blocked',
      source_equivalence: 'Not demonstrated',
      source_pipeline_interpreter: false,
      source_definitions_enforced: 0,
      automatic_stage_progression_enabled: false,
      caller_asserted_pipeline_transition_trusted: false,
      default_execution_decision: 'Deny',
      note: 'Blueprint and ordinary field handling do not establish source pipeline equivalence.',
    },
  };
}

function assertArtifactSafe(value) {
  const forbiddenKeys = new Set([
    'alias', 'api_key', 'authorization', 'credential', 'credentials', 'email', 'endpoint',
    'first_name', 'full_name', 'id', 'ids', 'last_name', 'mobile', 'password', 'phone',
    'private_path', 'secret', 'source_endpoint', 'source_id', 'token', 'url', 'user_name',
  ]);
  const forbiddenValues = [
    /https?:\/\//i,
    /\bwww\./i,
    /\/(?:Users|home|var|tmp|opt|etc)\//i,
    /\.private\//i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
    /\b\d{15,25}\b/,
  ];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === 'object') {
      return Object.entries(node).forEach(([key, child]) => {
        if (forbiddenKeys.has(key.toLowerCase())) throw new Error('Coverage contains a forbidden sensitive key.');
        visit(child);
      });
    }
    if (typeof node === 'string' && forbiddenValues.some(pattern => pattern.test(node))) {
      throw new Error('Coverage contains a forbidden sensitive value.');
    }
  }
  visit(value);
}

async function buildCoverage({ metadataRows = null, readMetadataRows = readCurrentLocalMetadataRows } = {}) {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const modules = array(snapshot.modules);
  assertEqual(modules.length, EXPECTED.modules, 'modules');
  const currentRows = metadataRows || await readMetadataRows();
  const currentRuntime = buildCurrentMirroredRuntimeAudit(currentRows);

  const layouts = summarizeModuleEndpoint(modules, 'layouts', 'layouts');
  const customViews = summarizeModuleEndpoint(modules, 'views', 'custom_views');
  const validationRules = summarizeModuleEndpoint(modules, 'validation_rules', 'validation_rules');
  const assignmentRules = summarizeModuleEndpoint(modules, 'assignment_rules', 'assignment_rules');
  const approvalRules = summarizeModuleEndpoint(modules, 'approval_rules', 'approval_rules');
  assertExpected(layouts, EXPECTED.layouts, 'layouts');
  assertExpected(customViews, EXPECTED.custom_views, 'custom_views');
  assertExpected(validationRules, EXPECTED.validation_rules, 'validation_rules');
  assertExpected(assignmentRules, EXPECTED.assignment_rules, 'assignment_rules');
  assertExpected(approvalRules, EXPECTED.approval_rules, 'approval_rules');

  const layoutDefinitions = modules.flatMap(module => extract(module?.results?.layouts, 'layouts'));
  const viewDefinitions = modules.flatMap(module => extract(module?.results?.views, 'custom_views'));
  const assignmentDefinitions = modules.flatMap(module => extract(module?.results?.assignment_rules, 'assignment_rules'));
  const pipelineResponses = modules.flatMap(module => array(module?.results?.pipelines));
  const pipelineSummary = {
    layout_scoped_responses: pipelineResponses.length,
    successful_responses: pipelineResponses.filter(result => result?.ok === true).length,
    blocked_responses: pipelineResponses.filter(result => result?.ok !== true).length,
    responses_by_status: statusCounts(pipelineResponses),
    definitions_captured: pipelineResponses.reduce((total, result) => total + extract(result, 'pipelines').length, 0),
    modules_with_responses: modules.filter(module => array(module?.results?.pipelines).length > 0).length,
    modules_with_successful_responses: modules.filter(module => array(module?.results?.pipelines).some(result => result?.ok === true)).length,
  };
  assertExpected(pipelineSummary, {
    layout_scoped_responses: EXPECTED.pipelines.layout_scoped_responses,
    successful_responses: EXPECTED.pipelines.successful_responses,
    blocked_responses: EXPECTED.pipelines.blocked_responses,
    definitions_captured: EXPECTED.pipelines.definitions_captured,
    modules_with_responses: EXPECTED.pipelines.modules_with_responses,
    modules_with_successful_responses: EXPECTED.pipelines.modules_with_successful_responses,
  }, 'pipelines');

  const coverage = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    source_snapshot_generated_at: snapshot.generated_at,
    audit_mode: 'Historical offline source evidence plus batched SELECT-only local crm_meta verification and static enforcement-code review; no source contact or mutation.',
    evidence_scope: {
      modules_cataloged: modules.length,
      offline_source_artifacts_only: true,
      source_contacted: false,
      source_mutations: false,
      local_database_queried: true,
      local_database_query_scope: 'SELECT-only crm_meta fields, layouts, views, and module catalog.',
      local_database_mutations: false,
      module_level_rows_included: false,
      configuration_names_included: false,
      record_values_included: false,
      limitations: [
        'A successful list response proves only that the captured list was readable at snapshot time.',
        'An inaccessible endpoint does not prove that no source configuration exists.',
        'Local engine capability does not prove equivalence without complete source definitions and negative-path tests.',
      ],
    },
    source_coverage: {
      layouts: {
        ...layouts,
        definitions_with_sections_property: layoutDefinitions.filter(layout => Object.prototype.hasOwnProperty.call(layout, 'sections')).length,
        definitions_with_nonempty_sections: layoutDefinitions.filter(layout => array(layout.sections).length > 0).length,
        definitions_with_profile_scope_property: layoutDefinitions.filter(layout => Object.prototype.hasOwnProperty.call(layout, 'profiles')).length,
        definitions_with_action_permissions_property: layoutDefinitions.filter(layout => Object.prototype.hasOwnProperty.call(layout, 'actions_allowed')).length,
        status: 'Partially captured',
      },
      custom_views: {
        ...customViews,
        list_rows_captured: customViews.definitions_captured,
        criteria_details_captured: viewDefinitions.filter(view => Object.prototype.hasOwnProperty.call(view, 'criteria')).length,
        criteria_details_missing: viewDefinitions.filter(view => !Object.prototype.hasOwnProperty.call(view, 'criteria')).length,
        source_criteria_compile_verified: 0,
        source_criteria_compile_blocked: viewDefinitions.length,
        status: 'List captured; criteria detail blocked offline',
      },
      validation_rules: {
        ...validationRules,
        rule_bodies_captured: 0,
        executable_definitions_captured: 0,
        status: 'Not accessible in captured discovery',
      },
      assignment_rules: {
        ...assignmentRules,
        definitions_with_criteria: assignmentDefinitions.filter(rule => Object.prototype.hasOwnProperty.call(rule, 'criteria')).length,
        definitions_with_actions: assignmentDefinitions.filter(rule => Object.prototype.hasOwnProperty.call(rule, 'actions')).length,
        definitions_with_assignee_reference: assignmentDefinitions.filter(rule => Object.prototype.hasOwnProperty.call(rule, 'default_assignee')).length,
        executable_definitions_captured: assignmentDefinitions.filter(rule => Object.prototype.hasOwnProperty.call(rule, 'criteria') && Object.prototype.hasOwnProperty.call(rule, 'actions')).length,
        status: 'List evidence only; execution detail blocked',
      },
      approval_rules: {
        ...approvalRules,
        rule_bodies_captured: 0,
        executable_definitions_captured: 0,
        status: 'Not accessible in captured discovery',
      },
      pipelines: {
        ...pipelineSummary,
        executable_definitions_captured: 0,
        status: 'Not accessible beyond one empty response',
      },
    },
    current_mirrored_runtime: currentRuntime,
    local_enforcement: auditLocalImplementation(currentRuntime),
    enforcement_boundary: {
      source_rule_execution_enabled: false,
      source_rule_mutations_enabled: false,
      caller_supplied_rule_outcomes_trusted: false,
      default_rule_decision: 'Deny',
      validation_rule_decision: 'Deny',
      assignment_rule_decision: 'Deny',
      approval_rule_decision: 'Deny',
      pipeline_decision: 'Deny',
      status: 'Fail-closed',
      reason: 'Complete source criteria, conditions, actions, ordering, actor context, and failure semantics are not available and implemented for these rule families.',
    },
    privacy: {
      source_identifiers_included: false,
      configuration_names_included: false,
      individual_identities_included: false,
      record_data_included: false,
      communication_targets_included: false,
      sensitive_values_included: false,
      private_locations_included: false,
    },
  };

  assertArtifactSafe(coverage);
  return coverage;
}

function markdown(coverage) {
  const source = coverage.source_coverage;
  const runtime = coverage.current_mirrored_runtime;
  const current = runtime.custom_views;
  const local = coverage.local_enforcement;
  return `# Local Rules, Layouts, Pipelines, and Custom-View Coverage\n\n` +
    `## Outcome\n\n` +
    `This report keeps two evidence scopes separate. The historical offline discovery audit covers **${coverage.evidence_scope.modules_cataloged} API-supported modules**. A separate current hydrated-runtime audit reads the local **${runtime.modules_cataloged}-module catalog** using bounded, SELECT-only crm_meta batches. Local layout-aware schema validation and a fail-closed custom-view compiler are implemented. Source validation rules, assignment execution, approvals, and pipelines are **not locally executable** from the available evidence and remain denied by default.\n\n` +
    `| Area | Captured source evidence | Actual local enforcement | Source-equivalent status |\n` +
    `| --- | --- | --- | --- |\n` +
    `| Layouts | ${source.layouts.definitions_captured} definitions across ${source.layouts.modules_with_definitions} modules; ${source.layouts.blocked_responses} module responses blocked | Exact/stored layout resolution, field overlay, and schema validation are enforced | Partial |\n` +
    `| Custom views | ${source.custom_views.list_rows_captured} list rows; ${source.custom_views.criteria_details_captured} criteria details captured; ${source.custom_views.criteria_details_missing} missing | Compiler is wired and rejects missing, dynamic, disrupted, unknown, or unsupported criteria | Blocked for all ${source.custom_views.source_criteria_compile_blocked} offline rows |\n` +
    `| Validation rules | ${source.validation_rules.definitions_captured} definitions; ${source.validation_rules.blocked_responses}/${source.validation_rules.endpoint_responses} responses inaccessible | Generic schema/layout validation only; no source-rule interpreter | Blocked |\n` +
    `| Assignment rules | ${source.assignment_rules.definitions_captured} list definition; ${source.assignment_rules.executable_definitions_captured} executable definitions | No rule interpreter or automatic assignee mutation | Blocked |\n` +
    `| Approval rules | ${source.approval_rules.definitions_captured} definitions; ${source.approval_rules.blocked_responses}/${source.approval_rules.endpoint_responses} responses inaccessible | No approval interpreter or approval-state mutation | Blocked |\n` +
    `| Pipelines | ${source.pipelines.layout_scoped_responses} layout-scoped responses; ${source.pipelines.definitions_captured} definitions | No pipeline interpreter or automatic stage progression | Blocked |\n\n` +
    `## Current hydrated local metadata\n\n` +
    `The generator queried only approved crm_meta keys: ${runtime.batching.metadata_key_rows} rows in ${runtime.batching.value_batches} value batches of at most ${runtime.batching.batch_size}, with maximum concurrency ${runtime.batching.maximum_concurrency}. It did not query CRM records, mutate local metadata, or contact the source.\n\n` +
    `| Local metadata family | Stored scopes | Modules with definitions | Definitions | Empty scopes |\n` +
    `| --- | ---: | ---: | ---: | ---: |\n` +
    `| Fields | ${runtime.fields.metadata_scopes} | ${runtime.fields.modules_with_definitions} | ${runtime.fields.definitions_mirrored} | ${runtime.fields.empty_scopes} |\n` +
    `| Layouts | ${runtime.layouts.metadata_scopes} | ${runtime.layouts.modules_with_definitions} | ${runtime.layouts.definitions_mirrored} | ${runtime.layouts.empty_scopes} |\n` +
    `| Custom views | ${current.metadata_scopes} | ${current.modules_with_definitions} | ${current.definitions_mirrored} | ${current.empty_scopes} |\n\n` +
    `The ${runtime.layouts.definitions_mirrored} layouts contain ${runtime.layouts.sections_mirrored} sections and ${runtime.layouts.layout_field_references} layout-field references. All counts are derived from the current local metadata bodies, not a pre-hydration constant.\n\n` +
    `## Current custom-view compiler results\n\n` +
    `| Runtime population | Reviewed | Executable criteria | Safe unfiltered | Unresolved body | Unsupported criteria | Compiles | Blocked |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n` +
    `| All mirrored views | ${current.compilation.definitions_reviewed} | ${current.compilation.executable_criteria_definitions} | ${current.compilation.explicitly_safe_unfiltered_definitions} | ${current.compilation.unresolved_criteria_bodies} | ${current.compilation.unsupported_criteria_definitions} | ${current.compilation.compiled_definitions} | ${current.compilation.blocked_definitions} |\n` +
    `| System-defined views | ${current.system_defined_compilation.definitions_reviewed} | ${current.system_defined_compilation.executable_criteria_definitions} | ${current.system_defined_compilation.explicitly_safe_unfiltered_definitions} | ${current.system_defined_compilation.unresolved_criteria_bodies} | ${current.system_defined_compilation.unsupported_criteria_definitions} | ${current.system_defined_compilation.compiled_definitions} | ${current.system_defined_compilation.blocked_definitions} |\n` +
    `| Module defaults | ${current.default_compilation.definitions_reviewed} | ${current.default_compilation.executable_criteria_definitions} | ${current.default_compilation.explicitly_safe_unfiltered_definitions} | ${current.default_compilation.unresolved_criteria_bodies} | ${current.default_compilation.unsupported_criteria_definitions} | ${current.default_compilation.compiled_definitions} | ${current.default_compilation.blocked_definitions} |\n\n` +
    `All ${current.definitions_mirrored} local views were passed through the production custom-view filter. ${current.compilation.executable_criteria_definitions} criteria bodies compile to filters; ${current.compilation.explicitly_safe_unfiltered_definitions} explicit null criteria are safely unfiltered; ${current.compilation.unresolved_criteria_bodies} definitions have no criteria body and remain unavailable; and ${current.compilation.unsupported_criteria_definitions} supplied criteria are rejected by the fail-closed compiler. An implicit unsupported default may fall back visibly to an explicitly safe unfiltered mirrored view; an explicitly selected unsupported view is denied.\n\n` +
    `## Exact source reconciliation\n\n` +
    `- Layouts: ${source.layouts.successful_responses} successful and ${source.layouts.blocked_responses} blocked module responses; ${source.layouts.definitions_captured} definitions; ${source.layouts.successful_empty_modules} successful empty responses. All ${source.layouts.definitions_with_sections_property} captured definitions contain the sections property, and ${source.layouts.definitions_with_nonempty_sections} contain at least one section.\n` +
    `- Custom views: ${source.custom_views.successful_responses} successful and ${source.custom_views.blocked_responses} blocked module responses; ${source.custom_views.list_rows_captured} list rows across ${source.custom_views.modules_with_definitions} modules; no captured row contains criteria detail.\n` +
    `- Validation rules: ${source.validation_rules.blocked_responses} inaccessible responses and no captured definitions. This does **not** establish that the source has no validation rules.\n` +
    `- Assignment rules: ${source.assignment_rules.successful_responses} successful and ${source.assignment_rules.blocked_responses} blocked responses; one list definition exists, but it has no captured criteria or actions.\n` +
    `- Approval rules: ${source.approval_rules.blocked_responses} inaccessible responses and no captured definitions. This does **not** establish that the source has no approval processes.\n` +
    `- Pipelines: ${source.pipelines.layout_scoped_responses} responses across ${source.pipelines.modules_with_responses} modules; one successful empty response, ${source.pipelines.blocked_responses} blocked responses, and no definitions.\n\n` +
    `## Implemented local equivalents\n\n` +
    `### Layout-aware validation\n\n` +
    `The local runtime resolves an explicitly selected or stored active layout. It does not guess when a create request has multiple candidate layouts. The resolved layout overlays field metadata before required, type, picklist, read-only, virtual-field, formula, lookup, and subform validation runs.\n\n` +
    `This is only partial parity: source profile visibility and layout-level action permissions are captured on the layout objects but are not locally enforced.\n\n` +
    `### Custom-view filtering\n\n` +
    `The local compiler supports nested AND/OR groups and these comparators: ${local.custom_views.comparators_supported.join(', ')}. An explicit null criterion is treated as intentionally unfiltered. Missing criteria, disrupted criteria, dynamic values, unavailable fields, malformed values, and unsupported operators are denied before records are queried.\n\n` +
    `The historical offline snapshot still contains list rows only, so **0 of ${source.custom_views.list_rows_captured} historical rows can be independently compiled from that artifact alone**. The hydrated local metadata separately contains ${current.criteria_bearing_definitions} criteria-bearing views comprising ${current.criteria_leaf_count} leaf conditions; ${current.compilation.executable_criteria_definitions} compile and the rest remain explicitly categorized.\n\n` +
    `## Fail-closed execution boundary\n\n` +
    `Validation-rule, assignment-rule, approval-rule, and pipeline execution remains disabled. Caller assertions that a rule matched, an assignee was selected, an approval occurred, or a pipeline transition is valid are not trusted. The default decision is **Deny** until complete definitions, ordering, actor context, side effects, and failure behavior are captured, implemented, and tested.\n\n` +
    `Generic field/layout validation must not be described as source validation-rule parity. Likewise, Blueprint support or direct stage-field handling must not be described as pipeline parity.\n\n` +
    `## Evidence and privacy boundary\n\n` +
    `This report was generated from existing offline source artifacts, batched SELECT-only crm_meta reads, and a static local-code audit. It did not contact or mutate the source, mutate the local database, query CRM records, execute source configuration, or include configuration names, raw identifiers, individual identities, record values, communication targets, sensitive values, or private filesystem locations.\n`;
}

async function main() {
  const coverage = await buildCoverage();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(coverage, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(DOCUMENT_PATH, markdown(coverage), { mode: 0o600 });
  process.stdout.write('Built sanitized historical rule/layout coverage and exact hydrated local metadata coverage.\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Rule/layout coverage build failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED,
  LOCAL_METADATA_BATCH_SIZE,
  LOCAL_METADATA_INDEX_SQL,
  LOCAL_METADATA_MAX_CONCURRENCY,
  assertArtifactSafe,
  assertReadOnlyMetadataQuery,
  auditLocalImplementation,
  buildCoverage,
  buildCurrentMirroredRuntimeAudit,
  markdown,
  metadataValueQuery,
  readCurrentLocalMetadataRows,
};
