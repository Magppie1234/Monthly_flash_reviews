'use strict';

const PAYMENT_MILESTONE_MODULE = 'Payment_Milestones';
const SNAPSHOT_LIST_MAX_PER_PAGE = 200;
const NUMERIC_SOURCE_ID = /^[0-9]{8,32}$/;

class PaymentMilestoneSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PaymentMilestoneSnapshotError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message) {
  throw new PaymentMilestoneSnapshotError(code, message);
}

function normalizeSourceId(value) {
  const normalized = String(value ?? '').trim();
  return NUMERIC_SOURCE_ID.test(normalized) ? normalized : null;
}

function validateCapabilityEnvelope(response) {
  if (
    !isPlainObject(response)
    || !Object.prototype.hasOwnProperty.call(response, 'fields')
    || !Array.isArray(response.fields)
    || response.fields.length === 0
  ) {
    fail('SNAPSHOT_CAPABILITY_UNVERIFIED', 'Payment milestone field metadata is unavailable.');
  }

  const apiNames = [];
  for (const field of response.fields) {
    if (
      !isPlainObject(field)
      || !Object.prototype.hasOwnProperty.call(field, 'api_name')
      || typeof field.api_name !== 'string'
      || !field.api_name.trim()
    ) {
      fail('SNAPSHOT_CAPABILITY_UNVERIFIED', 'Payment milestone field metadata is incomplete.');
    }
    apiNames.push(field.api_name.trim());
  }

  if (new Set(apiNames).size !== apiNames.length) {
    fail('SNAPSHOT_CAPABILITY_UNVERIFIED', 'Payment milestone field metadata contains duplicate API names.');
  }
  if (!apiNames.includes('id') || !apiNames.includes('Name')) {
    fail('SNAPSHOT_CAPABILITY_UNVERIFIED', 'Payment milestone snapshot identity fields are unavailable.');
  }
  if (apiNames.includes('Modified_Time')) {
    fail('SNAPSHOT_STRATEGY_DRIFT', 'Payment milestones now expose Modified_Time and require a reviewed strategy change.');
  }
  return true;
}

function validateSnapshotListRequest({ module, page, pageToken, perPage, sortBy, sortOrder } = {}) {
  if (
    module !== PAYMENT_MILESTONE_MODULE
    || page !== 1
    || pageToken !== null
    || !Number.isSafeInteger(perPage)
    || perPage < 1
    || perPage > SNAPSHOT_LIST_MAX_PER_PAGE
    || sortBy !== 'id'
    || sortOrder !== 'asc'
  ) {
    fail('INVALID_SNAPSHOT_LIST_REQUEST', 'Payment milestone snapshot listing requires one bounded ID-ordered page.');
  }
}

function validateStorageCapabilityProbe(response) {
  if (
    !isPlainObject(response)
    || response.status !== 400
    || !isPlainObject(response.error)
    || response.error.code !== '22023'
    || response.error.message !== 'invalid payment milestone snapshot batch'
  ) {
    fail(
      'SNAPSHOT_STORAGE_UNVERIFIED',
      'The atomic payment milestone snapshot storage contract is unavailable.',
    );
  }
  return true;
}

function createPaymentMilestoneSnapshotAdapter({
  sourceGet,
  storageProbe,
  upsertRows,
  recordToRow,
  now = () => new Date(),
} = {}) {
  if (typeof sourceGet !== 'function') throw new TypeError('sourceGet must be a function.');
  if (typeof upsertRows !== 'function') throw new TypeError('upsertRows must be a function.');
  if (typeof recordToRow !== 'function') throw new TypeError('recordToRow must be a function.');
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  return Object.freeze({
    async assertStorageCapability() {
      if (typeof storageProbe !== 'function') {
        fail('SNAPSHOT_STORAGE_UNVERIFIED', 'The atomic payment milestone snapshot storage contract is unavailable.');
      }
      let response;
      try {
        response = await storageProbe();
      } catch {
        fail('SNAPSHOT_STORAGE_UNVERIFIED', 'The atomic payment milestone snapshot storage contract is unavailable.');
      }
      return validateStorageCapabilityProbe(response);
    },

    async assertCapability() {
      const response = await sourceGet(`/crm/v8/settings/fields?module=${PAYMENT_MILESTONE_MODULE}`);
      return validateCapabilityEnvelope(response);
    },

    async listSnapshotIds(options) {
      validateSnapshotListRequest(options);
      const { perPage } = options;
      return sourceGet(
        `/crm/v8/${PAYMENT_MILESTONE_MODULE}?fields=Name&per_page=${perPage}&sort_by=id&sort_order=asc&page=1`,
      );
    },

    async upsertSnapshot({ module, records } = {}) {
      if (module !== PAYMENT_MILESTONE_MODULE) {
        fail('INVALID_SNAPSHOT_MODULE', 'The timestamp-less snapshot adapter is restricted to Payment_Milestones.');
      }
      if (!Array.isArray(records) || records.length < 1 || records.length > SNAPSHOT_LIST_MAX_PER_PAGE) {
        fail('INVALID_SNAPSHOT_RECORDS', 'Payment milestone snapshot rows must be a bounded non-empty array.');
      }

      const sourceSeenAtDate = now();
      const sourceSeenAt = sourceSeenAtDate instanceof Date
        ? sourceSeenAtDate.toISOString()
        : new Date(sourceSeenAtDate).toISOString();
      const seenIds = new Set();
      const rows = records.map(record => {
        if (!isPlainObject(record) || !Object.prototype.hasOwnProperty.call(record, 'id')) {
          fail('INVALID_SNAPSHOT_RECORD', 'Every payment milestone snapshot record requires a stable source ID.');
        }
        const recordId = normalizeSourceId(record.id);
        if (typeof record.id !== 'string' || !recordId || seenIds.has(recordId)) {
          fail('INVALID_SNAPSHOT_RECORD', 'Payment milestone snapshot record IDs must be unique numeric source IDs.');
        }
        if (Object.prototype.hasOwnProperty.call(record, 'Modified_Time')) {
          fail('SNAPSHOT_STRATEGY_DRIFT', 'Timestamp-bearing rows cannot use the timestamp-less snapshot adapter.');
        }
        seenIds.add(recordId);

        const row = recordToRow(module, record, sourceSeenAt);
        if (
          !isPlainObject(row)
          || row.module !== module
          || typeof row.id !== 'string'
          || normalizeSourceId(row.id) !== recordId
          || !isPlainObject(row.data)
          || typeof row.data.id !== 'string'
          || normalizeSourceId(row.data.id) !== recordId
          || row.modified_time !== null
          || row.source_seen_at !== sourceSeenAt
        ) {
          fail('INVALID_SNAPSHOT_ROW', 'Payment milestone snapshot row normalization failed closed.');
        }
        return row;
      });

      const changed = await upsertRows(rows);
      if (!Number.isSafeInteger(changed) || changed !== rows.length) {
        fail('SNAPSHOT_UPSERT_COUNT_MISMATCH', 'The atomic payment milestone snapshot upsert was incomplete.');
      }
      return { processed: rows.length };
    },
  });
}

module.exports = {
  PAYMENT_MILESTONE_MODULE,
  PaymentMilestoneSnapshotError,
  createPaymentMilestoneSnapshotAdapter,
  validateCapabilityEnvelope,
  validateSnapshotListRequest,
  validateStorageCapabilityProbe,
};
