'use strict';

const LOCAL_READ_MAX_ATTEMPTS = 2;
const LOCAL_READ_ATTEMPT_TIMEOUT_MS = 18_000;

function isRetryableStatementTimeout(error) {
  const code = String(error?.dbCode || error?.code || '');
  const message = String(error?.message || error || '');
  const hasTimeoutCode = code === '57014'
    || /["']?code["']?\s*:\s*["']57014["']/i.test(message);
  return hasTimeoutCode && /cancel(?:ing|led).*statement.*statement timeout|statement timeout/i.test(message);
}

function boundedSignals(abortSignal, attemptTimeoutMs) {
  const timeoutSignal = AbortSignal.timeout(attemptTimeoutMs);
  return {
    signal: abortSignal ? AbortSignal.any([abortSignal, timeoutSignal]) : timeoutSignal,
    timeoutSignal,
  };
}

function isRetryableBoundedAttemptTimeout(error, { timeoutSignal, abortSignal } = {}) {
  if (timeoutSignal?.aborted !== true || abortSignal?.aborted === true) return false;
  const name = String(error?.name || '');
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return name === 'TimeoutError'
    && (code === '' || code === '23')
    && /operation was aborted due to timeout/i.test(message);
}

async function executeBoundedLocalRead({
  readOnlyQuery,
  statement,
  abortSignal,
  maxAttempts = LOCAL_READ_MAX_ATTEMPTS,
  attemptTimeoutMs = LOCAL_READ_ATTEMPT_TIMEOUT_MS,
} = {}) {
  if (typeof readOnlyQuery !== 'function') throw new TypeError('readOnlyQuery must be a function.');
  if (typeof statement !== 'string' || !/^\s*(?:select|with)\b/i.test(statement)) throw new TypeError('statement must be a read-only SELECT or WITH query.');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > LOCAL_READ_MAX_ATTEMPTS) throw new TypeError('maxAttempts is outside the reviewed bound.');
  if (!Number.isSafeInteger(attemptTimeoutMs) || attemptTimeoutMs < 1 || attemptTimeoutMs > LOCAL_READ_ATTEMPT_TIMEOUT_MS) throw new TypeError('attemptTimeoutMs is outside the reviewed bound.');
  if (abortSignal !== undefined && (typeof abortSignal !== 'object' || typeof abortSignal.aborted !== 'boolean')) throw new TypeError('abortSignal is invalid.');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { signal, timeoutSignal } = boundedSignals(abortSignal, attemptTimeoutMs);
    try {
      const result = await readOnlyQuery(statement, {
        signal,
      });
      return { result, attempts: attempt };
    } catch (error) {
      const retryable = isRetryableStatementTimeout(error)
        || isRetryableBoundedAttemptTimeout(error, { timeoutSignal, abortSignal });
      if (attempt === maxAttempts || !retryable) throw error;
    }
  }
  throw new Error('Local read attempt accounting failed.');
}

module.exports = {
  LOCAL_READ_ATTEMPT_TIMEOUT_MS,
  LOCAL_READ_MAX_ATTEMPTS,
  executeBoundedLocalRead,
  isRetryableBoundedAttemptTimeout,
  isRetryableStatementTimeout,
};
