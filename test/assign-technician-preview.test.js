'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const enginePath = path.resolve(__dirname, '..', 'public', 'assign-technician-preview.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const {
  AssignTechnicianPreviewError,
  constants,
  createContext,
  buildVisitDraft,
  weekLabel,
} = require('../public/assign-technician-preview');

function context(overrides = {}) {
  return createContext({
    recordType: 'AMS',
    recordTypeOptions: ['AMS', 'Complaint'],
    amsDate: '2026-09-10',
    fullAddress: '12 Test Lane, Bengaluru',
    purposeOptions: ['Follow-up AMS', 'Issue Resolution'],
    teamOptionCount: 3,
    ...overrides,
  });
}

function input(overrides = {}) {
  return {
    context: context(),
    fullAddress: '12 Test Lane, Bengaluru',
    purpose: 'Follow-up AMS',
    teamMembers: ['team-member-1', 'team-member-3'],
    visitDate: '2026-09-02',
    ...overrides,
  };
}

function assertPreviewError(callback, code) {
  assert.throws(callback, error => {
    assert.equal(error instanceof AssignTechnicianPreviewError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, 'Assign Technician preview input is invalid.');
    return true;
  });
}

test('creates an immutable context with source-backed business options and anonymized team choices', () => {
  const value = context();
  assert.deepEqual(value.recordTypeOptions, ['AMS', 'Complaint']);
  assert.deepEqual(value.purposeOptions, ['Follow-up AMS', 'Issue Resolution']);
  assert.deepEqual(value.teamOptions, [
    { value: 'team-member-1', label: 'Team member 1' },
    { value: 'team-member-2', label: 'Team member 2' },
    { value: 'team-member-3', label: 'Team member 3' },
  ]);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.recordTypeOptions), true);
  assert.equal(Object.isFrozen(value.purposeOptions), true);
  assert.equal(Object.isFrozen(value.teamOptions), true);
  assert.ok(value.teamOptions.every(Object.isFrozen));
});

test('builds the exact sanitized non-persisted AMS Visit draft', () => {
  const draft = buildVisitDraft(input());
  assert.deepEqual(draft, {
    preview_only: true,
    persistence: 'disabled',
    fields: {
      Name: 'Visit preview',
      Record_Type: 'AMS',
      AMS_Status: 'Open',
      Team_Member_Name: ['Team member 1', 'Team member 3'],
      Assigned_Team_Member_Count: 2,
      Purpose: 'Follow-up AMS',
      Deploy_Date: '2026-09-02',
      Week_Label: '31 Aug - 6 Sep',
      Scheduled_Visit_Date: '2026-09-10',
    },
    display_only: {
      Full_Address: '12 Test Lane, Bengaluru',
      AMS: 'Current AMS/Complaint record',
      Client_Name: 'Current linked client when available',
    },
    blocked_actions: ['Visit creation', 'Workflow trigger', 'Blueprint continuation'],
  });
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft.fields), true);
  assert.equal(Object.isFrozen(draft.fields.Team_Member_Name), true);
  assert.equal(Object.isFrozen(draft.display_only), true);
  assert.equal(Object.isFrozen(draft.blocked_actions), true);
  assert.equal(JSON.stringify(draft).includes('1032257'), false);
});

test('Complaint context does not invent an AMS scheduled date', () => {
  const complaint = context({ recordType: 'Complaint', amsDate: '' });
  const draft = buildVisitDraft(input({ context: complaint }));
  assert.equal(draft.fields.Record_Type, 'Complaint');
  assert.equal(Object.hasOwn(draft.fields, 'Scheduled_Visit_Date'), false);
});

test('requires the conditional AMS date only for AMS records', () => {
  const missing = context({ amsDate: '' });
  assertPreviewError(() => buildVisitDraft(input({ context: missing })), 'AMS_DATE_REQUIRED');
  const complaint = context({ recordType: 'Complaint', amsDate: '' });
  assert.doesNotThrow(() => buildVisitDraft(input({ context: complaint })));
});

test('validates record type against local Visit metadata', () => {
  assertPreviewError(() => context({ recordType: '' }), 'RECORD_TYPE_REQUIRED');
  assertPreviewError(() => context({ recordType: 'Unsupported' }), 'RECORD_TYPE_UNSUPPORTED');
  assertPreviewError(() => context({ recordTypeOptions: [] }), 'RECORD_TYPE_OPTIONS_INVALID');
  assertPreviewError(() => context({ recordTypeOptions: ['AMS', 'AMS'] }), 'RECORD_TYPE_OPTIONS_INVALID');
});

test('requires address, purpose, team selection, and Visit date', () => {
  assertPreviewError(() => buildVisitDraft(input({ fullAddress: '   ' })), 'ADDRESS_REQUIRED');
  assertPreviewError(() => buildVisitDraft(input({ purpose: '' })), 'PURPOSE_REQUIRED');
  assertPreviewError(() => buildVisitDraft(input({ purpose: 'Unreviewed option' })), 'PURPOSE_UNSUPPORTED');
  assertPreviewError(() => buildVisitDraft(input({ teamMembers: [] })), 'TEAM_REQUIRED');
  assertPreviewError(() => buildVisitDraft(input({ visitDate: '' })), 'VISIT_DATE_INVALID');
  assertPreviewError(() => buildVisitDraft(input({ visitDate: '2026-02-30' })), 'VISIT_DATE_INVALID');
});

test('fails closed for duplicate, unknown, sparse, accessor, and expanded team selections', () => {
  assertPreviewError(() => buildVisitDraft(input({ teamMembers: ['team-member-1', 'team-member-1'] })), 'TEAM_SELECTION_INVALID');
  assertPreviewError(() => buildVisitDraft(input({ teamMembers: ['team-member-4'] })), 'TEAM_SELECTION_INVALID');
  assertPreviewError(() => buildVisitDraft(input({ teamMembers: ['captured-person-name'] })), 'TEAM_SELECTION_INVALID');
  assertPreviewError(() => buildVisitDraft(input({ teamMembers: new Array(1) })), 'TEAM_SELECTION_INVALID');

  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get: () => 'team-member-1' });
  accessor.length = 1;
  assertPreviewError(() => buildVisitDraft(input({ teamMembers: accessor })), 'TEAM_SELECTION_INVALID');

  const expanded = ['team-member-1'];
  expanded.extra = true;
  assertPreviewError(() => buildVisitDraft(input({ teamMembers: expanded })), 'TEAM_SELECTION_INVALID');
});

test('fails closed for malformed contexts, expanded inputs, and control characters', () => {
  assertPreviewError(() => buildVisitDraft(), 'INPUT_INVALID');
  assertPreviewError(() => buildVisitDraft({ ...input(), extra: true }), 'INPUT_INVALID');
  assertPreviewError(() => buildVisitDraft(input({ context: { ...context() } })), 'CONTEXT_INVALID');
  assertPreviewError(() => context({ fullAddress: 'Unsafe\u0000address' }), 'ADDRESS_INVALID');
  assertPreviewError(() => context({ purposeOptions: ['-None-'] }), 'PURPOSE_OPTIONS_INVALID');
  assertPreviewError(() => context({ teamOptionCount: 0 }), 'TEAM_OPTIONS_INVALID');
  assertPreviewError(() => context({ teamOptionCount: constants.limits.teamMembers + 1 }), 'TEAM_OPTIONS_INVALID');
});

test('week labels are deterministic in UTC across month and year boundaries', () => {
  assert.equal(weekLabel('2026-09-02'), '31 Aug - 6 Sep');
  assert.equal(weekLabel('2026-12-31'), '28 Dec - 3 Jan');
  assert.equal(weekLabel('2026-09-06'), '31 Aug - 6 Sep');
  assertPreviewError(() => weekLabel('not-a-date'), 'VISIT_DATE_INVALID');
});

test('attaches one frozen browser global when CommonJS is unavailable', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(engineSource, sandbox, { filename: 'assign-technician-preview.js' });
  assert.equal(typeof sandbox.AssignTechnicianPreview.createContext, 'function');
  assert.equal(typeof sandbox.AssignTechnicianPreview.buildVisitDraft, 'function');
  assert.equal(Object.isFrozen(sandbox.AssignTechnicianPreview), true);
  const descriptor = Object.getOwnPropertyDescriptor(sandbox, 'AssignTechnicianPreview');
  assert.equal(descriptor.configurable, false);
  assert.equal(descriptor.writable, false);
});

test('engine contains no provider, network, persistence, dynamic-code, logging, or captured-identity capability', () => {
  const forbidden = [
    /\bfetch\b/i,
    /XMLHttpRequest/i,
    /\bZOHO\b/i,
    /insertRecord/i,
    /updateRecord/i,
    /\.proceed\s*\(/i,
    /\b(?:POST|PUT|PATCH|DELETE)\b/,
    /\b(?:local|session)Storage\b/i,
    /\bconsole\s*\./i,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /https?:\/\//i,
    /\b\d{18,19}\b/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(engineSource, pattern);
});
