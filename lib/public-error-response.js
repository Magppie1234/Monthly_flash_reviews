'use strict';

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,79}$/;
const SAFE_STATUSES = new Set([400, 401, 403, 404, 409, 410, 412, 413, 415, 422, 429, 503]);
const CONTROLLED_SAFE_STATUSES = new Set([...SAFE_STATUSES, 502]);
const FORBIDDEN_KEYS = /(?:authorization|cookie|credential|password|secret|token|query|sql|url|host|response|body|stack)/i;
const FORBIDDEN_TEXT = [
  /https?:\/\//i,
  /(?:postgres(?:ql)?|mysql|mongodb):\/\//i,
  /\b(?:localhost|[A-Za-z0-9.-]+\.supabase\.co)(?::\d+)?\b/i,
  /\b(?:password|secret|token|authorization|api[_ -]?key|credential)\b\s*(?:[:=]|is)/i,
  /\b(?:select|insert|update|delete|alter|drop|truncate|grant|revoke)\b[\s\S]{0,160}\b(?:from|into|table|function|on)\b/i,
  /\bdb\s+\d{3}\b/i,
  /\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b/i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
];
const FIXED = Object.freeze({
  status: 500,
  body: Object.freeze({
    error: 'The request could not be completed safely.',
    code: 'INTERNAL_ERROR',
  }),
});

function ownValue(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function safeText(value, maxLength = 600) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !FORBIDDEN_TEXT.some(pattern => pattern.test(value));
}

function safeDetails(value, state = { count: 0, seen: new Set() }, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return safeText(value, 500) ? value : undefined;
  if (!value || typeof value !== 'object' || depth > 5 || state.seen.has(value)) return undefined;
  let descriptors;
  let prototype;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    return undefined;
  }
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || descriptors.length?.value > 100) return undefined;
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || Reflect.ownKeys(descriptors).length !== length + 1) return undefined;
    const output = [];
    state.seen.add(value);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) return undefined;
      const child = safeDetails(descriptor.value, state, depth + 1);
      if (child === undefined) return undefined;
      output.push(child);
    }
    state.seen.delete(value);
    return output;
  }
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const output = {};
  state.seen.add(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.test(key) || state.count >= 200) return undefined;
    const descriptor = descriptors[key];
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) return undefined;
    state.count += 1;
    const child = safeDetails(descriptor.value, state, depth + 1);
    if (child === undefined) return undefined;
    output[key] = child;
  }
  state.seen.delete(value);
  return output;
}

function publicErrorResponse(error, { controlledClass = false, includeDetails = false, details: suppliedDetails } = {}) {
  const status = ownValue(error, 'status');
  const code = ownValue(error, 'code');
  const message = ownValue(error, 'message');
  const allowedStatuses = controlledClass ? CONTROLLED_SAFE_STATUSES : SAFE_STATUSES;
  const controlledContract = SAFE_STATUSES.has(status) && typeof code === 'string' && SAFE_CODE.test(code);
  if ((!controlledClass && !controlledContract) || !allowedStatuses.has(status)
      || typeof code !== 'string' || !SAFE_CODE.test(code) || !safeText(message)) {
    return FIXED;
  }
  const body = { error: message, code };
  if (includeDetails) {
    const details = safeDetails(suppliedDetails === undefined ? ownValue(error, 'details') : suppliedDetails);
    if (details !== undefined) body.details = details;
  }
  return { status, body };
}

module.exports = {
  publicErrorResponse,
};
