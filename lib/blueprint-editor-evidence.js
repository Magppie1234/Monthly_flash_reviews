'use strict';

const DEALS_BLUEPRINT_ID = '1032257000000535747';
const EXPECTED_ORG_DOMAIN = 'org60046349006';
const FORBIDDEN_PUBLIC_VALUE = /(?:https?:\/\/|Zoho-oauthtoken|client_secret|refresh_token|access_token|authorization|cookie|\/Users\/)/i;

class BlueprintEditorEvidenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BlueprintEditorEvidenceError';
    this.code = code;
    this.details = details;
  }
}

const arr = value => Array.isArray(value) ? value : [];
const idOf = value => value === null || value === undefined ? '' : String(value);
const hasOwn = (value, key) => Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));

function fail(condition, code, message, details = {}) {
  if (!condition) throw new BlueprintEditorEvidenceError(code, message, details);
}

function validateDealsEditorArtifact(artifact, blueprint) {
  fail(artifact && typeof artifact === 'object' && !Array.isArray(artifact), 'ARTIFACT_INVALID', 'Deals Blueprint editor evidence must be an object.');
  fail(artifact.source_writes === 0, 'SOURCE_WRITE_BOUNDARY_INVALID', 'Deals Blueprint evidence must prove zero source writes.');
  fail(artifact.source_mode === 'authenticated-read-only-ui-get', 'SOURCE_MODE_INVALID', 'Deals Blueprint evidence must come from the authenticated read-only editor GET path.');
  fail(artifact.organization?.domain_name === EXPECTED_ORG_DOMAIN, 'ORG_MISMATCH', `Deals Blueprint evidence must belong to ${EXPECTED_ORG_DOMAIN}.`);
  fail(artifact.transport?.method === 'GET', 'TRANSPORT_INVALID', 'Deals Blueprint editor transport must be GET-only.');
  fail(artifact.transport?.requests_succeeded === 80 && artifact.transport?.requests_failed === 0, 'TRANSPORT_INCOMPLETE', 'Deals Blueprint editor evidence must contain 80 successful GET responses and no failed requests.');
  fail(idOf(artifact.blueprint?.id) === DEALS_BLUEPRINT_ID && artifact.blueprint?.module === 'Deals', 'BLUEPRINT_MISMATCH', 'Deals Blueprint evidence identifies an unexpected Blueprint.');
  fail(artifact.blueprint?.total_transitions === 80 && artifact.blueprint?.phase_details_captured === 80, 'PHASE_COVERAGE_INCOMPLETE', 'Deals Blueprint evidence must cover all 80 transitions.');
  fail(blueprint && idOf(blueprint.id) === DEALS_BLUEPRINT_ID, 'GRAPH_MISSING', 'The authoritative Deals Blueprint graph is unavailable.');

  const graphById = new Map(arr(blueprint.transitions).map(transition => [idOf(transition.id), transition]));
  const returnedById = new Map();
  for (const transition of arr(artifact.transitions)) {
    const transitionId = idOf(transition?.id);
    fail(transitionId && graphById.has(transitionId), 'UNEXPECTED_TRANSITION', 'Deals editor evidence contains an unexpected transition.', { transition_id: transitionId || null });
    fail(!returnedById.has(transitionId), 'DUPLICATE_TRANSITION', 'Deals editor evidence contains a duplicate transition.', { transition_id: transitionId });
    const graph = graphById.get(transitionId);
    fail(transition.name === graph.name, 'TRANSITION_NAME_DRIFT', 'Deals editor evidence transition name differs from the authoritative graph.', { transition_id: transitionId });
    fail(Boolean(transition.common) === Boolean(graph.global), 'TRANSITION_COMMON_DRIFT', 'Deals editor evidence common-transition flag differs from the authoritative graph.', { transition_id: transitionId });
    fail(idOf(transition.source_state_id) === idOf(graph.from?.id) && idOf(transition.target_state_id) === idOf(graph.to?.id), 'TRANSITION_EDGE_DRIFT', 'Deals editor evidence transition edge differs from the authoritative graph.', { transition_id: transitionId });
    fail(transition.before && Array.isArray(transition.before.owners) && Array.isArray(transition.during) && transition.after && typeof transition.after === 'object', 'PHASE_KEYS_INCOMPLETE', 'Deals editor evidence is missing Before, During, or After phase data.', { transition_id: transitionId });
    fail(transition.source_response?.http_status === 200 && transition.source_response?.status === 'Success', 'SOURCE_RESPONSE_INVALID', 'Deals editor transition response was not a successful HTTP 200 response.', { transition_id: transitionId });
    returnedById.set(transitionId, transition);
  }
  fail(returnedById.size === 80 && returnedById.size === graphById.size, 'TRANSITION_RECONCILIATION_FAILED', 'Deals editor evidence does not reconcile exactly to the 80-transition graph.', { returned: returnedById.size, expected: graphById.size });

  const validation = artifact.validation || {};
  for (const key of ['config_count', 'graph_count', 'returned_count', 'unique_ids', 'http_200', 'status_success', 'id_match', 'name_match', 'phase_keys_complete']) {
    fail(validation[key] === 80, 'CAPTURE_VALIDATION_INCOMPLETE', `Deals editor capture validation ${key} must equal 80.`);
  }
  for (const key of ['graph_manifest_missing', 'graph_manifest_extra', 'graph_name_drift', 'graph_common_drift', 'graph_edge_drift']) {
    fail(validation[key] === 0, 'CAPTURE_VALIDATION_DRIFT', `Deals editor capture validation ${key} must equal zero.`);
  }
  fail(validation.ui_fields_mapped_to_v8 === validation.ui_field_metadata_count && validation.during_field_ids_mapped === validation.during_field_ids_unique, 'FIELD_MAPPING_INCOMPLETE', 'Deals editor field metadata is not fully mapped to current API names.');
  return arr(blueprint.transitions).map(transition => returnedById.get(idOf(transition.id)));
}

function normalizeOwners(owners) {
  let recordOwner = false;
  let allUsers = false;
  let specificUsers = 0;
  let roles = 0;
  let unknown = 0;
  for (const owner of arr(owners)) {
    const type = String(owner?.type || '').toLowerCase();
    if (type === 'recordowner') recordOwner = true;
    else if (type === 'user' && idOf(owner?.id) === '-1' && !owner?.name) allUsers = true;
    else if (type === 'user') specificUsers += 1;
    else if (type === 'role') roles += 1;
    else unknown += 1;
  }
  const labels = [];
  if (recordOwner) labels.push('Record Owner');
  if (allUsers) labels.push('All Users');
  if (specificUsers) labels.push(`Specific Users (${specificUsers})`);
  if (roles) labels.push(`Roles (${roles})`);
  if (unknown) labels.push(`Unresolved Owners (${unknown})`);
  return labels;
}

function fieldMapFromArtifact(artifact) {
  return new Map(arr(artifact.field_metadata).flatMap(field => {
    const label = String(field?.field_label || field?.label || '').trim();
    return label && field?.api_name ? [[label, String(field.api_name)]] : [];
  }));
}

function normalizeCriteria(criteriaText, fieldMap) {
  const displayText = String(criteriaText || '').replace(/\s+/g, ' ').trim();
  if (!displayText) return { criteria: [], criteria_display_text: '', criteria_logic_supported: true };
  // The editor endpoint returns display text/HTML, not Zoho's structured
  // criteria tree. Preserve the text for audit, but never infer precedence,
  // empty-value semantics, comparator behavior, or execution eligibility.
  void fieldMap;
  return { criteria: [], criteria_display_text: displayText, criteria_logic_supported: false };
}

function parseChecklist(input) {
  try {
    const parsed = JSON.parse(input.CheckLists);
    const flags = typeof parsed.checkListsOpt === 'string' ? JSON.parse(parsed.checkListsOpt) : arr(parsed.checkListsOpt);
    return {
      title: String(parsed.title || 'Checklist'),
      items: arr(parsed.checkLists).map(String),
      option_flags: arr(flags).map(Boolean),
    };
  } catch {
    throw new BlueprintEditorEvidenceError('CHECKLIST_INVALID', 'Deals editor evidence contains an invalid During-phase checklist.');
  }
}

function normalizeDuringInput(input, index) {
  const sourceType = String(input?.Type || '');
  const sequence = index + 1;
  if (sourceType === 'Field') {
    fail(input.field?.api_name && input.field?.field_label && input.field?.data_type, 'DURING_FIELD_UNMAPPED', 'A Deals During-phase field lacks current API metadata.');
    return {
      kind: 'field',
      api_name: String(input.field.api_name),
      label: String(input.field.field_label),
      data_type: String(input.field.data_type),
      required: input.IsNonMandatory === false,
      sequence,
    };
  }
  if (sourceType === 'Note') {
    return { kind: 'associated_item', api_name: 'Notes', label: 'Notes', data_type: 'associated_item', required: input.IsNotesMandate === true, sequence };
  }
  if (sourceType === 'Attachment') {
    return { kind: 'associated_item', api_name: 'Attachments', label: 'Attachments', data_type: 'associated_item', required: input.IsAttachMandate === true, sequence };
  }
  if (sourceType === 'Info') {
    return { kind: 'message', api_name: null, label: 'Message', data_type: 'message', required: false, sequence, message: String(input.Info || '') };
  }
  if (sourceType === 'checkList') {
    const checklist = parseChecklist(input);
    return { kind: 'checklist', api_name: null, label: checklist.title, data_type: 'checklist', required: null, sequence, checklist };
  }
  throw new BlueprintEditorEvidenceError('DURING_TYPE_UNSUPPORTED', `Unsupported Deals During-phase input type: ${sourceType || 'missing'}.`);
}

const AFTER_ACTION_TYPES = Object.freeze({
  Alert: 'email_notification',
  Task: 'task',
  AddMeeting: 'meeting',
  Fieldupdate: 'field_update',
  CreateRecord: 'create_record',
  Webhook: 'webhook',
  Deluge: 'custom_action',
  Circuits: 'circuit',
  AddTags: 'add_tags',
  RemoveTags: 'remove_tags',
});

function normalizeAfterActions(after) {
  const actions = [];
  for (const [sourceType, publicType] of Object.entries(AFTER_ACTION_TYPES)) {
    for (const action of arr(after?.[sourceType])) {
      actions.push({
        type: publicType,
        name: action?.Name ? String(action.Name) : null,
        details: null,
        details_present: false,
      });
    }
  }
  return actions;
}

function normalizeDealsEditorEvidence(artifact, blueprint) {
  const ordered = validateDealsEditorArtifact(artifact, blueprint);
  const fields = fieldMapFromArtifact(artifact);
  const transitions = {};
  for (const source of ordered) {
    const criteria = normalizeCriteria(source.before.criteria_text, fields);
    transitions[idOf(source.id)] = {
      name: source.name,
      common: Boolean(source.common),
      trigger_type: source.trigger_type || 'manual',
      before: {
        owners: normalizeOwners(source.before.owners),
        criteria: criteria.criteria,
        criteria_display_text: criteria.criteria_display_text,
        criteria_logic_supported: criteria.criteria_logic_supported,
        criteria_evidence_complete: true,
      },
      during_inputs: arr(source.during).map(normalizeDuringInput),
      after_actions: normalizeAfterActions(source.after),
      local_execution: 'Blocked',
      block_reason: 'Captured from authenticated read-only source editor GET responses. Local execution remains blocked until source-equivalent identity and permission rules, every During input, and every After action are implemented and tested.',
      source_evidence: {
        method: 'authenticated-read-only-ui-get',
        phase_keys_complete: true,
      },
    };
  }
  const output = {
    name: artifact.blueprint.name,
    module: 'Deals',
    phase_coverage: 'Specified: 80 of 80 transitions',
    transitions,
  };
  const serialized = JSON.stringify(output);
  fail(!FORBIDDEN_PUBLIC_VALUE.test(serialized), 'PUBLIC_SANITIZATION_FAILED', 'Sanitized Deals Blueprint evidence contains a forbidden public value.');
  fail(!/Gursharan|Sachin|Mehul/i.test(serialized), 'PUBLIC_IDENTITY_LEAK', 'Sanitized Deals Blueprint evidence contains a source identity.');
  return output;
}

function mergeDealsEditorEvidence(current, artifact, blueprint) {
  const merged = JSON.parse(JSON.stringify(current));
  merged.version = merged.version || 1;
  merged.generated_at = artifact.captured_at;
  merged.source_mode = 'mixed-read-only-inspection';
  merged.blueprints = merged.blueprints && typeof merged.blueprints === 'object' ? merged.blueprints : {};
  merged.blueprints[DEALS_BLUEPRINT_ID] = normalizeDealsEditorEvidence(artifact, blueprint);
  return merged;
}

module.exports = {
  AFTER_ACTION_TYPES,
  BlueprintEditorEvidenceError,
  DEALS_BLUEPRINT_ID,
  EXPECTED_ORG_DOMAIN,
  mergeDealsEditorEvidence,
  normalizeAfterActions,
  normalizeCriteria,
  normalizeDealsEditorEvidence,
  normalizeDuringInput,
  normalizeOwners,
  validateDealsEditorArtifact,
};
