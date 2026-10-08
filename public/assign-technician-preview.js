(function attachAssignTechnicianPreview(root, createPreview) {
  'use strict';

  const preview = createPreview();

  if (typeof module === 'object' && module && module.exports) {
    module.exports = preview;
    return;
  }

  if (!root || Object.prototype.hasOwnProperty.call(root, 'AssignTechnicianPreview')) {
    throw new Error('Assign Technician preview namespace is unavailable.');
  }
  Object.defineProperty(root, 'AssignTechnicianPreview', {
    configurable: false,
    enumerable: true,
    value: preview,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createAssignTechnicianPreview() {
  'use strict';

  class AssignTechnicianPreviewError extends Error {
    constructor(code) {
      super('Assign Technician preview input is invalid.');
      this.name = 'AssignTechnicianPreviewError';
      this.code = code;
    }
  }

  const LIMITS = Object.freeze({
    address: 2000,
    purpose: 120,
    recordType: 120,
    purposeOptions: 100,
    teamMembers: 50,
  });
  const CONTEXT_KEYS = Object.freeze(['amsDate', 'fullAddress', 'purposeOptions', 'recordType', 'recordTypeOptions', 'teamOptionCount']);
  const DRAFT_KEYS = Object.freeze(['context', 'fullAddress', 'purpose', 'teamMembers', 'visitDate']);
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TEAM_KEY = /^team-member-(?:[1-9]|[1-4]\d|50)$/;
  const DISALLOWED_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  const MONTHS_SHORT = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  const createdContexts = new WeakSet();

  function fail(code) {
    throw new AssignTechnicianPreviewError(code);
  }

  function exactObject(value, keys, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    if (Object.getOwnPropertySymbols(value).length !== 0) fail(code);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (actual.some(key => !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) fail(code);
    return value;
  }

  function boundedText(value, maxLength, code, { optional = false } = {}) {
    if (value === null || value === undefined || value === '') {
      if (optional) return '';
      fail(code);
    }
    if (typeof value !== 'string') fail(code);
    const normalized = value.trim();
    if (!normalized) {
      if (optional) return '';
      fail(code);
    }
    if (normalized.length > maxLength || DISALLOWED_CONTROL.test(normalized)) fail(code);
    return normalized;
  }

  function validDate(value, code, { optional = false } = {}) {
    const text = boundedText(value, 10, code, { optional });
    if (!text) return '';
    const match = text.match(DATE);
    if (!match) fail(code);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail(code);
    return text;
  }

  function denseStringArray(value, maxItems, code) {
    if (!Array.isArray(value) || value.length > maxItems || Object.getOwnPropertySymbols(value).length !== 0) fail(code);
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.some(key => !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) fail(code);
    return value;
  }

  function normalizeOptions(value, code) {
    const options = denseStringArray(value, LIMITS.purposeOptions, code)
      .map(option => boundedText(option, LIMITS.purpose, code))
      .filter(option => option !== '-None-');
    if (!options.length || new Set(options).size !== options.length) fail(code);
    return Object.freeze(options);
  }

  function normalizePurposeOptions(value) {
    return normalizeOptions(value, 'PURPOSE_OPTIONS_INVALID');
  }

  function buildTeamOptions(count) {
    if (!Number.isInteger(count) || count < 1 || count > LIMITS.teamMembers) fail('TEAM_OPTIONS_INVALID');
    return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
      value: `team-member-${index + 1}`,
      label: `Team member ${index + 1}`,
    })));
  }

  function createContext(raw) {
    const input = exactObject(raw, CONTEXT_KEYS, 'CONTEXT_INVALID');
    const recordTypeOptions = normalizeOptions(input.recordTypeOptions, 'RECORD_TYPE_OPTIONS_INVALID');
    const recordType = boundedText(input.recordType, LIMITS.recordType, 'RECORD_TYPE_REQUIRED');
    if (!recordTypeOptions.includes(recordType)) fail('RECORD_TYPE_UNSUPPORTED');
    const context = Object.freeze({
      recordType,
      recordTypeOptions,
      amsDate: validDate(input.amsDate, 'AMS_DATE_INVALID', { optional: true }),
      fullAddress: boundedText(input.fullAddress, LIMITS.address, 'ADDRESS_INVALID', { optional: true }),
      purposeOptions: normalizePurposeOptions(input.purposeOptions),
      teamOptions: buildTeamOptions(input.teamOptionCount),
    });
    createdContexts.add(context);
    return context;
  }

  function weekLabel(dateText) {
    const normalized = validDate(dateText, 'VISIT_DATE_INVALID');
    const match = normalized.match(DATE);
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return `${monday.getUTCDate()} ${MONTHS_SHORT[monday.getUTCMonth()]} - ${sunday.getUTCDate()} ${MONTHS_SHORT[sunday.getUTCMonth()]}`;
  }

  function selectedTeamLabels(context, value) {
    const members = denseStringArray(value, LIMITS.teamMembers, 'TEAM_SELECTION_INVALID');
    if (!members.length) fail('TEAM_REQUIRED');
    if (new Set(members).size !== members.length || members.some(member => typeof member !== 'string' || !TEAM_KEY.test(member))) {
      fail('TEAM_SELECTION_INVALID');
    }
    const allowed = new Map(context.teamOptions.map(option => [option.value, option.label]));
    if (members.some(member => !allowed.has(member))) fail('TEAM_SELECTION_INVALID');
    return Object.freeze(members.map(member => allowed.get(member)));
  }

  function buildVisitDraft(raw) {
    const input = exactObject(raw, DRAFT_KEYS, 'INPUT_INVALID');
    if (!createdContexts.has(input.context)) fail('CONTEXT_INVALID');
    const context = input.context;
    const fullAddress = boundedText(input.fullAddress, LIMITS.address, 'ADDRESS_REQUIRED');
    const purpose = boundedText(input.purpose, LIMITS.purpose, 'PURPOSE_REQUIRED');
    if (!context.purposeOptions.includes(purpose)) fail('PURPOSE_UNSUPPORTED');
    const teamLabels = selectedTeamLabels(context, input.teamMembers);
    const visitDate = validDate(input.visitDate, 'VISIT_DATE_INVALID');
    if (context.recordType === 'AMS' && !context.amsDate) fail('AMS_DATE_REQUIRED');

    const fields = {
      Name: 'Visit preview',
      Record_Type: context.recordType,
      AMS_Status: 'Open',
      Team_Member_Name: teamLabels,
      Assigned_Team_Member_Count: teamLabels.length,
      Purpose: purpose,
      Deploy_Date: visitDate,
      Week_Label: weekLabel(visitDate),
    };
    if (context.recordType === 'AMS') fields.Scheduled_Visit_Date = context.amsDate;
    Object.freeze(fields);

    const output = {
      preview_only: true,
      persistence: 'disabled',
      fields,
      display_only: Object.freeze({
        Full_Address: fullAddress,
        AMS: 'Current AMS/Complaint record',
        Client_Name: 'Current linked client when available',
      }),
      blocked_actions: Object.freeze([
        'Visit creation',
        'Workflow trigger',
        'Blueprint continuation',
      ]),
    };
    return Object.freeze(output);
  }

  Object.freeze(AssignTechnicianPreviewError.prototype);
  Object.freeze(AssignTechnicianPreviewError);
  return Object.freeze({
    AssignTechnicianPreviewError,
    constants: Object.freeze({ limits: LIMITS }),
    createContext,
    buildVisitDraft,
    weekLabel,
  });
});
