'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'rule-layout-coverage.json');
const RAW_COVERAGE = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const EXPECTED_COUNTS = Object.freeze({
  modules: 122,
  layouts: Object.freeze({ responses: 122, successful: 75, blocked: 47, definitions: 70, with_definitions: 67, empty: 8 }),
  custom_views: Object.freeze({ responses: 122, successful: 121, blocked: 1, definitions: 386, with_definitions: 41, empty: 80, criteria: 0 }),
  validation_rules: Object.freeze({ responses: 122, successful: 0, blocked: 122, definitions: 0 }),
  assignment_rules: Object.freeze({ responses: 122, successful: 12, blocked: 110, definitions: 1, with_definitions: 1, empty: 11, executable: 0 }),
  approval_rules: Object.freeze({ responses: 122, successful: 0, blocked: 122, definitions: 0 }),
  pipelines: Object.freeze({ responses: 70, successful: 1, blocked: 69, definitions: 0, modules_with_responses: 67, modules_with_success: 1 }),
});

const EXPECTED_CURRENT_MIRRORED_RUNTIME = Object.freeze({
  modules: 153,
  metadata_key_rows: 318,
  batch_size: 12,
  value_batches: 27,
  maximum_concurrency: 4,
  field_scopes: 121,
  field_modules: 120,
  field_empty_scopes: 1,
  field_definitions: 2377,
  layout_scopes: 75,
  layout_modules: 67,
  layout_empty_scopes: 8,
  layout_definitions: 70,
  layout_sections: 168,
  layout_field_references: 1796,
  view_scopes: 121,
  view_modules: 41,
  view_empty_scopes: 80,
  definitions: 386,
  criteria_definitions: 199,
  criteria_leaves: 321,
  executable_criteria: 102,
  explicitly_safe_unfiltered: 53,
  unresolved_criteria: 134,
  unsupported_criteria: 97,
  compiled: 155,
  blocked: 231,
  system_reviewed: 306,
  system_executable_criteria: 33,
  system_explicitly_safe_unfiltered: 48,
  system_unresolved_criteria: 134,
  system_unsupported_criteria: 91,
  system_compiled: 81,
  system_blocked: 225,
  defaults_reviewed: 41,
  defaults_executable_criteria: 4,
  defaults_explicitly_safe_unfiltered: 10,
  defaults_unresolved_criteria: 26,
  defaults_unsupported_criteria: 1,
  defaults_compiled: 14,
  defaults_blocked: 27,
});

const EXPECTED_STATUS_COUNTS = Object.freeze({
  layouts: Object.freeze({ 200: 67, 204: 8, 400: 47 }),
  custom_views: Object.freeze({ 200: 41, 204: 80, 400: 1 }),
  validation_rules: Object.freeze({ 404: 122 }),
  assignment_rules: Object.freeze({ 200: 1, 204: 11, 400: 110 }),
  approval_rules: Object.freeze({ 404: 122 }),
  pipelines: Object.freeze({ 204: 1, 400: 69 }),
});

const RULE_FAMILIES = Object.freeze(['validation_rule', 'assignment_rule', 'approval_rule', 'pipeline']);
const VIEW_COMPARATORS = Object.freeze([
  'equal', 'not_equal', 'contains', 'not_contains', 'starts_with', 'ends_with',
  'in', 'not_in', 'greater_than', 'greater_equal', 'less_than', 'less_equal', 'between',
]);

const FORBIDDEN_KEYS = new Set([
  'alias', 'api_key', 'authorization', 'credential', 'credentials', 'email', 'endpoint',
  'first_name', 'full_name', 'id', 'ids', 'last_name', 'mobile', 'password', 'phone',
  'private_path', 'secret', 'source_endpoint', 'source_id', 'token', 'url', 'user_name',
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
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error('Coverage contains a forbidden sensitive key.');
      assertNoSensitiveData(child);
    });
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
    throw new Error('Coverage contains a forbidden sensitive value.');
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

function integer(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) throw new Error(`${label} does not match the reviewed fail-closed coverage.`);
  return value;
}

function stringArray(value, label, maxItems = 100) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be a bounded array.`);
  return value.map((item, index) => string(item, `${label}[${index}]`, 320));
}

function exactStringArray(value, expected, label) {
  const copied = stringArray(value, label, expected.length);
  if (copied.length !== expected.length || copied.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} changed and requires a manual review.`);
  }
  return copied;
}

function statusCounts(value, expected, label) {
  const input = object(value, label);
  const output = {};
  const expectedKeys = Object.keys(expected);
  if (Object.keys(input).length !== expectedKeys.length) throw new Error(`${label} contains unexpected status buckets.`);
  expectedKeys.forEach(key => {
    output[key] = exact(integer(input[key], `${label}.${key}`), expected[key], `${label}.${key}`);
  });
  return output;
}

function copyCommonModuleCoverage(value, label, expected, expectedStatuses) {
  const input = object(value, label);
  return {
    endpoint_responses: exact(integer(input.endpoint_responses, `${label}.endpoint_responses`), expected.responses, `${label}.endpoint_responses`),
    successful_responses: exact(integer(input.successful_responses, `${label}.successful_responses`), expected.successful, `${label}.successful_responses`),
    blocked_responses: exact(integer(input.blocked_responses, `${label}.blocked_responses`), expected.blocked, `${label}.blocked_responses`),
    responses_by_status: statusCounts(input.responses_by_status, expectedStatuses, `${label}.responses_by_status`),
    definitions_captured: exact(integer(input.definitions_captured, `${label}.definitions_captured`), expected.definitions, `${label}.definitions_captured`),
    modules_with_definitions: integer(input.modules_with_definitions, `${label}.modules_with_definitions`),
    successful_empty_modules: integer(input.successful_empty_modules, `${label}.successful_empty_modules`),
  };
}

function copySourceCoverage(value) {
  const input = object(value, 'source_coverage');
  const layoutsInput = object(input.layouts, 'source_coverage.layouts');
  const layouts = {
    ...copyCommonModuleCoverage(layoutsInput, 'source_coverage.layouts', EXPECTED_COUNTS.layouts, EXPECTED_STATUS_COUNTS.layouts),
    definitions_with_sections_property: exact(integer(layoutsInput.definitions_with_sections_property, 'source_coverage.layouts.definitions_with_sections_property'), 70, 'source_coverage.layouts.definitions_with_sections_property'),
    definitions_with_nonempty_sections: exact(integer(layoutsInput.definitions_with_nonempty_sections, 'source_coverage.layouts.definitions_with_nonempty_sections'), 69, 'source_coverage.layouts.definitions_with_nonempty_sections'),
    definitions_with_profile_scope_property: exact(integer(layoutsInput.definitions_with_profile_scope_property, 'source_coverage.layouts.definitions_with_profile_scope_property'), 70, 'source_coverage.layouts.definitions_with_profile_scope_property'),
    definitions_with_action_permissions_property: exact(integer(layoutsInput.definitions_with_action_permissions_property, 'source_coverage.layouts.definitions_with_action_permissions_property'), 70, 'source_coverage.layouts.definitions_with_action_permissions_property'),
    status: exact(string(layoutsInput.status, 'source_coverage.layouts.status'), 'Partially captured', 'source_coverage.layouts.status'),
  };
  exact(layouts.modules_with_definitions, EXPECTED_COUNTS.layouts.with_definitions, 'source_coverage.layouts.modules_with_definitions');
  exact(layouts.successful_empty_modules, EXPECTED_COUNTS.layouts.empty, 'source_coverage.layouts.successful_empty_modules');

  const viewsInput = object(input.custom_views, 'source_coverage.custom_views');
  const customViews = {
    ...copyCommonModuleCoverage(viewsInput, 'source_coverage.custom_views', EXPECTED_COUNTS.custom_views, EXPECTED_STATUS_COUNTS.custom_views),
    list_rows_captured: exact(integer(viewsInput.list_rows_captured, 'source_coverage.custom_views.list_rows_captured'), 386, 'source_coverage.custom_views.list_rows_captured'),
    criteria_details_captured: exact(integer(viewsInput.criteria_details_captured, 'source_coverage.custom_views.criteria_details_captured'), 0, 'source_coverage.custom_views.criteria_details_captured'),
    criteria_details_missing: exact(integer(viewsInput.criteria_details_missing, 'source_coverage.custom_views.criteria_details_missing'), 386, 'source_coverage.custom_views.criteria_details_missing'),
    source_criteria_compile_verified: exact(integer(viewsInput.source_criteria_compile_verified, 'source_coverage.custom_views.source_criteria_compile_verified'), 0, 'source_coverage.custom_views.source_criteria_compile_verified'),
    source_criteria_compile_blocked: exact(integer(viewsInput.source_criteria_compile_blocked, 'source_coverage.custom_views.source_criteria_compile_blocked'), 386, 'source_coverage.custom_views.source_criteria_compile_blocked'),
    status: exact(string(viewsInput.status, 'source_coverage.custom_views.status'), 'List captured; criteria detail blocked offline', 'source_coverage.custom_views.status'),
  };
  exact(customViews.modules_with_definitions, EXPECTED_COUNTS.custom_views.with_definitions, 'source_coverage.custom_views.modules_with_definitions');
  exact(customViews.successful_empty_modules, EXPECTED_COUNTS.custom_views.empty, 'source_coverage.custom_views.successful_empty_modules');

  const validationInput = object(input.validation_rules, 'source_coverage.validation_rules');
  const validationRules = {
    ...copyCommonModuleCoverage(validationInput, 'source_coverage.validation_rules', EXPECTED_COUNTS.validation_rules, EXPECTED_STATUS_COUNTS.validation_rules),
    rule_bodies_captured: exact(integer(validationInput.rule_bodies_captured, 'source_coverage.validation_rules.rule_bodies_captured'), 0, 'source_coverage.validation_rules.rule_bodies_captured'),
    executable_definitions_captured: exact(integer(validationInput.executable_definitions_captured, 'source_coverage.validation_rules.executable_definitions_captured'), 0, 'source_coverage.validation_rules.executable_definitions_captured'),
    status: exact(string(validationInput.status, 'source_coverage.validation_rules.status'), 'Not accessible in captured discovery', 'source_coverage.validation_rules.status'),
  };
  exact(validationRules.modules_with_definitions, 0, 'source_coverage.validation_rules.modules_with_definitions');
  exact(validationRules.successful_empty_modules, 0, 'source_coverage.validation_rules.successful_empty_modules');

  const assignmentInput = object(input.assignment_rules, 'source_coverage.assignment_rules');
  const assignmentRules = {
    ...copyCommonModuleCoverage(assignmentInput, 'source_coverage.assignment_rules', EXPECTED_COUNTS.assignment_rules, EXPECTED_STATUS_COUNTS.assignment_rules),
    definitions_with_criteria: exact(integer(assignmentInput.definitions_with_criteria, 'source_coverage.assignment_rules.definitions_with_criteria'), 0, 'source_coverage.assignment_rules.definitions_with_criteria'),
    definitions_with_actions: exact(integer(assignmentInput.definitions_with_actions, 'source_coverage.assignment_rules.definitions_with_actions'), 0, 'source_coverage.assignment_rules.definitions_with_actions'),
    definitions_with_assignee_reference: exact(integer(assignmentInput.definitions_with_assignee_reference, 'source_coverage.assignment_rules.definitions_with_assignee_reference'), 1, 'source_coverage.assignment_rules.definitions_with_assignee_reference'),
    executable_definitions_captured: exact(integer(assignmentInput.executable_definitions_captured, 'source_coverage.assignment_rules.executable_definitions_captured'), 0, 'source_coverage.assignment_rules.executable_definitions_captured'),
    status: exact(string(assignmentInput.status, 'source_coverage.assignment_rules.status'), 'List evidence only; execution detail blocked', 'source_coverage.assignment_rules.status'),
  };
  exact(assignmentRules.modules_with_definitions, EXPECTED_COUNTS.assignment_rules.with_definitions, 'source_coverage.assignment_rules.modules_with_definitions');
  exact(assignmentRules.successful_empty_modules, EXPECTED_COUNTS.assignment_rules.empty, 'source_coverage.assignment_rules.successful_empty_modules');

  const approvalInput = object(input.approval_rules, 'source_coverage.approval_rules');
  const approvalRules = {
    ...copyCommonModuleCoverage(approvalInput, 'source_coverage.approval_rules', EXPECTED_COUNTS.approval_rules, EXPECTED_STATUS_COUNTS.approval_rules),
    rule_bodies_captured: exact(integer(approvalInput.rule_bodies_captured, 'source_coverage.approval_rules.rule_bodies_captured'), 0, 'source_coverage.approval_rules.rule_bodies_captured'),
    executable_definitions_captured: exact(integer(approvalInput.executable_definitions_captured, 'source_coverage.approval_rules.executable_definitions_captured'), 0, 'source_coverage.approval_rules.executable_definitions_captured'),
    status: exact(string(approvalInput.status, 'source_coverage.approval_rules.status'), 'Not accessible in captured discovery', 'source_coverage.approval_rules.status'),
  };
  exact(approvalRules.modules_with_definitions, 0, 'source_coverage.approval_rules.modules_with_definitions');
  exact(approvalRules.successful_empty_modules, 0, 'source_coverage.approval_rules.successful_empty_modules');

  const pipelineInput = object(input.pipelines, 'source_coverage.pipelines');
  const pipelines = {
    layout_scoped_responses: exact(integer(pipelineInput.layout_scoped_responses, 'source_coverage.pipelines.layout_scoped_responses'), EXPECTED_COUNTS.pipelines.responses, 'source_coverage.pipelines.layout_scoped_responses'),
    successful_responses: exact(integer(pipelineInput.successful_responses, 'source_coverage.pipelines.successful_responses'), EXPECTED_COUNTS.pipelines.successful, 'source_coverage.pipelines.successful_responses'),
    blocked_responses: exact(integer(pipelineInput.blocked_responses, 'source_coverage.pipelines.blocked_responses'), EXPECTED_COUNTS.pipelines.blocked, 'source_coverage.pipelines.blocked_responses'),
    responses_by_status: statusCounts(pipelineInput.responses_by_status, EXPECTED_STATUS_COUNTS.pipelines, 'source_coverage.pipelines.responses_by_status'),
    definitions_captured: exact(integer(pipelineInput.definitions_captured, 'source_coverage.pipelines.definitions_captured'), EXPECTED_COUNTS.pipelines.definitions, 'source_coverage.pipelines.definitions_captured'),
    modules_with_responses: exact(integer(pipelineInput.modules_with_responses, 'source_coverage.pipelines.modules_with_responses'), EXPECTED_COUNTS.pipelines.modules_with_responses, 'source_coverage.pipelines.modules_with_responses'),
    modules_with_successful_responses: exact(integer(pipelineInput.modules_with_successful_responses, 'source_coverage.pipelines.modules_with_successful_responses'), EXPECTED_COUNTS.pipelines.modules_with_success, 'source_coverage.pipelines.modules_with_successful_responses'),
    executable_definitions_captured: exact(integer(pipelineInput.executable_definitions_captured, 'source_coverage.pipelines.executable_definitions_captured'), 0, 'source_coverage.pipelines.executable_definitions_captured'),
    status: exact(string(pipelineInput.status, 'source_coverage.pipelines.status'), 'Not accessible beyond one empty response', 'source_coverage.pipelines.status'),
  };

  return { layouts, custom_views: customViews, validation_rules: validationRules, assignment_rules: assignmentRules, approval_rules: approvalRules, pipelines };
}

function copyLocalEnforcement(value) {
  const input = object(value, 'local_enforcement');
  const layoutsInput = object(input.layouts, 'local_enforcement.layouts');
  const layouts = {
    status: exact(string(layoutsInput.status, 'local_enforcement.layouts.status'), 'Partially implemented', 'local_enforcement.layouts.status'),
    source_equivalence: exact(string(layoutsInput.source_equivalence, 'local_enforcement.layouts.source_equivalence'), 'Partial', 'local_enforcement.layouts.source_equivalence'),
    exact_or_stored_layout_resolution: exact(boolean(layoutsInput.exact_or_stored_layout_resolution, 'local_enforcement.layouts.exact_or_stored_layout_resolution'), true, 'local_enforcement.layouts.exact_or_stored_layout_resolution'),
    ambiguous_multi_layout_create_decision: exact(string(layoutsInput.ambiguous_multi_layout_create_decision, 'local_enforcement.layouts.ambiguous_multi_layout_create_decision'), 'Deny', 'local_enforcement.layouts.ambiguous_multi_layout_create_decision'),
    unknown_layout_decision: exact(string(layoutsInput.unknown_layout_decision, 'local_enforcement.layouts.unknown_layout_decision'), 'Deny', 'local_enforcement.layouts.unknown_layout_decision'),
    field_overlay_applied_before_validation: exact(boolean(layoutsInput.field_overlay_applied_before_validation, 'local_enforcement.layouts.field_overlay_applied_before_validation'), true, 'local_enforcement.layouts.field_overlay_applied_before_validation'),
    required_field_enforcement: exact(boolean(layoutsInput.required_field_enforcement, 'local_enforcement.layouts.required_field_enforcement'), true, 'local_enforcement.layouts.required_field_enforcement'),
    read_only_and_virtual_field_enforcement: exact(boolean(layoutsInput.read_only_and_virtual_field_enforcement, 'local_enforcement.layouts.read_only_and_virtual_field_enforcement'), true, 'local_enforcement.layouts.read_only_and_virtual_field_enforcement'),
    layout_profile_visibility_enforced: exact(boolean(layoutsInput.layout_profile_visibility_enforced, 'local_enforcement.layouts.layout_profile_visibility_enforced'), false, 'local_enforcement.layouts.layout_profile_visibility_enforced'),
    layout_action_permissions_enforced: exact(boolean(layoutsInput.layout_action_permissions_enforced, 'local_enforcement.layouts.layout_action_permissions_enforced'), false, 'local_enforcement.layouts.layout_action_permissions_enforced'),
    current_layout_definitions_available: exact(integer(layoutsInput.current_layout_definitions_available, 'local_enforcement.layouts.current_layout_definitions_available'), EXPECTED_CURRENT_MIRRORED_RUNTIME.layout_definitions, 'local_enforcement.layouts.current_layout_definitions_available'),
    current_field_definitions_available: exact(integer(layoutsInput.current_field_definitions_available, 'local_enforcement.layouts.current_field_definitions_available'), EXPECTED_CURRENT_MIRRORED_RUNTIME.field_definitions, 'local_enforcement.layouts.current_field_definitions_available'),
    note: string(layoutsInput.note, 'local_enforcement.layouts.note'),
  };

  const viewsInput = object(input.custom_views, 'local_enforcement.custom_views');
  const customViews = {
    status: exact(string(viewsInput.status, 'local_enforcement.custom_views.status'), 'Implemented fail-closed', 'local_enforcement.custom_views.status'),
    source_equivalence: exact(string(viewsInput.source_equivalence, 'local_enforcement.custom_views.source_equivalence'), 'Partial; unresolved and unsupported criteria remain blocked', 'local_enforcement.custom_views.source_equivalence'),
    nested_groups_supported: exact(boolean(viewsInput.nested_groups_supported, 'local_enforcement.custom_views.nested_groups_supported'), true, 'local_enforcement.custom_views.nested_groups_supported'),
    group_operators_supported: exactStringArray(viewsInput.group_operators_supported, ['AND', 'OR'], 'local_enforcement.custom_views.group_operators_supported'),
    comparators_supported: exactStringArray(viewsInput.comparators_supported, VIEW_COMPARATORS, 'local_enforcement.custom_views.comparators_supported'),
    explicit_unfiltered_view_supported: exact(boolean(viewsInput.explicit_unfiltered_view_supported, 'local_enforcement.custom_views.explicit_unfiltered_view_supported'), true, 'local_enforcement.custom_views.explicit_unfiltered_view_supported'),
    missing_criteria_decision: exact(string(viewsInput.missing_criteria_decision, 'local_enforcement.custom_views.missing_criteria_decision'), 'Deny', 'local_enforcement.custom_views.missing_criteria_decision'),
    disrupted_criteria_decision: exact(string(viewsInput.disrupted_criteria_decision, 'local_enforcement.custom_views.disrupted_criteria_decision'), 'Deny', 'local_enforcement.custom_views.disrupted_criteria_decision'),
    dynamic_values_decision: exact(string(viewsInput.dynamic_values_decision, 'local_enforcement.custom_views.dynamic_values_decision'), 'Deny', 'local_enforcement.custom_views.dynamic_values_decision'),
    unknown_fields_decision: exact(string(viewsInput.unknown_fields_decision, 'local_enforcement.custom_views.unknown_fields_decision'), 'Deny', 'local_enforcement.custom_views.unknown_fields_decision'),
    unsupported_comparators_decision: exact(string(viewsInput.unsupported_comparators_decision, 'local_enforcement.custom_views.unsupported_comparators_decision'), 'Deny', 'local_enforcement.custom_views.unsupported_comparators_decision'),
    current_executable_criteria_definitions: exact(integer(viewsInput.current_executable_criteria_definitions, 'local_enforcement.custom_views.current_executable_criteria_definitions'), EXPECTED_CURRENT_MIRRORED_RUNTIME.executable_criteria, 'local_enforcement.custom_views.current_executable_criteria_definitions'),
    current_explicitly_safe_unfiltered_definitions: exact(integer(viewsInput.current_explicitly_safe_unfiltered_definitions, 'local_enforcement.custom_views.current_explicitly_safe_unfiltered_definitions'), EXPECTED_CURRENT_MIRRORED_RUNTIME.explicitly_safe_unfiltered, 'local_enforcement.custom_views.current_explicitly_safe_unfiltered_definitions'),
    current_unresolved_criteria_bodies: exact(integer(viewsInput.current_unresolved_criteria_bodies, 'local_enforcement.custom_views.current_unresolved_criteria_bodies'), EXPECTED_CURRENT_MIRRORED_RUNTIME.unresolved_criteria, 'local_enforcement.custom_views.current_unresolved_criteria_bodies'),
    current_unsupported_criteria_definitions: exact(integer(viewsInput.current_unsupported_criteria_definitions, 'local_enforcement.custom_views.current_unsupported_criteria_definitions'), EXPECTED_CURRENT_MIRRORED_RUNTIME.unsupported_criteria, 'local_enforcement.custom_views.current_unsupported_criteria_definitions'),
    current_views_blocked: exact(integer(viewsInput.current_views_blocked, 'local_enforcement.custom_views.current_views_blocked'), EXPECTED_CURRENT_MIRRORED_RUNTIME.blocked, 'local_enforcement.custom_views.current_views_blocked'),
    note: string(viewsInput.note, 'local_enforcement.custom_views.note'),
  };

  function blockedRule(sectionName, extraFields) {
    const sectionInput = object(input[sectionName], `local_enforcement.${sectionName}`);
    const common = {
      status: exact(string(sectionInput.status, `local_enforcement.${sectionName}.status`), 'Blocked', `local_enforcement.${sectionName}.status`),
      source_equivalence: exact(string(sectionInput.source_equivalence, `local_enforcement.${sectionName}.source_equivalence`), 'Not demonstrated', `local_enforcement.${sectionName}.source_equivalence`),
      source_definitions_enforced: exact(integer(sectionInput.source_definitions_enforced, `local_enforcement.${sectionName}.source_definitions_enforced`), 0, `local_enforcement.${sectionName}.source_definitions_enforced`),
      default_execution_decision: exact(string(sectionInput.default_execution_decision, `local_enforcement.${sectionName}.default_execution_decision`), 'Deny', `local_enforcement.${sectionName}.default_execution_decision`),
    };
    return { ...common, ...extraFields(sectionInput), note: string(sectionInput.note, `local_enforcement.${sectionName}.note`) };
  }

  const validationRules = blockedRule('validation_rules', section => ({
    generic_field_and_layout_validation: exact(string(section.generic_field_and_layout_validation, 'local_enforcement.validation_rules.generic_field_and_layout_validation'), 'Implemented', 'local_enforcement.validation_rules.generic_field_and_layout_validation'),
    source_rule_interpreter: exact(boolean(section.source_rule_interpreter, 'local_enforcement.validation_rules.source_rule_interpreter'), false, 'local_enforcement.validation_rules.source_rule_interpreter'),
  }));
  const assignmentRules = blockedRule('assignment_rules', section => ({
    source_rule_interpreter: exact(boolean(section.source_rule_interpreter, 'local_enforcement.assignment_rules.source_rule_interpreter'), false, 'local_enforcement.assignment_rules.source_rule_interpreter'),
    automatic_assignee_changes_enabled: exact(boolean(section.automatic_assignee_changes_enabled, 'local_enforcement.assignment_rules.automatic_assignee_changes_enabled'), false, 'local_enforcement.assignment_rules.automatic_assignee_changes_enabled'),
    caller_asserted_assignment_trusted: exact(boolean(section.caller_asserted_assignment_trusted, 'local_enforcement.assignment_rules.caller_asserted_assignment_trusted'), false, 'local_enforcement.assignment_rules.caller_asserted_assignment_trusted'),
  }));
  const approvalRules = blockedRule('approval_rules', section => ({
    source_rule_interpreter: exact(boolean(section.source_rule_interpreter, 'local_enforcement.approval_rules.source_rule_interpreter'), false, 'local_enforcement.approval_rules.source_rule_interpreter'),
    approval_state_mutation_enabled: exact(boolean(section.approval_state_mutation_enabled, 'local_enforcement.approval_rules.approval_state_mutation_enabled'), false, 'local_enforcement.approval_rules.approval_state_mutation_enabled'),
    caller_asserted_approval_trusted: exact(boolean(section.caller_asserted_approval_trusted, 'local_enforcement.approval_rules.caller_asserted_approval_trusted'), false, 'local_enforcement.approval_rules.caller_asserted_approval_trusted'),
  }));
  const pipelines = blockedRule('pipelines', section => ({
    source_pipeline_interpreter: exact(boolean(section.source_pipeline_interpreter, 'local_enforcement.pipelines.source_pipeline_interpreter'), false, 'local_enforcement.pipelines.source_pipeline_interpreter'),
    automatic_stage_progression_enabled: exact(boolean(section.automatic_stage_progression_enabled, 'local_enforcement.pipelines.automatic_stage_progression_enabled'), false, 'local_enforcement.pipelines.automatic_stage_progression_enabled'),
    caller_asserted_pipeline_transition_trusted: exact(boolean(section.caller_asserted_pipeline_transition_trusted, 'local_enforcement.pipelines.caller_asserted_pipeline_transition_trusted'), false, 'local_enforcement.pipelines.caller_asserted_pipeline_transition_trusted'),
  }));

  return { layouts, custom_views: customViews, validation_rules: validationRules, assignment_rules: assignmentRules, approval_rules: approvalRules, pipelines };
}

function copyCurrentMirroredRuntime(value) {
  const input = object(value, 'current_mirrored_runtime');
  const batchingInput = object(input.batching, 'current_mirrored_runtime.batching');
  const fieldsInput = object(input.fields, 'current_mirrored_runtime.fields');
  const layoutsInput = object(input.layouts, 'current_mirrored_runtime.layouts');
  const viewsInput = object(input.custom_views, 'current_mirrored_runtime.custom_views');
  const compilationInput = object(viewsInput.compilation, 'current_mirrored_runtime.custom_views.compilation');
  const systemInput = object(viewsInput.system_defined_compilation, 'current_mirrored_runtime.custom_views.system_defined_compilation');
  const defaultsInput = object(viewsInput.default_compilation, 'current_mirrored_runtime.custom_views.default_compilation');
  const expected = EXPECTED_CURRENT_MIRRORED_RUNTIME;

  function copyCompilation(section, label, values) {
    const output = {
      definitions_reviewed: exact(integer(section.definitions_reviewed, `${label}.definitions_reviewed`), values.reviewed, `${label}.definitions_reviewed`),
      executable_criteria_definitions: exact(integer(section.executable_criteria_definitions, `${label}.executable_criteria_definitions`), values.executable, `${label}.executable_criteria_definitions`),
      explicitly_safe_unfiltered_definitions: exact(integer(section.explicitly_safe_unfiltered_definitions, `${label}.explicitly_safe_unfiltered_definitions`), values.unfiltered, `${label}.explicitly_safe_unfiltered_definitions`),
      unresolved_criteria_bodies: exact(integer(section.unresolved_criteria_bodies, `${label}.unresolved_criteria_bodies`), values.unresolved, `${label}.unresolved_criteria_bodies`),
      unsupported_criteria_definitions: exact(integer(section.unsupported_criteria_definitions, `${label}.unsupported_criteria_definitions`), values.unsupported, `${label}.unsupported_criteria_definitions`),
      compiled_definitions: exact(integer(section.compiled_definitions, `${label}.compiled_definitions`), values.compiled, `${label}.compiled_definitions`),
      blocked_definitions: exact(integer(section.blocked_definitions, `${label}.blocked_definitions`), values.blocked, `${label}.blocked_definitions`),
    };
    exact(output.executable_criteria_definitions + output.explicitly_safe_unfiltered_definitions, output.compiled_definitions, `${label}.compiled_total`);
    exact(output.unresolved_criteria_bodies + output.unsupported_criteria_definitions, output.blocked_definitions, `${label}.blocked_total`);
    exact(output.compiled_definitions + output.blocked_definitions, output.definitions_reviewed, `${label}.reviewed_total`);
    return output;
  }

  const compilation = copyCompilation(compilationInput, 'current_mirrored_runtime.custom_views.compilation', {
    reviewed: expected.definitions,
    executable: expected.executable_criteria,
    unfiltered: expected.explicitly_safe_unfiltered,
    unresolved: expected.unresolved_criteria,
    unsupported: expected.unsupported_criteria,
    compiled: expected.compiled,
    blocked: expected.blocked,
  });
  const systemCompilation = copyCompilation(systemInput, 'current_mirrored_runtime.custom_views.system_defined_compilation', {
    reviewed: expected.system_reviewed,
    executable: expected.system_executable_criteria,
    unfiltered: expected.system_explicitly_safe_unfiltered,
    unresolved: expected.system_unresolved_criteria,
    unsupported: expected.system_unsupported_criteria,
    compiled: expected.system_compiled,
    blocked: expected.system_blocked,
  });
  const defaultCompilation = {
    ...copyCompilation(defaultsInput, 'current_mirrored_runtime.custom_views.default_compilation', {
      reviewed: expected.defaults_reviewed,
      executable: expected.defaults_executable_criteria,
      unfiltered: expected.defaults_explicitly_safe_unfiltered,
      unresolved: expected.defaults_unresolved_criteria,
      unsupported: expected.defaults_unsupported_criteria,
      compiled: expected.defaults_compiled,
      blocked: expected.defaults_blocked,
    }),
    blocking_dynamic_families: exactStringArray(defaultsInput.blocking_dynamic_families, ['CURRENTUSER', 'TODAYANDOVERDUE'], 'current_mirrored_runtime.custom_views.default_compilation.blocking_dynamic_families'),
  };

  return {
    audit_scope: exact(string(input.audit_scope, 'current_mirrored_runtime.audit_scope'), 'Exact aggregate of hydrated local crm_meta fields, layouts, and custom views; separate from the historical offline source-discovery snapshot.', 'current_mirrored_runtime.audit_scope'),
    evidence_mode: exact(string(input.evidence_mode, 'current_mirrored_runtime.evidence_mode'), 'Batched SELECT-only crm_meta reads plus the production custom-view compiler; no CRM records or source requests.', 'current_mirrored_runtime.evidence_mode'),
    local_database_queried_during_generation: exact(boolean(input.local_database_queried_during_generation, 'current_mirrored_runtime.local_database_queried_during_generation'), true, 'current_mirrored_runtime.local_database_queried_during_generation'),
    source_contacted_during_generation: exact(boolean(input.source_contacted_during_generation, 'current_mirrored_runtime.source_contacted_during_generation'), false, 'current_mirrored_runtime.source_contacted_during_generation'),
    source_mutations: exact(boolean(input.source_mutations, 'current_mirrored_runtime.source_mutations'), false, 'current_mirrored_runtime.source_mutations'),
    local_mutations: exact(boolean(input.local_mutations, 'current_mirrored_runtime.local_mutations'), false, 'current_mirrored_runtime.local_mutations'),
    batching: {
      metadata_key_rows: exact(integer(batchingInput.metadata_key_rows, 'current_mirrored_runtime.batching.metadata_key_rows'), expected.metadata_key_rows, 'current_mirrored_runtime.batching.metadata_key_rows'),
      batch_size: exact(integer(batchingInput.batch_size, 'current_mirrored_runtime.batching.batch_size'), expected.batch_size, 'current_mirrored_runtime.batching.batch_size'),
      value_batches: exact(integer(batchingInput.value_batches, 'current_mirrored_runtime.batching.value_batches'), expected.value_batches, 'current_mirrored_runtime.batching.value_batches'),
      maximum_concurrency: exact(integer(batchingInput.maximum_concurrency, 'current_mirrored_runtime.batching.maximum_concurrency'), expected.maximum_concurrency, 'current_mirrored_runtime.batching.maximum_concurrency'),
    },
    modules_cataloged: exact(integer(input.modules_cataloged, 'current_mirrored_runtime.modules_cataloged'), expected.modules, 'current_mirrored_runtime.modules_cataloged'),
    fields: {
      metadata_scopes: exact(integer(fieldsInput.metadata_scopes, 'current_mirrored_runtime.fields.metadata_scopes'), expected.field_scopes, 'current_mirrored_runtime.fields.metadata_scopes'),
      modules_with_definitions: exact(integer(fieldsInput.modules_with_definitions, 'current_mirrored_runtime.fields.modules_with_definitions'), expected.field_modules, 'current_mirrored_runtime.fields.modules_with_definitions'),
      empty_scopes: exact(integer(fieldsInput.empty_scopes, 'current_mirrored_runtime.fields.empty_scopes'), expected.field_empty_scopes, 'current_mirrored_runtime.fields.empty_scopes'),
      definitions_mirrored: exact(integer(fieldsInput.definitions_mirrored, 'current_mirrored_runtime.fields.definitions_mirrored'), expected.field_definitions, 'current_mirrored_runtime.fields.definitions_mirrored'),
    },
    layouts: {
      metadata_scopes: exact(integer(layoutsInput.metadata_scopes, 'current_mirrored_runtime.layouts.metadata_scopes'), expected.layout_scopes, 'current_mirrored_runtime.layouts.metadata_scopes'),
      modules_with_definitions: exact(integer(layoutsInput.modules_with_definitions, 'current_mirrored_runtime.layouts.modules_with_definitions'), expected.layout_modules, 'current_mirrored_runtime.layouts.modules_with_definitions'),
      empty_scopes: exact(integer(layoutsInput.empty_scopes, 'current_mirrored_runtime.layouts.empty_scopes'), expected.layout_empty_scopes, 'current_mirrored_runtime.layouts.empty_scopes'),
      definitions_mirrored: exact(integer(layoutsInput.definitions_mirrored, 'current_mirrored_runtime.layouts.definitions_mirrored'), expected.layout_definitions, 'current_mirrored_runtime.layouts.definitions_mirrored'),
      definitions_with_sections_property: exact(integer(layoutsInput.definitions_with_sections_property, 'current_mirrored_runtime.layouts.definitions_with_sections_property'), expected.layout_definitions, 'current_mirrored_runtime.layouts.definitions_with_sections_property'),
      definitions_with_nonempty_sections: exact(integer(layoutsInput.definitions_with_nonempty_sections, 'current_mirrored_runtime.layouts.definitions_with_nonempty_sections'), 69, 'current_mirrored_runtime.layouts.definitions_with_nonempty_sections'),
      sections_mirrored: exact(integer(layoutsInput.sections_mirrored, 'current_mirrored_runtime.layouts.sections_mirrored'), expected.layout_sections, 'current_mirrored_runtime.layouts.sections_mirrored'),
      layout_field_references: exact(integer(layoutsInput.layout_field_references, 'current_mirrored_runtime.layouts.layout_field_references'), expected.layout_field_references, 'current_mirrored_runtime.layouts.layout_field_references'),
    },
    custom_views: {
      metadata_scopes: exact(integer(viewsInput.metadata_scopes, 'current_mirrored_runtime.custom_views.metadata_scopes'), expected.view_scopes, 'current_mirrored_runtime.custom_views.metadata_scopes'),
      modules_with_definitions: exact(integer(viewsInput.modules_with_definitions, 'current_mirrored_runtime.custom_views.modules_with_definitions'), expected.view_modules, 'current_mirrored_runtime.custom_views.modules_with_definitions'),
      empty_scopes: exact(integer(viewsInput.empty_scopes, 'current_mirrored_runtime.custom_views.empty_scopes'), expected.view_empty_scopes, 'current_mirrored_runtime.custom_views.empty_scopes'),
      definitions_mirrored: exact(integer(viewsInput.definitions_mirrored, 'current_mirrored_runtime.custom_views.definitions_mirrored'), expected.definitions, 'current_mirrored_runtime.custom_views.definitions_mirrored'),
      criteria_bearing_definitions: exact(integer(viewsInput.criteria_bearing_definitions, 'current_mirrored_runtime.custom_views.criteria_bearing_definitions'), expected.criteria_definitions, 'current_mirrored_runtime.custom_views.criteria_bearing_definitions'),
      criteria_leaf_count: exact(integer(viewsInput.criteria_leaf_count, 'current_mirrored_runtime.custom_views.criteria_leaf_count'), expected.criteria_leaves, 'current_mirrored_runtime.custom_views.criteria_leaf_count'),
      compilation,
      system_defined_compilation: systemCompilation,
      default_compilation: defaultCompilation,
      compiler_error_codes: statusCounts(viewsInput.compiler_error_codes, {
        CUSTOM_VIEW_CRITERIA_UNAVAILABLE: expected.unresolved_criteria,
        CUSTOM_VIEW_CRITERIA_UNSUPPORTED: expected.unsupported_criteria,
      }, 'current_mirrored_runtime.custom_views.compiler_error_codes'),
      implicit_unsupported_default_behavior: exact(string(viewsInput.implicit_unsupported_default_behavior, 'current_mirrored_runtime.custom_views.implicit_unsupported_default_behavior'), 'Visible fallback to an explicitly safe unfiltered mirrored view.', 'current_mirrored_runtime.custom_views.implicit_unsupported_default_behavior'),
      explicit_unsupported_selection_decision: exact(string(viewsInput.explicit_unsupported_selection_decision, 'current_mirrored_runtime.custom_views.explicit_unsupported_selection_decision'), 'Deny', 'current_mirrored_runtime.custom_views.explicit_unsupported_selection_decision'),
      source_equivalence: exact(string(viewsInput.source_equivalence, 'current_mirrored_runtime.custom_views.source_equivalence'), 'Partial; unresolved and unsupported criteria remain blocked.', 'current_mirrored_runtime.custom_views.source_equivalence'),
      status: exact(string(viewsInput.status, 'current_mirrored_runtime.custom_views.status'), 'Partially implemented; fail-closed', 'current_mirrored_runtime.custom_views.status'),
    },
  };
}

function copyEvidenceScope(value) {
  const input = object(value, 'evidence_scope');
  const output = {
    modules_cataloged: exact(integer(input.modules_cataloged, 'evidence_scope.modules_cataloged'), EXPECTED_COUNTS.modules, 'evidence_scope.modules_cataloged'),
    offline_source_artifacts_only: exact(boolean(input.offline_source_artifacts_only, 'evidence_scope.offline_source_artifacts_only'), true, 'evidence_scope.offline_source_artifacts_only'),
    source_contacted: exact(boolean(input.source_contacted, 'evidence_scope.source_contacted'), false, 'evidence_scope.source_contacted'),
    source_mutations: exact(boolean(input.source_mutations, 'evidence_scope.source_mutations'), false, 'evidence_scope.source_mutations'),
    local_database_queried: exact(boolean(input.local_database_queried, 'evidence_scope.local_database_queried'), true, 'evidence_scope.local_database_queried'),
    local_database_query_scope: exact(string(input.local_database_query_scope, 'evidence_scope.local_database_query_scope', 240), 'SELECT-only crm_meta fields, layouts, views, and module catalog.', 'evidence_scope.local_database_query_scope'),
    local_database_mutations: exact(boolean(input.local_database_mutations, 'evidence_scope.local_database_mutations'), false, 'evidence_scope.local_database_mutations'),
    module_level_rows_included: exact(boolean(input.module_level_rows_included, 'evidence_scope.module_level_rows_included'), false, 'evidence_scope.module_level_rows_included'),
    configuration_names_included: exact(boolean(input.configuration_names_included, 'evidence_scope.configuration_names_included'), false, 'evidence_scope.configuration_names_included'),
    record_values_included: exact(boolean(input.record_values_included, 'evidence_scope.record_values_included'), false, 'evidence_scope.record_values_included'),
    limitations: stringArray(input.limitations, 'evidence_scope.limitations', 10),
  };
  if (output.limitations.length !== 3) throw new Error('evidence_scope.limitations must preserve all reviewed limitations.');
  return output;
}

function copyBoundary(value) {
  const input = object(value, 'enforcement_boundary');
  return {
    source_rule_execution_enabled: exact(boolean(input.source_rule_execution_enabled, 'enforcement_boundary.source_rule_execution_enabled'), false, 'enforcement_boundary.source_rule_execution_enabled'),
    source_rule_mutations_enabled: exact(boolean(input.source_rule_mutations_enabled, 'enforcement_boundary.source_rule_mutations_enabled'), false, 'enforcement_boundary.source_rule_mutations_enabled'),
    caller_supplied_rule_outcomes_trusted: exact(boolean(input.caller_supplied_rule_outcomes_trusted, 'enforcement_boundary.caller_supplied_rule_outcomes_trusted'), false, 'enforcement_boundary.caller_supplied_rule_outcomes_trusted'),
    default_rule_decision: exact(string(input.default_rule_decision, 'enforcement_boundary.default_rule_decision'), 'Deny', 'enforcement_boundary.default_rule_decision'),
    validation_rule_decision: exact(string(input.validation_rule_decision, 'enforcement_boundary.validation_rule_decision'), 'Deny', 'enforcement_boundary.validation_rule_decision'),
    assignment_rule_decision: exact(string(input.assignment_rule_decision, 'enforcement_boundary.assignment_rule_decision'), 'Deny', 'enforcement_boundary.assignment_rule_decision'),
    approval_rule_decision: exact(string(input.approval_rule_decision, 'enforcement_boundary.approval_rule_decision'), 'Deny', 'enforcement_boundary.approval_rule_decision'),
    pipeline_decision: exact(string(input.pipeline_decision, 'enforcement_boundary.pipeline_decision'), 'Deny', 'enforcement_boundary.pipeline_decision'),
    status: exact(string(input.status, 'enforcement_boundary.status'), 'Fail-closed', 'enforcement_boundary.status'),
    reason: string(input.reason, 'enforcement_boundary.reason'),
  };
}

function copyPrivacy(value) {
  const input = object(value, 'privacy');
  const keys = [
    'source_identifiers_included', 'configuration_names_included', 'individual_identities_included',
    'record_data_included', 'communication_targets_included', 'sensitive_values_included', 'private_locations_included',
  ];
  return Object.fromEntries(keys.map(key => [key, exact(boolean(input[key], `privacy.${key}`), false, `privacy.${key}`)]));
}

function buildRuleLayoutCoverage(value) {
  const input = object(value, 'coverage');
  assertNoSensitiveData(input);
  const output = {
    schema_version: exact(integer(input.schema_version, 'schema_version'), 2, 'schema_version'),
    generated_at: string(input.generated_at, 'generated_at', 80),
    source_snapshot_generated_at: string(input.source_snapshot_generated_at, 'source_snapshot_generated_at', 80),
    audit_mode: string(input.audit_mode, 'audit_mode'),
    evidence_scope: copyEvidenceScope(input.evidence_scope),
    source_coverage: copySourceCoverage(input.source_coverage),
    current_mirrored_runtime: copyCurrentMirroredRuntime(input.current_mirrored_runtime),
    local_enforcement: copyLocalEnforcement(input.local_enforcement),
    enforcement_boundary: copyBoundary(input.enforcement_boundary),
    privacy: copyPrivacy(input.privacy),
  };
  assertNoSensitiveData(output);
  return output;
}

function getRuleLayoutCoverage() {
  return buildRuleLayoutCoverage(RAW_COVERAGE);
}

function evaluateSourceRuleExecution(request = {}) {
  const requested = typeof request.rule_family === 'string' ? request.rule_family : '';
  const recognized = RULE_FAMILIES.includes(requested);
  return {
    allowed: false,
    status: 'Blocked',
    code: recognized ? 'SOURCE_RULE_EXECUTION_UNAVAILABLE' : 'UNSUPPORTED_RULE_FAMILY',
    rule_family: recognized ? requested : 'unknown',
    reason: recognized
      ? 'Complete source execution evidence is unavailable and no reviewed local interpreter is enabled.'
      : 'Only reviewed source rule families may be evaluated, and all remain disabled.',
  };
}

module.exports = {
  EXPECTED_CURRENT_MIRRORED_RUNTIME,
  EXPECTED_COUNTS,
  RULE_FAMILIES,
  buildRuleLayoutCoverage,
  evaluateSourceRuleExecution,
  getRuleLayoutCoverage,
};
