'use strict';

class ValidationError extends Error {
  constructor(errors, status = 422) {
    super(errors.map(error => error.message).join('; '));
    this.name = 'ValidationError';
    this.status = status;
    this.code = 'VALIDATION_FAILED';
    this.errors = errors;
  }
}

const blank = value => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value);

function validatePayload(fields, payload, { isCreate = false } = {}) {
  const map = new Map((fields || []).map(field => [field.api_name, field]));
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError([{ field: null, code: 'invalid_payload', message: 'Request body must be a JSON object.' }], 400);
  }

  for (const [apiName, value] of Object.entries(payload)) {
    const field = map.get(apiName);
    if (!field) {
      errors.push({ field: apiName, code: 'unknown_field', message: `${apiName} is not a configured field.` });
      continue;
    }
    if (field.read_only || field.virtual_field || field.data_type === 'formula') {
      errors.push({ field: apiName, code: 'read_only', message: `${field.field_label || apiName} is read-only.` });
      continue;
    }
    if (blank(value)) {
      if (field.system_mandatory || field.required) errors.push({ field: apiName, code: 'required', message: `${field.field_label || apiName} is required.` });
      continue;
    }

    const type = field.data_type;
    if (['integer', 'double', 'currency', 'percent', 'bigint'].includes(type)) {
      const numeric = scalar(value) ? Number(value) : Number.NaN;
      if (!Number.isFinite(numeric)) {
        errors.push({ field: apiName, code: 'invalid_number', message: `${field.field_label || apiName} must be a valid number.` });
      } else if (type === 'integer') {
        const exactInteger = typeof value === 'number'
          ? Number.isSafeInteger(value)
          : /^-?\d+$/.test(String(value).trim()) && Number.isSafeInteger(numeric);
        if (!exactInteger) {
          errors.push({ field: apiName, code: 'invalid_integer', message: `${field.field_label || apiName} must be a whole number.` });
        } else if (field.length && String(Math.abs(numeric)).length > Number(field.length)) {
          errors.push({ field: apiName, code: 'too_long', message: `${field.field_label || apiName} exceeds its ${field.length}-digit limit.` });
        }
      } else if (type === 'bigint' && !/^-?\d+$/.test(String(value).trim())) {
        errors.push({ field: apiName, code: 'invalid_integer', message: `${field.field_label || apiName} must be a whole number.` });
      }
    }
    if (type === 'boolean' && typeof value !== 'boolean') {
      errors.push({ field: apiName, code: 'invalid_boolean', message: `${field.field_label || apiName} must be true or false.` });
    }
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      errors.push({ field: apiName, code: 'invalid_date', message: `${field.field_label || apiName} must use YYYY-MM-DD.` });
    }
    if (type === 'datetime' && Number.isNaN(Date.parse(String(value)))) {
      errors.push({ field: apiName, code: 'invalid_datetime', message: `${field.field_label || apiName} must be a valid date and time.` });
    }
    if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
      errors.push({ field: apiName, code: 'invalid_email', message: `${field.field_label || apiName} must be a valid email address.` });
    }
    if (type === 'picklist') {
      const allowed = (field.pick_list_values || []).filter(option => option.type !== 'unused').flatMap(option => [option.actual_value, option.display_value]).filter(option => option !== null && option !== undefined).map(String);
      if (allowed.length && !allowed.includes(String(value))) errors.push({ field: apiName, code: 'invalid_picklist', message: `${field.field_label || apiName} contains a value outside its configured picklist.` });
    }
    if (['multiselectpicklist', 'multiselectlookup', 'multiuserlookup'].includes(type) && !Array.isArray(value)) {
      errors.push({ field: apiName, code: 'invalid_collection', message: `${field.field_label || apiName} must be a list.` });
    }
    if (type === 'subform' && (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row)))) {
      errors.push({ field: apiName, code: 'invalid_subform', message: `${field.field_label || apiName} must contain a list of subform rows.` });
    }
    if (['lookup', 'ownerlookup', 'userlookup'].includes(type) && !(typeof value === 'string' || (value && typeof value === 'object' && !Array.isArray(value) && (value.id || value.name)))) {
      errors.push({ field: apiName, code: 'invalid_lookup', message: `${field.field_label || apiName} must reference a valid record.` });
    }
    if (field.length && typeof value === 'string' && value.length > Number(field.length)) {
      errors.push({ field: apiName, code: 'too_long', message: `${field.field_label || apiName} exceeds its ${field.length}-character limit.` });
    }
  }

  if (isCreate) {
    for (const field of fields || []) {
      const enforceableVirtualField = field.virtual_field !== true || field.data_type === 'subform';
      if ((field.system_mandatory || field.required) && !field.read_only && enforceableVirtualField && field.data_type !== 'formula' && blank(payload[field.api_name])) {
        if (!errors.some(error => error.field === field.api_name && error.code === 'required')) {
          errors.push({ field: field.api_name, code: 'required', message: `${field.field_label || field.api_name} is required.` });
        }
      }
    }
  }

  if (errors.length) throw new ValidationError(errors);
  return payload;
}

module.exports = { ValidationError, validatePayload };
