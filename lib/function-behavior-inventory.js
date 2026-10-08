'use strict';

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PRIVATE_PATH_PATTERN = /(?:\/(?:Users|home|var|tmp|opt|etc)\/|[A-Z]:\\|\.private\/)[^\s,;)]*/gi;
const BEARER_VALUE_PATTERN = /\bbearer\s+[A-Z0-9._~+/=-]{8,}/gi;
const DIGEST_PATTERN = /\b[A-F0-9]{32,128}\b/gi;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(api[_ -]?key|authorization|bearer|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}["']?/gi;

function safeText(value, maxLength = 1200) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text
    .slice(0, maxLength)
    .replace(URL_PATTERN, '[external target omitted]')
    .replace(EMAIL_PATTERN, '[address omitted]')
    .replace(PRIVATE_PATH_PATTERN, '[private path omitted]')
    .replace(BEARER_VALUE_PATTERN, 'Bearer [sensitive value omitted]')
    .replace(DIGEST_PATTERN, '[digest omitted]')
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1: [sensitive value omitted]');
}

function safeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function uniqueSafeStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => safeText(value, 160))
    .filter(Boolean))];
}

function sanitizeAssociation(association) {
  if (!association || typeof association !== 'object' || Array.isArray(association)) return null;
  if (association.source === 'active_workflow') {
    return {
      source: 'active_workflow',
      rule_id: safeText(String(association.rule_id || ''), 80),
      rule_name: safeText(association.rule_name, 240),
      rule_module: safeText(association.rule_module, 160),
      action_id: safeText(String(association.action_id || ''), 80),
      action_name: safeText(association.action_name, 240),
    };
  }
  if (association.source === 'custom_button') {
    return {
      source: 'custom_button',
      button_id: safeText(String(association.button_id || ''), 80),
      button_api_name: safeText(association.button_api_name, 160),
      button_module: safeText(association.button_module, 160),
      button_position: safeText(association.button_position, 80),
      action_reference_id: safeText(String(association.action_reference_id || ''), 80),
      action_reference_name: safeText(association.action_reference_name, 240),
    };
  }
  return null;
}

function sanitizeFunction(fn) {
  const fieldsRead = uniqueSafeStrings(fn?.fields_read);
  const fieldsWritten = uniqueSafeStrings(fn?.fields_written);
  const associations = (Array.isArray(fn?.associations) ? fn.associations : [])
    .map(sanitizeAssociation)
    .filter(Boolean);
  return {
    id: safeText(String(fn?.id || ''), 80),
    api_name: safeText(fn?.api_name, 160),
    display_name: safeText(fn?.display_name, 240) || '(unnamed function)',
    category: fn?.category === 'Button' ? 'Button' : 'Automation',
    behavior: safeText(fn?.behavior, 1200) || 'Behavior summary unavailable.',
    associations,
    modules_read: uniqueSafeStrings(fn?.modules_read),
    modules_written: uniqueSafeStrings(fn?.modules_written),
    field_references: {
      read: fieldsRead.length,
      write: fieldsWritten.length,
      total: fieldsRead.length + fieldsWritten.length,
    },
    local_implementation_complexity: safeText(fn?.local_implementation_complexity, 80) || 'Unassessed',
    mapping_confidence: safeText(fn?.mapping_confidence, 80) || 'Unassessed',
    blockers: uniqueSafeStrings(fn?.blockers),
    local_execution: 'Blocked',
  };
}

function buildModuleSummary(functions) {
  const modules = new Map();
  const entryFor = module => {
    if (!modules.has(module)) modules.set(module, { module, read_function_count: 0, write_function_count: 0, function_ids: new Set() });
    return modules.get(module);
  };
  functions.forEach(fn => {
    fn.modules_read.forEach(module => {
      const entry = entryFor(module);
      entry.read_function_count += 1;
      entry.function_ids.add(fn.id);
    });
    fn.modules_written.forEach(module => {
      const entry = entryFor(module);
      entry.write_function_count += 1;
      entry.function_ids.add(fn.id);
    });
  });
  return [...modules.values()]
    .map(({ function_ids: functionIds, ...entry }) => ({ ...entry, affected_function_count: functionIds.size }))
    .sort((a, b) => b.affected_function_count - a.affected_function_count || a.module.localeCompare(b.module));
}

function buildFunctionBehaviorInventory(rawInventory) {
  const rawFunctions = Array.isArray(rawInventory?.functions) ? rawInventory.functions : [];
  const functions = rawFunctions.map(sanitizeFunction).filter(fn => fn.id);
  const scope = rawInventory?.scope && typeof rawInventory.scope === 'object' ? rawInventory.scope : {};
  const workflowAssociations = functions.flatMap(fn => fn.associations.filter(item => item.source === 'active_workflow'));
  const buttonAssociations = functions.flatMap(fn => fn.associations.filter(item => item.source === 'custom_button'));
  const workflowFunctionCount = functions.filter(fn => fn.associations.some(item => item.source === 'active_workflow')).length;
  const buttonFunctionCount = functions.filter(fn => fn.associations.some(item => item.source === 'custom_button')).length;
  const uniqueWorkflowActions = new Set(workflowAssociations.map(item => item.action_id).filter(Boolean));
  const uniqueReadFields = new Set(rawFunctions.flatMap(fn => uniqueSafeStrings(fn?.fields_read)));
  const uniqueWrittenFields = new Set(rawFunctions.flatMap(fn => uniqueSafeStrings(fn?.fields_written)));
  const fieldReadReferences = functions.reduce((total, fn) => total + fn.field_references.read, 0);
  const fieldWriteReferences = functions.reduce((total, fn) => total + fn.field_references.write, 0);
  const moduleSummary = buildModuleSummary(functions);

  return {
    source_mode: 'read-only',
    generated_at: safeText(rawInventory?.generated_at, 80),
    coverage: {
      detailed_workflow_rules: safeInteger(scope.workflow_rules_detailed),
      active_workflow_rules: safeInteger(scope.active_workflow_rules),
      workflow_function_associations: workflowAssociations.length,
      unique_workflow_function_actions: uniqueWorkflowActions.size,
      mapped_workflow_functions: workflowFunctionCount,
      custom_button_entries: safeInteger(scope.custom_button_entries),
      custom_function_button_references: buttonAssociations.length,
      mapped_button_functions: buttonFunctionCount,
      available_function_definitions: safeInteger(scope.captured_function_bodies_available),
      in_scope_function_definitions: functions.length,
      analyzed_function_definitions: functions.length,
      unresolved_in_scope_references: safeInteger(scope.unresolved_in_scope_function_references),
      status: safeInteger(scope.unresolved_in_scope_function_references) === 0 ? 'Reconciled' : 'Incomplete',
    },
    affected: {
      module_count: moduleSummary.length,
      modules: moduleSummary,
      field_references: {
        read: fieldReadReferences,
        write: fieldWriteReferences,
        total: fieldReadReferences + fieldWriteReferences,
        unique_read: uniqueReadFields.size,
        unique_write: uniqueWrittenFields.size,
      },
    },
    execution: {
      local_status: 'Blocked',
      local_function_execution_enabled: false,
      source_execution_enabled: false,
      source_writes_enabled: false,
      outbound_delivery_enabled: false,
      reason: 'Behavior metadata is for replication planning only; every function remains fail-closed.',
    },
    functions,
  };
}

module.exports = {
  buildFunctionBehaviorInventory,
  safeText,
};
