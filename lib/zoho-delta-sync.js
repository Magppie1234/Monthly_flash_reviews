'use strict';

const STATE_SCHEMA_VERSION = 1;
const DEFAULT_PER_PAGE = 200;
const DEFAULT_MAX_PAGES = 1_000;
const DEFAULT_MAX_RECORDS_PER_MODULE = 60;
const DEFAULT_MAX_RECORDS_PER_RUN = 60;
const SNAPSHOT_MAX_PER_PAGE = 200;
const TIMESTAMP_STRATEGY = 'timestamp';
const SNAPSHOT_STRATEGY = 'snapshot';
const MODULE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const NUMERIC_RECORD_ID_PATTERN = /^[1-9][0-9]*$/;

class DeltaSyncError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'DeltaSyncError';
    this.code = code;
  }
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function safeIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DeltaSyncError('INVALID_TIMESTAMP', `${label} must be a valid timestamp.`);
  }
  return date.toISOString();
}

function safePositiveInteger(value, fallback, label) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new DeltaSyncError('INVALID_LIMIT', `${label} must be a positive safe integer.`);
  }
  return resolved;
}

function normalizeModuleKeys(modules) {
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new DeltaSyncError('MODULES_REQUIRED', 'At least one module is required.');
  }
  const unique = [];
  const seen = new Set();
  for (const value of modules) {
    const moduleKey = String(value || '').trim();
    if (!MODULE_KEY_PATTERN.test(moduleKey)) {
      throw new DeltaSyncError('INVALID_MODULE_KEY', 'Module keys must use the CRM API-name format.');
    }
    if (!seen.has(moduleKey)) {
      seen.add(moduleKey);
      unique.push(moduleKey);
    }
  }
  return unique;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeModuleStrategies(moduleKeys, moduleStrategies) {
  if (moduleStrategies !== undefined && !isPlainObject(moduleStrategies)) {
    throw new DeltaSyncError(
      'INVALID_MODULE_STRATEGIES',
      'moduleStrategies must be a plain object keyed by CRM module API name.',
    );
  }

  const configured = moduleStrategies || {};
  const moduleSet = new Set(moduleKeys);
  for (const moduleKey of Object.keys(configured)) {
    if (!MODULE_KEY_PATTERN.test(moduleKey) || !moduleSet.has(moduleKey)) {
      throw new DeltaSyncError(
        'INVALID_MODULE_STRATEGY',
        'Every configured module strategy must target a scheduled CRM module.',
      );
    }
  }

  const normalized = new Map();
  for (const moduleKey of moduleKeys) {
    const raw = configured[moduleKey];
    if (raw === undefined) {
      normalized.set(moduleKey, {
        mode: TIMESTAMP_STRATEGY,
        timestampField: 'Modified_Time',
      });
      continue;
    }
    if (!isPlainObject(raw)) {
      throw new DeltaSyncError(
        'INVALID_MODULE_STRATEGY',
        'Each module strategy must be a plain object with an explicit mode.',
      );
    }

    const mode = String(raw.mode || '').trim();
    if (mode === SNAPSHOT_STRATEGY) {
      if (raw.timestamp_field !== undefined || raw.timestampField !== undefined) {
        throw new DeltaSyncError(
          'INVALID_MODULE_STRATEGY',
          'Snapshot strategies cannot configure a timestamp field.',
        );
      }
      normalized.set(moduleKey, { mode: SNAPSHOT_STRATEGY });
      continue;
    }
    if (mode !== TIMESTAMP_STRATEGY) {
      throw new DeltaSyncError(
        'INVALID_MODULE_STRATEGY',
        'Module strategy mode must be timestamp or snapshot.',
      );
    }

    const timestampField = String(raw.timestamp_field ?? raw.timestampField ?? 'Modified_Time').trim();
    if (timestampField !== 'Modified_Time') {
      throw new DeltaSyncError(
        'UNSUPPORTED_TIMESTAMP_FIELD',
        'Timestamp strategies require the stable Modified_Time field.',
      );
    }
    normalized.set(moduleKey, {
      mode: TIMESTAMP_STRATEGY,
      timestampField,
    });
  }
  return normalized;
}

function normalizeCursor(value) {
  if (!value || typeof value !== 'object') return null;
  const recordId = String(value.record_id || '').trim();
  if (!recordId) return null;
  return {
    modified_time: safeIso(value.modified_time, 'Cursor modified_time'),
    record_id: recordId,
  };
}

function emptyDeltaSyncState() {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    modules: {},
    last_completed_run: null,
    last_successful_run: null,
  };
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
  const reasonCode = value.reason_code === null || value.reason_code === undefined
    ? null
    : String(value.reason_code);
  return {
    module_key: moduleKey,
    status,
    pages_scanned: normalizedCount(value.pages_scanned),
    discovered_changes: normalizedCount(value.discovered_changes, { nullable: true }),
    attempted_changes: normalizedCount(value.attempted_changes),
    processed_changes: normalizedCount(value.processed_changes),
    remaining_changes: normalizedCount(value.remaining_changes, { nullable: true }),
    cursor_advanced: value.cursor_advanced === true,
    reason_code: reasonCode && REASON_CODE_PATTERN.test(reasonCode) ? reasonCode : null,
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

function normalizeRunSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const summary = value.module_summary || {};
  const moduleSummary = {
    total: normalizedCount(summary.total),
    complete: normalizedCount(summary.complete),
    partial: normalizedCount(summary.partial),
    error: normalizedCount(summary.error),
  };
  const seenModuleKeys = new Set();
  const moduleResults = (Array.isArray(value.module_results) ? value.module_results : [])
    .map(normalizeSafeModuleResult)
    .filter(result => {
      if (!result || seenModuleKeys.has(result.module_key)) return false;
      seenModuleKeys.add(result.module_key);
      return true;
    });
  const moduleResultsComplete = moduleResults.length === 0
    || (moduleResults.length === moduleSummary.total && moduleResults.every(result => result.status === 'complete'));
  const structurallySuccessful = moduleSummary.total > 0
    && moduleSummary.complete === moduleSummary.total
    && moduleSummary.partial === 0
    && moduleSummary.error === 0
    && moduleResultsComplete;
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
    module_results: moduleResults,
  };
}

function normalizeDeltaSyncState(value) {
  const state = emptyDeltaSyncState();
  if (!value || typeof value !== 'object') return state;
  if (value.schema_version !== undefined && value.schema_version !== STATE_SCHEMA_VERSION) {
    throw new DeltaSyncError('UNSUPPORTED_STATE_VERSION', 'The persisted delta-sync state version is unsupported.');
  }

  if (value.modules && typeof value.modules === 'object' && !Array.isArray(value.modules)) {
    for (const [moduleKey, moduleState] of Object.entries(value.modules)) {
      if (!MODULE_KEY_PATTERN.test(moduleKey)) continue;
      const cursor = normalizeCursor(moduleState?.cursor);
      state.modules[moduleKey] = { cursor };
    }
  }
  state.last_completed_run = normalizeRunSummary(value.last_completed_run);
  const lastSuccessfulRun = normalizeRunSummary(value.last_successful_run);
  state.last_successful_run = lastSuccessfulRun?.global_success === true ? lastSuccessfulRun : null;
  return state;
}

function createPersistedDeltaSyncStateStore({ loadSnapshot, saveSnapshot } = {}) {
  if (typeof loadSnapshot !== 'function') {
    throw new TypeError('loadSnapshot must be a function.');
  }
  if (typeof saveSnapshot !== 'function') {
    throw new TypeError('saveSnapshot must be a function.');
  }

  return {
    async load() {
      let snapshot;
      try {
        snapshot = await loadSnapshot();
      } catch (error) {
        throw new DeltaSyncError('STATE_LOAD_FAILED', 'Delta-sync state could not be loaded.', { cause: error });
      }
      if (typeof snapshot === 'string') {
        try {
          snapshot = JSON.parse(snapshot);
        } catch (error) {
          throw new DeltaSyncError('STATE_PARSE_FAILED', 'Delta-sync state is not valid JSON.', { cause: error });
        }
      }
      return normalizeDeltaSyncState(snapshot);
    },

    async save(state) {
      const normalized = normalizeDeltaSyncState(state);
      try {
        await saveSnapshot(cloneJson(normalized));
      } catch (error) {
        throw new DeltaSyncError('STATE_PERSIST_FAILED', 'Delta-sync state could not be persisted.', { cause: error });
      }
      return cloneJson(normalized);
    },
  };
}

function createInMemoryDeltaSyncStateStore(initialState = null) {
  let snapshot = normalizeDeltaSyncState(initialState);
  return {
    async load() {
      return cloneJson(snapshot);
    },
    async save(state) {
      snapshot = normalizeDeltaSyncState(state);
      return cloneJson(snapshot);
    },
    snapshot() {
      return cloneJson(snapshot);
    },
  };
}

function compareChangeTuple(left, right) {
  const leftTime = Date.parse(left.modified_time);
  const rightTime = Date.parse(right.modified_time);
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.record_id.localeCompare(right.record_id);
}

function normalizeChange(value) {
  if (!value || typeof value !== 'object') return null;
  const recordId = String(value.id ?? value.record_id ?? '').trim();
  const modifiedValue = value.Modified_Time ?? value.modified_time;
  if (!recordId || modifiedValue === null || modifiedValue === undefined || modifiedValue === '') return null;
  try {
    return {
      record_id: recordId,
      modified_time: safeIso(modifiedValue, 'Changed record Modified_Time'),
    };
  } catch {
    return null;
  }
}

function normalizePage(value) {
  const rows = Array.isArray(value?.data)
    ? value.data
    : (Array.isArray(value?.records) ? value.records : []);
  const info = value?.info && typeof value.info === 'object' ? value.info : {};
  return {
    rows,
    moreRecords: info.more_records === true || value?.more_records === true,
    nextPageToken: info.next_page_token ?? value?.next_page_token ?? null,
  };
}

function normalizeNumericRecordId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) return null;
    return String(value);
  }
  if (typeof value !== 'string' || !NUMERIC_RECORD_ID_PATTERN.test(value)) return null;
  return value;
}

function compareNumericRecordIds(left, right) {
  if (left.length !== right.length) return left.length - right.length;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function snapshotContinuationPresent(value) {
  const info = isPlainObject(value?.info) ? value.info : {};
  return info.more_records === true
    || value?.more_records === true
    || (info.next_page_token !== null && info.next_page_token !== undefined && info.next_page_token !== '')
    || (value?.next_page_token !== null && value?.next_page_token !== undefined && value?.next_page_token !== '')
    || (info.page_token !== null && info.page_token !== undefined && info.page_token !== '')
    || (value?.page_token !== null && value?.page_token !== undefined && value?.page_token !== '')
    || (info.next_page !== null && info.next_page !== undefined && info.next_page !== '')
    || (value?.next_page !== null && value?.next_page !== undefined && value?.next_page !== '');
}

function validateSnapshotPage(value, perPage) {
  if (!isPlainObject(value)) {
    return { ok: false, reasonCode: 'SNAPSHOT_PAGE_INVALID' };
  }
  if (
    !Object.prototype.hasOwnProperty.call(value, 'data')
    || !Array.isArray(value.data)
    || Object.prototype.hasOwnProperty.call(value, 'records')
    || !Object.prototype.hasOwnProperty.call(value, 'info')
    || !isPlainObject(value.info)
    || !Object.prototype.hasOwnProperty.call(value.info, 'more_records')
    || typeof value.info.more_records !== 'boolean'
  ) {
    return { ok: false, reasonCode: 'SNAPSHOT_PAGE_INVALID' };
  }
  const rows = value.data;
  if (value.info.more_records === true || rows.length > perPage || rows.length > SNAPSHOT_MAX_PER_PAGE || snapshotContinuationPresent(value)) {
    return { ok: false, reasonCode: 'SNAPSHOT_PAGINATION_UNSUPPORTED' };
  }

  const ids = [];
  const seen = new Set();
  let previousId = null;
  for (const row of rows) {
    if (!isPlainObject(row) || !Object.prototype.hasOwnProperty.call(row, 'id')) {
      return { ok: false, reasonCode: 'SNAPSHOT_ROW_INVALID' };
    }
    const recordId = normalizeNumericRecordId(row.id);
    if (!recordId) return { ok: false, reasonCode: 'SNAPSHOT_ID_INVALID' };
    if (seen.has(recordId)) return { ok: false, reasonCode: 'SNAPSHOT_ID_DUPLICATE' };
    if (previousId !== null && compareNumericRecordIds(previousId, recordId) >= 0) {
      return { ok: false, reasonCode: 'SNAPSHOT_ID_ORDER_INVALID' };
    }
    seen.add(recordId);
    ids.push(recordId);
    previousId = recordId;
  }
  return { ok: true, ids };
}

async function scanSnapshotIds({ moduleKey, listSnapshotIds, perPage }) {
  let response;
  try {
    response = await listSnapshotIds({
      module: moduleKey,
      page: 1,
      pageToken: null,
      perPage,
      sortBy: 'id',
      sortOrder: 'asc',
    });
  } catch {
    return {
      ok: false,
      status: 'error',
      reasonCode: 'SNAPSHOT_LIST_FAILED',
      pagesScanned: 0,
    };
  }
  const validated = validateSnapshotPage(response, perPage);
  if (!validated.ok) {
    return {
      ok: false,
      status: 'partial',
      reasonCode: validated.reasonCode,
      pagesScanned: 1,
    };
  }
  return {
    ok: true,
    pagesScanned: 1,
    ids: validated.ids,
  };
}

async function discoverStableSnapshot({ moduleKey, listSnapshotIds, perPage }) {
  const first = await scanSnapshotIds({ moduleKey, listSnapshotIds, perPage });
  if (!first.ok) return first;
  const second = await scanSnapshotIds({ moduleKey, listSnapshotIds, perPage });
  if (!second.ok) {
    return {
      ...second,
      pagesScanned: first.pagesScanned + second.pagesScanned,
    };
  }
  const identical = first.ids.length === second.ids.length
    && first.ids.every((recordId, index) => recordId === second.ids[index]);
  if (!identical) {
    return {
      ok: false,
      status: 'partial',
      reasonCode: 'SNAPSHOT_LIST_DRIFT',
      pagesScanned: first.pagesScanned + second.pagesScanned,
    };
  }
  return {
    ok: true,
    pagesScanned: first.pagesScanned + second.pagesScanned,
    ids: first.ids,
  };
}

function safeModuleResult(status, values = {}) {
  return {
    status,
    pages_scanned: normalizedCount(values.pages_scanned),
    discovered_changes: normalizedCount(values.discovered_changes, { nullable: true }),
    attempted_changes: normalizedCount(values.attempted_changes),
    processed_changes: normalizedCount(values.processed_changes),
    remaining_changes: normalizedCount(values.remaining_changes, { nullable: true }),
    cursor_advanced: values.cursor_advanced === true,
    reason_code: REASON_CODE_PATTERN.test(String(values.reason_code || '')) ? String(values.reason_code) : null,
  };
}

async function discoverChanges({
  moduleKey,
  cursor,
  listModified,
  perPage,
  maxPages,
}) {
  const byRecordId = new Map();
  let page = 1;
  let pageToken = null;
  let tokenMode = false;
  let pagesScanned = 0;
  let reachedBoundary = false;
  let moreRecords = false;
  let previousModifiedTime = Number.POSITIVE_INFINITY;
  const seenPageTokens = new Set();

  while (pagesScanned < maxPages) {
    let response;
    try {
      response = await listModified({
        module: moduleKey,
        page: tokenMode ? null : page,
        pageToken,
        perPage,
      });
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        reasonCode: 'CHANGE_LIST_FAILED',
        pagesScanned,
        changes: [],
      };
    }

    pagesScanned += 1;
    const normalizedPage = normalizePage(response);
    moreRecords = normalizedPage.moreRecords;
    let invalidEntry = false;
    let invalidOrder = false;

    for (const raw of normalizedPage.rows) {
      const change = normalizeChange(raw);
      if (!change) {
        invalidEntry = true;
        break;
      }
      const modifiedTime = Date.parse(change.modified_time);
      if (modifiedTime > previousModifiedTime) {
        invalidOrder = true;
        break;
      }
      previousModifiedTime = modifiedTime;

      if (cursor && Date.parse(change.modified_time) < Date.parse(cursor.modified_time)) {
        reachedBoundary = true;
        continue;
      }
      if (!cursor || compareChangeTuple(change, cursor) > 0) {
        const previous = byRecordId.get(change.record_id);
        if (!previous || compareChangeTuple(previous, change) < 0) {
          byRecordId.set(change.record_id, change);
        }
      }
    }

    if (invalidEntry) {
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'INVALID_CHANGE_ENTRY',
        pagesScanned,
        changes: [],
      };
    }
    if (invalidOrder) {
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'SOURCE_ORDER_INVALID',
        pagesScanned,
        changes: [],
      };
    }
    if (reachedBoundary || !moreRecords) break;

    if (!tokenMode && page < 10) {
      page += 1;
      continue;
    }

    if (normalizedPage.nextPageToken === null || normalizedPage.nextPageToken === '') {
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'PAGE_CONTINUATION_MISSING',
        pagesScanned,
        changes: [],
      };
    }

    const tokenKey = String(normalizedPage.nextPageToken);
    if (seenPageTokens.has(tokenKey)) {
      return {
        ok: false,
        status: 'partial',
        reasonCode: 'PAGE_CONTINUATION_REPEATED',
        pagesScanned,
        changes: [],
      };
    }
    seenPageTokens.add(tokenKey);

    tokenMode = true;
    pageToken = normalizedPage.nextPageToken;
  }

  if (!reachedBoundary && moreRecords && pagesScanned >= maxPages) {
    return {
      ok: false,
      status: 'partial',
      reasonCode: 'PAGE_BOUND_REACHED',
      pagesScanned,
      changes: [],
    };
  }

  return {
    ok: true,
    pagesScanned,
    changes: [...byRecordId.values()].sort(compareChangeTuple),
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

function persistedRunSummary(run) {
  return normalizeRunSummary(run);
}

async function runZohoDeltaSync({
  modules,
  moduleStrategies,
  listModified,
  listSnapshotIds,
  fetchRecord,
  upsertRecord,
  upsertSnapshot,
  stateStore,
  now = () => new Date(),
  perPage = DEFAULT_PER_PAGE,
  maxPages = DEFAULT_MAX_PAGES,
  maxRecordsPerModule = DEFAULT_MAX_RECORDS_PER_MODULE,
  maxRecordsPerRun = DEFAULT_MAX_RECORDS_PER_RUN,
} = {}) {
  const moduleKeys = normalizeModuleKeys(modules);
  const strategies = normalizeModuleStrategies(moduleKeys, moduleStrategies);
  const hasTimestampModules = moduleKeys.some(
    moduleKey => strategies.get(moduleKey).mode === TIMESTAMP_STRATEGY,
  );
  const hasSnapshotModules = moduleKeys.some(
    moduleKey => strategies.get(moduleKey).mode === SNAPSHOT_STRATEGY,
  );
  if (hasTimestampModules && typeof listModified !== 'function') {
    throw new TypeError('listModified must be a function for timestamp modules.');
  }
  if (hasSnapshotModules && typeof listSnapshotIds !== 'function') {
    throw new TypeError('listSnapshotIds must be a function for snapshot modules.');
  }
  if (typeof fetchRecord !== 'function') throw new TypeError('fetchRecord must be a function.');
  if (hasTimestampModules && typeof upsertRecord !== 'function') {
    throw new TypeError('upsertRecord must be a function for timestamp modules.');
  }
  if (hasSnapshotModules && typeof upsertSnapshot !== 'function') {
    throw new TypeError('upsertSnapshot must be a function for snapshot modules.');
  }
  if (!stateStore || typeof stateStore.load !== 'function' || typeof stateStore.save !== 'function') {
    throw new TypeError('stateStore must provide load and save functions.');
  }

  const resolvedPerPage = safePositiveInteger(perPage, DEFAULT_PER_PAGE, 'perPage');
  const resolvedMaxPages = safePositiveInteger(maxPages, DEFAULT_MAX_PAGES, 'maxPages');
  const resolvedRecordLimit = safePositiveInteger(
    maxRecordsPerModule,
    DEFAULT_MAX_RECORDS_PER_MODULE,
    'maxRecordsPerModule',
  );
  const resolvedRunLimit = safePositiveInteger(maxRecordsPerRun, DEFAULT_MAX_RECORDS_PER_RUN, 'maxRecordsPerRun');
  const startedAt = safeIso(now(), 'Sync start time');
  const state = normalizeDeltaSyncState(await stateStore.load());
  const results = {};
  const workByModule = new Map();
  const snapshotWorkByModule = new Map();

  for (const moduleKey of moduleKeys) {
    const strategy = strategies.get(moduleKey);
    if (strategy.mode === SNAPSHOT_STRATEGY) {
      const discovery = await discoverStableSnapshot({
        moduleKey,
        listSnapshotIds,
        perPage: Math.min(resolvedPerPage, SNAPSHOT_MAX_PER_PAGE),
      });
      state.modules[moduleKey] = { cursor: null };
      if (!discovery.ok) {
        results[moduleKey] = safeModuleResult(discovery.status, {
          pages_scanned: discovery.pagesScanned,
          reason_code: discovery.reasonCode,
        });
        continue;
      }
      if (discovery.ids.length > resolvedRecordLimit) {
        results[moduleKey] = safeModuleResult('partial', {
          pages_scanned: discovery.pagesScanned,
          discovered_changes: discovery.ids.length,
          attempted_changes: 0,
          processed_changes: 0,
          remaining_changes: discovery.ids.length,
          reason_code: 'MODULE_RECORD_BOUND_REACHED',
        });
        continue;
      }
      snapshotWorkByModule.set(moduleKey, {
        pagesScanned: discovery.pagesScanned,
        ids: discovery.ids,
      });
      continue;
    }

    const currentCursor = state.modules[moduleKey]?.cursor || null;
    const discovery = await discoverChanges({
      moduleKey,
      cursor: currentCursor,
      listModified,
      perPage: resolvedPerPage,
      maxPages: resolvedMaxPages,
    });
    if (!discovery.ok) {
      results[moduleKey] = safeModuleResult(discovery.status, {
        pages_scanned: discovery.pagesScanned,
        reason_code: discovery.reasonCode,
      });
      state.modules[moduleKey] = { cursor: currentCursor };
      continue;
    }
    if (discovery.changes.length === 0) {
      results[moduleKey] = safeModuleResult('complete', {
        pages_scanned: discovery.pagesScanned,
        discovered_changes: 0,
        attempted_changes: 0,
        processed_changes: 0,
        remaining_changes: 0,
      });
      state.modules[moduleKey] = { cursor: currentCursor };
      continue;
    }
    workByModule.set(moduleKey, {
      currentCursor,
      nextCursor: currentCursor,
      pagesScanned: discovery.pagesScanned,
      changes: discovery.changes,
      index: 0,
      attempted: 0,
      processed: 0,
      closed: false,
      reasonCode: null,
    });
  }

  let snapshotRecordsReserved = 0;
  for (const moduleKey of moduleKeys) {
    const work = snapshotWorkByModule.get(moduleKey);
    if (!work) continue;
    if (snapshotRecordsReserved + work.ids.length > resolvedRunLimit) {
      results[moduleKey] = safeModuleResult('partial', {
        pages_scanned: work.pagesScanned,
        discovered_changes: work.ids.length,
        attempted_changes: 0,
        processed_changes: 0,
        remaining_changes: work.ids.length,
        reason_code: 'GLOBAL_RECORD_BUDGET_REACHED',
      });
      snapshotWorkByModule.delete(moduleKey);
      continue;
    }
    snapshotRecordsReserved += work.ids.length;
  }

  let attemptedTotal = 0;
  let processedTotal = 0;
  for (const moduleKey of moduleKeys) {
    const work = snapshotWorkByModule.get(moduleKey);
    if (!work) continue;

    const records = [];
    let attempted = 0;
    let reasonCode = null;
    for (const recordId of work.ids) {
      attempted += 1;
      attemptedTotal += 1;
      let record;
      try {
        record = await fetchRecord({ module: moduleKey, recordId });
      } catch {
        reasonCode = 'SNAPSHOT_RECORD_FETCH_FAILED';
        break;
      }
      if (!isPlainObject(record) || !Object.prototype.hasOwnProperty.call(record, 'id')) {
        reasonCode = 'SNAPSHOT_RECORD_INVALID';
        break;
      }
      const fetchedRecordId = normalizeNumericRecordId(record.id);
      if (!fetchedRecordId || fetchedRecordId !== recordId) {
        reasonCode = 'SNAPSHOT_RECORD_ID_MISMATCH';
        break;
      }
      records.push(record);
    }

    let processed = 0;
    if (!reasonCode && records.length > 0) {
      try {
        await upsertSnapshot({ module: moduleKey, records });
        processed = records.length;
        processedTotal += processed;
      } catch {
        reasonCode = 'SNAPSHOT_UPSERT_FAILED';
      }
    }

    const complete = reasonCode === null;
    results[moduleKey] = safeModuleResult(complete ? 'complete' : 'partial', {
      pages_scanned: work.pagesScanned,
      discovered_changes: work.ids.length,
      attempted_changes: attempted,
      processed_changes: processed,
      remaining_changes: complete ? 0 : work.ids.length,
      cursor_advanced: false,
      reason_code: reasonCode,
    });
    state.modules[moduleKey] = { cursor: null };
  }

  while (attemptedTotal < resolvedRunLimit) {
    let attemptedInRound = false;
    for (const moduleKey of moduleKeys) {
      if (attemptedTotal >= resolvedRunLimit) break;
      const work = workByModule.get(moduleKey);
      if (
        !work
        || work.closed
        || work.index >= work.changes.length
        || work.attempted >= resolvedRecordLimit
      ) continue;

      attemptedInRound = true;
      attemptedTotal += 1;
      work.attempted += 1;
      const change = work.changes[work.index];
      let record;
      try {
        record = await fetchRecord({ module: moduleKey, recordId: change.record_id });
      } catch {
        work.closed = true;
        work.reasonCode = 'RECORD_FETCH_FAILED';
        continue;
      }
      if (!record || typeof record !== 'object') {
        work.closed = true;
        work.reasonCode = 'RECORD_NOT_RETURNED';
        continue;
      }
      try {
        await upsertRecord({ module: moduleKey, record });
      } catch {
        work.closed = true;
        work.reasonCode = 'RECORD_UPSERT_FAILED';
        continue;
      }

      work.nextCursor = change;
      work.index += 1;
      work.processed += 1;
      processedTotal += 1;
    }
    if (!attemptedInRound) break;
  }

  for (const moduleKey of moduleKeys) {
    const work = workByModule.get(moduleKey);
    if (!work) continue;
    const remaining = work.changes.length - work.processed;
    let reasonCode = work.reasonCode;
    if (!reasonCode && remaining > 0) {
      reasonCode = work.attempted >= resolvedRecordLimit
        ? 'MODULE_RECORD_BOUND_REACHED'
        : 'GLOBAL_RECORD_BUDGET_REACHED';
    }
    results[moduleKey] = safeModuleResult(remaining === 0 ? 'complete' : 'partial', {
      pages_scanned: work.pagesScanned,
      discovered_changes: work.changes.length,
      attempted_changes: work.attempted,
      processed_changes: work.processed,
      remaining_changes: remaining,
      cursor_advanced: Boolean(
        work.nextCursor
        && (!work.currentCursor || compareChangeTuple(work.nextCursor, work.currentCursor) > 0)
      ),
      reason_code: reasonCode,
    });
    state.modules[moduleKey] = { cursor: work.nextCursor || null };
  }

  const finishedAt = safeIso(now(), 'Sync finish time');
  const moduleSummary = summarizeModules(results);
  const globalSuccess = moduleSummary.complete === moduleSummary.total;
  const status = globalSuccess
    ? 'succeeded'
    : (moduleSummary.error === moduleSummary.total ? 'failed' : 'partial');
  const run = {
    schema_version: STATE_SCHEMA_VERSION,
    source_mode: 'read-only',
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    global_success: globalSuccess,
    module_summary: moduleSummary,
    record_budget: {
      limit: resolvedRunLimit,
      attempted: attemptedTotal,
      processed: processedTotal,
      remaining_capacity: Math.max(0, resolvedRunLimit - attemptedTotal),
    },
    module_results: moduleKeys.map(moduleKey => ({ module_key: moduleKey, ...results[moduleKey] })),
    modules: results,
  };

  state.last_completed_run = persistedRunSummary(run);
  if (globalSuccess) state.last_successful_run = persistedRunSummary(run);
  await stateStore.save(state);
  return cloneJson(run);
}

module.exports = {
  STATE_SCHEMA_VERSION,
  DEFAULT_PER_PAGE,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RECORDS_PER_MODULE,
  DEFAULT_MAX_RECORDS_PER_RUN,
  DeltaSyncError,
  emptyDeltaSyncState,
  normalizeDeltaSyncState,
  createPersistedDeltaSyncStateStore,
  createInMemoryDeltaSyncStateStore,
  compareChangeTuple,
  runZohoDeltaSync,
};
