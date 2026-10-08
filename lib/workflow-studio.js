'use strict';

const EXPECTED_COVERAGE = Object.freeze({
  listed_rules: 44,
  detailed_rules: 44,
  active_rules: 39,
  inactive_rules: 5,
  plan_eligible_active_rules: 4,
  blocked_active_rules: 35,
  runtime_write_enabled_rules: 0,
  referenced_actions: 98,
  referenced_field_update_actions: 37,
  unique_referenced_field_update_actions: 25,
  captured_field_update_definitions: 60,
  missing_referenced_field_update_definitions: 1,
  eligible_condition_count: 4,
  eligible_field_mutation_count: 4,
  eligible_function_adapter_count: 1,
  blocked_active_reason_counts: Object.freeze({
    CRITERIA_COMPARATOR_UNSUPPORTED: 2,
    CRITERIA_FIELD_UNRESOLVED: 1,
    CRITERIA_VALUE_UNSUPPORTED: 6,
    FIELD_UPDATE_DEFINITION_MISSING: 1,
    FUNCTION_ADAPTER_UNAVAILABLE: 20,
    FUNCTION_PARAMETER_BINDING_UNVERIFIED: 1,
    IDENTITY_ACTION_UNSUPPORTED: 2,
    IDENTITY_CRITERIA_UNSUPPORTED: 7,
    IDENTITY_FIELD_UPDATE_UNSUPPORTED: 2,
    OUTBOUND_ACTION_UNSUPPORTED: 6,
    RECORD_CREATION_ACTION_UNSUPPORTED: 1,
    RELATIONAL_CRITERIA_UNSUPPORTED: 6,
    TRIGGER_TYPE_UNSUPPORTED: 8,
  }),
});
const EXPECTED_REVIEWED_FUNCTION_ADAPTER_COUNT = 2;

const EXPECTED_ELIGIBLE_RULES = Object.freeze({
  '1032257000022813289': Object.freeze({
    name: 'Set Last Services Date',
    module: 'Contacts',
    trigger: Object.freeze({
      type: 'field_update',
      module: 'Contacts',
      repeat: true,
      match_all: false,
      watched_fields: Object.freeze(['First_Service_Date']),
      criteria: Object.freeze({ kind: 'criterion', field: 'First_Service_Date', operator: 'changed' }),
    }),
    conditions: Object.freeze([Object.freeze({
      sequence: 1,
      criteria: Object.freeze({ kind: 'match_all' }),
      field_update_plan: Object.freeze([
        Object.freeze({
          action_id: '1032257000022813285',
          action_name: 'Set Last Services Date',
          operation: 'set_field',
          field: 'Last_Service_Date',
          value: Object.freeze({ kind: 'record_field', field: 'First_Service_Date' }),
        }),
        Object.freeze({
          action_id: '1032257000022813287',
          action_name: 'Set Next Services Date',
          operation: 'set_field',
          field: 'Next_Service_Date',
          value: Object.freeze({ kind: 'record_field', field: 'First_Service_Date' }),
        }),
      ]),
      function_adapter_plan: Object.freeze([]),
    })]),
  }),
  '1032257000004081038': Object.freeze({
    name: 'set lead qualified date',
    module: 'Contacts',
    trigger: Object.freeze({
      type: 'create',
      module: 'Contacts',
      repeat: null,
      match_all: null,
      watched_fields: Object.freeze([]),
      criteria: Object.freeze({ kind: 'match_all' }),
    }),
    conditions: Object.freeze([Object.freeze({
      sequence: 1,
      criteria: Object.freeze({ kind: 'match_all' }),
      field_update_plan: Object.freeze([Object.freeze({
        action_id: '1032257000004081032',
        action_name: 'set lead qualified date',
        operation: 'set_field',
        field: 'Lead_Qualified_Date1',
        value: Object.freeze({ kind: 'execution_date', offset_days: 0 }),
      })]),
      function_adapter_plan: Object.freeze([]),
    })]),
  }),
  '1032257000016568154': Object.freeze({
    name: 'Update Expected Closing Date Change Counter',
    module: 'Contacts',
    trigger: Object.freeze({
      type: 'field_update',
      module: 'Contacts',
      repeat: true,
      match_all: false,
      watched_fields: Object.freeze(['Est_Closoure_Date']),
      criteria: Object.freeze({ kind: 'criterion', field: 'Est_Closoure_Date', operator: 'changed' }),
    }),
    conditions: Object.freeze([Object.freeze({
      sequence: 1,
      criteria: Object.freeze({ kind: 'match_all' }),
      field_update_plan: Object.freeze([]),
      function_adapter_plan: Object.freeze([Object.freeze({
        action_id: '1032257000016568150',
        action_name: 'Update Expected Closing Date Change Counter',
        adapter: 'increment_integer_field_v1',
        operation: 'increment_field',
        field: 'Expected_Closing_Date_Change_Counter',
        default_value: 0,
        increment: 1,
        minimum_current: 0,
        maximum_current: 999999998,
      })]),
    })]),
  }),
  '1032257000013277102': Object.freeze({
    name: 'updateFormFilledDate',
    module: 'Deals',
    trigger: Object.freeze({
      type: 'field_update',
      module: 'Deals',
      repeat: false,
      match_all: false,
      watched_fields: Object.freeze(['Stage']),
      criteria: Object.freeze({ kind: 'criterion', field: 'Stage', operator: 'equal', value: 'Form Filled' }),
    }),
    conditions: Object.freeze([Object.freeze({
      sequence: 1,
      criteria: Object.freeze({ kind: 'match_all' }),
      field_update_plan: Object.freeze([Object.freeze({
        action_id: '1032257000013277097',
        action_name: 'Update',
        operation: 'set_field',
        field: 'Form_Filled_Date_Time',
        value: Object.freeze({ kind: 'execution_datetime', offset_days: 0 }),
      })]),
      function_adapter_plan: Object.freeze([]),
    })]),
  }),
});

const EXPECTED_RULE_IDENTITIES = Object.freeze({
  '1032257000003489158': Object.freeze({ name: 'Automatic Lead Creation', module: 'Calls', source_active: true, plan_status: 'Blocked' }),
  '1032257000015737666': Object.freeze({ name: 'Call Durations Update In Mint', module: 'Calls', source_active: true, plan_status: 'Blocked' }),
  '1032257000005147032': Object.freeze({ name: 'create ticket in services management', module: 'Calls', source_active: true, plan_status: 'Blocked' }),
  '1032257000023616255': Object.freeze({ name: 'Add Sunrooof files in the workdrive folder', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000015737607': Object.freeze({ name: 'Copy of Create And Update Order', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000010080047': Object.freeze({ name: 'Create Account', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000005804262': Object.freeze({ name: 'Create Note In Opportunity', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000007791110': Object.freeze({ name: 'fetch old  note', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000021616723': Object.freeze({ name: 'Is Sunrooof', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000003501079': Object.freeze({ name: 'PSM assign', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000022813289': Object.freeze({ name: 'Set Last Services Date', module: 'Contacts', source_active: true, plan_status: 'Eligible' }),
  '1032257000004081038': Object.freeze({ name: 'set lead qualified date', module: 'Contacts', source_active: true, plan_status: 'Eligible' }),
  '1032257000006063250': Object.freeze({ name: 'Set Owner Team on Creation - opp', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000004871161': Object.freeze({ name: 'Set PSM User', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000006063320': Object.freeze({ name: 'Set Team on Owner Change - opp', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000018629177': Object.freeze({ name: 'Sync Attachment', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000022923018': Object.freeze({ name: 'test_opp', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000025276002': Object.freeze({ name: 'Transfer the Qualified Lead', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000010080063': Object.freeze({ name: 'Update Accounts', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000016568154': Object.freeze({ name: 'Update Expected Closing Date Change Counter', module: 'Contacts', source_active: true, plan_status: 'Eligible' }),
  '1032257000005832133': Object.freeze({ name: 'Update Note In Opportunity', module: 'Contacts', source_active: true, plan_status: 'Blocked' }),
  '1032257000000118001': Object.freeze({ name: 'Big Deal Rule', module: 'Deals', source_active: false, plan_status: 'Blocked' }),
  '1032257000011594112': Object.freeze({ name: 'Sync Order Value with Opp', module: 'Deals', source_active: true, plan_status: 'Blocked' }),
  '1032257000022769112': Object.freeze({ name: 'Update Total Revision', module: 'Deals', source_active: false, plan_status: 'Blocked' }),
  '1032257000010762211': Object.freeze({ name: 'UpdateDesignerName', module: 'Deals', source_active: true, plan_status: 'Blocked' }),
  '1032257000013277102': Object.freeze({ name: 'updateFormFilledDate', module: 'Deals', source_active: true, plan_status: 'Eligible' }),
  '1032257000007264083': Object.freeze({ name: 'Notify When opened', module: 'Emails', source_active: true, plan_status: 'Blocked' }),
  '1032257000015032363': Object.freeze({ name: 'Add Lead Transfer Info', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000005804209': Object.freeze({ name: 'Create Note From Description', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000015737646': Object.freeze({ name: 'Creation Add Country Code And Remove Duplicate Lead', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000004875686': Object.freeze({ name: 'Lead Distribution - Adglobal', module: 'Leads', source_active: false, plan_status: 'Blocked' }),
  '1032257000001097014': Object.freeze({ name: 'Lead Distribution Rule', module: 'Leads', source_active: false, plan_status: 'Blocked' }),
  '1032257000015737626': Object.freeze({ name: 'Modify Add Country Code And Remove Duplicate Lead', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000022388187': Object.freeze({ name: 'New Lead Distribution Rule', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000022638142': Object.freeze({ name: 'new_lead_msgtest', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000005687575': Object.freeze({ name: 'Priya AI - Edit Lead Sync', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000007886187': Object.freeze({ name: 'Priya AI - New Lead Sync', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000004081019': Object.freeze({ name: 'set lead creation time - test', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000006063025': Object.freeze({ name: 'Set Lead Owner Team on Creation', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000006063095': Object.freeze({ name: 'Set Team On Owner Change', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000022662026': Object.freeze({ name: 'test', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000005832094': Object.freeze({ name: 'Update Last Note In Lead', module: 'Leads', source_active: true, plan_status: 'Blocked' }),
  '1032257000007949001': Object.freeze({ name: 'Task Creation on Follow Up Date', module: 'Tasks', source_active: false, plan_status: 'Blocked' }),
  '1032257000023782470': Object.freeze({ name: 'Mark Visit Done', module: 'Visit_Module', source_active: true, plan_status: 'Blocked' }),
});

const EXPECTED_BLOCK_MESSAGES = Object.freeze({
  CRITERIA_COMPARATOR_UNSUPPORTED: 'The source criterion comparator is unsupported.',
  CRITERIA_FIELD_UNRESOLVED: 'The source criterion field is missing or invalid.',
  CRITERIA_VALUE_UNSUPPORTED: 'The source criterion value is dynamic, identity-shaped, or otherwise unsupported.',
  FIELD_UPDATE_DEFINITION_MISSING: 'The referenced field-update definition was not captured.',
  FUNCTION_ADAPTER_UNAVAILABLE: 'No reviewed, deterministic local adapter is registered for the source function.',
  FUNCTION_PARAMETER_BINDING_UNVERIFIED: 'The captured workflow action does not expose authoritative function parameter-to-field bindings.',
  IDENTITY_ACTION_UNSUPPORTED: 'The action depends on unresolved source identities.',
  IDENTITY_CRITERIA_UNSUPPORTED: 'The source criterion depends on an unresolved user, owner, role, or profile identity.',
  IDENTITY_FIELD_UPDATE_UNSUPPORTED: 'The field update targets an unresolved identity field.',
  OUTBOUND_ACTION_UNSUPPORTED: 'Outbound delivery is disabled and has no local phase-1 adapter.',
  RECORD_CREATION_ACTION_UNSUPPORTED: 'Record-creation actions are outside the phase-1 field-mutation planner.',
  RELATIONAL_CRITERIA_UNSUPPORTED: 'Relational workflow criteria are unsupported.',
  RULE_INACTIVE: 'The source workflow rule is inactive.',
  TRIGGER_TYPE_UNSUPPORTED: 'The workflow trigger type is unsupported.',
});

const TOP_LEVEL_KEYS = Object.freeze([
  'schema_version',
  'generated_at',
  'source_snapshot_at',
  'evidence',
  'coverage',
  'runtime_boundary',
  'rules',
]);

const BLOCKED_RULE_KEYS = Object.freeze([
  'id',
  'name',
  'module',
  'source_active',
  'plan_status',
  'write_execution',
  'block_reasons',
]);

const ELIGIBLE_RULE_KEYS = Object.freeze([
  'id',
  'name',
  'module',
  'source_active',
  'plan_status',
  'write_execution',
  'trigger',
  'conditions',
  'idempotency',
  'recursion',
]);

const FORBIDDEN_OUTPUT_KEYS = new Set([
  'authorization',
  'body',
  'code_body',
  'credential',
  'credentials',
  'endpoint',
  'headers',
  'local_path',
  'password',
  'private_path',
  'record_data',
  'records',
  'secret',
  'secrets',
  'source_code',
  'target_url',
  'token',
  'tokens',
  'url',
]);

const FORBIDDEN_OUTPUT_VALUES = Object.freeze([
  /https?:\/\//i,
  /\bwww\./i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
  /\.private\//i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Z0-9_-]{16,}\b/i,
  /\beyJ[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}\b/i,
  /\b[A-F0-9]{32,128}\b/i,
  /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i,
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an unsupported or missing property.`);
  }
}

function requiredString(value, label, maxLength = 600) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function requiredIsoTimestamp(value, label) {
  const text = requiredString(value, label, 80);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${label} must be an ISO UTC timestamp.`);
  }
  return text;
}

function requiredRuleId(value, label) {
  const id = requiredString(value, label, 24);
  if (!/^\d{19}$/.test(id)) throw new Error(`${label} must be a captured workflow rule ID.`);
  return id;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactCopy(value, expected, label) {
  if (canonical(value) !== canonical(expected)) throw new Error(`${label} drifted from the reconciled workflow definition.`);
  return JSON.parse(JSON.stringify(value));
}

function assertNoSensitiveData(value, path = 'catalog') {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoSensitiveData(child, `${path}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, child]) => {
      if (FORBIDDEN_OUTPUT_KEYS.has(key.toLowerCase())) {
        throw new Error(`${path} contains a forbidden sensitive property.`);
      }
      assertNoSensitiveData(child, `${path}.${key}`);
    });
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_OUTPUT_VALUES.some(pattern => pattern.test(value))) {
    throw new Error(`${path} contains a forbidden sensitive value.`);
  }
}

function assertRuntimeBoundary(boundary) {
  assertExactKeys(boundary, [
    'phase',
    'source_calls_enabled',
    'source_writes_enabled',
    'local_writes_enabled',
    'outbound_delivery_enabled',
    'identity_resolution_enabled',
    'destructive_actions_enabled',
    'scheduled_actions_enabled',
    'function_adapters_registered',
    'whole_rule_decision',
  ], 'runtime_boundary');
  for (const key of [
    'source_calls_enabled',
    'source_writes_enabled',
    'local_writes_enabled',
    'outbound_delivery_enabled',
    'identity_resolution_enabled',
    'destructive_actions_enabled',
    'scheduled_actions_enabled',
  ]) {
    if (boundary[key] !== false) throw new Error(`runtime_boundary.${key} must remain false.`);
  }
  if (boundary.function_adapters_registered !== 2) throw new Error('The exact reviewed Workflow function-adapter count must remain two.');
  requiredString(boundary.phase, 'runtime_boundary.phase', 240);
  requiredString(boundary.whole_rule_decision, 'runtime_boundary.whole_rule_decision', 240);
}

function assertEvidence(evidence) {
  assertExactKeys(evidence, [
    'mode',
    'source_contacted',
    'source_writes',
    'local_metadata_read',
    'local_database_writes',
    'input_endpoint_scope',
  ], 'evidence');
  if (evidence.source_contacted !== false || evidence.source_writes !== false || evidence.local_database_writes !== false) {
    throw new Error('Workflow Studio input must remain offline and write-free.');
  }
  if (evidence.local_metadata_read !== true) throw new Error('Workflow Studio input must be captured local metadata.');
  requiredString(evidence.mode, 'evidence.mode', 240);
  const scope = requiredString(evidence.input_endpoint_scope, 'evidence.input_endpoint_scope', 160);
  if (!/^Local \/api\/meta\/automation snapshot\.$/.test(scope)) {
    throw new Error('Workflow Studio input endpoint scope is not the approved local snapshot.');
  }
}

function assertCoverage(coverage) {
  assertExactKeys(coverage, Object.keys(EXPECTED_COVERAGE), 'coverage');
  for (const [key, expected] of Object.entries(EXPECTED_COVERAGE)) {
    if (key === 'blocked_active_reason_counts') {
      if (canonical(coverage[key]) !== canonical(expected)) {
        throw new Error('coverage.blocked_active_reason_counts does not reconcile.');
      }
      continue;
    }
    if (coverage[key] !== expected) throw new Error(`coverage.${key} does not reconcile.`);
  }
}

function copyBlockReasons(value, label, { inactive }) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw new Error(`${label} must contain bounded block reasons.`);
  }
  const reasons = value.map((reason, index) => {
    assertExactKeys(reason, ['code', 'message'], `${label}[${index}]`);
    const code = requiredString(reason.code, `${label}[${index}].code`, 80);
    const message = requiredString(reason.message, `${label}[${index}].message`, 400);
    if (EXPECTED_BLOCK_MESSAGES[code] !== message) throw new Error(`${label}[${index}] drifted from the reconciled block reason.`);
    return { code, message };
  });
  const inactiveCodes = reasons.filter(reason => reason.code === 'RULE_INACTIVE').length;
  if (inactive ? inactiveCodes !== 1 || reasons.length !== 1 : inactiveCodes !== 0) {
    throw new Error(`${label} does not match the source-active state.`);
  }
  return reasons;
}

function flattenMutations(conditions) {
  return conditions.flatMap(condition => condition.field_update_plan.map((mutation, index) => ({
    condition_sequence: condition.sequence,
    order: index + 1,
    action_id: mutation.action_id,
    action_name: mutation.action_name,
    operation: mutation.operation,
    field: mutation.field,
    value: JSON.parse(JSON.stringify(mutation.value)),
  })));
}

function flattenFunctionAdapters(conditions) {
  return conditions.flatMap(condition => condition.function_adapter_plan.map((adapter, index) => ({
    condition_sequence: condition.sequence,
    order: index + 1,
    ...JSON.parse(JSON.stringify(adapter)),
  })));
}

function copyEligibleRule(rule, index) {
  assertExactKeys(rule, ELIGIBLE_RULE_KEYS, `rules[${index}]`);
  const id = requiredRuleId(rule.id, `rules[${index}].id`);
  const expected = EXPECTED_ELIGIBLE_RULES[id];
  const identity = EXPECTED_RULE_IDENTITIES[id];
  if (!expected) throw new Error(`rules[${index}] is not an approved plan-eligible workflow rule.`);
  if (!identity || canonical({ name: rule.name, module: rule.module, source_active: rule.source_active, plan_status: rule.plan_status }) !== canonical(identity)
    || rule.name !== expected.name || rule.module !== expected.module) {
    throw new Error(`rules[${index}] identity drifted from the reconciled workflow definition.`);
  }
  if (rule.source_active !== true || rule.plan_status !== 'Eligible' || rule.write_execution !== 'Blocked') {
    throw new Error(`rules[${index}] violates the eligible plan-only boundary.`);
  }
  const trigger = exactCopy(rule.trigger, expected.trigger, `rules[${index}].trigger`);
  const conditions = exactCopy(rule.conditions, expected.conditions, `rules[${index}].conditions`);
  assertExactKeys(rule.idempotency, [
    'event_id_required',
    'record_id_required',
    'key_components',
    'persistence_requirement',
  ], `rules[${index}].idempotency`);
  if (rule.idempotency.event_id_required !== true || rule.idempotency.record_id_required !== true
    || canonical(rule.idempotency.key_components) !== canonical(['rule_id', 'record_id', 'event_id'])) {
    throw new Error(`rules[${index}].idempotency is incomplete.`);
  }
  requiredString(rule.idempotency.persistence_requirement, `rules[${index}].idempotency.persistence_requirement`, 320);
  assertExactKeys(rule.recursion, [
    'workflow_origin_decision',
    'maximum_planning_depth',
    'same_rule_same_event_decision',
    'cross_rule_chaining',
  ], `rules[${index}].recursion`);
  if (rule.recursion.workflow_origin_decision !== 'Deny'
    || rule.recursion.maximum_planning_depth !== 0
    || rule.recursion.same_rule_same_event_decision !== 'Deny'
    || !/^Blocked\b/.test(requiredString(rule.recursion.cross_rule_chaining, `rules[${index}].recursion.cross_rule_chaining`, 320))) {
    throw new Error(`rules[${index}].recursion does not fail closed.`);
  }
  return {
    id,
    name: expected.name,
    module: expected.module,
    source_active: true,
    plan_status: 'Eligible',
    write_execution: 'Blocked',
    studio_status: 'Eligible plan only',
    definition_available: true,
    trigger,
    conditions,
    planned_field_mutations: flattenMutations(conditions),
    planned_function_adapters: flattenFunctionAdapters(conditions),
    block_reasons: [],
    execution: {
      status: 'Blocked',
      enabled: false,
      source_calls: false,
      source_writes: false,
      local_writes: false,
      outbound_delivery: false,
    },
  };
}

function copyBlockedRule(rule, index) {
  assertExactKeys(rule, BLOCKED_RULE_KEYS, `rules[${index}]`);
  const id = requiredRuleId(rule.id, `rules[${index}].id`);
  const name = requiredString(rule.name, `rules[${index}].name`, 240);
  const module = requiredString(rule.module, `rules[${index}].module`, 160);
  const identity = EXPECTED_RULE_IDENTITIES[id];
  if (!identity || canonical({ name, module, source_active: rule.source_active, plan_status: rule.plan_status }) !== canonical(identity)) {
    throw new Error(`rules[${index}] identity drifted from the reconciled workflow definition.`);
  }
  if (rule.plan_status !== 'Blocked' || rule.write_execution !== 'Blocked' || typeof rule.source_active !== 'boolean') {
    throw new Error(`rules[${index}] violates the blocked execution boundary.`);
  }
  const inactive = rule.source_active === false;
  const blockReasons = copyBlockReasons(rule.block_reasons, `rules[${index}].block_reasons`, { inactive });
  return {
    id,
    name,
    module,
    source_active: !inactive,
    plan_status: 'Blocked',
    write_execution: 'Blocked',
    studio_status: inactive ? 'Inactive' : 'Blocked active',
    definition_available: false,
    trigger: null,
    conditions: [],
    planned_field_mutations: [],
    planned_function_adapters: [],
    block_reasons: blockReasons,
    execution: {
      status: 'Blocked',
      enabled: false,
      source_calls: false,
      source_writes: false,
      local_writes: false,
      outbound_delivery: false,
    },
  };
}

function increment(map, key, by = 1) {
  map[key] = (map[key] || 0) + by;
}

function moduleAggregates(rules) {
  const modules = new Map();
  for (const rule of rules) {
    if (!modules.has(rule.module)) {
      modules.set(rule.module, {
        module: rule.module,
        total_rules: 0,
        active_rules: 0,
        inactive_rules: 0,
        eligible_plan_only: 0,
        blocked_active: 0,
      });
    }
    const aggregate = modules.get(rule.module);
    aggregate.total_rules += 1;
    if (rule.source_active) aggregate.active_rules += 1;
    else aggregate.inactive_rules += 1;
    if (rule.studio_status === 'Eligible plan only') aggregate.eligible_plan_only += 1;
    if (rule.studio_status === 'Blocked active') aggregate.blocked_active += 1;
  }
  return [...modules.values()].sort((a, b) => a.module.localeCompare(b.module));
}

function validateDerivedCoverage(rules) {
  const ids = new Set(rules.map(rule => rule.id));
  const eligible = rules.filter(rule => rule.studio_status === 'Eligible plan only');
  const blockedActive = rules.filter(rule => rule.studio_status === 'Blocked active');
  const inactive = rules.filter(rule => rule.studio_status === 'Inactive');
  if (rules.length !== EXPECTED_COVERAGE.listed_rules || ids.size !== rules.length) {
    throw new Error('Workflow rule IDs do not reconcile to 44 unique source rules.');
  }
  if (rules.filter(rule => rule.source_active).length !== EXPECTED_COVERAGE.active_rules
    || inactive.length !== EXPECTED_COVERAGE.inactive_rules
    || eligible.length !== EXPECTED_COVERAGE.plan_eligible_active_rules
    || blockedActive.length !== EXPECTED_COVERAGE.blocked_active_rules) {
    throw new Error('Derived Workflow Studio status counts do not reconcile.');
  }
  const eligibleIds = new Set(eligible.map(rule => rule.id));
  if (Object.keys(EXPECTED_ELIGIBLE_RULES).some(id => !eligibleIds.has(id))) {
    throw new Error('The exact four plan-eligible workflow rules are not present.');
  }
  const conditionCount = eligible.reduce((total, rule) => total + rule.conditions.length, 0);
  const mutationCount = eligible.reduce((total, rule) => total + rule.planned_field_mutations.length, 0);
  const adapterCount = eligible.reduce((total, rule) => total + rule.planned_function_adapters.length, 0);
  if (conditionCount !== EXPECTED_COVERAGE.eligible_condition_count
    || mutationCount !== EXPECTED_COVERAGE.eligible_field_mutation_count
    || adapterCount !== EXPECTED_COVERAGE.eligible_function_adapter_count) {
    throw new Error('Eligible workflow plan coverage does not reconcile.');
  }
  const reasonCounts = {};
  blockedActive.flatMap(rule => rule.block_reasons).forEach(reason => increment(reasonCounts, reason.code));
  if (canonical(reasonCounts) !== canonical(EXPECTED_COVERAGE.blocked_active_reason_counts)) {
    throw new Error('Derived active block-reason counts do not reconcile.');
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function buildWorkflowStudioCatalog(rawRuntime) {
  assertExactKeys(rawRuntime, TOP_LEVEL_KEYS, 'workflow runtime');
  if (rawRuntime.schema_version !== 1) throw new Error('Workflow runtime schema version is unsupported.');
  assertEvidence(rawRuntime.evidence);
  assertCoverage(rawRuntime.coverage);
  assertRuntimeBoundary(rawRuntime.runtime_boundary);
  const generatedAt = requiredIsoTimestamp(rawRuntime.generated_at, 'generated_at');
  const sourceSnapshotAt = requiredIsoTimestamp(rawRuntime.source_snapshot_at, 'source_snapshot_at');
  if (!Array.isArray(rawRuntime.rules) || rawRuntime.rules.length !== EXPECTED_COVERAGE.listed_rules) {
    throw new Error('Workflow runtime must contain exactly 44 rules.');
  }
  const rules = rawRuntime.rules.map((rule, index) => rule?.plan_status === 'Eligible'
    ? copyEligibleRule(rule, index)
    : copyBlockedRule(rule, index));
  validateDerivedCoverage(rules);

  const eligible = rules.filter(rule => rule.studio_status === 'Eligible plan only');
  const blockedActive = rules.filter(rule => rule.studio_status === 'Blocked active');
  const inactive = rules.filter(rule => rule.studio_status === 'Inactive');
  const inactiveReasonCounts = {};
  inactive.flatMap(rule => rule.block_reasons).forEach(reason => increment(inactiveReasonCounts, reason.code));
  const triggerTypes = {};
  eligible.forEach(rule => increment(triggerTypes, rule.trigger.type));

  const output = {
    schema_version: 1,
    generated_at: generatedAt,
    source_snapshot_at: sourceSnapshotAt,
    source_mode: 'captured-local-metadata',
    studio_mode: 'catalog-only',
    aggregates: {
      total_rules: rules.length,
      detailed_rules: EXPECTED_COVERAGE.detailed_rules,
      active_rules: rules.length - inactive.length,
      inactive_rules: inactive.length,
      eligible_plan_only_rules: eligible.length,
      blocked_active_rules: blockedActive.length,
      runtime_write_enabled_rules: 0,
      eligible_conditions: eligible.reduce((total, rule) => total + rule.conditions.length, 0),
      planned_field_mutations: eligible.reduce((total, rule) => total + rule.planned_field_mutations.length, 0),
      function_adapters: eligible.reduce((total, rule) => total + rule.planned_function_adapters.length, 0),
      trigger_types_for_eligible_rules: Object.fromEntries(Object.entries(triggerTypes).sort(([a], [b]) => a.localeCompare(b))),
      blocked_active_reason_counts: { ...EXPECTED_COVERAGE.blocked_active_reason_counts },
      inactive_reason_counts: Object.fromEntries(Object.entries(inactiveReasonCounts).sort(([a], [b]) => a.localeCompare(b))),
      referenced_actions: {
        total: EXPECTED_COVERAGE.referenced_actions,
        field_update_references: EXPECTED_COVERAGE.referenced_field_update_actions,
        unique_field_update_references: EXPECTED_COVERAGE.unique_referenced_field_update_actions,
        captured_field_update_definitions: EXPECTED_COVERAGE.captured_field_update_definitions,
        missing_field_update_definitions: EXPECTED_COVERAGE.missing_referenced_field_update_definitions,
      },
      modules: moduleAggregates(rules),
    },
    execution_boundary: {
      status: 'Blocked',
      catalog_only: true,
      source_calls_enabled: false,
      source_writes_enabled: false,
      local_writes_enabled: false,
      outbound_delivery_enabled: false,
      identity_resolution_enabled: false,
      destructive_actions_enabled: false,
      scheduled_actions_enabled: false,
      function_adapters_registered: EXPECTED_REVIEWED_FUNCTION_ADAPTER_COUNT,
      whole_rule_decision: 'Fail closed when any rule definition, count, or execution boundary does not reconcile.',
    },
    privacy: {
      crm_records_included: false,
      credentials_included: false,
      private_paths_included: false,
      external_targets_included: false,
      source_code_included: false,
    },
    rules,
  };
  assertNoSensitiveData(output);
  return deepFreeze(output);
}

module.exports = {
  buildWorkflowStudioCatalog,
};
