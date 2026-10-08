'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const assistantStart = appSource.indexOf('/* ---------- CRM assistant ---------- */');
const assistantEnd = appSource.indexOf('/* ---------- global search ---------- */', assistantStart);
assert.ok(assistantStart >= 0 && assistantEnd > assistantStart, 'CRM assistant UI source was not found.');
const assistantSource = appSource.slice(assistantStart, assistantEnd);

const helpersStart = appSource.indexOf("const CRM_ASSISTANT_SOURCE_MODE = 'local-replica-read-only';", assistantStart);
const helpersEnd = appSource.indexOf('/* CRM assistant safety helpers end */', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'CRM assistant safety helpers were not found.');
const helperSource = appSource.slice(helpersStart, helpersEnd);

function evaluatedHandoff(draft, status, moduleByApi = { Leads: { api_name: 'Leads' } }) {
  const context = vm.createContext({});
  vm.runInContext(`${helperSource}\nglobalThis.__assistantDraftHandoff = assistantDraftHandoff;`, context);
  const result = vm.runInContext(
    `__assistantDraftHandoff(${JSON.stringify(draft)}, ${JSON.stringify(status)}, ${JSON.stringify(moduleByApi)})`,
    context,
  );
  return result ? JSON.parse(JSON.stringify(result)) : result;
}

async function evaluatedLayoutVerification({
  handoff = { mode: 'prefill', module: 'Leads', values: { Last_Name: 'Rao' } },
  bootReady = true,
  fields = [{ api_name: 'Last_Name', data_type: 'text', view_type: { create: true, edit: true } }],
  layouts = [{ id: 'lead-layout', sections: [{ fields: [{ api_name: 'Last_Name' }] }] }],
} = {}) {
  const context = vm.createContext({
    state: { bootReady, moduleByApi: { Leads: { api_name: 'Leads' } } },
    getFields: async () => fields,
    getLayouts: async () => layouts,
    EDITABLE: field => field?.read_only !== true && field?.view_type?.edit !== false && !['lookup', 'subform'].includes(field?.data_type),
  });
  vm.runInContext(`${helperSource}\nglobalThis.__verifyAssistantLayout = verifyAssistantDraftCreateLayout;`, context);
  const result = await vm.runInContext(`__verifyAssistantLayout(${JSON.stringify(handoff)})`, context);
  return result ? JSON.parse(JSON.stringify(result)) : result;
}

function evaluatedQuestionCopy(question) {
  const context = vm.createContext({});
  vm.runInContext(`${helperSource}\nglobalThis.__assistantQuestionInput = assistantQuestionInput; globalThis.__assistantQuestionLabel = assistantQuestionLabel;`, context);
  return {
    input: vm.runInContext(`__assistantQuestionInput(${JSON.stringify(question)})`, context),
    label: vm.runInContext(`__assistantQuestionLabel(${JSON.stringify(question)})`, context),
  };
}

function safeStatus() {
  return {
    available: true,
    source_mode: 'local-replica-read-only',
    permission_scope: {
      loaded: true,
      modules: [{
        module: 'Leads',
        capabilities: { create_draft: true },
        layout_resolved: true,
      }],
    },
  };
}

function safeDeterministicStatus() {
  const reviewed = [
    'Count Leads by Lead Status',
    'Find up to 10 overdue Tasks',
    'Show required fields for a new Lead',
    'Prepare a new Lead draft for review with Last Name: <name>',
    'Count records in <module>',
    'Count records in <module> by <safe field>',
    'Count records in <module> by <safe-group-field> where <safe-filter-field> is empty',
  ];
  return {
    available: false,
    deterministic_available: true,
    status: 'DeterministicOnly',
    model: null,
    provider: 'Local deterministic parser',
    network_attempted: false,
    source_mode: 'local-replica-read-only',
    fallback: {
      mode: 'DeterministicLocalOnly',
      network_attempted: false,
      supported_questions: reviewed,
      reviewed_questions: reviewed,
      unavailable_questions: [],
    },
    permission_scope: {
      loaded: true,
      modules: [{
        module: 'Leads',
        capabilities: { create_draft: true },
        layout_resolved: true,
      }],
    },
  };
}

function safeDraft() {
  const fingerprint = 'a'.repeat(64);
  const values = { Last_Name: 'Rao', Lead_Status: 'New' };
  return {
    status: 'PreviewOnly',
    module: 'Leads',
    layout: { resolved: true, selection_required: false },
    values,
    draft_fingerprint: fingerprint,
    validation: {
      valid: true,
      metadata_complete: true,
      missing_required_fields: [],
      unavailable_required_fields: [],
      hidden_required_field_count: 0,
      invalid_or_read_only_fields: [],
      scope: 'mirrored-required-field-precheck',
      requires_existing_create_form_validation: true,
    },
    approval: { required: true, approved: false },
    execution: {
      local_create_route_called: false,
      local_database_write: false,
      zoho_contacted: false,
      zoho_write: false,
      outbound_action: false,
    },
    ui_handoff: {
      action: 'open_existing_validated_create_form',
      module: 'Leads',
      values: { ...values },
      draft_fingerprint: fingerprint,
      requires_explicit_user_approval: true,
      auto_submit: false,
    },
  };
}

test('assistant draft handoff accepts only an exact preview-only, permission-scoped contract', () => {
  assert.deepEqual(evaluatedHandoff(safeDraft(), safeStatus()), {
    mode: 'prefill',
    module: 'Leads',
    values: { Last_Name: 'Rao', Lead_Status: 'New' },
    draft_fingerprint: 'a'.repeat(64),
  });

  const unsafeCases = [
    draft => { draft.ui_handoff.auto_submit = true; },
    draft => { draft.execution.local_create_route_called = true; },
    draft => { draft.approval.approved = true; },
    draft => { draft.layout.selection_required = true; },
    draft => { draft.validation.scope = 'unverified'; },
    draft => { draft.validation.requires_existing_create_form_validation = false; },
    draft => { draft.validation.valid = false; },
    draft => { draft.validation.metadata_complete = false; },
    draft => { draft.validation.missing_required_fields = ['Lead_Status']; },
    draft => { draft.validation.unavailable_required_fields = ['Owner']; },
    draft => { draft.validation.hidden_required_field_count = 1; },
    draft => { draft.validation.invalid_or_read_only_fields = ['Owner']; },
    draft => { draft.ui_handoff.values.Last_Name = 'Different'; },
    draft => { draft.values.Last_Name = { nested: 'unsupported for form prefill' }; draft.ui_handoff.values.Last_Name = { nested: 'unsupported for form prefill' }; },
  ];
  unsafeCases.forEach(mutate => {
    const draft = safeDraft();
    mutate(draft);
    assert.equal(evaluatedHandoff(draft, safeStatus()), null);
  });
  assert.equal(evaluatedHandoff(safeDraft(), { ...safeStatus(), source_mode: 'zoho-live' }), null);
  assert.equal(evaluatedHandoff(safeDraft(), safeStatus(), {}), null);
  assert.deepEqual(evaluatedHandoff(safeDraft(), safeDeterministicStatus()), {
    mode: 'prefill',
    module: 'Leads',
    values: { Last_Name: 'Rao', Lead_Status: 'New' },
    draft_fingerprint: 'a'.repeat(64),
  });
  assert.equal(evaluatedHandoff(safeDraft(), { ...safeDeterministicStatus(), network_attempted: true }), null);
  const unsupported = safeDeterministicStatus();
  unsupported.fallback.supported_questions = [];
  assert.equal(evaluatedHandoff(safeDraft(), unsupported), null);
});

test('assistant draft Create-form verification requires booted, exact, editable layout fields', async () => {
  assert.deepEqual(await evaluatedLayoutVerification(), {
    layout_id: 'lead-layout',
    values: { Last_Name: 'Rao' },
  });
  assert.equal(await evaluatedLayoutVerification({ bootReady: false }), null);
  assert.equal(await evaluatedLayoutVerification({ layouts: [
    { id: 'one', sections: [{ fields: [{ api_name: 'Last_Name' }] }] },
    { id: 'two', sections: [{ fields: [{ api_name: 'Last_Name' }] }] },
  ] }), null);
  assert.equal(await evaluatedLayoutVerification({
    handoff: { mode: 'prefill', module: 'Leads', values: { Email: 'person@example.com' } },
  }), null);
  assert.equal(await evaluatedLayoutVerification({
    fields: [{ api_name: 'Last_Name', data_type: 'text', view_type: { create: false, edit: true } }],
  }), null);
  assert.equal(await evaluatedLayoutVerification({
    fields: [{ api_name: 'Last_Name', data_type: 'lookup', view_type: { create: true, edit: true } }],
  }), null);
});

test('assistant preserves reviewed templates while chips produce exact executable aggregate examples', () => {
  assert.deepEqual(evaluatedQuestionCopy('Count records in <module>'), {
    input: 'Count records in Leads',
    label: 'Count records in Leads',
  });
  assert.deepEqual(evaluatedQuestionCopy('Count records in <module> by <safe field>'), {
    input: 'Count records in Calls by Call Result',
    label: 'Count records in Calls by Call Result',
  });
  assert.deepEqual(evaluatedQuestionCopy('Count records in <module> by <safe-group-field> where <safe-filter-field> is empty'), {
    input: 'Count records in Calls by Call Type where Call Result is empty',
    label: 'Count records in Calls by Call Type where Call Result is empty',
  });
  assert.deepEqual(evaluatedQuestionCopy('Prepare a new Lead draft for review with Last Name: <name>'), {
    input: 'Prepare a new Lead draft for review with Last Name: ',
    label: 'Prepare a new Lead draft for review with Last Name',
  });
  assert.match(helperSource, /'Count records in <module>'/);
  assert.match(helperSource, /'Count records in <module> by <safe field>'/);
  assert.match(helperSource, /'Count records in <module> by <safe-group-field> where <safe-filter-field> is empty'/);
});

test('assistant DOM is global, accessible, bounded, and renders untrusted content as text', () => {
  assert.match(assistantSource, /id = 'crmAssistantLauncher'/);
  assert.match(assistantSource, /aria-controls', 'crmAssistantPanel'/);
  assert.match(assistantSource, /aria-expanded', 'false'/);
  assert.match(assistantSource, /panel\.setAttribute\('role', 'dialog'\)/);
  assert.match(assistantSource, /log\.setAttribute\('role', 'log'\)/);
  assert.match(assistantSource, /aria-live', 'polite'/);
  assert.match(assistantSource, /const CRM_ASSISTANT_TURN_LIMIT = 8/);
  assert.match(assistantSource, /input\.maxLength = CRM_ASSISTANT_PROMPT_LIMIT/);
  assert.match(assistantSource, /body: JSON\.stringify\(\{ prompt \}\)/);
  assert.match(assistantSource, /node\.textContent = String\(text\)/);
  assert.match(assistantSource, /assistantDeterministicStatusUsable/);
  assert.match(assistantSource, /reviewed questions · no model or network/);
  assert.match(assistantSource, /chip\.dataset\.prompt = question/);
  assert.match(assistantSource, /const chipLabel = assistantQuestionLabel\(question\)/);
  assert.match(assistantSource, /button\.disabled = !enabled \|\| !supportedNow/);
  assert.match(assistantSource, /state\.bootReady/);
  assert.match(assistantSource, /AGENT_PERMISSION_DENIED: 'That operation is outside the current mirrored CRM permission scope/);
  assert.match(assistantSource, /AGENT_LOCAL_HANDLER_FAILED: 'The local read-only CRM operation failed safely/);
  assert.match(assistantSource, /state\.bootReady && !crmAssistantState\.statusLoading && \(!crmAssistantState\.status \|\| crmAssistantState\.statusError\)/);
  assert.doesNotMatch(assistantSource, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
});

test('assistant uses only the reviewed routes and never writes or dispatches an integration', () => {
  assert.match(assistantSource, /assistantFetchJson\('\/api\/agent\/status'\)/);
  assert.match(assistantSource, /assistantFetchJson\('\/api\/agent\/chat'/);
  assert.match(assistantSource, /AI model unavailable\. Keyless local mode can answer \$\{supported\} of \$\{CRM_ASSISTANT_REVIEWED_QUESTIONS\.length\} reviewed CRM questions with no model or network call\./);
  assert.match(assistantSource, /response\?\.deterministic_available === true/);
  assert.match(assistantSource, /response\.network_attempted === false/);
  assert.match(assistantSource, /const verified = await verifyAssistantDraftCreateLayout\(handoff\)/);
  assert.match(assistantSource, /await openForm\(handoff\.module, null, verified\.layout_id, verified\.values\)/);
  assert.doesNotMatch(assistantSource, /\/api\/record\/|\/api\/integrations\/|ozonetel|picky|webhook/i);
  assert.match(appSource, /async function openForm\(mod, rec, selectedLayoutId = null, draftPrefill = null\)/);
  assert.match(appSource, /const activeDraftPrefill = !rec && layoutExact/);
  assert.match(appSource, /Assistant draft preview loaded\. Nothing has been created/);
  assert.match(assistantSource, /draft\.validation\.valid !== true/);
  assert.match(assistantSource, /unavailable_required_fields/);
  assert.match(assistantSource, /hidden_required_field_count/);
  assert.match(assistantSource, /refs\.input\.removeAttribute\('aria-invalid'\)/);
  assert.match(assistantSource, /refs\.hint\.textContent = CRM_ASSISTANT_SAFETY_HINT/);
});

test('assistant styling includes polished focus, preview, and mobile behavior', () => {
  assert.match(styles, /\.crm-assistant-panel\s*\{/);
  assert.match(styles, /\.crm-assistant-draft-action\s*\{/);
  assert.match(styles, /\.crm-assistant-launcher:focus-visible/);
  assert.match(styles, /\.crm-assistant-chips button\.is-unavailable/);
  assert.match(styles, /\.crm-assistant-suggestions-availability/);
  assert.match(styles, /@media \(max-width:600px\)[\s\S]*\.crm-assistant-panel\s*\{ inset:10px 10px 74px;/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)[\s\S]*\.crm-assistant-message\.is-loading/);
});
