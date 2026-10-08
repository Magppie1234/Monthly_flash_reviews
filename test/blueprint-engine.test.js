'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const blueprints = require('../config/blueprints.json');
const details = require('../config/blueprint-transition-details.json');
const {
  BlueprintTransitionError,
  beforeCriteriaMatch,
  localExecutionReadiness,
  transitionEligible,
  transitionStateValue,
  validateTransitionPayload,
} = require('../lib/blueprint-engine');

const leadTransitions = details.blueprints['1032257000000416697'].transitions;
const amsTransitions = details.blueprints['1032257000023685467'].transitions;
const contactsBlueprint = blueprints.blueprints.find(blueprint => String(blueprint.id) === '1032257000001044611');
const contactsTransitions = details.blueprints['1032257000001044611'].transitions;

test('common Blueprint transitions are eligible from every state', () => {
  const definition = leadTransitions['1032257000009279001'];
  assert.equal(transitionEligible({ from: { display_value: '-None-' } }, definition, 'Under Follow Up'), true);
});

test('non-common Blueprint transitions require their configured state', () => {
  const definition = leadTransitions['1032257000002755003'];
  const transition = { from: { display_value: '-None-', actual_value: '-None-' } };
  assert.equal(transitionEligible(transition, definition, '-None-'), true);
  assert.equal(transitionEligible(transition, definition, 'Under Follow Up'), false);
});

test('authoritative Blueprint connections control every eligible source state', () => {
  const transition = { id: 't1', from: { display_value: 'Fallback state' } };
  const connections = [
    { transition: { id: 't1' }, from_state: { id: 's1', name: 'State One' } },
    { transition: { id: 't1' }, from_state: { id: 's2', name: 'State Two' } },
  ];
  assert.equal(transitionEligible(transition, null, 'State One', connections), true);
  assert.equal(transitionEligible(transition, null, 'State Two', connections), true);
  assert.equal(transitionEligible(transition, null, 'Fallback state', connections), false);
});

test('Revised Design Discussion1 is eligible only on its exact authoritative Contacts path', () => {
  const transition = contactsBlueprint.transitions.find(item => String(item.id) === '1032257000001044845');
  const definition = contactsTransitions['1032257000001044845'];
  const connections = contactsBlueprint.connections.filter(connection => String(connection.transition?.id) === String(transition.id));
  assert.equal(connections.length, 1);
  assert.equal(transitionEligible(transition, definition, 'Revised Design Discussion', connections), true);
  assert.equal(transitionEligible(transition, definition, 'Design Discussion', connections), false);
  assert.deepEqual(localExecutionReadiness(definition, transition), { executable: true, reason: null });
});

test('Raw Quotation is eligible only on its exact authoritative Contacts path', () => {
  const transition = contactsBlueprint.transitions.find(item => String(item.id) === '1032257000001044557');
  const definition = contactsTransitions['1032257000001044557'];
  const connections = contactsBlueprint.connections.filter(connection => String(connection.transition?.id) === String(transition.id));
  assert.equal(connections.length, 1);
  assert.equal(transitionEligible(transition, definition, 'Approve/Disapprove Quote', connections), true);
  assert.equal(transitionEligible(transition, definition, 'Design Discussion', connections), false);
  assert.deepEqual(localExecutionReadiness(definition, transition), { executable: true, reason: null });
});

test('Raw Quotation enforces its mandatory date and exact optional integer types', () => {
  const definition = contactsTransitions['1032257000001044557'];
  assert.throws(() => validateTransitionPayload(definition, { Next_Follow_UP_Date: '2026-09-01' }, { data: {} }), error => (
    error instanceof BlueprintTransitionError
    && error.details.some(item => item.field === 'Next_Follow_UP_Date' && item.code === 'required')
  ));
  assert.deepEqual(validateTransitionPayload(definition, {}, {
    data: { Next_Follow_UP_Date: '2026-09-01', Amount: 25 },
  }).data, { Next_Follow_UP_Date: '2026-09-01', Amount: 25 });
  assert.deepEqual(validateTransitionPayload(definition, {}, {
    data: { Next_Follow_UP_Date: '2026-09-01', Amount: '' },
  }).data, { Next_Follow_UP_Date: '2026-09-01' });
  for (const Next_Follow_UP_Date of ['01-09-2026', '2026-02-30']) {
    assert.throws(() => validateTransitionPayload(definition, {}, { data: { Next_Follow_UP_Date } }), error => (
      error instanceof BlueprintTransitionError
      && error.details.some(item => item.field === 'Next_Follow_UP_Date' && item.code === 'invalid_transition_date')
    ));
  }
  for (const Amount of [1.9, '1e2']) {
    assert.throws(() => validateTransitionPayload(definition, {}, {
      data: { Next_Follow_UP_Date: '2026-09-01', Amount },
    }), error => (
      error instanceof BlueprintTransitionError
      && error.details.some(item => item.field === 'Amount' && item.code === 'invalid_transition_integer')
    ));
  }
});

test('Before-phase criteria hide transitions from non-matching records', () => {
  const definition = amsTransitions['1032257000023685484'];
  const transition = { id: '1032257000023685484', from: { display_value: 'Assigned Technician' } };
  assert.equal(transitionEligible(transition, definition, 'Assigned Technician', [], { Record_Type: 'AMS' }), true);
  assert.equal(transitionEligible(transition, definition, 'Assigned Technician', [], { Record_Type: 'Complaint' }), false);
});

test('Before-phase criteria with unsupported source logic fail closed', () => {
  const definition = {
    before: {
      criteria: [],
      criteria_display_text: "Product Type isn't SUNROOOF AND Number of Design Revisions > 0",
      criteria_logic_supported: false,
      criteria_evidence_complete: true,
    },
  };
  assert.equal(beforeCriteriaMatch(definition, { Product_Type: 'MAGPPIE', Number_of_Design_Revisions: 2 }), false);
});

test('Blueprint During-phase mandatory fields and Notes are enforced', () => {
  const definition = leadTransitions['1032257000009279001'];
  assert.throws(() => validateTransitionPayload(definition, {}, { data: {} }), error => {
    assert.ok(error instanceof BlueprintTransitionError);
    assert.deepEqual(error.details.map(item => item.field).sort(), ['Notes', 'Oppourtunity_Value', 'Type_of_Client']);
    return true;
  });
  const result = validateTransitionPayload(definition, {}, {
    data: { Oppourtunity_Value: 25, Type_of_Client: 'Architect' },
    associated_items: { Notes: { content: 'Drawings and budget confirmed.' } },
  });
  assert.equal(result.data.Oppourtunity_Value, 25);
  assert.equal(result.notes, 'Drawings and budget confirmed.');
});

test('mandatory During fields must be submitted even when the record already has values', () => {
  const definition = leadTransitions['1032257000009279001'];
  assert.throws(() => validateTransitionPayload(definition, {
    Oppourtunity_Value: 25,
    Type_of_Client: 'Architect',
  }, {
    associated_items: { Notes: { content: 'Existing record values are not a transition submission.' } },
  }), error => error instanceof BlueprintTransitionError
    && error.details.some(item => item.field === 'Oppourtunity_Value')
    && error.details.some(item => item.field === 'Type_of_Client'));
});

test('mandatory picklist sentinels and fractional integers fail closed', () => {
  const definition = leadTransitions['1032257000009279001'];
  assert.throws(() => validateTransitionPayload(definition, {}, {
    data: { Oppourtunity_Value: 25, Type_of_Client: '-None-' },
    associated_items: { Notes: { content: 'Picklist sentinel is not a selection.' } },
  }), error => error instanceof BlueprintTransitionError
    && error.details.some(item => item.field === 'Type_of_Client' && item.code === 'required'));
  assert.throws(() => validateTransitionPayload(definition, {}, {
    data: { Oppourtunity_Value: 1.9, Type_of_Client: 'Architect' },
    associated_items: { Notes: { content: 'Fractional integer must not be truncated.' } },
  }), error => error instanceof BlueprintTransitionError
    && error.details.some(item => item.field === 'Oppourtunity_Value' && item.code === 'invalid_transition_integer'));
  assert.throws(() => validateTransitionPayload(definition, {}, {
    data: { Oppourtunity_Value: '1e2', Type_of_Client: 'Architect' },
    associated_items: { Notes: { content: 'Exponent notation is not an exact integer submission.' } },
  }), error => error instanceof BlueprintTransitionError
    && error.details.some(item => item.field === 'Oppourtunity_Value' && item.code === 'invalid_transition_integer'));
});

test('local execution readiness permits only the implemented fail-closed subset', () => {
  const implemented = leadTransitions['1032257000009279001'];
  const safeTransition = { trigger_type: 'manual', to: { actual_value: 'Qualified', display_value: 'Qualified' } };
  assert.deepEqual(localExecutionReadiness(implemented, safeTransition), { executable: true, reason: null });
  assert.equal(localExecutionReadiness({ ...implemented, before: { owners: ['Record Owner'], criteria: [] } }, safeTransition).executable, false);
  assert.equal(localExecutionReadiness({ ...implemented, after_actions: [{ type: 'webhook' }] }, safeTransition).executable, false);
  assert.equal(localExecutionReadiness(implemented, { ...safeTransition, to: { actual_value: 'Internal', display_value: 'Visible' } }).executable, false);
});

test('local state value uses the source display value used by the replicated record corpus', () => {
  assert.equal(transitionStateValue({ to: { actual_value: 'Internal', display_value: 'Visible' } }), 'Visible');
  assert.equal(transitionStateValue({ to: { actual_value: 'Internal' } }), 'Internal');
});

test('Blueprint transition rejects fields outside the configured During phase', () => {
  const definition = leadTransitions['1032257000009322035'];
  assert.throws(() => validateTransitionPayload(definition, {}, { data: { Lead_Status: 'Junk Lead' }, notes: 'Needs review' }), /not part of the Zoho During phase/);
});

test('Blueprint During-phase allowed-value validation is enforced exactly', () => {
  const definition = {
    during_inputs: [{
      kind: 'field', api_name: 'Priority', label: 'Priority', required: true,
      validation: {
        kind: 'allowed_values', allowed_values: ['Highest'], logic_supported: true,
        message: 'You cannot change priority to lower ranks!',
      },
    }],
  };
  assert.throws(
    () => validateTransitionPayload(definition, {}, { data: { Priority: 'High' } }),
    error => error instanceof BlueprintTransitionError
      && error.details[0].code === 'invalid_transition_value'
      && error.details[0].message === 'You cannot change priority to lower ranks!',
  );
  assert.equal(validateTransitionPayload(definition, {}, { data: { Priority: 'Highest' } }).data.Priority, 'Highest');
});

test('Blueprint During-phase date windows use the CRM timezone and fail closed', () => {
  const awaiting = {
    during_inputs: [{
      kind: 'field', api_name: 'Due_Date', label: 'Due Date', required: true,
      validation: {
        kind: 'date_window', min_offset_days: 0, max_offset_days: null, logic_supported: true,
        message: 'Due date cannot be past dates.',
      },
    }],
  };
  const deferred = {
    during_inputs: [{
      kind: 'field', api_name: 'Due_Date', label: 'Due Date', required: true,
      validation: {
        kind: 'date_window', min_offset_days: 1, max_offset_days: 30, logic_supported: true,
        message: 'Due date can only be within 30 days.',
      },
    }],
  };
  const context = { now: new Date('2026-08-30T18:45:00.000Z'), timeZone: 'Asia/Kolkata' }; // 31 August in CRM time
  assert.equal(validateTransitionPayload(awaiting, {}, { data: { Due_Date: '2026-08-31' } }, context).data.Due_Date, '2026-08-31');
  assert.throws(() => validateTransitionPayload(awaiting, {}, { data: { Due_Date: '2026-08-30' } }, context), /field validation failed/);
  assert.equal(validateTransitionPayload(deferred, {}, { data: { Due_Date: '2026-09-01' } }, context).data.Due_Date, '2026-09-01');
  assert.equal(validateTransitionPayload(deferred, {}, { data: { Due_Date: '2026-09-30' } }, context).data.Due_Date, '2026-09-30');
  assert.throws(() => validateTransitionPayload(deferred, {}, { data: { Due_Date: '2026-08-31' } }, context), /field validation failed/);
  assert.throws(() => validateTransitionPayload(deferred, {}, { data: { Due_Date: '2026-10-01' } }, context), /field validation failed/);
});

test('unknown or unsupported During-phase validation logic fails closed', () => {
  const definition = {
    during_inputs: [{
      kind: 'field', api_name: 'Priority', label: 'Priority', required: true,
      validation: { kind: 'source_expression', logic_supported: false, message: 'Source validation is unavailable.' },
    }],
  };
  assert.throws(
    () => validateTransitionPayload(definition, {}, { data: { Priority: 'Highest' } }),
    error => error instanceof BlueprintTransitionError && error.details[0].code === 'source_validation_unsupported',
  );
});
