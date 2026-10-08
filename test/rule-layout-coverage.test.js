'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_CURRENT_MIRRORED_RUNTIME,
  RULE_FAMILIES,
  buildRuleLayoutCoverage,
  evaluateSourceRuleExecution,
  getRuleLayoutCoverage,
} = require('../lib/rule-layout-coverage');
const {
  LOCAL_METADATA_BATCH_SIZE,
  LOCAL_METADATA_INDEX_SQL,
  LOCAL_METADATA_MAX_CONCURRENCY,
  assertReadOnlyMetadataQuery,
  buildCoverage,
  buildCurrentMirroredRuntimeAudit,
  metadataValueQuery,
  readCurrentLocalMetadataRows,
} = require('../scripts/build-rule-layout-coverage');

const rawCoverage = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config', 'rule-layout-coverage.json'), 'utf8'));

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) value.forEach(item => collectKeys(item, keys));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => {
    keys.push(key);
    collectKeys(child, keys);
  });
  return keys;
}

function syntheticMetadataRows() {
  return [
    {
      key: 'modules',
      data: { modules: [{ api_name: 'Leads' }, { api_name: 'Tasks' }] },
    },
    {
      key: 'fields:Leads',
      data: {
        fields: [
          { api_name: 'Stage', data_type: 'picklist' },
          { api_name: 'Amount', data_type: 'currency' },
        ],
      },
    },
    {
      key: 'layouts:Leads',
      data: {
        layouts: [{ sections: [{ fields: [{ api_name: 'Stage' }, { api_name: 'Amount' }] }] }],
      },
    },
    {
      key: 'views:Leads',
      data: {
        custom_views: [
          {
            id: 'executable',
            criteria: { field: { api_name: 'Stage' }, comparator: 'equal', value: 'Open' },
          },
          { id: 'safe-unfiltered', criteria: null, system_defined: true, default: true },
          { id: 'unresolved', system_defined: true, default: true },
          {
            id: 'unsupported-dynamic',
            criteria: { field: { api_name: 'Stage' }, comparator: 'equal', value: '${CURRENTUSER}' },
            system_defined: true,
            default: true,
          },
        ],
      },
    },
  ];
}

test('reconciles the exact historical offline source response and definition counts', () => {
  const coverage = getRuleLayoutCoverage();
  assert.equal(coverage.evidence_scope.modules_cataloged, 122);
  assert.equal(coverage.evidence_scope.offline_source_artifacts_only, true);
  assert.deepEqual(coverage.source_coverage.layouts.responses_by_status, { 200: 67, 204: 8, 400: 47 });
  assert.deepEqual(coverage.source_coverage.custom_views.responses_by_status, { 200: 41, 204: 80, 400: 1 });
  assert.deepEqual(coverage.source_coverage.validation_rules.responses_by_status, { 404: 122 });
  assert.deepEqual(coverage.source_coverage.assignment_rules.responses_by_status, { 200: 1, 204: 11, 400: 110 });
  assert.deepEqual(coverage.source_coverage.approval_rules.responses_by_status, { 404: 122 });
  assert.deepEqual(coverage.source_coverage.pipelines.responses_by_status, { 204: 1, 400: 69 });
  assert.deepEqual({
    layouts: coverage.source_coverage.layouts.definitions_captured,
    custom_views: coverage.source_coverage.custom_views.definitions_captured,
    validation_rules: coverage.source_coverage.validation_rules.definitions_captured,
    assignment_rules: coverage.source_coverage.assignment_rules.definitions_captured,
    approval_rules: coverage.source_coverage.approval_rules.definitions_captured,
    pipelines: coverage.source_coverage.pipelines.definitions_captured,
  }, {
    layouts: 70,
    custom_views: 386,
    validation_rules: 0,
    assignment_rules: 1,
    approval_rules: 0,
    pipelines: 0,
  });
});

test('reports the exact hydrated local field and layout aggregates', () => {
  const runtime = getRuleLayoutCoverage().current_mirrored_runtime;
  assert.equal(runtime.modules_cataloged, 153);
  assert.deepEqual(runtime.batching, {
    metadata_key_rows: 318,
    batch_size: LOCAL_METADATA_BATCH_SIZE,
    value_batches: 27,
    maximum_concurrency: LOCAL_METADATA_MAX_CONCURRENCY,
  });
  assert.deepEqual(runtime.fields, {
    metadata_scopes: 121,
    modules_with_definitions: 120,
    empty_scopes: 1,
    definitions_mirrored: 2377,
  });
  assert.deepEqual(runtime.layouts, {
    metadata_scopes: 75,
    modules_with_definitions: 67,
    empty_scopes: 8,
    definitions_mirrored: 70,
    definitions_with_sections_property: 70,
    definitions_with_nonempty_sections: 69,
    sections_mirrored: 168,
    layout_field_references: 1796,
  });
  assert.equal(runtime.local_database_queried_during_generation, true);
  assert.equal(runtime.source_contacted_during_generation, false);
  assert.equal(runtime.source_mutations, false);
  assert.equal(runtime.local_mutations, false);
});

test('classifies every hydrated custom view through the production compiler', () => {
  const views = getRuleLayoutCoverage().current_mirrored_runtime.custom_views;
  assert.deepEqual({
    metadata_scopes: views.metadata_scopes,
    modules_with_definitions: views.modules_with_definitions,
    empty_scopes: views.empty_scopes,
    definitions_mirrored: views.definitions_mirrored,
    criteria_bearing_definitions: views.criteria_bearing_definitions,
    criteria_leaf_count: views.criteria_leaf_count,
  }, {
    metadata_scopes: 121,
    modules_with_definitions: 41,
    empty_scopes: 80,
    definitions_mirrored: 386,
    criteria_bearing_definitions: 199,
    criteria_leaf_count: 321,
  });
  assert.deepEqual(views.compilation, {
    definitions_reviewed: 386,
    executable_criteria_definitions: 102,
    explicitly_safe_unfiltered_definitions: 53,
    unresolved_criteria_bodies: 134,
    unsupported_criteria_definitions: 97,
    compiled_definitions: 155,
    blocked_definitions: 231,
  });
  assert.deepEqual(views.system_defined_compilation, {
    definitions_reviewed: 306,
    executable_criteria_definitions: 33,
    explicitly_safe_unfiltered_definitions: 48,
    unresolved_criteria_bodies: 134,
    unsupported_criteria_definitions: 91,
    compiled_definitions: 81,
    blocked_definitions: 225,
  });
  assert.deepEqual(views.default_compilation, {
    definitions_reviewed: 41,
    executable_criteria_definitions: 4,
    explicitly_safe_unfiltered_definitions: 10,
    unresolved_criteria_bodies: 26,
    unsupported_criteria_definitions: 1,
    compiled_definitions: 14,
    blocked_definitions: 27,
    blocking_dynamic_families: ['CURRENTUSER', 'TODAYANDOVERDUE'],
  });
  assert.deepEqual(views.compiler_error_codes, {
    CUSTOM_VIEW_CRITERIA_UNAVAILABLE: 134,
    CUSTOM_VIEW_CRITERIA_UNSUPPORTED: 97,
  });
  assert.equal(views.explicit_unsupported_selection_decision, 'Deny');
});

test('derives compiler categories from an arbitrary metadata population', () => {
  const runtime = buildCurrentMirroredRuntimeAudit(syntheticMetadataRows());
  assert.equal(runtime.modules_cataloged, 2);
  assert.deepEqual(runtime.batching, {
    metadata_key_rows: 4,
    batch_size: 12,
    value_batches: 1,
    maximum_concurrency: 4,
  });
  assert.deepEqual(runtime.fields, {
    metadata_scopes: 1,
    modules_with_definitions: 1,
    empty_scopes: 0,
    definitions_mirrored: 2,
  });
  assert.deepEqual(runtime.layouts, {
    metadata_scopes: 1,
    modules_with_definitions: 1,
    empty_scopes: 0,
    definitions_mirrored: 1,
    definitions_with_sections_property: 1,
    definitions_with_nonempty_sections: 1,
    sections_mirrored: 1,
    layout_field_references: 2,
  });
  assert.deepEqual(runtime.custom_views.compilation, {
    definitions_reviewed: 4,
    executable_criteria_definitions: 1,
    explicitly_safe_unfiltered_definitions: 1,
    unresolved_criteria_bodies: 1,
    unsupported_criteria_definitions: 1,
    compiled_definitions: 2,
    blocked_definitions: 2,
  });
  assert.deepEqual(runtime.custom_views.system_defined_compilation, {
    definitions_reviewed: 3,
    executable_criteria_definitions: 0,
    explicitly_safe_unfiltered_definitions: 1,
    unresolved_criteria_bodies: 1,
    unsupported_criteria_definitions: 1,
    compiled_definitions: 1,
    blocked_definitions: 2,
  });
  assert.deepEqual(runtime.custom_views.default_compilation, {
    definitions_reviewed: 3,
    executable_criteria_definitions: 0,
    explicitly_safe_unfiltered_definitions: 1,
    unresolved_criteria_bodies: 1,
    unsupported_criteria_definitions: 1,
    compiled_definitions: 1,
    blocked_definitions: 2,
    blocking_dynamic_families: ['CURRENTUSER'],
  });
  assert.deepEqual(runtime.custom_views.compiler_error_codes, {
    CUSTOM_VIEW_CRITERIA_UNAVAILABLE: 1,
    CUSTOM_VIEW_CRITERIA_UNSUPPORTED: 1,
  });
});

test('metadata SQL guard permits only bounded SELECT-only crm_meta reads', () => {
  assert.equal(assertReadOnlyMetadataQuery(LOCAL_METADATA_INDEX_SQL), LOCAL_METADATA_INDEX_SQL);
  assert.match(metadataValueQuery(['modules', 'fields:Leads']), /^select key, data from crm_meta/i);
  assert.throws(() => assertReadOnlyMetadataQuery('update crm_meta set data = null'), /SELECT-only/i);
  assert.throws(() => assertReadOnlyMetadataQuery('select * from crm_records'), /approved crm_meta scope/i);
  assert.throws(() => assertReadOnlyMetadataQuery('select * from crm_meta; delete from crm_meta'), /SELECT-only/i);
  assert.throws(() => metadataValueQuery(['fields:Leads', 'fields:Bad-Key']), /key batch is invalid/i);
  assert.throws(
    () => metadataValueQuery(Array.from({ length: LOCAL_METADATA_BATCH_SIZE + 1 }, (_, index) => `fields:Module${index}`)),
    /key batch is invalid/i,
  );
});

test('local metadata reader scales in bounded batches without contacting source systems or writing', async () => {
  const keyRows = [
    { key: 'modules' },
    ...Array.from({ length: 13 }, (_, index) => ({ key: `fields:Module${index}` })),
  ];
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, method: options.method, query: body.q });
    if (body.q === LOCAL_METADATA_INDEX_SQL) return { ok: true, status: 200, json: async () => keyRows };
    const keys = [...body.q.matchAll(/'([^']+)'/g)].map(match => match[1]);
    return {
      ok: true,
      status: 200,
      json: async () => keys.map(key => ({ key, data: key === 'modules' ? { modules: [] } : { fields: [] } })),
    };
  };
  const rows = await readCurrentLocalMetadataRows({
    fetchImpl,
    env: {
      SUPABASE_URL: 'https://local-metadata-test.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      CRM_SQL_SECRET: 'test-sql-secret',
    },
  });

  assert.equal(rows.length, 14);
  assert.equal(requests.length, 1 + Math.ceil(14 / LOCAL_METADATA_BATCH_SIZE));
  for (const request of requests) {
    assert.equal(request.url, 'https://local-metadata-test.supabase.co/rest/v1/rpc/crm_sql');
    assert.equal(request.method, 'POST');
    assert.match(request.query, /^select\b/i);
    assert.match(request.query, /\bfrom\s+crm_meta\b/i);
    assert.doesNotMatch(request.query, /\b(?:insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|copy|call|do)\b/i);
  }
});

test('distinguishes implemented local enforcement from unavailable source rule execution', () => {
  const coverage = getRuleLayoutCoverage();
  const layouts = coverage.local_enforcement.layouts;
  const views = coverage.local_enforcement.custom_views;
  assert.equal(layouts.exact_or_stored_layout_resolution, true);
  assert.equal(layouts.required_field_enforcement, true);
  assert.equal(layouts.layout_profile_visibility_enforced, false);
  assert.equal(layouts.layout_action_permissions_enforced, false);
  assert.equal(layouts.current_layout_definitions_available, 70);
  assert.equal(layouts.current_field_definitions_available, 2377);
  assert.equal(views.current_executable_criteria_definitions, 102);
  assert.equal(views.current_explicitly_safe_unfiltered_definitions, 53);
  assert.equal(views.current_unresolved_criteria_bodies, 134);
  assert.equal(views.current_unsupported_criteria_definitions, 97);
  assert.equal(views.current_views_blocked, 231);

  for (const family of RULE_FAMILIES.map(value => value === 'pipeline' ? 'pipelines' : `${value}s`)) {
    assert.equal(coverage.local_enforcement[family].status, 'Blocked');
    assert.equal(coverage.local_enforcement[family].source_definitions_enforced, 0);
    assert.equal(coverage.local_enforcement[family].default_execution_decision, 'Deny');
  }
});

test('rule execution evaluator denies recognized, unrecognized, and caller-asserted outcomes', () => {
  for (const ruleFamily of RULE_FAMILIES) {
    assert.deepEqual(evaluateSourceRuleExecution({ rule_family: ruleFamily, matched: true, approved: true }), {
      allowed: false,
      status: 'Blocked',
      code: 'SOURCE_RULE_EXECUTION_UNAVAILABLE',
      rule_family: ruleFamily,
      reason: 'Complete source execution evidence is unavailable and no reviewed local interpreter is enabled.',
    });
  }
  assert.deepEqual(evaluateSourceRuleExecution({ rule_family: 'caller_supplied', matched: true }), {
    allowed: false,
    status: 'Blocked',
    code: 'UNSUPPORTED_RULE_FAMILY',
    rule_family: 'unknown',
    reason: 'Only reviewed source rule families may be evaluated, and all remain disabled.',
  });
  assert.equal(evaluateSourceRuleExecution().allowed, false);
});

test('artifact and adapter exclude sensitive keys, values, records, and private paths', () => {
  const coverage = getRuleLayoutCoverage();
  const forbiddenKeys = new Set([
    'alias', 'api_key', 'authorization', 'credential', 'credentials', 'email', 'endpoint',
    'first_name', 'full_name', 'id', 'ids', 'last_name', 'mobile', 'password', 'phone',
    'private_path', 'secret', 'source_endpoint', 'source_id', 'token', 'url', 'user_name',
  ]);
  const exposed = collectKeys(coverage).find(key => forbiddenKeys.has(key.toLowerCase()));
  assert.equal(exposed, undefined);
  const serialized = JSON.stringify(coverage);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\bwww\./i);
  assert.doesNotMatch(serialized, /\/(?:Users|home|var|tmp|opt|etc)\//i);
  assert.doesNotMatch(serialized, /\.private\//i);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(serialized, /\b\d{15,25}\b/);
  assert.ok(Object.values(coverage.privacy).every(value => value === false));
});

test('runtime adapter returns a fresh allowlisted artifact and rejects drift or unsafe expansion', () => {
  const first = getRuleLayoutCoverage();
  const second = getRuleLayoutCoverage();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.current_mirrored_runtime, second.current_mirrored_runtime);
  assert.notStrictEqual(
    first.current_mirrored_runtime.custom_views.default_compilation.blocking_dynamic_families,
    second.current_mirrored_runtime.custom_views.default_compilation.blocking_dynamic_families,
  );
  first.current_mirrored_runtime.custom_views.default_compilation.blocking_dynamic_families[0] = 'mutated';
  assert.equal(second.current_mirrored_runtime.custom_views.default_compilation.blocking_dynamic_families[0], 'CURRENTUSER');

  const input = structuredClone(rawCoverage);
  input.unreviewed_metadata = 'omit me';
  input.source_coverage.layouts.unreviewed_metadata = 'omit me';
  const output = buildRuleLayoutCoverage(input);
  assert.equal(output.unreviewed_metadata, undefined);
  assert.equal(output.source_coverage.layouts.unreviewed_metadata, undefined);

  const staleCount = structuredClone(rawCoverage);
  staleCount.current_mirrored_runtime.custom_views.definitions_mirrored = 252;
  assert.throws(() => buildRuleLayoutCoverage(staleCount), /fail-closed coverage/i);

  const categoryDrift = structuredClone(rawCoverage);
  categoryDrift.current_mirrored_runtime.custom_views.compilation.explicitly_safe_unfiltered_definitions = 52;
  assert.throws(() => buildRuleLayoutCoverage(categoryDrift), /fail-closed coverage/i);

  const enabledExecution = structuredClone(rawCoverage);
  enabledExecution.enforcement_boundary.source_rule_execution_enabled = true;
  assert.throws(() => buildRuleLayoutCoverage(enabledExecution), /fail-closed coverage/i);

  const enabledLocalMutation = structuredClone(rawCoverage);
  enabledLocalMutation.current_mirrored_runtime.local_mutations = true;
  assert.throws(() => buildRuleLayoutCoverage(enabledLocalMutation), /fail-closed coverage/i);

  const sensitiveKey = structuredClone(rawCoverage);
  sensitiveKey.source_coverage.assignment_rules.source_id = 'synthetic';
  assert.throws(() => buildRuleLayoutCoverage(sensitiveKey), /forbidden sensitive key/i);

  const sensitiveValue = structuredClone(rawCoverage);
  sensitiveValue.evidence_scope.limitations[0] = '/Users/example/private.json';
  assert.throws(() => buildRuleLayoutCoverage(sensitiveValue), /forbidden sensitive value/i);
});

test('builder preserves the read-only source boundary while deriving injected local metadata', async () => {
  let readerCalled = false;
  const rebuilt = await buildCoverage({
    metadataRows: syntheticMetadataRows(),
    readMetadataRows: async () => {
      readerCalled = true;
      throw new Error('injected metadata must avoid network reads');
    },
  });
  assert.equal(readerCalled, false);
  assert.equal(rebuilt.schema_version, 2);
  assert.equal(rebuilt.evidence_scope.offline_source_artifacts_only, true);
  assert.equal(rebuilt.evidence_scope.source_contacted, false);
  assert.equal(rebuilt.evidence_scope.source_mutations, false);
  assert.equal(rebuilt.evidence_scope.local_database_mutations, false);
  assert.equal(rebuilt.current_mirrored_runtime.custom_views.compilation.definitions_reviewed, 4);
  assert.equal(rebuilt.current_mirrored_runtime.custom_views.compilation.compiled_definitions, 2);
  assert.equal(rebuilt.current_mirrored_runtime.custom_views.compilation.blocked_definitions, 2);
  assert.equal(rebuilt.local_enforcement.custom_views.current_views_blocked, 2);
  assert.deepEqual(rebuilt.source_coverage, rawCoverage.source_coverage);
});

test('adapter constants reconcile to the regenerated hydrated artifact', () => {
  const runtime = rawCoverage.current_mirrored_runtime;
  assert.equal(EXPECTED_CURRENT_MIRRORED_RUNTIME.modules, runtime.modules_cataloged);
  assert.equal(EXPECTED_CURRENT_MIRRORED_RUNTIME.field_definitions, runtime.fields.definitions_mirrored);
  assert.equal(EXPECTED_CURRENT_MIRRORED_RUNTIME.layout_definitions, runtime.layouts.definitions_mirrored);
  assert.equal(EXPECTED_CURRENT_MIRRORED_RUNTIME.definitions, runtime.custom_views.definitions_mirrored);
  assert.equal(EXPECTED_CURRENT_MIRRORED_RUNTIME.compiled, runtime.custom_views.compilation.compiled_definitions);
  assert.equal(EXPECTED_CURRENT_MIRRORED_RUNTIME.blocked, runtime.custom_views.compilation.blocked_definitions);
});
