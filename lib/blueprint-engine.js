'use strict';

class BlueprintTransitionError extends Error {
  constructor(message, { status = 422, code = 'BLUEPRINT_VALIDATION', details = [] } = {}) {
    super(message);
    this.name = 'BlueprintTransitionError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isBlank = value => value === null
  || value === undefined
  || (typeof value === 'string' && value.trim() === '')
  || (Array.isArray(value) && value.length === 0);

const SUPPORTED_LOCAL_DURING_TYPES = new Set([
  'text', 'textarea', 'integer', 'double', 'currency', 'percent', 'bigint',
  'date', 'datetime', 'picklist', 'email', 'phone', 'website', 'url',
]);

function transitionStateValue(transition) {
  return transition?.to?.display_value ?? transition?.to?.actual_value ?? null;
}

function localExecutionReadiness(definition, transition = {}) {
  const configuredReason = definition?.block_reason
    || 'Before, During, and After requirements are not fully specified for this transition.';
  if (!definition || definition.local_execution !== 'Implemented') {
    return { executable: false, reason: configuredReason };
  }
  if ((definition.trigger_type || transition.trigger_type || 'manual') !== 'manual') {
    return { executable: false, reason: 'Automatic Blueprint transitions require a durable local scheduler.' };
  }
  if (transitionStateValue(transition) === null) {
    return { executable: false, reason: 'The source destination state is unavailable.' };
  }
  if (transition?.to?.actual_value != null && transition?.to?.display_value != null
    && String(transition.to.actual_value) !== String(transition.to.display_value)) {
    return { executable: false, reason: 'The source destination has different actual and display values; local state canonicalization is not yet reconciled.' };
  }

  const owners = definition.before?.owners;
  if (!Array.isArray(owners) || owners.length !== 1 || owners[0] !== 'All Users') {
    return { executable: false, reason: 'This transition requires a verified source-equivalent user or owner identity.' };
  }
  if (definition.before?.criteria_evidence_complete === false || definition.before?.criteria_logic_supported === false) {
    return { executable: false, reason: 'The source Before-phase criteria cannot be enforced locally.' };
  }

  const inputs = Array.isArray(definition.during_inputs) ? definition.during_inputs : [];
  for (const input of inputs) {
    const supportedAssociatedItem = input.kind === 'associated_item' && input.api_name === 'Notes';
    if (input.kind !== 'field' && !supportedAssociatedItem) {
      return { executable: false, reason: 'The source During phase requires a widget, attachment, or unsupported associated item.' };
    }
    if (input.kind === 'field' && !SUPPORTED_LOCAL_DURING_TYPES.has(String(input.data_type || 'text').toLowerCase())) {
      return { executable: false, reason: 'The source During phase contains a field type that is not implemented locally.' };
    }
    if (input.validation && input.validation.logic_supported !== true) {
      return { executable: false, reason: 'The source During-phase validation cannot be enforced locally.' };
    }
  }
  if ((definition.after_actions || []).length > 0) {
    return { executable: false, reason: 'The source After phase contains actions that are not implemented atomically.' };
  }
  return { executable: true, reason: null };
}

function transitionValueMissing(input, value) {
  if (isBlank(value)) return true;
  return input?.data_type === 'picklist' && String(value).trim() === '-None-';
}

function validateDuringType(input, value) {
  const type = String(input?.data_type || 'text').toLowerCase();
  const message = `${input?.label || input?.api_name || 'Transition input'} must be a valid ${type}.`;
  if (type === 'integer') {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim());
    const exactInteger = typeof value === 'number'
      ? Number.isSafeInteger(value)
      : /^-?\d+$/.test(String(value).trim()) && Number.isSafeInteger(parsed);
    if (!exactInteger) return { field: input.api_name, code: 'invalid_transition_integer', message };
  }
  if (type === 'bigint' && !/^-?\d+$/.test(String(value).trim())) {
    return { field: input.api_name, code: 'invalid_transition_integer', message };
  }
  if (['double', 'currency', 'percent'].includes(type)) {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(parsed)) return { field: input.api_name, code: 'invalid_transition_number', message };
  }
  if (type === 'date' && dateKey(value) === null) {
    return { field: input.api_name, code: 'invalid_transition_date', message };
  }
  return null;
}

const criterionScalar = value => value && typeof value === 'object'
  ? (value.actual_value ?? value.display_value ?? value.name ?? value.id)
  : value;

function dateKey(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(timestamp / 86_400_000);
}

function dateInTimeZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function validateDuringField(input, value, { now = new Date(), timeZone = 'Asia/Kolkata' } = {}) {
  const validation = input?.validation;
  if (!validation) return null;
  const message = validation.message || `${input.label || input.api_name} does not satisfy the Zoho During-phase validation.`;
  if (validation.logic_supported !== true) {
    return { field: input.api_name, code: 'source_validation_unsupported', message };
  }
  const scalar = criterionScalar(value);
  if (validation.kind === 'allowed_values') {
    const allowed = Array.isArray(validation.allowed_values) ? validation.allowed_values.map(String) : [];
    return allowed.includes(String(scalar ?? '')) ? null : { field: input.api_name, code: 'invalid_transition_value', message };
  }
  if (validation.kind === 'date_window') {
    const supplied = dateKey(scalar);
    const reference = dateKey(dateInTimeZone(now, timeZone));
    if (supplied === null || reference === null) return { field: input.api_name, code: 'invalid_transition_date', message };
    const offsetDays = supplied - reference;
    const min = validation.min_offset_days;
    const max = validation.max_offset_days;
    if ((Number.isInteger(min) && offsetDays < min) || (Number.isInteger(max) && offsetDays > max)) {
      return { field: input.api_name, code: 'invalid_transition_date', message };
    }
    return null;
  }
  return { field: input.api_name, code: 'source_validation_unsupported', message };
}

function beforeCriteriaMatch(definition, record) {
  if (definition?.before?.criteria_evidence_complete === false || definition?.before?.criteria_logic_supported === false) return false;
  const criteria = definition?.before?.criteria || [];
  return criteria.every(criterion => {
    if (!['equal', 'is'].includes(criterion.operator)) return false;
    const actual = criterionScalar(record?.[criterion.field]);
    return String(actual ?? '') === String(criterion.value ?? '');
  });
}

function transitionEligible(transition, definition, current, authoritativeConnections = [], record = null) {
  if (!beforeCriteriaMatch(definition, record)) return false;
  const currentValues = new Set([
    current,
    current && typeof current === 'object' ? current.name : null,
    current && typeof current === 'object' ? current.display_value : null,
    current && typeof current === 'object' ? current.actual_value : null,
  ].filter(value => value !== null && value !== undefined).map(String));
  const connections = (authoritativeConnections || []).filter(connection => String(connection?.transition?.id || '') === String(transition?.id || ''));
  if (connections.length) {
    return connections.some(connection => currentValues.has(String(connection?.from_state?.name ?? '')) || currentValues.has(String(connection?.from_state?.id ?? '')));
  }
  if (definition?.common && definition?.include_all_states) return true;
  return [transition?.from?.actual_value, transition?.from?.display_value, transition?.from?.id]
    .filter(value => value !== null && value !== undefined)
    .some(value => currentValues.has(String(value)));
}

function validateTransitionPayload(definition, record, payload = {}, validationContext = {}) {
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? { ...payload.data } : {};
  const notes = String(payload.associated_items?.Notes?.content ?? payload.notes ?? '').trim();
  const allowedFields = new Set((definition?.during_inputs || []).filter(input => input.kind === 'field').map(input => input.api_name));
  const unknownFields = Object.keys(data).filter(field => !allowedFields.has(field));
  if (unknownFields.length) {
    throw new BlueprintTransitionError('Transition payload contains fields that are not part of the Zoho During phase.', {
      details: unknownFields.map(field => ({ field, code: 'not_in_transition', message: `${field} is not configured for this transition.` })),
    });
  }

  const missing = [];
  for (const input of definition?.during_inputs || []) {
    if (!input.required) continue;
    if (input.kind === 'associated_item' && input.api_name === 'Notes') {
      if (!notes) missing.push({ field: 'Notes', code: 'required', message: 'Notes is mandatory for this transition.' });
      continue;
    }
    if (input.kind === 'field') {
      const submitted = Object.prototype.hasOwnProperty.call(data, input.api_name);
      const finalValue = submitted ? data[input.api_name] : undefined;
      if (!submitted || transitionValueMissing(input, finalValue)) {
        missing.push({ field: input.api_name, code: 'required', message: `${input.label || input.api_name} is mandatory for this transition.` });
      }
    }
  }
  if (missing.length) throw new BlueprintTransitionError('Mandatory Blueprint transition inputs are missing.', { details: missing });

  const invalid = [];
  for (const input of definition?.during_inputs || []) {
    if (input.kind !== 'field' || !Object.prototype.hasOwnProperty.call(data, input.api_name)) continue;
    const finalValue = data[input.api_name];
    if (transitionValueMissing(input, finalValue)) {
      if (!input.required) {
        delete data[input.api_name];
        continue;
      }
    } else {
      const typeError = validateDuringType(input, finalValue);
      if (typeError) invalid.push(typeError);
      if (input.validation) {
        const validationError = validateDuringField(input, finalValue, validationContext);
        if (validationError) invalid.push(validationError);
      }
    }
  }
  if (invalid.length) throw new BlueprintTransitionError('Blueprint transition field validation failed.', { details: invalid });
  return { data, notes };
}

module.exports = {
  BlueprintTransitionError,
  beforeCriteriaMatch,
  localExecutionReadiness,
  transitionEligible,
  transitionStateValue,
  validateDuringField,
  validateTransitionPayload,
};
