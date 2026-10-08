'use strict';

const crypto = require('node:crypto');

const STATE_SCHEMA_VERSION = 1;
const DEFAULT_PER_PAGE = 200;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_RECORDS_PER_MODULE = 60;
const DEFAULT_MAX_RECORDS_PER_RUN = 60;
const DEFAULT_MAX_SOURCE_REQUESTS_PER_RUN = 100;
const DEFAULT_OVERLAP_MS = 1_000;
const DEFAULT_CLOCK_SKEW_MS = 300_000;
const MODULE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const RECORD_ID_PATTERN = /^\d{8,32}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const DELETION_TYPES = new Set(['recycle', 'permanent']);

class DeletionSyncError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'DeletionSyncError';
    this.code = code;
  }
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function safeIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DeletionSyncError('INVALID_TIMESTAMP', `${label} must be a valid timestamp.`);
  }
  return date.toISOString();
}

function optionalIso(value, label) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return safeIso(value, label);
  } catch {
    return null;
  }
}

function safePositiveInteger(value, fallback, label) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new DeletionSyncError('INVALID_LIMIT', `${label} must be a positive safe integer.`);
  }
  return resolved;
}

function safeNonNegativeInteger(value, fallback, label) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new DeletionSyncError('INVALID_DURATION', `${label} must be a non-negative safe integer.`);
  }
  return resolved;
}

function normalizeModuleKeys(modules) {
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new DeletionSyncError('MODULES_REQUIRED', 'At least one module is required.');
  }
  const unique = [];
  const seen = new Set();
  for (const value of modules) {
    const moduleKey = String(value || '').trim();
    if (!MODULE_KEY_PATTERN.test(moduleKey)) {
      throw new DeletionSyncError('INVALID_MODULE_KEY', 'Module keys must use the CRM API-name format.');
    }
    if (!seen.has(moduleKey)) {
      seen.add(moduleKey);
      unique.push(moduleKey);
    }
  }
  return unique;
}

function normalizeRecordId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const recordId = String(value).trim();
  return RECORD_ID_PATTERN.test(recordId) ? recordId : null;
}

function normalizeDeletionEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const recordId = normalizeRecordId(value.id ?? value.record_id);
  const deletionType = typeof value.type === 'string' ? value.type : value.deletion_type;
  const deletedTimeValue = value.deleted_time;
  if (
    !recordId
    || !DELETION_TYPES.has(deletionType)
    || deletedTimeValue === null
    || deletedTimeValue === undefined
    || deletedTimeValue === ''
  ) return null;
  try {
    return {
      record_id: recordId,
      deleted_time: safeIso(deletedTimeValue, 'Deleted record deleted_time'),
      deletion_type: deletionType,
    };
  } catch {
    return null;
  }
}

function typeRank(value) {
  return value === 'permanent' ? 1 : 0;
}

function compareDeletionTuple(left, right) {
  const timeDifference = Date.parse(left.deleted_time) - Date.parse(right.deleted_time);
  if (timeDifference !== 0) return timeDifference;
  const idDifference = left.record_id.localeCompare(right.record_id);
  if (idDifference !== 0) return idDifference;
  return typeRank(left.deletion_type) - typeRank(right.deletion_type);
}

function sameDeletionTuple(left, right) {
  return Boolean(
    left
    && right
    && left.record_id === right.record_id
    && left.deleted_time === right.deleted_time
    && left.deletion_type === right.deletion_type
  );
}

function normalizeCursor(value) {
  const event = normalizeDeletionEvent(value);
  return event ? event : null;
}

function emptyModuleState() {
  return {
    baseline: {
      status: 'pending',
      established_at: null,
    },
    successful_through: null,
    window: null,
  };
}

function normalizeBaseline(value) {
  const establishedAt = optionalIso(value?.established_at, 'Baseline established_at');
  if (value?.status === 'ready' && establishedAt) {
    return { status: 'ready', established_at: establishedAt };
  }
  return {
    status: 'pending',
    established_at: establishedAt,
  };
}

function normalizeWindow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const since = optionalIso(value.since, 'Window since');
  const through = optionalIso(value.through, 'Window through');
  if (!since || !through || Date.parse(through) < Date.parse(since)) return null;

  const candidates = normalizeCandidateEvents(value.candidates);
  const digest = typeof value.digest === 'string' && DIGEST_PATTERN.test(value.digest)
    ? value.digest
    : null;
  const count = Number.isSafeInteger(value.count) && value.count >= 0 ? value.count : null;
  const hasStableScan = candidates !== null
    && digest !== null
    && count === candidates.length
    && digestEvents(candidates) === digest;
  const confirmed = hasStableScan && value.confirmed === true;
  const cursor = confirmed ? normalizeCursor(value.cursor) : null;
  return {
    since,
    through,
    digest: hasStableScan ? digest : null,
    count: hasStableScan ? count : null,
    candidates: hasStableScan ? candidates : null,
    confirmed,
    cursor: cursor && candidates.some(event => sameDeletionTuple(event, cursor)) ? cursor : null,
  };
}

function normalizeModuleState(value) {
  const state = emptyModuleState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state;
  state.baseline = normalizeBaseline(value.baseline);
  state.successful_through = optionalIso(value.successful_through, 'Module successful_through');
  state.window = normalizeWindow(value.window);
  return state;
}

function normalizedCount(value, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function normalizeSafeModuleResult(value) {
  if (!value || typeof value !== 'object') return null;
  const moduleKey = String(value.module_key || '').trim();
  if (!MODULE_KEY_PATTERN.test(moduleKey)) return null;
  const status = ['complete', 'partial', 'error'].includes(value.status) ? value.status : 'error';
  const reason = value.reason_code === null || value.reason_code === undefined
    ? null
    : String(value.reason_code);
  return {
    module_key: moduleKey,
    status,
    pages_scanned: normalizedCount(value.pages_scanned),
    discovered_deletions: normalizedCount(value.discovered_deletions, { nullable: true }),
    attempted_deletions: normalizedCount(value.attempted_deletions),
    processed_deletions: normalizedCount(value.processed_deletions),
    applied_deletions: normalizedCount(value.applied_deletions),
    remaining_deletions: normalizedCount(value.remaining_deletions, { nullable: true }),
    cursor_advanced: value.cursor_advanced === true,
    reason_code: reason && REASON_CODE_PATTERN.test(reason) ? reason : null,
  };
}

function normalizeRecordBudget(value) {
  if (!value || typeof value !== 'object') return null;
  const limit = normalizedCount(value.limit);
  const attempted = Math.min(normalizedCount(value.attempted), limit);
  const processed = Math.min(normalizedCount(value.processed), attempted);
  return {
    limit,
    attempted,
    processed,
    remaining_capacity: Math.max(0, limit - attempted),
  };
}

function normalizeSourceRequestBudget(value) {
  if (!value || typeof value !== 'object') return null;
  const limit = normalizedCount(value.limit);
  const used = Math.min(normalizedCount(value.used), limit);
  return {
    limit,
    used,
    remaining_capacity: Math.max(0, limit - used),
    estimated_api_credits: used * 2,
  };
}

function normalizeRunSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const summary = value.module_summary || {};
  const moduleSummary = {
    total: normalizedCount(summary.total),
    complete: normalizedCount(summary.complete),
    partial: normalizedCount(summary.partial),
    error: normalizedCount(summary.error),
  };
  const seen = new Set();
  const moduleResults = (Array.isArray(value.module_results) ? value.module_results : [])
    .map(normalizeSafeModuleResult)
    .filter(result => {
      if (!result || seen.has(result.module_key)) return false;
      seen.add(result.module_key);
      return true;
    });
  const structurallySuccessful = moduleSummary.total > 0
    && moduleSummary.complete === moduleSummary.total
    && moduleSummary.partial === 0
    && moduleSummary.error === 0
    && moduleResults.length === moduleSummary.total
    && moduleResults.every(result => result.status === 'complete');
  const globalSuccess = value.global_success === true && structurallySuccessful;
  return {
    schema_version: STATE_SCHEMA_VERSION,
    source_mode: 'read-only',
    started_at: safeIso(value.started_at, 'Run started_at'),
    finished_at: safeIso(value.finished_at, 'Run finished_at'),
    status: globalSuccess
      ? 'succeeded'
      : (moduleSummary.total > 0 && moduleSummary.error === moduleSummary.total ? 'failed' : 'partial'),
    global_success: globalSuccess,
    module_summary: moduleSummary,
    record_budget: normalizeRecordBudget(value.record_budget),
    source_request_budget: normalizeSourceRequestBudget(value.source_request_budget),
    module_results: moduleResults,
  };
}

function emptyDeletionSyncState() {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    modules: {},
    fairness: { next_module: null },
    last_completed_run: null,
    last_successful_run: null,
  };
}

function normalizeDeletionSyncState(value) {
  const state = emptyDeletionSyncState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return state;
  if (value.schema_version !== undefined && value.schema_version !== STATE_SCHEMA_VERSION) {
    throw new DeletionSyncError(
      'UNSUPPORTED_STATE_VERSION',
      'The persisted deletion-sync state version is unsupported.',
    );
  }
  if (value.modules && typeof value.modules === 'object' && !Array.isArray(value.modules)) {
    for (const [moduleKey, moduleState] of Object.entries(value.modules)) {
      if (MODULE_KEY_PATTERN.test(moduleKey)) state.modules[moduleKey] = normalizeModuleState(moduleState);
    }
  }
  const nextModule = String(value.fairness?.next_module || '').trim();
  state.fairness.next_module = MODULE_KEY_PATTERN.test(nextModule) ? nextModule : null;
  state.last_completed_run = normalizeRunSummary(value.last_completed_run);
  const lastSuccessful = normalizeRunSummary(value.last_successful_run);
  state.last_successful_run = lastSuccessful?.global_success === true ? lastSuccessful : null;
  return state;
}

function createPersistedDeletionSyncStateStore({ loadSnapshot, saveSnapshot } = {}) {
  if (typeof loadSnapshot !== 'function') throw new TypeError('loadSnapshot must be a function.');
  if (typeof saveSnapshot !== 'function') throw new TypeError('saveSnapshot must be a function.');
  return {
    async load() {
      let snapshot;
      try {
        snapshot = await loadSnapshot();
      } catch (error) {
        throw new DeletionSyncError(
          'STATE_LOAD_FAILED',
          'Deletion-sync state could not be loaded.',
          { cause: error },
        );
      }
      if (typeof snapshot === 'string') {
        try {
          snapshot = JSON.parse(snapshot);
        } catch (error) {
          throw new DeletionSyncError(
            'STATE_PARSE_FAILED',
            'Deletion-sync state is not valid JSON.',
            { cause: error },
          );
        }
      }
      return normalizeDeletionSyncState(snapshot);
    },
    async save(value) {
      const normalized = normalizeDeletionSyncState(value);
      try {
        await saveSnapshot(cloneJson(normalized));
      } catch (error) {
        throw new DeletionSyncError(
          'STATE_PERSIST_FAILED',
          'Deletion-sync state could not be persisted.',
          { cause: error },
        );
      }
      return cloneJson(normalized);
    },
  };
}

function createInMemoryDeletionSyncStateStore(initialState = null) {
  let snapshot = normalizeDeletionSyncState(initialState);
  return {
    async load() {
      return cloneJson(snapshot);
    },
    async save(value) {
      snapshot = normalizeDeletionSyncState(value);
      return cloneJson(snapshot);
    },
    snapshot() {
      return cloneJson(snapshot);
    },
  };
}

function eventKey(event) {
  return `${event.deleted_time}\u0000${event.record_id}\u0000${event.deletion_type}`;
}

function digestEvents(events) {
  const hash = crypto.createHash('sha256');
  for (const event of events) hash.update(`${eventKey(event)}\n`);
  return hash.digest('hex');
}

function normalizeCandidateEvents(values) {
  if (!Array.isArray(values)) return null;
  const events = [];
  const seenRecordIds = new Set();
  for (const value of values) {
    const event = normalizeDeletionEvent(value);
    if (!event || seenRecordIds.has(event.record_id)) return null;
    seenRecordIds.add(event.record_id);
    events.push(event);
  }
  return events.sort(compareDeletionTuple);
}

function sameCandidateEvents(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((event, index) => sameDeletionTuple(event, right[index]));
}

function containsEveryCandidate(superset, subset) {
  const keys = new Set(superset.map(eventKey));
  return subset.every(event => keys.has(eventKey(event)));
}

function firstPendingCandidateIndex(events, cursor) {
  if (!cursor) return 0;
  const firstPending = events.findIndex(event => compareDeletionTuple(event, cursor) > 0);
  return firstPending < 0 ? events.length : firstPending;
}

function isExplicitNoContentPage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === 2
    && keys.includes('data')
    && keys.includes('status')
    && (value.status === 204 || value.status === 304)
    && Array.isArray(value.data)
    && value.data.length === 0;
}

async function scanDeletionPass({
  moduleKey,
  listDeleted,
  since,
  through,
  perPage,
  maxPages,
  sourceRequestBudget,
}) {
  const events = [];
  const seenRecordIds = new Set();
  const seenPageSignatures = new Set();
  let pagesScanned = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    if (sourceRequestBudget.used >= sourceRequestBudget.limit) {
      sourceRequestBudget.exhausted = true;
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'SOURCE_REQUEST_BUDGET_REACHED',
        pagesScanned,
      };
    }
    sourceRequestBudget.used += 1;
    sourceRequestBudget.lastModule = moduleKey;
    let body;
    try {
      body = await listDeleted({
        module: moduleKey,
        page,
        perPage,
        ifModifiedSince: since,
        type: 'all',
      });
    } catch {
      return {
        ok: false,
        status: 'error',
        reasonCode: 'DELETION_LIST_FAILED',
        pagesScanned,
      };
    }
    pagesScanned += 1;

    const explicitNoContent = isExplicitNoContentPage(body);
    if (explicitNoContent && page === 1) {
      return { ok: true, pagesScanned, events: [...events].sort(compareDeletionTuple) };
    }
    const hasAmbiguousStatus = body
      && typeof body === 'object'
      && !Array.isArray(body)
      && Object.prototype.hasOwnProperty.call(body, 'status');
    if (body === null || body === undefined || explicitNoContent || hasAmbiguousStatus) {
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'DELETION_PAGE_INVALID',
        pagesScanned,
      };
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'DELETION_PAGE_INVALID',
        pagesScanned,
      };
    }
    if (!Array.isArray(body.data) || body.data.length > perPage
      || !body.info || typeof body.info !== 'object'
      || Array.isArray(body.info)
      || typeof body.info.more_records !== 'boolean') {
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'DELETION_PAGE_INVALID',
        pagesScanned,
      };
    }
    if (body.info.page !== undefined && body.info.page !== null && Number(body.info.page) !== page) {
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'DELETION_PAGE_MISMATCH',
        pagesScanned,
      };
    }

    const pageEvents = [];
    for (const rawEvent of body.data) {
      const event = normalizeDeletionEvent(rawEvent);
      if (!event) {
        return {
          ok: false,
          status: 'partial',
          reasonCode: 'DELETION_ENTRY_INVALID',
          pagesScanned,
        };
      }
      pageEvents.push(event);
    }

    if (pageEvents.length > 0) {
      const pageSignature = digestEvents([...pageEvents].sort(compareDeletionTuple));
      if (seenPageSignatures.has(pageSignature)) {
        return {
          ok: false,
          status: 'partial',
          reasonCode: 'DELETION_PAGE_REPEATED',
          pagesScanned,
        };
      }
      seenPageSignatures.add(pageSignature);
    }

    for (const event of pageEvents) {
      if (seenRecordIds.has(event.record_id)) {
        return {
          ok: false,
          status: 'partial',
          reasonCode: 'DELETION_RECORD_DUPLICATE',
          pagesScanned,
        };
      }
      seenRecordIds.add(event.record_id);
      const timestamp = Date.parse(event.deleted_time);
      if (timestamp >= Date.parse(since) && timestamp <= Date.parse(through)) events.push(event);
    }

    if (!body.info.more_records) {
      return { ok: true, pagesScanned, events: [...events].sort(compareDeletionTuple) };
    }
    if (page === maxPages) {
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'DELETION_PAGE_BOUND_REACHED',
        pagesScanned,
      };
    }
  }

  return {
    ok: false,
    status: 'partial',
    reasonCode: 'DELETION_PAGE_BOUND_REACHED',
    pagesScanned,
  };
}

async function discoverStableWindow(options) {
  const first = await scanDeletionPass(options);
  if (!first.ok) return first;
  const second = await scanDeletionPass(options);
  const pagesScanned = first.pagesScanned + second.pagesScanned;
  if (!second.ok) return { ...second, pagesScanned };

  const firstDigest = digestEvents(first.events);
  const secondDigest = digestEvents(second.events);
  if (first.events.length !== second.events.length || firstDigest !== secondDigest) {
    return {
      ok: false,
      status: 'partial',
      reasonCode: 'DELETION_SCAN_UNSTABLE',
      pagesScanned,
    };
  }
  return {
    ok: true,
    pagesScanned,
    events: second.events,
    count: second.events.length,
    digest: secondDigest,
  };
}

function safeModuleResult(status, values = {}) {
  const reason = String(values.reason_code || '');
  return {
    status,
    pages_scanned: normalizedCount(values.pages_scanned),
    discovered_deletions: normalizedCount(values.discovered_deletions, { nullable: true }),
    attempted_deletions: normalizedCount(values.attempted_deletions),
    processed_deletions: normalizedCount(values.processed_deletions),
    applied_deletions: normalizedCount(values.applied_deletions),
    remaining_deletions: normalizedCount(values.remaining_deletions, { nullable: true }),
    cursor_advanced: values.cursor_advanced === true,
    reason_code: REASON_CODE_PATTERN.test(reason) ? reason : null,
  };
}

function summarizeModules(results) {
  const values = Object.values(results);
  return {
    total: values.length,
    complete: values.filter(value => value.status === 'complete').length,
    partial: values.filter(value => value.status === 'partial').length,
    error: values.filter(value => value.status === 'error').length,
  };
}

function rotatedModuleOrder(moduleKeys, nextModule) {
  const index = moduleKeys.indexOf(nextModule);
  if (index < 0) return [...moduleKeys];
  return [...moduleKeys.slice(index), ...moduleKeys.slice(0, index)];
}

function nextModuleAfter(moduleKeys, moduleKey) {
  if (moduleKeys.length === 0) return null;
  const index = moduleKeys.indexOf(moduleKey);
  return moduleKeys[(index < 0 ? 0 : index + 1) % moduleKeys.length];
}

function freshWindow(moduleState, startedTime, overlapMs, clockSkewMs) {
  const base = moduleState.successful_through || moduleState.baseline.established_at;
  const since = new Date(Date.parse(base) - overlapMs).toISOString();
  const through = new Date(startedTime - clockSkewMs).toISOString();
  return {
    since,
    through,
    digest: null,
    count: null,
    candidates: null,
    confirmed: false,
    cursor: null,
  };
}

async function runZohoDeletionSync({
  modules,
  listDeleted,
  archiveRecord,
  stateStore,
  now = () => new Date(),
  perPage = DEFAULT_PER_PAGE,
  maxPages = DEFAULT_MAX_PAGES,
  maxRecordsPerModule = DEFAULT_MAX_RECORDS_PER_MODULE,
  maxRecordsPerRun = DEFAULT_MAX_RECORDS_PER_RUN,
  maxSourceRequestsPerRun = DEFAULT_MAX_SOURCE_REQUESTS_PER_RUN,
  overlapMs = DEFAULT_OVERLAP_MS,
  clockSkewMs = DEFAULT_CLOCK_SKEW_MS,
} = {}) {
  const moduleKeys = normalizeModuleKeys(modules);
  if (typeof listDeleted !== 'function') throw new TypeError('listDeleted must be a function.');
  if (typeof archiveRecord !== 'function') throw new TypeError('archiveRecord must be a function.');
  if (!stateStore || typeof stateStore.load !== 'function' || typeof stateStore.save !== 'function') {
    throw new TypeError('stateStore must provide load and save functions.');
  }
  const resolvedPerPage = safePositiveInteger(perPage, DEFAULT_PER_PAGE, 'perPage');
  if (resolvedPerPage > DEFAULT_PER_PAGE) {
    throw new DeletionSyncError(
      'INVALID_LIMIT',
      `perPage must be between 1 and ${DEFAULT_PER_PAGE}.`,
    );
  }
  const resolvedMaxPages = safePositiveInteger(maxPages, DEFAULT_MAX_PAGES, 'maxPages');
  const resolvedModuleLimit = safePositiveInteger(
    maxRecordsPerModule,
    DEFAULT_MAX_RECORDS_PER_MODULE,
    'maxRecordsPerModule',
  );
  const resolvedRunLimit = safePositiveInteger(
    maxRecordsPerRun,
    DEFAULT_MAX_RECORDS_PER_RUN,
    'maxRecordsPerRun',
  );
  const resolvedSourceRequestLimit = safePositiveInteger(
    maxSourceRequestsPerRun,
    DEFAULT_MAX_SOURCE_REQUESTS_PER_RUN,
    'maxSourceRequestsPerRun',
  );
  const maximumConvergentPages = Math.floor(resolvedSourceRequestLimit / 2);
  if (resolvedMaxPages > maximumConvergentPages) {
    throw new DeletionSyncError(
      'INVALID_LIMIT',
      'maxPages must allow two complete discovery passes within maxSourceRequestsPerRun.',
    );
  }
  const resolvedOverlapMs = safeNonNegativeInteger(overlapMs, DEFAULT_OVERLAP_MS, 'overlapMs');
  const resolvedClockSkewMs = safeNonNegativeInteger(clockSkewMs, DEFAULT_CLOCK_SKEW_MS, 'clockSkewMs');

  const startedDate = now();
  const startedAt = safeIso(startedDate, 'Sync start time');
  const startedTime = Date.parse(startedAt);
  const state = normalizeDeletionSyncState(await stateStore.load());
  const results = {};
  const workByModule = new Map();
  const sourceRequestBudget = {
    limit: resolvedSourceRequestLimit,
    used: 0,
    exhausted: false,
    lastModule: null,
  };
  const orderedModules = rotatedModuleOrder(moduleKeys, state.fairness.next_module);

  for (const moduleKey of orderedModules) {
    const moduleState = state.modules[moduleKey]
      ? normalizeModuleState(state.modules[moduleKey])
      : emptyModuleState();
    state.modules[moduleKey] = moduleState;

    if (moduleState.baseline.status !== 'ready') {
      results[moduleKey] = safeModuleResult('partial', {
        reason_code: 'DELETION_BASELINE_REQUIRED',
      });
      continue;
    }

    const window = moduleState.window
      ? cloneJson(moduleState.window)
      : freshWindow(moduleState, startedTime, resolvedOverlapMs, resolvedClockSkewMs);
    if (Date.parse(window.through) < Date.parse(window.since)) {
      results[moduleKey] = safeModuleResult('partial', {
        reason_code: 'DELETION_WINDOW_NOT_READY',
      });
      continue;
    }
    moduleState.window = window;

    const discovery = await discoverStableWindow({
      moduleKey,
      listDeleted,
      since: window.since,
      through: window.through,
      perPage: resolvedPerPage,
      maxPages: resolvedMaxPages,
      sourceRequestBudget,
    });
    if (!discovery.ok) {
      results[moduleKey] = safeModuleResult(discovery.status, {
        pages_scanned: discovery.pagesScanned,
        reason_code: discovery.reasonCode,
      });
      continue;
    }

    const priorCandidates = window.candidates;
    if (priorCandidates === null) {
      moduleState.window = {
        since: window.since,
        through: window.through,
        digest: discovery.digest,
        count: discovery.count,
        candidates: cloneJson(discovery.events),
        confirmed: false,
        cursor: null,
      };
      results[moduleKey] = safeModuleResult('partial', {
        pages_scanned: discovery.pagesScanned,
        discovered_deletions: discovery.count,
        remaining_deletions: discovery.count,
        reason_code: 'DELETION_WINDOW_CONFIRMATION_REQUIRED',
      });
      continue;
    }

    if (!sameCandidateEvents(priorCandidates, discovery.events)) {
      if (!containsEveryCandidate(discovery.events, priorCandidates)) {
        const retainedIndex = firstPendingCandidateIndex(
          priorCandidates,
          window.confirmed ? window.cursor : null,
        );
        results[moduleKey] = safeModuleResult('partial', {
          pages_scanned: discovery.pagesScanned,
          discovered_deletions: discovery.count,
          remaining_deletions: Math.max(0, priorCandidates.length - retainedIndex),
          reason_code: 'DELETION_WINDOW_REGRESSION',
        });
        continue;
      }
      moduleState.window = {
        since: window.since,
        through: window.through,
        digest: discovery.digest,
        count: discovery.count,
        candidates: cloneJson(discovery.events),
        confirmed: false,
        cursor: null,
      };
      results[moduleKey] = safeModuleResult('partial', {
        pages_scanned: discovery.pagesScanned,
        discovered_deletions: discovery.count,
        remaining_deletions: discovery.count,
        reason_code: 'DELETION_WINDOW_CHANGED',
      });
      continue;
    }

    const cursor = window.confirmed ? window.cursor : null;
    moduleState.window = {
      since: window.since,
      through: window.through,
      digest: discovery.digest,
      count: discovery.count,
      candidates: cloneJson(discovery.events),
      confirmed: true,
      cursor,
    };

    const index = firstPendingCandidateIndex(discovery.events, cursor);
    if (index >= discovery.events.length) {
      moduleState.successful_through = window.through;
      moduleState.window = null;
      results[moduleKey] = safeModuleResult('complete', {
        pages_scanned: discovery.pagesScanned,
        discovered_deletions: discovery.count,
        remaining_deletions: 0,
      });
      continue;
    }

    workByModule.set(moduleKey, {
      moduleState,
      window,
      pagesScanned: discovery.pagesScanned,
      events: discovery.events,
      index,
      startingIndex: index,
      attempted: 0,
      processed: 0,
      applied: 0,
      closed: false,
      reasonCode: null,
    });
  }

  let attemptedTotal = 0;
  let processedTotal = 0;
  let lastAttemptedModule = null;
  while (attemptedTotal < resolvedRunLimit) {
    let attemptedInRound = false;
    for (const moduleKey of orderedModules) {
      if (attemptedTotal >= resolvedRunLimit) break;
      const work = workByModule.get(moduleKey);
      if (!work || work.closed || work.index >= work.events.length
        || work.attempted >= resolvedModuleLimit) continue;

      attemptedInRound = true;
      attemptedTotal += 1;
      work.attempted += 1;
      lastAttemptedModule = moduleKey;
      const event = work.events[work.index];
      let outcome;
      try {
        outcome = await archiveRecord({
          module: moduleKey,
          recordId: event.record_id,
          deletedTime: event.deleted_time,
          deletionType: event.deletion_type,
        });
      } catch {
        work.closed = true;
        work.reasonCode = 'ARCHIVE_FAILED';
        continue;
      }
      if (!outcome || outcome.processed !== true || typeof outcome.applied !== 'boolean') {
        work.closed = true;
        work.reasonCode = 'ARCHIVE_OUTCOME_INVALID';
        continue;
      }

      work.index += 1;
      work.processed += 1;
      if (outcome.applied) work.applied += 1;
      processedTotal += 1;
      work.moduleState.window.cursor = cloneJson(event);
    }
    if (!attemptedInRound) break;
  }

  for (const moduleKey of moduleKeys) {
    const work = workByModule.get(moduleKey);
    if (!work) continue;
    const remaining = work.events.length - work.index;
    let reasonCode = work.reasonCode;
    if (!reasonCode && remaining > 0) {
      reasonCode = work.attempted >= resolvedModuleLimit
        ? 'MODULE_RECORD_BOUND_REACHED'
        : 'GLOBAL_RECORD_BUDGET_REACHED';
    }
    if (remaining === 0) {
      work.moduleState.successful_through = work.window.through;
      work.moduleState.window = null;
    }
    results[moduleKey] = safeModuleResult(remaining === 0 ? 'complete' : 'partial', {
      pages_scanned: work.pagesScanned,
      discovered_deletions: work.events.length,
      attempted_deletions: work.attempted,
      processed_deletions: work.processed,
      applied_deletions: work.applied,
      remaining_deletions: remaining,
      cursor_advanced: work.processed > 0,
      reason_code: reasonCode,
    });
  }

  if (sourceRequestBudget.exhausted && sourceRequestBudget.lastModule) {
    state.fairness.next_module = nextModuleAfter(moduleKeys, sourceRequestBudget.lastModule);
  } else if (lastAttemptedModule) {
    state.fairness.next_module = nextModuleAfter(moduleKeys, lastAttemptedModule);
  }

  const finishedAt = safeIso(now(), 'Sync finish time');
  const moduleSummary = summarizeModules(results);
  const globalSuccess = moduleSummary.total > 0 && moduleSummary.complete === moduleSummary.total;
  const run = {
    schema_version: STATE_SCHEMA_VERSION,
    source_mode: 'read-only',
    started_at: startedAt,
    finished_at: finishedAt,
    status: globalSuccess
      ? 'succeeded'
      : (moduleSummary.error === moduleSummary.total ? 'failed' : 'partial'),
    global_success: globalSuccess,
    module_summary: moduleSummary,
    record_budget: {
      limit: resolvedRunLimit,
      attempted: attemptedTotal,
      processed: processedTotal,
      remaining_capacity: Math.max(0, resolvedRunLimit - attemptedTotal),
    },
    source_request_budget: {
      limit: resolvedSourceRequestLimit,
      used: sourceRequestBudget.used,
      remaining_capacity: Math.max(0, resolvedSourceRequestLimit - sourceRequestBudget.used),
      estimated_api_credits: sourceRequestBudget.used * 2,
    },
    module_results: moduleKeys.map(moduleKey => ({ module_key: moduleKey, ...results[moduleKey] })),
    modules: results,
  };

  state.last_completed_run = normalizeRunSummary(run);
  if (globalSuccess) state.last_successful_run = normalizeRunSummary(run);
  await stateStore.save(state);
  return cloneJson(run);
}

module.exports = {
  STATE_SCHEMA_VERSION,
  DEFAULT_PER_PAGE,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RECORDS_PER_MODULE,
  DEFAULT_MAX_RECORDS_PER_RUN,
  DEFAULT_MAX_SOURCE_REQUESTS_PER_RUN,
  DEFAULT_OVERLAP_MS,
  DEFAULT_CLOCK_SKEW_MS,
  DeletionSyncError,
  emptyDeletionSyncState,
  normalizeDeletionSyncState,
  createPersistedDeletionSyncStateStore,
  createInMemoryDeletionSyncStateStore,
  compareDeletionTuple,
  runZohoDeletionSync,
};
