'use strict';

const crypto = require('node:crypto');

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_$]*$/;
const IDENTITY_FIELDS = new Set([
  'Owner', 'Created_By', 'Modified_By', 'Sales_Manager', 'Current_Owner',
  'Assigned_To', 'User', 'Users', 'Role', 'Roles', 'Profile', 'Profiles',
]);
const OUTBOUND_ACTION_TYPES = new Set([
  'email_notifications', 'webhooks', 'cliq_notifications', 'sms_notifications',
  'notifications', 'signals',
]);
const RECORD_CREATION_ACTION_TYPES = new Set(['tasks', 'meetings', 'calls', 'records']);
const IDENTITY_ACTION_TYPES = new Set(['assign_owner', 'assign_user', 'assign_role']);
const ALLOWED_TRIGGER_TYPES = new Set(['create', 'field_update']);
const MAX_PLAN_SNAPSHOT_DEPTH = 12;
const MAX_PLAN_SNAPSHOT_PROPERTIES = 10_000;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Reflect.ownKeys(value).forEach(key => deepFreeze(value[key]));
  return value;
}

function snapshotPlanData(value, code, message, state = { seen: new Set(), properties: 0 }, depth = 0) {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value !== 'object' || depth > MAX_PLAN_SNAPSHOT_DEPTH || state.seen.has(value)) {
    throw new WorkflowRuntimeError(code, message);
  }
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new WorkflowRuntimeError(code, message);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string')) throw new WorkflowRuntimeError(code, message);
  state.properties += keys.length;
  if (state.properties > MAX_PLAN_SNAPSHOT_PROPERTIES) throw new WorkflowRuntimeError(code, message);
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) throw new WorkflowRuntimeError(code, message);
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !hasOwn(lengthDescriptor, 'value') || lengthDescriptor.enumerable !== false
        || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
        || keys.length !== lengthDescriptor.value + 1) {
        throw new WorkflowRuntimeError(code, message);
      }
      const output = new Array(lengthDescriptor.value);
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
          throw new WorkflowRuntimeError(code, message);
        }
        output[index] = snapshotPlanData(descriptor.value, code, message, state, depth + 1);
      }
      return Object.freeze(output);
    }
    if (prototype !== Object.prototype && prototype !== null) throw new WorkflowRuntimeError(code, message);
    const output = Object.create(prototype === null ? null : Object.prototype);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
        throw new WorkflowRuntimeError(code, message);
      }
      Object.defineProperty(output, key, {
        configurable: false,
        enumerable: true,
        value: snapshotPlanData(descriptor.value, code, message, state, depth + 1),
        writable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    state.seen.delete(value);
  }
}

const REVIEWED_FUNCTION_ADAPTERS = new Map([
  ['1032257000016568150', deepFreeze({
    rule_id: '1032257000016568154',
    rule_name: 'Update Expected Closing Date Change Counter',
    module: 'Contacts',
    action_name: 'Update Expected Closing Date Change Counter',
    adapter: 'increment_integer_field_v1',
    operation: 'increment_field',
    field: 'Expected_Closing_Date_Change_Counter',
    default_value: 0,
    increment: 1,
    minimum_current: 0,
    maximum_current: 999999998,
  })],
  ['1032257000023782468', deepFreeze({
    rule_id: '1032257000023782470',
    rule_name: 'Mark Visit Done',
    module: 'Visit_Module',
    action_name: 'Mark Done Visit',
    adapter: 'compare_counts_set_picklist_v1',
    operation: 'conditional_set_field',
    record_count_field: 'Total_Recoads',
    team_count_field: 'Assigned_Team_Member_Count',
    field: 'AMS_Status',
    value: 'Done',
    minimum_count: 0,
    maximum_count: 999999999,
    source_contract_fingerprinted: true,
    parameter_alias_reviewed: true,
    parameter_binding_verified: false,
    rule_contract: {
      deprecated: false,
      execute_when: {
        type: 'field_update',
        details: {
          repeat: true,
          criteria: {
            field: { id: '1032257000023782444', api_name: 'Total_Recoads' },
            value: '${ANYVALUE}',
            comparator: '${ANYVALUE}',
          },
          match_all: false,
          trigger_module: { id: '1032257000022292379', api_name: 'Visit_Module' },
        },
      },
      conditions: [{
        id: '1032257000023782471',
        instant_actions: {
          actions: [{ id: '1032257000023782468', name: 'Mark Done Visit', type: 'functions' }],
        },
        sequence_number: 1,
        criteria_details: {
          criteria: null,
          relational_criteria: { module: null, criteria: null, module_selection: null },
        },
        scheduled_actions: null,
      }],
    },
    function_contract: {
      id: '1032257000023782453',
      name: 'Mark Done Visit',
      api_name: 'markdonevisit',
      category: 'Automation',
      language: 'Deluge',
      runtime: 'Deluge 1.0',
      state: 'active',
      return_type: 'void',
      rest_api_mode: ['None'],
      has_draft: false,
      source: 'crm',
      arguments: [
        { name: 'Id', type: 'int' },
        { name: 'recoadcount', type: 'Float' },
        { name: 'teamCount', type: 'int' },
      ],
    },
    captured_source_contract: {
      sha256: 'dbfddafee3f0200f9feefcd49ce17723c17e2a0a10d92f7ae24112334425a854',
      byte_length: 180,
      parameters: [
        { name: 'Id', type: 'int' },
        { name: 'recoad_count', type: 'Float' },
        { name: 'teamCount', type: 'int' },
      ],
    },
  })],
]);

class WorkflowRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkflowRuntimeError';
    this.code = code;
    this.status = 422;
    this.details = details;
  }
}

const array = value => Array.isArray(value) ? value : [];
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sourceId = value => value === null || value === undefined ? null : String(value);
const safeScalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);

function scalar(value) {
  if (!isObject(value)) return value;
  return value.actual_value ?? value.display_value ?? value.name ?? value.id ?? value;
}

function valuesEqual(left, right) {
  const a = scalar(left);
  const b = scalar(right);
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  return String(a) === String(b);
}

function fieldChanged(field, before, after) {
  const beforeValue = before?.[field];
  const afterValue = after?.[field];
  if (isObject(beforeValue) || isObject(afterValue)) {
    return !valuesEqual(beforeValue, afterValue);
  }
  return JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
}

function criteriaChildren(node) {
  if (Array.isArray(node?.group)) return node.group;
  if (Array.isArray(node?.criteria)) return node.criteria;
  if (isObject(node?.group)) return [node.group];
  return [];
}

function criteriaFailure(code, message) {
  return { ok: false, code, message };
}

function normalizeCriteria(node) {
  if (node === null || node === undefined) return { ok: true, expression: { kind: 'match_all' }, fields: [] };
  if (!isObject(node)) return criteriaFailure('CRITERIA_SHAPE_UNSUPPORTED', 'The source criterion is not an object.');

  if (node.group_operator || Array.isArray(node.group) || Array.isArray(node.criteria)) {
    const operator = String(node.group_operator || '').toUpperCase();
    if (!['AND', 'OR'].includes(operator)) {
      return criteriaFailure('CRITERIA_GROUP_OPERATOR_UNSUPPORTED', 'The source criterion group operator is unsupported.');
    }
    const children = criteriaChildren(node);
    if (!children.length) return criteriaFailure('CRITERIA_GROUP_EMPTY', 'The source criterion group has no children.');
    const normalized = children.map(normalizeCriteria);
    const failed = normalized.find(item => !item.ok);
    if (failed) return failed;
    return {
      ok: true,
      expression: { kind: operator === 'AND' ? 'all' : 'any', criteria: normalized.map(item => item.expression) },
      fields: [...new Set(normalized.flatMap(item => item.fields))],
    };
  }

  const field = node.field?.api_name;
  if (typeof field !== 'string' || !IDENTIFIER.test(field)) {
    return criteriaFailure('CRITERIA_FIELD_UNRESOLVED', 'The source criterion field is missing or invalid.');
  }
  if (IDENTITY_FIELDS.has(field)) {
    return criteriaFailure('IDENTITY_CRITERIA_UNSUPPORTED', 'The source criterion depends on an unresolved user, owner, role, or profile identity.');
  }

  const comparator = String(node.comparator || '');
  if (comparator === '${ANYVALUE}' && node.value === '${ANYVALUE}') {
    return { ok: true, expression: { kind: 'criterion', field, operator: 'changed' }, fields: [field] };
  }
  if (!['equal', 'not_equal'].includes(comparator)) {
    return criteriaFailure('CRITERIA_COMPARATOR_UNSUPPORTED', 'The source criterion comparator is unsupported.');
  }
  if (!safeScalar(node.value) || node.value === null || (typeof node.value === 'string' && node.value.startsWith('${'))) {
    return criteriaFailure('CRITERIA_VALUE_UNSUPPORTED', 'The source criterion value is dynamic, identity-shaped, or otherwise unsupported.');
  }
  return {
    ok: true,
    expression: { kind: 'criterion', field, operator: comparator, value: node.value },
    fields: [field],
  };
}

function evaluateCriteria(expression, { record = {}, previousRecord = {} } = {}) {
  if (!expression || expression.kind === 'match_all') return true;
  if (expression.kind === 'all') {
    return array(expression.criteria).length > 0
      && expression.criteria.every(criterion => evaluateCriteria(criterion, { record, previousRecord }));
  }
  if (expression.kind === 'any') {
    return array(expression.criteria).some(criterion => evaluateCriteria(criterion, { record, previousRecord }));
  }
  if (expression.kind !== 'criterion' || typeof expression.field !== 'string') return false;
  if (expression.operator === 'changed') return fieldChanged(expression.field, previousRecord, record);
  if (expression.operator === 'equal') return valuesEqual(record?.[expression.field], expression.value);
  if (expression.operator === 'not_equal') return !valuesEqual(record?.[expression.field], expression.value);
  return false;
}

function normalizeFieldUpdate(definition, ruleModule) {
  if (!isObject(definition)) {
    return { ok: false, code: 'FIELD_UPDATE_DEFINITION_MISSING', message: 'The referenced field-update definition was not captured.' };
  }
  const module = definition.module?.api_name;
  if (module !== ruleModule || definition.related_module) {
    return { ok: false, code: 'CROSS_MODULE_FIELD_UPDATE_UNSUPPORTED', message: 'Cross-module and related-record field updates are not supported.' };
  }
  if (definition.associated !== true) {
    return { ok: false, code: 'FIELD_UPDATE_NOT_ASSOCIATED', message: 'The captured field update is not confirmed as associated.' };
  }
  const field = definition.field?.api_name;
  if (typeof field !== 'string' || !IDENTIFIER.test(field)) {
    return { ok: false, code: 'FIELD_UPDATE_TARGET_UNRESOLVED', message: 'The field-update target is missing or invalid.' };
  }
  if (IDENTITY_FIELDS.has(field)) {
    return { ok: false, code: 'IDENTITY_FIELD_UPDATE_UNSUPPORTED', message: 'The field update targets an unresolved identity field.' };
  }
  if (definition.dependent_fields !== null && definition.dependent_fields !== undefined
    && (!Array.isArray(definition.dependent_fields) || definition.dependent_fields.length > 0)) {
    return { ok: false, code: 'DEPENDENT_FIELD_UPDATE_UNSUPPORTED', message: 'Dependent field-update behavior is not supported.' };
  }

  const value = definition.value;
  let valuePlan = null;
  if (definition.type === 'static') {
    const day = typeof value === 'string' && value.match(/^\$\{EXECUTION_DAY\}\+([+-]?\d+)$/);
    const time = typeof value === 'string' && value.match(/^\$\{EXECUTION_TIME\}\+([+-]?\d+)$/);
    if (day && Number(day[1]) === 0) valuePlan = { kind: 'execution_date', offset_days: 0 };
    else if (time && Number(time[1]) === 0) valuePlan = { kind: 'execution_datetime', offset_days: 0 };
    else if (safeScalar(value) && value !== null && !(typeof value === 'string' && value.startsWith('${'))) {
      valuePlan = { kind: 'literal', value };
    } else if (isObject(value) && ('id' in value || 'name' in value)) {
      return { ok: false, code: 'IDENTITY_VALUE_UNSUPPORTED', message: 'The field update contains an unresolved identity or lookup value.' };
    } else {
      return { ok: false, code: 'DYNAMIC_FIELD_UPDATE_UNSUPPORTED', message: 'The field-update expression is unsupported.' };
    }
  } else if (definition.type === 'merge_field') {
    const merge = typeof value === 'string' && value.match(/^\$\{!([A-Za-z][A-Za-z0-9_$]*)\.([A-Za-z][A-Za-z0-9_$]*)\}$/);
    if (!merge || merge[1] !== ruleModule || IDENTITY_FIELDS.has(merge[2])) {
      return { ok: false, code: 'MERGE_FIELD_UPDATE_UNSUPPORTED', message: 'The merge-field expression is cross-module, identity-dependent, or unsupported.' };
    }
    valuePlan = { kind: 'record_field', field: merge[2] };
  } else {
    return { ok: false, code: 'FIELD_UPDATE_TYPE_UNSUPPORTED', message: 'The field-update type is unsupported.' };
  }

  return {
    ok: true,
    plan: {
      action_id: sourceId(definition.id),
      action_name: typeof definition.name === 'string' ? definition.name : '(unnamed field update)',
      operation: 'set_field',
      field,
      value: valuePlan,
    },
  };
}

function exactData(value) {
  if (Array.isArray(value)) return `[${value.map(exactData).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${exactData(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function reviewedRuleProjection(rule) {
  return {
    deprecated: rule?.deprecated === true,
    execute_when: rule?.execute_when,
    conditions: rule?.conditions,
  };
}

function reviewedFunctionProjection(definition) {
  return {
    id: sourceId(definition?.id),
    name: definition?.name,
    api_name: definition?.api_name,
    category: definition?.category,
    language: definition?.language,
    runtime: definition?.runtime,
    state: definition?.state,
    return_type: definition?.return_type,
    rest_api_mode: definition?.rest_api_mode,
    has_draft: definition?.has_draft,
    source: definition?.source,
    arguments: definition?.arguments,
  };
}

function publicFunctionAdapterPlan(reviewed, actionId) {
  const common = {
    action_id: actionId,
    action_name: reviewed.action_name,
    adapter: reviewed.adapter,
    operation: reviewed.operation,
  };
  if (reviewed.adapter === 'increment_integer_field_v1') {
    return {
      ...common,
      field: reviewed.field,
      default_value: reviewed.default_value,
      increment: reviewed.increment,
      minimum_current: reviewed.minimum_current,
      maximum_current: reviewed.maximum_current,
    };
  }
  if (reviewed.adapter === 'compare_counts_set_picklist_v1') {
    return {
      ...common,
      record_count_field: reviewed.record_count_field,
      team_count_field: reviewed.team_count_field,
      field: reviewed.field,
      value: reviewed.value,
      minimum_count: reviewed.minimum_count,
      maximum_count: reviewed.maximum_count,
      source_contract_fingerprinted: reviewed.source_contract_fingerprinted,
      parameter_alias_reviewed: reviewed.parameter_alias_reviewed,
    };
  }
  return null;
}

function normalizeFunctionAdapter(action, rule, functionDefinitionsById = new Map()) {
  const actionId = sourceId(action?.id);
  const reviewed = REVIEWED_FUNCTION_ADAPTERS.get(actionId);
  if (!reviewed) {
    return { ok: false, code: 'FUNCTION_ADAPTER_UNAVAILABLE', message: 'No reviewed, deterministic local adapter is registered for the source function.' };
  }
  if (sourceId(rule?.id) !== reviewed.rule_id || rule?.name !== reviewed.rule_name
      || rule?.module?.api_name !== reviewed.module || action?.name !== reviewed.action_name) {
    return { ok: false, code: 'FUNCTION_ADAPTER_CONTRACT_DRIFT', message: 'The reviewed source-function contract no longer matches the captured workflow action.' };
  }
  if (reviewed.rule_contract && exactData(reviewedRuleProjection(rule)) !== exactData(reviewed.rule_contract)) {
    return { ok: false, code: 'FUNCTION_ADAPTER_CONTRACT_DRIFT', message: 'The reviewed source-function contract no longer matches the captured workflow action.' };
  }
  if (reviewed.function_contract) {
    const definition = functionDefinitionsById.get(reviewed.function_contract.id);
    if (!definition || exactData(reviewedFunctionProjection(definition)) !== exactData(reviewed.function_contract)) {
      return { ok: false, code: 'FUNCTION_DEFINITION_CONTRACT_DRIFT', message: 'The reviewed source-function definition no longer matches its exact captured catalog contract.' };
    }
  }
  if (reviewed.parameter_binding_verified === false) {
    return {
      ok: false,
      code: 'FUNCTION_PARAMETER_BINDING_UNVERIFIED',
      message: 'The captured workflow action does not expose authoritative function parameter-to-field bindings.',
    };
  }
  const plan = publicFunctionAdapterPlan(reviewed, actionId);
  if (!plan) {
    return { ok: false, code: 'FUNCTION_ADAPTER_CONTRACT_DRIFT', message: 'The reviewed source-function contract no longer matches the captured workflow action.' };
  }
  return {
    ok: true,
    plan,
  };
}

function conditionCriteria(condition) {
  const details = condition?.criteria_details;
  const relational = details?.relational_criteria;
  if (relational?.module || relational?.module_selection) {
    return { ok: false, code: 'RELATIONAL_CRITERIA_UNSUPPORTED', message: 'Relational workflow criteria are unsupported.' };
  }
  const node = details?.criteria ?? relational?.criteria ?? null;
  return normalizeCriteria(node);
}

function actionReferences(condition) {
  const instant = array(condition?.instant_actions?.actions);
  const scheduledShapeUnsupported = condition?.scheduled_actions !== null
    && condition?.scheduled_actions !== undefined
    && !Array.isArray(condition.scheduled_actions);
  const scheduledGroups = array(condition?.scheduled_actions);
  const scheduled = scheduledGroups.flatMap(group => array(group?.actions));
  return { instant, scheduled, scheduledShapeUnsupported };
}

function blockedRule(rule, reasons) {
  const uniqueReasons = [...new Map(reasons.map(reason => [reason.code, reason])).values()];
  return {
    id: sourceId(rule.id),
    name: typeof rule.name === 'string' ? rule.name : '(unnamed workflow rule)',
    module: rule.module?.api_name || null,
    source_active: rule.status?.active === true,
    plan_status: 'Blocked',
    write_execution: 'Blocked',
    block_reasons: uniqueReasons,
  };
}

function normalizeTrigger(rule) {
  const executeWhen = rule.execute_when;
  const type = executeWhen?.type;
  if (!ALLOWED_TRIGGER_TYPES.has(type)) {
    return { ok: false, code: 'TRIGGER_TYPE_UNSUPPORTED', message: 'The workflow trigger type is unsupported.' };
  }
  const module = rule.module?.api_name;
  if (!module || executeWhen?.details?.trigger_module?.api_name !== module) {
    return { ok: false, code: 'TRIGGER_MODULE_UNRESOLVED', message: 'The workflow trigger module is missing or does not match the rule module.' };
  }
  const criteria = normalizeCriteria(executeWhen?.details?.criteria ?? null);
  if (!criteria.ok) return criteria;
  if (type === 'field_update' && criteria.expression.kind === 'match_all') {
    return { ok: false, code: 'FIELD_UPDATE_TRIGGER_FIELDS_UNRESOLVED', message: 'The field-update trigger does not identify any watched field.' };
  }
  return {
    ok: true,
    trigger: {
      type,
      module,
      repeat: type === 'field_update' ? executeWhen.details.repeat === true : null,
      match_all: type === 'field_update' ? executeWhen.details.match_all === true : null,
      watched_fields: criteria.fields,
      criteria: criteria.expression,
    },
  };
}

function normalizeActiveRule(rule, fieldUpdatesById, functionDefinitionsById) {
  const reasons = [];
  if (rule.deprecated === true) reasons.push({ code: 'RULE_DEPRECATED', message: 'The source rule is deprecated.' });
  const triggerResult = normalizeTrigger(rule);
  if (!triggerResult.ok) reasons.push({ code: triggerResult.code, message: triggerResult.message });

  const sourceConditions = array(rule.conditions).slice().sort((a, b) => Number(a?.sequence_number) - Number(b?.sequence_number));
  if (!sourceConditions.length) reasons.push({ code: 'CONDITIONS_MISSING', message: 'The source rule has no captured conditions.' });
  const seenSequence = new Set();
  const conditions = [];

  for (const condition of sourceConditions) {
    const sequence = Number(condition?.sequence_number);
    if (!Number.isInteger(sequence) || sequence < 1 || seenSequence.has(sequence)) {
      reasons.push({ code: 'CONDITION_ORDER_INVALID', message: 'Condition sequence numbers are missing, invalid, or duplicated.' });
      continue;
    }
    seenSequence.add(sequence);
    const criteria = conditionCriteria(condition);
    if (!criteria.ok) reasons.push({ code: criteria.code, message: criteria.message });
    const { instant, scheduled, scheduledShapeUnsupported } = actionReferences(condition);
    if (scheduledShapeUnsupported) reasons.push({ code: 'SCHEDULED_ACTION_SHAPE_UNSUPPORTED', message: 'The scheduled-action container has an unsupported shape.' });
    if (scheduled.length) reasons.push({ code: 'SCHEDULED_ACTIONS_UNSUPPORTED', message: 'Scheduled workflow actions are not supported by the phase-1 planner.' });
    if (!instant.length) reasons.push({ code: 'INSTANT_ACTIONS_MISSING', message: 'The source condition has no captured instant actions.' });

    const fieldUpdatePlan = [];
    const functionAdapterPlan = [];
    for (const action of instant) {
      const actionType = String(action?.type || '');
      if (actionType === 'field_updates') {
        const normalized = normalizeFieldUpdate(fieldUpdatesById.get(sourceId(action.id)), rule.module?.api_name);
        if (!normalized.ok) reasons.push({ code: normalized.code, message: normalized.message });
        else fieldUpdatePlan.push(normalized.plan);
      } else if (actionType === 'functions') {
        const normalized = normalizeFunctionAdapter(action, rule, functionDefinitionsById);
        if (!normalized.ok) reasons.push({ code: normalized.code, message: normalized.message });
        else functionAdapterPlan.push(normalized.plan);
      } else if (OUTBOUND_ACTION_TYPES.has(actionType)) {
        reasons.push({ code: 'OUTBOUND_ACTION_UNSUPPORTED', message: 'Outbound delivery is disabled and has no local phase-1 adapter.' });
      } else if (IDENTITY_ACTION_TYPES.has(actionType)) {
        reasons.push({ code: 'IDENTITY_ACTION_UNSUPPORTED', message: 'The action depends on unresolved source identities.' });
      } else if (RECORD_CREATION_ACTION_TYPES.has(actionType)) {
        reasons.push({ code: 'RECORD_CREATION_ACTION_UNSUPPORTED', message: 'Record-creation actions are outside the phase-1 field-mutation planner.' });
      } else {
        reasons.push({ code: 'ACTION_TYPE_UNSUPPORTED', message: 'The workflow action type is unsupported.' });
      }
    }
    if (criteria.ok) {
      conditions.push({
        sequence,
        criteria: criteria.expression,
        field_update_plan: fieldUpdatePlan,
        function_adapter_plan: functionAdapterPlan,
      });
    }
  }

  if (reasons.length) return blockedRule(rule, reasons);
  return {
    id: sourceId(rule.id),
    name: typeof rule.name === 'string' ? rule.name : '(unnamed workflow rule)',
    module: rule.module.api_name,
    source_active: true,
    plan_status: 'Eligible',
    write_execution: 'Blocked',
    trigger: triggerResult.trigger,
    conditions,
    idempotency: {
      event_id_required: true,
      record_id_required: true,
      key_components: ['rule_id', 'record_id', 'event_id'],
      persistence_requirement: 'Persist the plan key atomically with mutations before any future write wiring.',
    },
    recursion: {
      workflow_origin_decision: 'Deny',
      maximum_planning_depth: 0,
      same_rule_same_event_decision: 'Deny',
      cross_rule_chaining: 'Blocked until an authoritative dependency graph and cycle guard are implemented.',
    },
  };
}

function collection(metadata, metaKey, childKey) {
  return array(metadata?.[metaKey]?.[childKey]);
}

function buildWorkflowRuntimeInventory(metadata, { generatedAt = new Date().toISOString() } = {}) {
  if (!isObject(metadata)) throw new WorkflowRuntimeError('AUTOMATION_METADATA_INVALID', 'Captured automation metadata is missing or invalid.');
  const listed = collection(metadata, 'automation:workflow_rules', 'workflow_rules');
  const detailed = collection(metadata, 'automation:workflow_rule_details', 'workflow_rules');
  const fieldUpdates = collection(metadata, 'automation:field_updates', 'field_updates');
  const functionDefinitions = collection(metadata, 'automation:functions', 'functions');
  if (!listed.length || !detailed.length) {
    throw new WorkflowRuntimeError('WORKFLOW_METADATA_INCOMPLETE', 'Both the workflow list and detailed rule collection are required.');
  }
  const listedIds = new Set(listed.map(rule => sourceId(rule.id)).filter(Boolean));
  const detailedIds = new Set(detailed.map(rule => sourceId(rule.id)).filter(Boolean));
  if (listedIds.size !== listed.length || detailedIds.size !== detailed.length
    || listedIds.size !== detailedIds.size || [...listedIds].some(id => !detailedIds.has(id))) {
    throw new WorkflowRuntimeError('WORKFLOW_DETAIL_RECONCILIATION_FAILED', 'Workflow list and detail IDs do not reconcile exactly.');
  }
  const fieldUpdatesById = new Map(fieldUpdates.map(action => [sourceId(action.id), action]).filter(([id]) => id));
  if (fieldUpdatesById.size !== fieldUpdates.length) {
    throw new WorkflowRuntimeError('FIELD_UPDATE_DEFINITION_IDS_INVALID', 'Captured field-update definitions contain a missing or duplicate ID.');
  }
  const functionDefinitionsById = new Map(functionDefinitions.map(definition => [sourceId(definition.id), definition]).filter(([id]) => id));
  if (functionDefinitionsById.size !== functionDefinitions.length) {
    throw new WorkflowRuntimeError('FUNCTION_DEFINITION_IDS_INVALID', 'Captured function definitions contain a missing or duplicate ID.');
  }

  const rules = detailed
    .map(rule => rule.status?.active === true
      ? normalizeActiveRule(rule, fieldUpdatesById, functionDefinitionsById)
      : blockedRule(rule, [{ code: 'RULE_INACTIVE', message: 'The source workflow rule is inactive.' }]))
    .sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const active = rules.filter(rule => rule.source_active);
  const eligible = active.filter(rule => rule.plan_status === 'Eligible');
  const blockedActive = active.filter(rule => rule.plan_status === 'Blocked');
  const referencedActions = detailed.flatMap(rule => array(rule.conditions).flatMap(condition => {
    const { instant, scheduled } = actionReferences(condition);
    return [...instant, ...scheduled];
  }));
  const fieldUpdateReferences = referencedActions.filter(action => action.type === 'field_updates');
  const missingFieldUpdateDefinitions = [...new Set(fieldUpdateReferences
    .map(action => sourceId(action.id))
    .filter(id => id && !fieldUpdatesById.has(id)))];
  const reasonCounts = {};
  blockedActive.flatMap(rule => rule.block_reasons).forEach(reason => {
    reasonCounts[reason.code] = (reasonCounts[reason.code] || 0) + 1;
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    source_snapshot_at: metadata?.automation_synced_at?.at || null,
    evidence: {
      mode: 'Existing captured sanitized local automation metadata only.',
      source_contacted: false,
      source_writes: false,
      local_metadata_read: true,
      local_database_writes: false,
      input_endpoint_scope: 'Local /api/meta/automation snapshot.',
    },
    coverage: {
      listed_rules: listed.length,
      detailed_rules: detailed.length,
      active_rules: active.length,
      inactive_rules: rules.length - active.length,
      plan_eligible_active_rules: eligible.length,
      blocked_active_rules: blockedActive.length,
      runtime_write_enabled_rules: 0,
      referenced_actions: referencedActions.length,
      referenced_field_update_actions: fieldUpdateReferences.length,
      unique_referenced_field_update_actions: new Set(fieldUpdateReferences.map(action => sourceId(action.id))).size,
      captured_field_update_definitions: fieldUpdates.length,
      missing_referenced_field_update_definitions: missingFieldUpdateDefinitions.length,
      eligible_condition_count: eligible.reduce((total, rule) => total + rule.conditions.length, 0),
      eligible_field_mutation_count: eligible.reduce((total, rule) => total + rule.conditions.reduce((sum, condition) => sum + condition.field_update_plan.length, 0), 0),
      eligible_function_adapter_count: eligible.reduce((total, rule) => total + rule.conditions.reduce((sum, condition) => sum + condition.function_adapter_plan.length, 0), 0),
      blocked_active_reason_counts: Object.fromEntries(Object.entries(reasonCounts).sort(([a], [b]) => a.localeCompare(b))),
    },
    runtime_boundary: {
      phase: 'Inventory, criteria evaluation, and deterministic mutation planning only.',
      source_calls_enabled: false,
      source_writes_enabled: false,
      local_writes_enabled: false,
      outbound_delivery_enabled: false,
      identity_resolution_enabled: false,
      destructive_actions_enabled: false,
      scheduled_actions_enabled: false,
      function_adapters_registered: REVIEWED_FUNCTION_ADAPTERS.size,
      whole_rule_decision: 'Deny a rule when any trigger, criterion, condition, or action is unsupported.',
    },
    rules,
  };
}

function assertPlanContext(rule, event) {
  if (rule?.plan_status !== 'Eligible' || rule?.write_execution !== 'Blocked') {
    throw new WorkflowRuntimeError('WORKFLOW_RULE_BLOCKED', 'The workflow rule is not eligible for local mutation planning.', { rule_id: rule?.id || null });
  }
  if (!isObject(event) || typeof event.event_id !== 'string' || !event.event_id.trim()
    || typeof event.record_id !== 'string' || !event.record_id.trim()) {
    throw new WorkflowRuntimeError('WORKFLOW_EVENT_IDEMPOTENCY_CONTEXT_REQUIRED', 'A stable event_id and record_id are required.');
  }
  if (event.origin === 'workflow' || Number(event.depth || 0) > 0) {
    throw new WorkflowRuntimeError('WORKFLOW_RECURSION_BLOCKED', 'Workflow-originated or nested planning is blocked in phase 1.');
  }
  const occurredAt = new Date(event.occurred_at);
  if (!event.occurred_at || Number.isNaN(occurredAt.getTime())) {
    throw new WorkflowRuntimeError('WORKFLOW_EVENT_TIME_REQUIRED', 'A valid occurred_at timestamp is required for deterministic planning.');
  }
  return occurredAt;
}

function triggerMatches(trigger, event) {
  if (!trigger || event?.module !== trigger.module) return false;
  if (trigger.type === 'create') {
    return event.type === 'create'
      && evaluateCriteria(trigger.criteria, { record: event.after || {}, previousRecord: event.before || {} });
  }
  if (trigger.type !== 'field_update' || !['update', 'field_update'].includes(event.type)) return false;
  if (!isObject(event.before) || !isObject(event.after)) return false;
  if (!array(trigger.watched_fields).some(field => fieldChanged(field, event.before, event.after))) return false;
  return evaluateCriteria(trigger.criteria, { record: event.after, previousRecord: event.before });
}

function timeZoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function executionDate(date, timeZone) {
  const parts = timeZoneParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function executionDateTime(date, timeZone) {
  const parts = timeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMinutes = Math.round((localAsUtc - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function resolveValue(valuePlan, event, occurredAt, timeZone) {
  if (valuePlan.kind === 'literal') return valuePlan.value;
  if (valuePlan.kind === 'execution_date') return executionDate(occurredAt, timeZone);
  if (valuePlan.kind === 'execution_datetime') return executionDateTime(occurredAt, timeZone);
  if (valuePlan.kind === 'record_field') {
    if (!hasOwn(event.after, valuePlan.field)) {
      throw new WorkflowRuntimeError('WORKFLOW_MERGE_FIELD_VALUE_MISSING', 'The event record does not contain a required merge field.', { field: valuePlan.field });
    }
    return event.after[valuePlan.field];
  }
  throw new WorkflowRuntimeError('WORKFLOW_VALUE_PLAN_UNSUPPORTED', 'The mutation value plan is unsupported.');
}

function reviewedAdapterForPlan(adapter) {
  const reviewed = REVIEWED_FUNCTION_ADAPTERS.get(sourceId(adapter?.action_id));
  const expected = reviewed ? publicFunctionAdapterPlan(reviewed, sourceId(adapter?.action_id)) : null;
  if (!reviewed || !expected || exactData(adapter) !== exactData(expected)) {
    throw new WorkflowRuntimeError('WORKFLOW_FUNCTION_ADAPTER_CONTRACT_DRIFT', 'The reviewed function-adapter plan no longer matches its exact contract.');
  }
  if (reviewed.parameter_binding_verified === false) {
    throw new WorkflowRuntimeError(
      'WORKFLOW_FUNCTION_PARAMETER_BINDING_UNVERIFIED',
      'The reviewed function adapter has no authoritative parameter-to-field binding evidence.',
    );
  }
  return reviewed;
}

function ordinaryDataDescriptors(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.getPrototypeOf(record) !== Object.prototype) {
    throw new WorkflowRuntimeError('WORKFLOW_FUNCTION_RECORD_SHAPE_INVALID', 'The reviewed function adapter requires an ordinary record object.');
  }
  const keys = Reflect.ownKeys(record);
  if (keys.some(key => typeof key === 'symbol')) {
    throw new WorkflowRuntimeError('WORKFLOW_FUNCTION_RECORD_SHAPE_INVALID', 'The reviewed function adapter rejects symbol-keyed record data.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (Object.values(descriptors).some(descriptor => !hasOwn(descriptor, 'value') || descriptor.get || descriptor.set)) {
    throw new WorkflowRuntimeError('WORKFLOW_FUNCTION_RECORD_SHAPE_INVALID', 'The reviewed function adapter rejects accessor-backed record data.');
  }
  return descriptors;
}

function ownDataValue(descriptors, field) {
  if (!hasOwn(descriptors, field)) {
    throw new WorkflowRuntimeError('WORKFLOW_FUNCTION_FIELD_VALUE_MISSING', 'The event record does not contain the field required by the reviewed function adapter.', { field });
  }
  return descriptors[field].value;
}

function boundedCount(value, reviewed, field) {
  if (!Number.isSafeInteger(value) || value < reviewed.minimum_count || value > reviewed.maximum_count) {
    throw new WorkflowRuntimeError('WORKFLOW_FUNCTION_FIELD_VALUE_INVALID', 'The reviewed function adapter requires bounded non-negative whole-number count fields.', { field });
  }
  return value;
}

function preflightFunctionAdapterInputs(rule, event) {
  const adapters = array(rule?.conditions).flatMap(condition => array(condition?.function_adapter_plan));
  for (const adapter of adapters) {
    const reviewed = reviewedAdapterForPlan(adapter);
    if (reviewed.adapter !== 'compare_counts_set_picklist_v1'
      || event?.module !== rule.module || !['update', 'field_update'].includes(event?.type)) continue;
    const beforeDescriptors = ordinaryDataDescriptors(event?.before);
    const afterDescriptors = ordinaryDataDescriptors(event?.after);
    boundedCount(ownDataValue(beforeDescriptors, reviewed.record_count_field), reviewed, reviewed.record_count_field);
    boundedCount(ownDataValue(afterDescriptors, reviewed.record_count_field), reviewed, reviewed.record_count_field);
    boundedCount(ownDataValue(afterDescriptors, reviewed.team_count_field), reviewed, reviewed.team_count_field);
  }
}

function resolveFunctionAdapter(adapter, event) {
  const reviewed = reviewedAdapterForPlan(adapter);
  if (reviewed.adapter === 'compare_counts_set_picklist_v1') {
    const descriptors = ordinaryDataDescriptors(event?.after);
    const recordCount = boundedCount(
      ownDataValue(descriptors, reviewed.record_count_field), reviewed, reviewed.record_count_field,
    );
    const teamCount = boundedCount(
      ownDataValue(descriptors, reviewed.team_count_field), reviewed, reviewed.team_count_field,
    );
    if (recordCount !== teamCount) return null;
    return {
      action_id: sourceId(adapter.action_id),
      operation: 'set_field',
      field: reviewed.field,
      value: reviewed.value,
    };
  }
  if (!hasOwn(event?.after, reviewed.field)) {
    throw new WorkflowRuntimeError('WORKFLOW_FUNCTION_FIELD_VALUE_MISSING', 'The event record does not contain the field required by the reviewed function adapter.');
  }
  const supplied = event.after[reviewed.field];
  const current = supplied === null ? reviewed.default_value : supplied;
  if (!Number.isSafeInteger(current) || current < reviewed.minimum_current || current > reviewed.maximum_current) {
    throw new WorkflowRuntimeError('WORKFLOW_FUNCTION_FIELD_VALUE_INVALID', 'The reviewed function adapter requires a bounded whole-number field value.');
  }
  return {
    action_id: sourceId(adapter.action_id),
    operation: 'set_field',
    field: reviewed.field,
    value: current + reviewed.increment,
  };
}

function idempotencyKey(rule, event) {
  const material = JSON.stringify([rule.id, event.record_id, event.event_id]);
  return `workflow:${crypto.createHash('sha256').update(material).digest('hex')}`;
}

function createMutationPlan(rule, event, { timeZone = 'Asia/Kolkata' } = {}) {
  const ruleSnapshot = snapshotPlanData(
    rule,
    'WORKFLOW_RULE_SHAPE_INVALID',
    'The workflow rule must be an accessor-free, bounded data snapshot.',
  );
  const eventSnapshot = snapshotPlanData(
    event,
    'WORKFLOW_EVENT_SHAPE_INVALID',
    'The workflow event must be an accessor-free, bounded data snapshot.',
  );
  const occurredAt = assertPlanContext(ruleSnapshot, eventSnapshot);
  const base = {
    rule_id: ruleSnapshot.id,
    module: ruleSnapshot.module,
    record_id: eventSnapshot.record_id,
    event_id: eventSnapshot.event_id,
    idempotency_key: idempotencyKey(ruleSnapshot, eventSnapshot),
    source_calls: false,
    source_writes: false,
    local_writes: false,
    outbound_delivery: false,
    write_execution: 'Blocked',
  };
  preflightFunctionAdapterInputs(ruleSnapshot, eventSnapshot);
  if (!triggerMatches(ruleSnapshot.trigger, eventSnapshot)) return deepFreeze({ ...base, status: 'NoMatch', reason: 'trigger_not_matched', mutations: [], function_adapters: [] });
  if (ruleSnapshot.trigger.repeat === false) {
    if (typeof eventSnapshot.previously_executed !== 'boolean') {
      throw new WorkflowRuntimeError('WORKFLOW_EXECUTION_HISTORY_REQUIRED', 'This non-repeating rule requires an authoritative previously_executed decision.');
    }
    if (eventSnapshot.previously_executed) return deepFreeze({ ...base, status: 'NoMatch', reason: 'repeat_suppressed', mutations: [], function_adapters: [] });
  }
  const condition = ruleSnapshot.conditions.find(item => evaluateCriteria(item.criteria, { record: eventSnapshot.after || {}, previousRecord: eventSnapshot.before || {} }));
  if (!condition) return deepFreeze({ ...base, status: 'NoMatch', reason: 'condition_not_matched', mutations: [], function_adapters: [] });
  const mutations = condition.field_update_plan.map((action, index) => ({
    order: index + 1,
    action_id: action.action_id,
    operation: 'set_field',
    field: action.field,
    value: resolveValue(action.value, eventSnapshot, occurredAt, timeZone),
  }));
  const functionMutations = [];
  condition.function_adapter_plan.forEach(adapter => {
    const resolved = resolveFunctionAdapter(adapter, eventSnapshot);
    if (resolved) functionMutations.push({ order: mutations.length + functionMutations.length + 1, ...resolved });
  });
  return deepFreeze({
    ...base,
    status: 'Planned',
    condition_sequence: condition.sequence,
    mutations: [...mutations, ...functionMutations],
    function_adapters: condition.function_adapter_plan.map(adapter => ({ ...adapter })),
    requirements: {
      persist_idempotency_key_atomically: true,
      reject_duplicate_idempotency_key: true,
      recursion_policy: 'Deny workflow-originated and nested events.',
    },
  });
}

module.exports = {
  WorkflowRuntimeError,
  buildWorkflowRuntimeInventory,
  createMutationPlan,
  evaluateCriteria,
  normalizeCriteria,
  normalizeFunctionAdapter,
  triggerMatches,
};
