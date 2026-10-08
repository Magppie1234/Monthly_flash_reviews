(function attachPaymentMilestonePreview(root, createPreview) {
  'use strict';

  const preview = createPreview();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = preview;
    return;
  }
  if (!root || Object.prototype.hasOwnProperty.call(root, 'PaymentMilestonePreview')) {
    throw new Error('Payment Milestone preview namespace is unavailable.');
  }
  Object.defineProperty(root, 'PaymentMilestonePreview', {
    configurable: false,
    enumerable: true,
    value: preview,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createPaymentMilestonePreview() {
  'use strict';

  class PaymentMilestonePreviewError extends Error {
    constructor(code) {
      super('Payment Milestone preview input is invalid.');
      this.name = 'PaymentMilestonePreviewError';
      this.code = code;
    }
  }

  const LIMITS = Object.freeze({
    accessories: 100000,
    existingMilestones: 200,
    lacs: 10000000,
    managementDiscount: 1000000000,
    rupees: 1000000000000,
  });
  const LACS_TO_INR = 100000;
  const CONTEXT_KEYS = Object.freeze([
    'contactFieldMetadata',
    'existingMilestoneCount',
    'paymentFieldMetadata',
    'recordSnapshot',
    'sourceTargetFieldAvailable',
    'today',
  ]);
  const SNAPSHOT_KEYS = Object.freeze([
    'accessories',
    'amountAfterDiscountLacs',
    'closureDate',
    'followUpDateTime',
    'grandTotalLacs',
    'managementDiscount',
    'productCount',
    'quotationPresent',
    'regionPresent',
  ]);
  const INPUT_KEYS = Object.freeze([
    'closureDate',
    'context',
    'followUpDateTime',
    'preset',
    'retentionPercent',
    'rows',
    'sunrooof',
  ]);
  const ROW_KEYS = Object.freeze(['percent', 'purpose']);
  const SUNROOOF_KEYS = Object.freeze(['booking', 'discount', 'enabled', 'total']);
  const FIELD_KEYS = Object.freeze(['apiName', 'dataType']);
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
  const createdContexts = new WeakSet();

  const MILESTONE_NAMES = Object.freeze([
    'Order Booking Payment',
    'Production Payment',
    'Dispatch Payment',
  ]);
  const PRESETS = Object.freeze({
    '3.2': Object.freeze([
      Object.freeze({ purpose: 'Order Booking Payment', percent: 50 }),
      Object.freeze({ purpose: 'Production Payment', percent: 30 }),
      Object.freeze({ purpose: 'Dispatch Payment', percent: 20 }),
    ]),
    '2': Object.freeze([
      Object.freeze({ purpose: 'Order Booking Payment', percent: 50 }),
      Object.freeze({ purpose: 'Dispatch Payment', percent: 50 }),
    ]),
  });
  const CONTACT_FIELD_TYPES = Object.freeze({
    Product_Details1: 'subform',
    Region: 'picklist',
    Quotation_Link: 'website',
    Management_Discount_Proposed: 'currency',
    Est_Closoure_Date: 'date',
    No_of_Accessories: 'percent',
    Next_Follow_Up_Date1: 'datetime',
    Accessories_Amount: 'currency',
    Amount_After_Discount: 'formula',
    Grand_Total: 'formula',
  });
  const PAYMENT_FIELD_TYPES = Object.freeze({
    Opportunity_Name: 'lookup',
    Is_Amount_Due: 'boolean',
    Milestone_Number: 'text',
    Payment_Status: 'picklist',
    Percentage: 'percent',
    Grand_Total: 'currency',
    Management_Discount_Proposed: 'currency',
    Amount_Received: 'currency',
    Serial_Number: 'integer',
  });

  function fail(code) {
    throw new PaymentMilestonePreviewError(code);
  }

  function exactObject(value, keys, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      fail(code);
    }
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (actualKeys.some(key => typeof key !== 'string')) fail(code);
    const actual = actualKeys.sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
    const captured = Object.create(null);
    for (const key of actual) {
      const descriptor = descriptors[key];
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail(code);
      Object.defineProperty(captured, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
    return Object.freeze(captured);
  }

  function denseArray(value, maxItems, code) {
    if (!Array.isArray(value)) fail(code);
    let prototype;
    let descriptors;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      fail(code);
    }
    if (prototype !== Array.prototype) fail(code);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some(key => typeof key !== 'string')) fail(code);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor
      || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
      || lengthDescriptor.enumerable !== false
      || !Number.isInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > maxItems
    ) fail(code);
    const length = lengthDescriptor.value;
    if (ownKeys.length !== length + 1) fail(code);
    const captured = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || descriptor.enumerable !== true
      ) fail(code);
      captured[index] = descriptor.value;
    }
    return Object.freeze(captured);
  }

  function boundedText(value, maxLength, code, { optional = false } = {}) {
    if (value === '' && optional) return '';
    if (typeof value !== 'string') fail(code);
    const normalized = value.trim();
    if (!normalized) {
      if (optional) return '';
      fail(code);
    }
    if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) fail(code);
    return normalized;
  }

  function boundedNumber(value, min, max, code, { nullable = false } = {}) {
    if (nullable && value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(code);
    return value;
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

  function validDateTime(value, code, { optional = false } = {}) {
    const text = boundedText(value, 16, code, { optional });
    if (!text) return '';
    const match = text.match(DATETIME);
    if (!match) fail(code);
    const datePart = validDate(text.slice(0, 10), code);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (hour > 23 || minute > 59) fail(code);
    return `${datePart}T${match[4]}:${match[5]}`;
  }

  function normalizeMetadata(value, expected, code) {
    const fields = denseArray(value, Object.keys(expected).length, code).map(raw => {
      const field = exactObject(raw, FIELD_KEYS, code);
      const apiName = boundedText(field.apiName, 80, code);
      const dataType = boundedText(field.dataType, 40, code);
      if (!Object.prototype.hasOwnProperty.call(expected, apiName) || expected[apiName] !== dataType) fail(code);
      return Object.freeze({ apiName, dataType });
    });
    if (fields.length !== Object.keys(expected).length) fail(code);
    if (new Set(fields.map(field => field.apiName)).size !== fields.length) fail(code);
    return Object.freeze(fields);
  }

  function normalizeSnapshot(raw) {
    const snapshot = exactObject(raw, SNAPSHOT_KEYS, 'RECORD_SNAPSHOT_INVALID');
    if (typeof snapshot.regionPresent !== 'boolean' || !snapshot.regionPresent) fail('REGION_REQUIRED');
    if (typeof snapshot.quotationPresent !== 'boolean' || !snapshot.quotationPresent) fail('QUOTATION_REQUIRED');
    if (!Number.isInteger(snapshot.productCount) || snapshot.productCount < 1 || snapshot.productCount > 200) fail('PRODUCT_REQUIRED');
    const managementDiscount = boundedNumber(
      snapshot.managementDiscount,
      0,
      LIMITS.managementDiscount,
      'MANAGEMENT_DISCOUNT_INVALID',
    );
    const accessories = boundedNumber(snapshot.accessories, 0, LIMITS.accessories, 'ACCESSORIES_INVALID', { nullable: true });
    if (managementDiscount > 0 && accessories === null) fail('ACCESSORIES_REQUIRED');
    const amountAfterDiscountLacs = boundedNumber(
      snapshot.amountAfterDiscountLacs,
      Number.MIN_VALUE,
      LIMITS.lacs,
      'AMOUNT_AFTER_DISCOUNT_INVALID',
    );
    const grandTotalLacs = boundedNumber(
      snapshot.grandTotalLacs,
      Number.MIN_VALUE,
      LIMITS.lacs,
      'GRAND_TOTAL_INVALID',
    );
    return Object.freeze({
      accessories,
      amountAfterDiscountLacs,
      closureDate: validDate(snapshot.closureDate, 'CLOSURE_DATE_INVALID', { optional: true }),
      followUpDateTime: validDateTime(snapshot.followUpDateTime, 'FOLLOW_UP_INVALID', { optional: true }),
      grandTotalLacs,
      managementDiscount,
      productCount: snapshot.productCount,
      quotationPresent: true,
      regionPresent: true,
    });
  }

  function createContext(raw) {
    const input = exactObject(raw, CONTEXT_KEYS, 'CONTEXT_INVALID');
    if (input.sourceTargetFieldAvailable !== false) fail('RUNTIME_EVIDENCE_CHANGED');
    if (!Number.isInteger(input.existingMilestoneCount)
      || input.existingMilestoneCount < 0
      || input.existingMilestoneCount > LIMITS.existingMilestones) fail('EXISTING_MILESTONE_COUNT_INVALID');
    const today = validDate(input.today, 'TODAY_INVALID');
    const recordSnapshot = normalizeSnapshot(input.recordSnapshot);
    const context = Object.freeze({
      contactFieldMetadata: normalizeMetadata(input.contactFieldMetadata, CONTACT_FIELD_TYPES, 'CONTACT_METADATA_INVALID'),
      existingMilestoneCount: input.existingMilestoneCount,
      paymentFieldMetadata: normalizeMetadata(input.paymentFieldMetadata, PAYMENT_FIELD_TYPES, 'PAYMENT_METADATA_INVALID'),
      recordSnapshot,
      sourceTargetFieldAvailable: false,
      today,
    });
    createdContexts.add(context);
    return context;
  }

  function roundPct(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function money(value) {
    if (!Number.isFinite(value) || value < 0 || value > LIMITS.rupees) fail('CALCULATION_OUT_OF_RANGE');
    return value.toFixed(2);
  }

  function normalizeRows(value, preset) {
    const expectedRows = PRESETS[preset];
    const rows = denseArray(value, 3, 'ROWS_INVALID');
    if (rows.length !== expectedRows.length) fail('ROW_COUNT_MISMATCH');
    const normalized = rows.map(raw => {
      const row = exactObject(raw, ROW_KEYS, 'ROW_INVALID');
      const purpose = boundedText(row.purpose, 80, 'MILESTONE_NAME_INVALID');
      if (!MILESTONE_NAMES.includes(purpose)) fail('MILESTONE_NAME_INVALID');
      return Object.freeze({
        percent: boundedNumber(row.percent, 0, 100, 'PERCENT_INVALID'),
        purpose,
      });
    });
    const total = roundPct(normalized.reduce((sum, row) => sum + row.percent, 0));
    if (total !== 100) fail('PERCENT_TOTAL_INVALID');
    return Object.freeze(normalized);
  }

  function normalizeSunrooof(raw, grandTotalInr) {
    const input = exactObject(raw, SUNROOOF_KEYS, 'SUNROOOF_INVALID');
    if (typeof input.enabled !== 'boolean') fail('SUNROOOF_INVALID');
    const total = boundedNumber(input.total, 0, LIMITS.rupees, 'SUNROOOF_TOTAL_INVALID');
    const booking = boundedNumber(input.booking, 0, LIMITS.rupees, 'SUNROOOF_BOOKING_INVALID');
    const discount = boundedNumber(input.discount, 0, LIMITS.rupees, 'SUNROOOF_DISCOUNT_INVALID');
    if (!input.enabled) {
      if (total !== 0 || booking !== 0 || discount !== 0) fail('SUNROOOF_DISABLED_VALUES');
      return Object.freeze({ enabled: false, total: 0, booking: 0, discount: 0, percent: null });
    }
    if (!(total > 0) || !(booking > 0)) fail('SUNROOOF_VALUES_REQUIRED');
    if (booking > total) fail('SUNROOOF_BOOKING_EXCEEDS_TOTAL');
    if (discount > total) fail('SUNROOOF_DISCOUNT_EXCEEDS_TOTAL');
    if (total >= grandTotalInr) fail('SUNROOOF_TOTAL_EXCEEDS_GRAND_TOTAL');
    return Object.freeze({
      booking,
      discount,
      enabled: true,
      percent: roundPct((booking / total) * 100),
      total,
    });
  }

  function scheduleRow(kind, purpose, percent, amountBase, grandBase, serialNumber, extra = {}) {
    return Object.freeze({
      kind,
      milestone: purpose,
      percentage: percent,
      calculated_amount_after_discount: money(amountBase),
      calculated_grand_total: money(grandBase),
      serial_number: serialNumber,
      ...extra,
    });
  }

  function buildPaymentMilestoneDraft(raw) {
    const input = exactObject(raw, INPUT_KEYS, 'INPUT_INVALID');
    if (!createdContexts.has(input.context)) fail('CONTEXT_INVALID');
    const preset = boundedText(input.preset, 8, 'PRESET_INVALID');
    if (!Object.prototype.hasOwnProperty.call(PRESETS, preset)) fail('PRESET_INVALID');
    const closureDate = validDate(input.closureDate, 'CLOSURE_DATE_INVALID');
    const followUpDateTime = validDateTime(input.followUpDateTime, 'FOLLOW_UP_INVALID');
    if (closureDate < input.context.today) fail('CLOSURE_DATE_PAST');
    if (followUpDateTime.slice(0, 10) < input.context.today) fail('FOLLOW_UP_PAST');
    const rows = normalizeRows(input.rows, preset);
    const retentionPercent = boundedNumber(input.retentionPercent, 0, 15, 'RETENTION_INVALID');
    if (roundPct(rows[rows.length - 1].percent - retentionPercent) < 0) fail('RETENTION_EXCEEDS_LAST_MILESTONE');

    const snapshot = input.context.recordSnapshot;
    const amountAfterDiscountInr = snapshot.amountAfterDiscountLacs * LACS_TO_INR;
    const grandTotalInr = snapshot.grandTotalLacs * LACS_TO_INR;
    const sunrooof = normalizeSunrooof(input.sunrooof, grandTotalInr);
    const standardGrandBase = grandTotalInr - (sunrooof.enabled ? sunrooof.total : 0);
    const schedule = [];
    let serialOffset = 0;
    if (sunrooof.enabled) {
      serialOffset = 1;
      schedule.push(scheduleRow(
        'sunrooof',
        'Order Booking Sunroof Milestone',
        sunrooof.percent,
        sunrooof.booking,
        sunrooof.booking,
        1,
        { management_discount: money(sunrooof.discount) },
      ));
    }
    rows.forEach((row, index) => {
      const percentage = index === rows.length - 1
        ? roundPct(row.percent - retentionPercent)
        : row.percent;
      schedule.push(scheduleRow(
        'magppie',
        row.purpose,
        percentage,
        (amountAfterDiscountInr * percentage) / 100,
        (standardGrandBase * percentage) / 100,
        index + 1 + serialOffset,
      ));
    });
    if (retentionPercent > 0) {
      schedule.push(scheduleRow(
        'retention',
        'Retention Milestone',
        retentionPercent,
        (amountAfterDiscountInr * retentionPercent) / 100,
        (standardGrandBase * retentionPercent) / 100,
        rows.length + 1 + serialOffset,
      ));
    }

    return Object.freeze({
      preview_only: true,
      persistence: 'disabled',
      calculation_basis: 'current local formula snapshot',
      replacement_preview: Object.freeze({
        existing_milestone_count: input.context.existingMilestoneCount,
        replacement_enabled: false,
      }),
      contact_draft: Object.freeze({
        Est_Closoure_Date: closureDate,
        Management_Discount_Proposed: snapshot.managementDiscount,
        No_of_Accessories: snapshot.accessories,
        Accessories_Amount: money(snapshot.managementDiscount * (snapshot.accessories || 0) / 100),
        Next_Follow_Up_Date1: `${followUpDateTime}:00+05:30`,
      }),
      schedule: Object.freeze(schedule),
      runtime_evidence: Object.freeze({
        source_amount_target: 'Amount_To_Be_Paid',
        local_field_status: 'unavailable',
        schedule_shape: 'display-only',
      }),
      blocked_actions: Object.freeze([
        'Existing milestone deletion',
        'Contact update',
        'Milestone creation',
        'Workflow trigger',
        'Blueprint continuation',
      ]),
    });
  }

  Object.freeze(PaymentMilestonePreviewError.prototype);
  Object.freeze(PaymentMilestonePreviewError);
  return Object.freeze({
    PaymentMilestonePreviewError,
    constants: Object.freeze({
      contactFieldTypes: CONTACT_FIELD_TYPES,
      limits: LIMITS,
      milestoneNames: MILESTONE_NAMES,
      paymentFieldTypes: PAYMENT_FIELD_TYPES,
      presets: PRESETS,
      sourceAmountTarget: 'Amount_To_Be_Paid',
    }),
    createContext,
    buildPaymentMilestoneDraft,
  });
});
