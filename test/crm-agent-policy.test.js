'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CrmAgentPolicyError,
  LIMITS,
  getCrmAgentAvailability,
  normalizePermissionContext,
  prepareRecordCreationDraft,
  sanitizeDetailResult,
  sanitizeMetadataResult,
  sanitizeSearchResult,
  validateAggregateInput,
  validateDetailInput,
  validateDraftInput,
  validateMetadataInput,
  validateSearchInput,
} = require('../lib/crm-agent-policy');

function permissions() {
  return normalizePermissionContext({
    modules: {
      Leads: {
        aggregate: true,
        search: true,
        detail: true,
        metadata: true,
        create_draft: true,
        readable_fields: ['id', 'Full_Name', 'Last_Name', 'Email', 'Lead_Status', 'Owner', 'Notes'],
        aggregate_fields: ['Lead_Status', 'Owner'],
        writable_fields: ['Last_Name', 'Email', 'Lead_Status', 'Notes'],
      },
      Deals: {
        aggregate: true,
        search: false,
        detail: false,
        metadata: true,
        create_draft: false,
        readable_fields: ['id', 'Deal_Name', 'Stage'],
        aggregate_fields: ['Stage'],
        writable_fields: [],
      },
      Tasks: {
        aggregate: true,
        search: true,
        detail: true,
        metadata: true,
        create_draft: false,
        readable_fields: ['id', 'Subject', 'Due_Date', 'Status'],
        aggregate_fields: ['Due_Date', 'Status'],
        writable_fields: [],
      },
    },
  });
}

const leadMetadata = {
  definition_complete: true,
  layout_resolved: true,
  fields: [
    { api_name: 'id', field_label: 'ID', data_type: 'bigint', read_only: true },
    { api_name: 'Last_Name', field_label: 'Last Name', data_type: 'text', system_mandatory: true },
    { api_name: 'Email', field_label: 'Email', data_type: 'email' },
    { api_name: 'Lead_Status', field_label: 'Lead Status', data_type: 'picklist', required: true, pick_list_values: [{ actual_value: 'New' }, { actual_value: 'Qualified' }] },
    { api_name: 'Notes', field_label: 'Notes', data_type: 'textarea' },
    { api_name: 'Owner', field_label: 'Owner', data_type: 'ownerlookup', read_only: true, required: true },
    { api_name: 'Hidden_Field', field_label: 'Hidden', data_type: 'text' },
    { api_name: 'Password', field_label: 'Password', data_type: 'text' },
  ],
};

test('agent availability has a deterministic no-key fallback and never echoes credentials', () => {
  const first = getCrmAgentAvailability({});
  const second = getCrmAgentAvailability({ AI_GATEWAY_API_KEY: '', VERCEL_OIDC_TOKEN: '' });
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    available: false,
    status: 'Unavailable',
    reason_code: 'AI_GATEWAY_CREDENTIAL_MISSING',
    model: 'openai/gpt-5.6-sol',
    fallback: {
      mode: 'DeterministicLocalOnly',
      message: 'AI model unavailable. Keyless local mode can answer up to seven reviewed CRM questions after permission and schema preflight, with no model or network call.',
    },
  });
  const available = getCrmAgentAvailability({ AI_GATEWAY_API_KEY: 'do-not-expose', CRM_AGENT_MODEL: 'openai/gpt-5.6-sol' });
  assert.equal(available.available, true);
  assert.equal(available.model, 'openai/gpt-5.6-sol');
  assert.doesNotMatch(JSON.stringify(available), /do-not-expose/);
  assert.equal(getCrmAgentAvailability({ VERCEL_OIDC_TOKEN: 'do-not-expose', CRM_AGENT_MODEL: 'invalid model' }).reason_code, 'CRM_AGENT_MODEL_INVALID');
});

test('permission context is explicit, field-bounded, and credential-sensitive fields are rejected', () => {
  const scope = permissions();
  assert.equal(scope.modules.Leads.search, true);
  assert.ok(Object.isFrozen(scope));
  assert.throws(() => normalizePermissionContext({
    modules: {
      Leads: {
        aggregate: true, search: true, detail: true, metadata: true, create_draft: true,
        readable_fields: ['*'], aggregate_fields: [], writable_fields: [],
      },
    },
  }), error => error instanceof CrmAgentPolicyError && error.code === 'AGENT_INPUT_INVALID');
  assert.throws(() => normalizePermissionContext({
    modules: {
      Leads: {
        aggregate: true, search: true, detail: true, metadata: true, create_draft: true,
        readable_fields: ['Password'], aggregate_fields: [], writable_fields: [],
      },
    },
  }), error => error instanceof CrmAgentPolicyError && error.code === 'AGENT_SENSITIVE_FIELD_BLOCKED');
});

test('aggregate validation accepts only bounded structured queries and never arbitrary SQL', () => {
  const query = validateAggregateInput({
    module: 'Leads',
    group_by: 'Lead_Status',
    filters: [{ field: 'Lead_Status', operator: 'in', value: ['New', 'Qualified'] }],
    limit: 25,
  }, permissions());
  assert.deepEqual(query, {
    module: 'Leads', group_by: 'Lead_Status',
    filters: [{ field: 'Lead_Status', operator: 'in', value: ['New', 'Qualified'] }],
    limit: 25,
  });
  assert.throws(() => validateAggregateInput({ module: 'Leads', sql: 'select * from crm_records' }, permissions()), /unsupported property/);
  assert.throws(() => validateAggregateInput({ module: 'Leads', group_by: 'Email' }, permissions()), error => error.code === 'AGENT_PERMISSION_DENIED');
  assert.throws(() => validateAggregateInput({ module: 'Leads', limit: 51 }, permissions()), /between 1 and 50/);
});

test('record, search, and metadata inputs are permission-aware and bounded', () => {
  assert.deepEqual(validateSearchInput({ module: 'Leads', query: 'Acme', limit: 20 }, permissions()), { module: 'Leads', query: 'Acme', overdue_only: false, limit: 20 });
  assert.deepEqual(validateSearchInput({ module: 'Tasks', overdue_only: true, limit: 10 }, permissions()), { module: 'Tasks', query: '', overdue_only: true, limit: 10 });
  assert.throws(() => validateSearchInput({ module: 'Leads', overdue_only: true }, permissions()), error => error.code === 'AGENT_INPUT_INVALID');
  assert.throws(() => validateSearchInput({ module: 'Tasks', query: 'late', overdue_only: true }, permissions()), error => error.code === 'AGENT_INPUT_INVALID');
  assert.throws(() => validateSearchInput({ module: 'Deals', query: 'Acme' }, permissions()), error => error.code === 'AGENT_PERMISSION_DENIED');
  assert.deepEqual(validateDetailInput({ module: 'Leads', record_id: 'local-123' }, permissions()), { module: 'Leads', record_id: 'local-123' });
  assert.throws(() => validateDetailInput({ module: 'Leads', record_id: '../secret' }, permissions()), /record_id/);
  assert.deepEqual(validateMetadataInput({ module: 'Leads', required_only: true }, permissions()), { module: 'Leads', required_only: true, limit: 100 });
});

test('record creation inputs are draft-only, writable-field scoped, and scrub credential-shaped text', () => {
  const draft = validateDraftInput({
    module: 'Leads',
    values: { Last_Name: 'Rao', Notes: 'token=super-secret-value and Bearer abcdefghi' },
  }, permissions());
  assert.equal(draft.values.Last_Name, 'Rao');
  assert.doesNotMatch(draft.values.Notes, /super-secret-value|abcdefghi/);
  assert.match(draft.values.Notes, /credential omitted/);
  assert.throws(() => validateDraftInput({ module: 'Leads', values: { Owner: { id: 'user-1' } } }, permissions()), error => error.code === 'AGENT_PERMISSION_DENIED');
  assert.throws(() => validateDraftInput({ module: 'Leads', values: { Password: 'x' } }, permissions()), error => ['AGENT_SENSITIVE_FIELD_BLOCKED', 'AGENT_PERMISSION_DENIED'].includes(error.code));

  const wideFields = Array.from({ length: 40 }, (_, index) => `Field_${index}`);
  const wideScope = normalizePermissionContext({
    modules: {
      Leads: {
        aggregate: false, search: false, detail: false, metadata: true, create_draft: true,
        readable_fields: wideFields, aggregate_fields: [], writable_fields: wideFields,
      },
    },
  });
  assert.throws(() => validateDraftInput({
    module: 'Leads',
    values: Object.fromEntries(wideFields.map(field => [field, 'x'.repeat(1000)])),
  }, wideScope), error => error.code === 'AGENT_INPUT_INVALID' && /total size bound/.test(error.message));
});

test('draft preparation is deterministic, validates required fields, and cannot execute creation', () => {
  const input = validateDraftInput({ module: 'Leads', values: { Last_Name: 'Rao', Lead_Status: 'New' } }, permissions());
  const first = prepareRecordCreationDraft(input, leadMetadata, permissions());
  const second = prepareRecordCreationDraft(input, leadMetadata, permissions());
  assert.deepEqual(first, second);
  assert.equal(first.status, 'PreviewOnly');
  assert.equal(first.validation.valid, true);
  assert.equal(first.validation.metadata_complete, true);
  assert.equal(first.validation.hidden_required_field_count, 0);
  assert.match(first.draft_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.approval.required, true);
  assert.equal(first.approval.approved, false);
  assert.equal(first.approval.execution_tool_available_to_agent, false);
  assert.deepEqual(first.execution, {
    local_create_route_called: false,
    local_database_write: false,
    zoho_contacted: false,
    zoho_write: false,
    outbound_action: false,
  });

  const incomplete = prepareRecordCreationDraft(
    validateDraftInput({ module: 'Leads', values: { Email: 'person@example.com' } }, permissions()),
    leadMetadata,
    permissions(),
  );
  assert.equal(incomplete.validation.valid, false);
  assert.deepEqual(incomplete.validation.missing_required_fields.sort(), ['Last_Name', 'Lead_Status'].sort());

  const uncertain = prepareRecordCreationDraft(input, { fields: leadMetadata.fields }, permissions());
  assert.equal(uncertain.validation.valid, false);
  assert.equal(uncertain.validation.metadata_complete, false);

  const hiddenRequired = prepareRecordCreationDraft(input, {
    ...leadMetadata,
    fields: [...leadMetadata.fields, { api_name: 'Private_Required_Field', required: true, read_only: false }],
  }, permissions());
  assert.equal(hiddenRequired.validation.valid, false);
  assert.equal(hiddenRequired.validation.hidden_required_field_count, 1);
});

test('record and metadata results are field-filtered, secret-scrubbed, and bounded', () => {
  const scope = permissions();
  const longText = `password=very-secret ${'x'.repeat(700)}`;
  const search = sanitizeSearchResult({ records: Array.from({ length: 30 }, (_, index) => ({
    id: String(index), Full_Name: `Lead ${index}`, Notes: longText, Hidden_Field: 'hidden', Password: 'hidden-secret',
  })) }, { module: 'Leads', limit: 20 }, scope);
  assert.equal(search.records.length, 20);
  assert.equal(search.bounded, true);
  assert.ok(search.records.every(record => !Object.prototype.hasOwnProperty.call(record, 'Hidden_Field') && !Object.prototype.hasOwnProperty.call(record, 'Password')));
  assert.doesNotMatch(JSON.stringify(search), /very-secret|hidden-secret/);
  assert.ok(search.records[0].Notes.length <= 500);

  const detail = sanitizeDetailResult({ record: { id: '1', Full_Name: 'Lead', Hidden_Field: 'hidden' } }, { module: 'Leads' }, scope);
  assert.deepEqual(detail.record, { id: '1', Full_Name: 'Lead' });

  const metadata = sanitizeMetadataResult(leadMetadata, { module: 'Leads', required_only: true, limit: 200 }, scope);
  assert.deepEqual(metadata.fields.map(field => field.api_name).sort(), ['Last_Name', 'Lead_Status', 'Owner'].sort());
  assert.ok(metadata.fields.every(field => !['Hidden_Field', 'Password'].includes(field.api_name)));

  const wideFields = Array.from({ length: 80 }, (_, index) => `Field_${index}`);
  const wideScope = normalizePermissionContext({
    modules: {
      Leads: {
        aggregate: false, search: true, detail: true, metadata: true, create_draft: false,
        readable_fields: wideFields, aggregate_fields: [], writable_fields: [],
      },
    },
  });
  const wideRecord = Object.fromEntries(wideFields.map(field => [field, 'x'.repeat(1000)]));
  const boundedSearch = sanitizeSearchResult(
    { records: Array.from({ length: 20 }, () => wideRecord) },
    { module: 'Leads', limit: 20 },
    wideScope,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(boundedSearch), 'utf8') <= LIMITS.output_bytes);
  assert.ok(boundedSearch.returned < 20);
});
