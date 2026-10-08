'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const enginePath = path.resolve(__dirname, '..', 'public', 'payment-milestone-preview.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const {
  PaymentMilestonePreviewError,
  constants,
  createContext,
  buildPaymentMilestoneDraft,
} = require('../public/payment-milestone-preview');

function metadata(fieldTypes) {
  return Object.entries(fieldTypes).map(([apiName, dataType]) => ({ apiName, dataType }));
}

function snapshot(overrides = {}) {
  return {
    accessories: 10,
    amountAfterDiscountLacs: 10,
    closureDate: '2026-09-15',
    followUpDateTime: '2026-09-10T10:30',
    grandTotalLacs: 12,
    managementDiscount: 50000,
    productCount: 2,
    quotationPresent: true,
    regionPresent: true,
    ...overrides,
  };
}

function contextInput(overrides = {}) {
  return {
    contactFieldMetadata: metadata(constants.contactFieldTypes),
    existingMilestoneCount: 3,
    paymentFieldMetadata: metadata(constants.paymentFieldTypes),
    recordSnapshot: snapshot(),
    sourceTargetFieldAvailable: false,
    today: '2026-09-01',
    ...overrides,
  };
}

function previewContext(overrides = {}) {
  return createContext(contextInput(overrides));
}

function rowsFor(preset = '3.2') {
  return constants.presets[preset].map(row => ({ percent: row.percent, purpose: row.purpose }));
}

function input(overrides = {}) {
  return {
    closureDate: '2026-09-15',
    context: previewContext(),
    followUpDateTime: '2026-09-10T10:30',
    preset: '3.2',
    retentionPercent: 0,
    rows: rowsFor('3.2'),
    sunrooof: { booking: 0, discount: 0, enabled: false, total: 0 },
    ...overrides,
  };
}

function assertPreviewError(callback, code) {
  assert.throws(callback, error => {
    assert.equal(error instanceof PaymentMilestonePreviewError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, 'Payment Milestone preview input is invalid.');
    return true;
  });
}

test('exports the exact immutable constants and current missing-target metadata contract', () => {
  assert.deepEqual(constants.contactFieldTypes, {
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
  assert.deepEqual(constants.paymentFieldTypes, {
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
  assert.deepEqual(constants.milestoneNames, [
    'Order Booking Payment',
    'Production Payment',
    'Dispatch Payment',
  ]);
  assert.deepEqual(constants.presets, {
    '3.2': [
      { purpose: 'Order Booking Payment', percent: 50 },
      { purpose: 'Production Payment', percent: 30 },
      { purpose: 'Dispatch Payment', percent: 20 },
    ],
    '2': [
      { purpose: 'Order Booking Payment', percent: 50 },
      { purpose: 'Dispatch Payment', percent: 50 },
    ],
  });
  assert.deepEqual(constants.limits, {
    accessories: 100000,
    existingMilestones: 200,
    lacs: 10000000,
    managementDiscount: 1000000000,
    rupees: 1000000000000,
  });
  assert.equal(constants.sourceAmountTarget, 'Amount_To_Be_Paid');
  assert.equal(Object.hasOwn(constants.paymentFieldTypes, constants.sourceAmountTarget), false);
  assert.equal(Object.isFrozen(constants), true);
  assert.equal(Object.isFrozen(constants.contactFieldTypes), true);
  assert.equal(Object.isFrozen(constants.paymentFieldTypes), true);
  assert.equal(Object.isFrozen(constants.milestoneNames), true);
  assert.equal(Object.isFrozen(constants.presets), true);
  assert.equal(Object.isFrozen(constants.presets['3.2']), true);
  assert.ok(constants.presets['3.2'].every(Object.isFrozen));
  assert.equal(Object.isFrozen(constants.limits), true);
  assert.throws(() => { constants.presets['3.2'][0].percent = 1; }, TypeError);
  assert.equal(constants.presets['3.2'][0].percent, 50);
});

test('creates an immutable context from exact metadata and only a milestone count', () => {
  const raw = contextInput();
  const value = createContext(raw);

  assert.deepEqual(value, {
    contactFieldMetadata: metadata(constants.contactFieldTypes),
    existingMilestoneCount: 3,
    paymentFieldMetadata: metadata(constants.paymentFieldTypes),
    recordSnapshot: snapshot(),
    sourceTargetFieldAvailable: false,
    today: '2026-09-01',
  });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.contactFieldMetadata), true);
  assert.ok(value.contactFieldMetadata.every(Object.isFrozen));
  assert.equal(Object.isFrozen(value.paymentFieldMetadata), true);
  assert.ok(value.paymentFieldMetadata.every(Object.isFrozen));
  assert.equal(Object.isFrozen(value.recordSnapshot), true);

  raw.contactFieldMetadata[0].dataType = 'changed';
  raw.paymentFieldMetadata[0].apiName = 'changed';
  raw.recordSnapshot.amountAfterDiscountLacs = 999;
  assert.equal(value.contactFieldMetadata[0].dataType, 'subform');
  assert.equal(value.paymentFieldMetadata[0].apiName, 'Opportunity_Name');
  assert.equal(value.recordSnapshot.amountAfterDiscountLacs, 10);
});

test('builds the exact valid three-row display-only allocation vector', () => {
  const result = buildPaymentMilestoneDraft(input());
  assert.deepEqual(result, {
    preview_only: true,
    persistence: 'disabled',
    calculation_basis: 'current local formula snapshot',
    replacement_preview: {
      existing_milestone_count: 3,
      replacement_enabled: false,
    },
    contact_draft: {
      Est_Closoure_Date: '2026-09-15',
      Management_Discount_Proposed: 50000,
      No_of_Accessories: 10,
      Accessories_Amount: '5000.00',
      Next_Follow_Up_Date1: '2026-09-10T10:30:00+05:30',
    },
    schedule: [
      {
        kind: 'magppie',
        milestone: 'Order Booking Payment',
        percentage: 50,
        calculated_amount_after_discount: '500000.00',
        calculated_grand_total: '600000.00',
        serial_number: 1,
      },
      {
        kind: 'magppie',
        milestone: 'Production Payment',
        percentage: 30,
        calculated_amount_after_discount: '300000.00',
        calculated_grand_total: '360000.00',
        serial_number: 2,
      },
      {
        kind: 'magppie',
        milestone: 'Dispatch Payment',
        percentage: 20,
        calculated_amount_after_discount: '200000.00',
        calculated_grand_total: '240000.00',
        serial_number: 3,
      },
    ],
    runtime_evidence: {
      source_amount_target: 'Amount_To_Be_Paid',
      local_field_status: 'unavailable',
      schedule_shape: 'display-only',
    },
    blocked_actions: [
      'Existing milestone deletion',
      'Contact update',
      'Milestone creation',
      'Workflow trigger',
      'Blueprint continuation',
    ],
  });
});

test('builds the exact valid two-row vector with nullable accessories when discount is zero', () => {
  const context = previewContext({
    existingMilestoneCount: 0,
    recordSnapshot: snapshot({ accessories: null, managementDiscount: 0 }),
  });
  const result = buildPaymentMilestoneDraft(input({
    context,
    preset: '2',
    rows: rowsFor('2'),
  }));

  assert.deepEqual(result.schedule, [
    {
      kind: 'magppie',
      milestone: 'Order Booking Payment',
      percentage: 50,
      calculated_amount_after_discount: '500000.00',
      calculated_grand_total: '600000.00',
      serial_number: 1,
    },
    {
      kind: 'magppie',
      milestone: 'Dispatch Payment',
      percentage: 50,
      calculated_amount_after_discount: '500000.00',
      calculated_grand_total: '600000.00',
      serial_number: 2,
    },
  ]);
  assert.deepEqual(result.replacement_preview, {
    existing_milestone_count: 0,
    replacement_enabled: false,
  });
  assert.equal(result.contact_draft.No_of_Accessories, null);
  assert.equal(result.contact_draft.Accessories_Amount, '0.00');
  assert.deepEqual(result.runtime_evidence, {
    source_amount_target: 'Amount_To_Be_Paid',
    local_field_status: 'unavailable',
    schedule_shape: 'display-only',
  });
});

test('deducts retention from the final Magppie milestone and appends one serial row', () => {
  const result = buildPaymentMilestoneDraft(input({ retentionPercent: 5 }));
  assert.equal(result.schedule.length, 4);
  assert.deepEqual(result.schedule.slice(-2), [
    {
      kind: 'magppie',
      milestone: 'Dispatch Payment',
      percentage: 15,
      calculated_amount_after_discount: '150000.00',
      calculated_grand_total: '180000.00',
      serial_number: 3,
    },
    {
      kind: 'retention',
      milestone: 'Retention Milestone',
      percentage: 5,
      calculated_amount_after_discount: '50000.00',
      calculated_grand_total: '60000.00',
      serial_number: 4,
    },
  ]);
  assert.equal(result.schedule.reduce((sum, row) => sum + row.percentage, 0), 100);
});

test('calculates Sunrooof booking percentage, shifts serials, and subtracts its total from the Magppie grand-total base', () => {
  const result = buildPaymentMilestoneDraft(input({
    retentionPercent: 5,
    sunrooof: {
      booking: 50000,
      discount: 10000,
      enabled: true,
      total: 200000,
    },
  }));

  assert.deepEqual(result.schedule, [
    {
      kind: 'sunrooof',
      milestone: 'Order Booking Sunroof Milestone',
      percentage: 25,
      calculated_amount_after_discount: '50000.00',
      calculated_grand_total: '50000.00',
      serial_number: 1,
      management_discount: '10000.00',
    },
    {
      kind: 'magppie',
      milestone: 'Order Booking Payment',
      percentage: 50,
      calculated_amount_after_discount: '500000.00',
      calculated_grand_total: '500000.00',
      serial_number: 2,
    },
    {
      kind: 'magppie',
      milestone: 'Production Payment',
      percentage: 30,
      calculated_amount_after_discount: '300000.00',
      calculated_grand_total: '300000.00',
      serial_number: 3,
    },
    {
      kind: 'magppie',
      milestone: 'Dispatch Payment',
      percentage: 15,
      calculated_amount_after_discount: '150000.00',
      calculated_grand_total: '150000.00',
      serial_number: 4,
    },
    {
      kind: 'retention',
      milestone: 'Retention Milestone',
      percentage: 5,
      calculated_amount_after_discount: '50000.00',
      calculated_grand_total: '50000.00',
      serial_number: 5,
    },
  ]);
  const magppieGrandTotal = result.schedule
    .filter(row => row.kind !== 'sunrooof')
    .reduce((sum, row) => sum + Number(row.calculated_grand_total), 0);
  assert.equal(magppieGrandTotal, 1000000);
});

test('returns a deeply immutable, defensive, anonymized display-only draft', () => {
  const rawRows = rowsFor('3.2');
  const raw = input({ rows: rawRows });
  const result = buildPaymentMilestoneDraft(raw);

  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.replacement_preview), true);
  assert.equal(Object.isFrozen(result.contact_draft), true);
  assert.equal(Object.isFrozen(result.schedule), true);
  assert.ok(result.schedule.every(Object.isFrozen));
  assert.equal(Object.isFrozen(result.runtime_evidence), true);
  assert.equal(Object.isFrozen(result.blocked_actions), true);
  assert.throws(() => { result.schedule[0].percentage = 1; }, TypeError);
  assert.throws(() => { result.schedule.push({}); }, TypeError);

  rawRows[0].percent = 1;
  rawRows[0].purpose = 'Dispatch Payment';
  rawRows.push({ percent: 99, purpose: 'Production Payment' });
  assert.equal(result.schedule[0].percentage, 50);
  assert.equal(result.schedule[0].milestone, 'Order Booking Payment');
  assert.equal(result.schedule.length, 3);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /\b\d{17,20}\b/);
  assert.doesNotMatch(serialized, /"(?:id|record_id|contact_id|opportunity_id|owner|email|phone|mobile|full_name|deal_name)"\s*:/i);
  assert.deepEqual(Object.keys(result.replacement_preview), ['existing_milestone_count', 'replacement_enabled']);
});

test('validates calendar dates, datetimes, explicit today, and date-only past rules', () => {
  const sameDay = buildPaymentMilestoneDraft(input({
    closureDate: '2026-09-01',
    followUpDateTime: '2026-09-01T00:00',
  }));
  assert.equal(sameDay.contact_draft.Est_Closoure_Date, '2026-09-01');
  assert.equal(sameDay.contact_draft.Next_Follow_Up_Date1, '2026-09-01T00:00:00+05:30');

  const leap = buildPaymentMilestoneDraft(input({
    closureDate: '2028-02-29',
    followUpDateTime: '2028-02-29T23:59',
  }));
  assert.equal(leap.contact_draft.Est_Closoure_Date, '2028-02-29');

  assertPreviewError(() => previewContext({ today: '2026-02-30' }), 'TODAY_INVALID');
  assertPreviewError(() => previewContext({ today: '2026-9-01' }), 'TODAY_INVALID');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ closureDate: '2026-02-30' }) }), 'CLOSURE_DATE_INVALID');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ followUpDateTime: '2026-09-01T24:00' }) }), 'FOLLOW_UP_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ closureDate: '' })), 'CLOSURE_DATE_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ closureDate: '2026-02-29' })), 'CLOSURE_DATE_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ closureDate: '2026-08-31' })), 'CLOSURE_DATE_PAST');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ followUpDateTime: '' })), 'FOLLOW_UP_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ followUpDateTime: '2026-09-01T24:00' })), 'FOLLOW_UP_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ followUpDateTime: '2026-09-01T12:60' })), 'FOLLOW_UP_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ followUpDateTime: '2026-09-01T12:00:00' })), 'FOLLOW_UP_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ followUpDateTime: '2026-08-31T23:59' })), 'FOLLOW_UP_PAST');
});

test('enforces record and relationship preconditions before allocation', () => {
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ regionPresent: false }) }), 'REGION_REQUIRED');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ regionPresent: 'true' }) }), 'REGION_REQUIRED');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ quotationPresent: false }) }), 'QUOTATION_REQUIRED');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ productCount: 0 }) }), 'PRODUCT_REQUIRED');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ productCount: 201 }) }), 'PRODUCT_REQUIRED');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ productCount: 1.5 }) }), 'PRODUCT_REQUIRED');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ managementDiscount: -1 }) }), 'MANAGEMENT_DISCOUNT_INVALID');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ managementDiscount: constants.limits.managementDiscount + 1 }) }), 'MANAGEMENT_DISCOUNT_INVALID');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ managementDiscount: 1, accessories: null }) }), 'ACCESSORIES_REQUIRED');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ accessories: -1 }) }), 'ACCESSORIES_INVALID');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ accessories: constants.limits.accessories + 1 }) }), 'ACCESSORIES_INVALID');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ amountAfterDiscountLacs: 0 }) }), 'AMOUNT_AFTER_DISCOUNT_INVALID');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ amountAfterDiscountLacs: Number.NaN }) }), 'AMOUNT_AFTER_DISCOUNT_INVALID');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ grandTotalLacs: 0 }) }), 'GRAND_TOTAL_INVALID');
  assertPreviewError(() => previewContext({ recordSnapshot: snapshot({ grandTotalLacs: constants.limits.lacs + 1 }) }), 'GRAND_TOTAL_INVALID');
  assertPreviewError(() => previewContext({ existingMilestoneCount: -1 }), 'EXISTING_MILESTONE_COUNT_INVALID');
  assertPreviewError(() => previewContext({ existingMilestoneCount: 1.5 }), 'EXISTING_MILESTONE_COUNT_INVALID');
  assertPreviewError(() => previewContext({ existingMilestoneCount: constants.limits.existingMilestones + 1 }), 'EXISTING_MILESTONE_COUNT_INVALID');
});

test('fails closed for missing, changed, duplicate, unknown, or newly appeared target metadata', () => {
  const contactFields = metadata(constants.contactFieldTypes);
  const paymentFields = metadata(constants.paymentFieldTypes);

  assertPreviewError(() => previewContext({
    contactFieldMetadata: contactFields.slice(1),
  }), 'CONTACT_METADATA_INVALID');
  assertPreviewError(() => previewContext({
    contactFieldMetadata: contactFields.map((field, index) => index === 0 ? { ...field, dataType: 'text' } : field),
  }), 'CONTACT_METADATA_INVALID');
  assertPreviewError(() => previewContext({
    paymentFieldMetadata: paymentFields.slice(1),
  }), 'PAYMENT_METADATA_INVALID');
  assertPreviewError(() => previewContext({
    paymentFieldMetadata: paymentFields.map((field, index) => index === 0 ? { ...paymentFields[1] } : field),
  }), 'PAYMENT_METADATA_INVALID');
  assertPreviewError(() => previewContext({
    paymentFieldMetadata: paymentFields.map((field, index) => index === 0 ? { apiName: 'Unknown_Field', dataType: 'currency' } : field),
  }), 'PAYMENT_METADATA_INVALID');
  assertPreviewError(() => previewContext({ sourceTargetFieldAvailable: true }), 'RUNTIME_EVIDENCE_CHANGED');
  assertPreviewError(() => previewContext({
    paymentFieldMetadata: [...paymentFields, { apiName: 'Amount_To_Be_Paid', dataType: 'currency' }],
  }), 'PAYMENT_METADATA_INVALID');
  assertPreviewError(() => previewContext({
    paymentFieldMetadata: paymentFields.map((field, index) => index === 0
      ? { apiName: 'Amount_To_Be_Paid', dataType: 'currency' }
      : field),
  }), 'PAYMENT_METADATA_INVALID');
});

test('rejects malformed, expanded, accessor, symbolic, sparse, and prototype-bearing contracts', () => {
  assertPreviewError(() => buildPaymentMilestoneDraft(), 'INPUT_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft([]), 'INPUT_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft({ ...input(), extra: true }), 'INPUT_INVALID');

  const hiddenInput = input();
  Object.defineProperty(hiddenInput, 'extra', { value: true });
  assertPreviewError(() => buildPaymentMilestoneDraft(hiddenInput), 'INPUT_INVALID');

  const symbolicInput = input();
  symbolicInput[Symbol('extra')] = true;
  assertPreviewError(() => buildPaymentMilestoneDraft(symbolicInput), 'INPUT_INVALID');

  const inheritedInput = Object.assign(Object.create({ extra: true }), input());
  assertPreviewError(() => buildPaymentMilestoneDraft(inheritedInput), 'INPUT_INVALID');

  const accessorInput = input();
  Object.defineProperty(accessorInput, 'preset', { enumerable: true, get: () => '3.2' });
  assertPreviewError(() => buildPaymentMilestoneDraft(accessorInput), 'INPUT_INVALID');

  const expandedContext = contextInput();
  expandedContext.extra = true;
  assertPreviewError(() => createContext(expandedContext), 'CONTEXT_INVALID');

  const hiddenContext = contextInput();
  Object.defineProperty(hiddenContext, 'extra', { value: true });
  assertPreviewError(() => createContext(hiddenContext), 'CONTEXT_INVALID');

  const inheritedContext = Object.assign(Object.create({ extra: true }), contextInput());
  assertPreviewError(() => createContext(inheritedContext), 'CONTEXT_INVALID');

  const accessorContext = contextInput();
  Object.defineProperty(accessorContext, 'today', { enumerable: true, get: () => '2026-09-01' });
  assertPreviewError(() => createContext(accessorContext), 'CONTEXT_INVALID');

  const accessorSnapshot = snapshot();
  Object.defineProperty(accessorSnapshot, 'productCount', { enumerable: true, get: () => 2 });
  assertPreviewError(() => previewContext({ recordSnapshot: accessorSnapshot }), 'RECORD_SNAPSHOT_INVALID');

  const inheritedSnapshot = Object.assign(Object.create({ extra: true }), snapshot());
  assertPreviewError(() => previewContext({ recordSnapshot: inheritedSnapshot }), 'RECORD_SNAPSHOT_INVALID');

  const hiddenSnapshot = snapshot();
  Object.defineProperty(hiddenSnapshot, 'extra', { value: true });
  assertPreviewError(() => previewContext({ recordSnapshot: hiddenSnapshot }), 'RECORD_SNAPSHOT_INVALID');

  const sparseMetadata = new Array(Object.keys(constants.contactFieldTypes).length);
  assertPreviewError(() => previewContext({ contactFieldMetadata: sparseMetadata }), 'CONTACT_METADATA_INVALID');

  const accessorMetadata = metadata(constants.contactFieldTypes);
  Object.defineProperty(accessorMetadata, '0', {
    enumerable: true,
    get: () => ({ apiName: 'Product_Details1', dataType: 'subform' }),
  });
  assertPreviewError(() => previewContext({ contactFieldMetadata: accessorMetadata }), 'CONTACT_METADATA_INVALID');

  const expandedMetadata = metadata(constants.paymentFieldTypes);
  expandedMetadata.extra = true;
  assertPreviewError(() => previewContext({ paymentFieldMetadata: expandedMetadata }), 'PAYMENT_METADATA_INVALID');

  const hiddenMetadata = metadata(constants.paymentFieldTypes);
  Object.defineProperty(hiddenMetadata, 'extra', { value: true });
  assertPreviewError(() => previewContext({ paymentFieldMetadata: hiddenMetadata }), 'PAYMENT_METADATA_INVALID');

  const accessorField = { dataType: 'lookup' };
  Object.defineProperty(accessorField, 'apiName', { enumerable: true, get: () => 'Opportunity_Name' });
  const accessorFields = metadata(constants.paymentFieldTypes);
  accessorFields[0] = accessorField;
  assertPreviewError(() => previewContext({ paymentFieldMetadata: accessorFields }), 'PAYMENT_METADATA_INVALID');

  class MetadataField {
    constructor() {
      this.apiName = 'Opportunity_Name';
      this.dataType = 'lookup';
    }
  }
  const prototypeFields = metadata(constants.paymentFieldTypes);
  prototypeFields[0] = new MetadataField();
  assertPreviewError(() => previewContext({ paymentFieldMetadata: prototypeFields }), 'PAYMENT_METADATA_INVALID');

  const hiddenField = { ...metadata(constants.paymentFieldTypes)[0] };
  Object.defineProperty(hiddenField, 'extra', { value: true });
  const hiddenFields = metadata(constants.paymentFieldTypes);
  hiddenFields[0] = hiddenField;
  assertPreviewError(() => previewContext({ paymentFieldMetadata: hiddenFields }), 'PAYMENT_METADATA_INVALID');

  const sparseRows = new Array(3);
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: sparseRows })), 'ROWS_INVALID');

  const expandedRows = rowsFor('3.2');
  expandedRows.extra = true;
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: expandedRows })), 'ROWS_INVALID');

  const hiddenRows = rowsFor('3.2');
  Object.defineProperty(hiddenRows, 'extra', { value: true });
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: hiddenRows })), 'ROWS_INVALID');

  const symbolicRows = rowsFor('3.2');
  symbolicRows[Symbol('extra')] = true;
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: symbolicRows })), 'ROWS_INVALID');

  const accessorRows = rowsFor('3.2');
  Object.defineProperty(accessorRows, '0', {
    enumerable: true,
    get: () => ({ purpose: 'Order Booking Payment', percent: 50 }),
  });
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: accessorRows })), 'ROWS_INVALID');

  const customArrayPrototype = Object.create(Array.prototype);
  const prototypeRows = rowsFor('3.2');
  Object.setPrototypeOf(prototypeRows, customArrayPrototype);
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: prototypeRows })), 'ROWS_INVALID');

  const expandedRow = { ...rowsFor('3.2')[0], extra: true };
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: [expandedRow, ...rowsFor('3.2').slice(1)] })), 'ROW_INVALID');

  const hiddenRow = { ...rowsFor('3.2')[0] };
  Object.defineProperty(hiddenRow, 'extra', { value: true });
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: [hiddenRow, ...rowsFor('3.2').slice(1)] })), 'ROW_INVALID');

  const accessorRow = { purpose: 'Order Booking Payment' };
  Object.defineProperty(accessorRow, 'percent', { enumerable: true, get: () => 50 });
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: [accessorRow, ...rowsFor('3.2').slice(1)] })), 'ROW_INVALID');

  const inheritedRow = Object.assign(Object.create({ extra: true }), rowsFor('3.2')[0]);
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: [inheritedRow, ...rowsFor('3.2').slice(1)] })), 'ROW_INVALID');

  const accessorSunrooof = { booking: 0, discount: 0, enabled: false };
  Object.defineProperty(accessorSunrooof, 'total', { enumerable: true, get: () => 0 });
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ sunrooof: accessorSunrooof })), 'SUNROOOF_INVALID');

  const inheritedSunrooof = Object.assign(
    Object.create({ extra: true }),
    { booking: 0, discount: 0, enabled: false, total: 0 },
  );
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ sunrooof: inheritedSunrooof })), 'SUNROOOF_INVALID');

  const hiddenSunrooof = { booking: 0, discount: 0, enabled: false, total: 0 };
  Object.defineProperty(hiddenSunrooof, 'extra', { value: true });
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ sunrooof: hiddenSunrooof })), 'SUNROOOF_INVALID');
});

test('rejects copied, inherited, proxied, and otherwise forged preview contexts', () => {
  const genuine = previewContext();
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ context: { ...genuine } })), 'CONTEXT_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ context: Object.create(genuine) })), 'CONTEXT_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ context: new Proxy(genuine, {}) })), 'CONTEXT_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ context: Object.freeze(contextInput()) })), 'CONTEXT_INVALID');
  assert.doesNotThrow(() => buildPaymentMilestoneDraft(input({ context: genuine })));
});

test('captures the outer input descriptors once and rejects a context-swapping proxy', () => {
  const genuine = previewContext();
  const forged = Object.freeze({
    ...genuine,
    recordSnapshot: Object.freeze({
      ...genuine.recordSnapshot,
      amountAfterDiscountLacs: 999,
      grandTotalLacs: 999,
    }),
    today: '2000-01-01',
  });
  const target = input({ context: forged });
  let contextReads = 0;
  const swappingInput = new Proxy(target, {
    get(object, key, receiver) {
      if (key === 'context') {
        contextReads += 1;
        return contextReads === 1 ? genuine : forged;
      }
      return Reflect.get(object, key, receiver);
    },
  });

  assertPreviewError(() => buildPaymentMilestoneDraft(swappingInput), 'CONTEXT_INVALID');
  assert.equal(contextReads, 0);
});

test('fails closed for preset, row-count, milestone, percentage, retention, and total errors', () => {
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ preset: '4' })), 'PRESET_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ preset: '2', rows: rowsFor('3.2') })), 'ROW_COUNT_MISMATCH');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: rowsFor('3.2').slice(0, 2) })), 'ROW_COUNT_MISMATCH');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: [
    { purpose: 'Unsupported Payment', percent: 50 },
    ...rowsFor('3.2').slice(1),
  ] })), 'MILESTONE_NAME_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: [
    { purpose: 'Order Booking Payment', percent: -1 },
    { purpose: 'Production Payment', percent: 81 },
    { purpose: 'Dispatch Payment', percent: 20 },
  ] })), 'PERCENT_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: [
    { purpose: 'Order Booking Payment', percent: 101 },
    { purpose: 'Production Payment', percent: 0 },
    { purpose: 'Dispatch Payment', percent: 0 },
  ] })), 'PERCENT_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: [
    { purpose: 'Order Booking Payment', percent: Number.NaN },
    ...rowsFor('3.2').slice(1),
  ] })), 'PERCENT_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ rows: [
    { purpose: 'Order Booking Payment', percent: 50 },
    { purpose: 'Production Payment', percent: 30 },
    { purpose: 'Dispatch Payment', percent: 19.99 },
  ] })), 'PERCENT_TOTAL_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ retentionPercent: -0.01 })), 'RETENTION_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ retentionPercent: 15.01 })), 'RETENTION_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({ retentionPercent: Number.NaN })), 'RETENTION_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({
    retentionPercent: 11,
    rows: [
      { purpose: 'Order Booking Payment', percent: 50 },
      { purpose: 'Production Payment', percent: 40 },
      { purpose: 'Dispatch Payment', percent: 10 },
    ],
  })), 'RETENTION_EXCEEDS_LAST_MILESTONE');
});

test('fails closed for every conditional and range-invalid Sunrooof allocation', () => {
  assertPreviewError(() => buildPaymentMilestoneDraft(input({
    sunrooof: { booking: 1, discount: 0, enabled: false, total: 0 },
  })), 'SUNROOOF_DISABLED_VALUES');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({
    sunrooof: { booking: 0, discount: 0, enabled: true, total: 200000 },
  })), 'SUNROOOF_VALUES_REQUIRED');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({
    sunrooof: { booking: 50000, discount: 0, enabled: true, total: 0 },
  })), 'SUNROOOF_VALUES_REQUIRED');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({
    sunrooof: { booking: 200001, discount: 0, enabled: true, total: 200000 },
  })), 'SUNROOOF_BOOKING_EXCEEDS_TOTAL');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({
    sunrooof: { booking: 50000, discount: 200001, enabled: true, total: 200000 },
  })), 'SUNROOOF_DISCOUNT_EXCEEDS_TOTAL');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({
    sunrooof: { booking: 50000, discount: 0, enabled: true, total: 1200000 },
  })), 'SUNROOOF_TOTAL_EXCEEDS_GRAND_TOTAL');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({
    sunrooof: { booking: 50000, discount: 0, enabled: true, total: Number.NaN },
  })), 'SUNROOOF_TOTAL_INVALID');
  assertPreviewError(() => buildPaymentMilestoneDraft(input({
    sunrooof: { booking: constants.limits.rupees + 1, discount: 0, enabled: true, total: constants.limits.rupees },
  })), 'SUNROOOF_BOOKING_INVALID');
});

test('attaches one frozen non-replaceable browser global when CommonJS is unavailable', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(engineSource, sandbox, { filename: 'payment-milestone-preview.js' });

  assert.equal(typeof sandbox.PaymentMilestonePreview.createContext, 'function');
  assert.equal(typeof sandbox.PaymentMilestonePreview.buildPaymentMilestoneDraft, 'function');
  assert.equal(sandbox.PaymentMilestonePreview.constants.sourceAmountTarget, 'Amount_To_Be_Paid');
  assert.equal(Object.isFrozen(sandbox.PaymentMilestonePreview), true);
  const descriptor = Object.getOwnPropertyDescriptor(sandbox, 'PaymentMilestonePreview');
  assert.equal(descriptor.configurable, false);
  assert.equal(descriptor.enumerable, true);
  assert.equal(descriptor.writable, false);
  assert.throws(
    () => vm.runInContext(engineSource, sandbox, { filename: 'payment-milestone-preview.js' }),
    /namespace is unavailable/i,
  );
});

test('contains no network, SDK, provider, storage, write, file, logging, source-ID, or identity capability', () => {
  const forbidden = [
    /\bfetch\b/i,
    /\bXMLHttpRequest\b/i,
    /\bWebSocket\b/i,
    /\bEventSource\b/i,
    /\baxios\b/i,
    /\bZOHO\b/i,
    /\bSDK\b/i,
    /\b(?:local|session)Storage\b/i,
    /\bindexedDB\b/i,
    /\bdocument\.cookie\b/i,
    /\bupdateRecord\b/i,
    /\bcreateRecord\b/i,
    /\bdeleteRecord\b/i,
    /\bupdateBluePrint\b/i,
    /\bBLUEPRINT\.proceed\b/i,
    /\bFileReader\b/i,
    /\bFormData\b/i,
    /\bBlob\b/,
    /\bconsole\s*\./i,
    /\b(?:record|contact|opportunity|user|owner|profile)[_-]?id\b/i,
    /\b(?:Contact_Name|Full_Name|Deal_Name|Owner|Email|Phone|Mobile)\b/i,
    /\b\d{17,20}\b/,
    /\b(?:POST|PUT|PATCH|DELETE)\b/,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(engineSource, pattern);
});
