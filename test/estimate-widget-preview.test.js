'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const enginePath = path.resolve(__dirname, '..', 'public', 'estimate-widget-preview.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const {
  EstimatePreviewError,
  constants,
  calculateEstimate,
  formatIndian,
} = require('../public/estimate-widget-preview');

function input(overrides = {}) {
  return {
    shape: 'linear',
    packageType: 'PG1',
    wallHeightMM: 720,
    wallFeet: [10],
    ...overrides,
  };
}

function assertPreviewError(callback, code) {
  assert.throws(callback, error => {
    assert.equal(error instanceof EstimatePreviewError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, 'Estimate preview input is invalid.');
    return true;
  });
}

test('exports the exact immutable source-observed constants and defaults', () => {
  assert.deepEqual(constants.shapes, {
    linear: { label: 'Linear', wallCount: 1 },
    'l-shape': { label: 'L Shape', wallCount: 2 },
    'u-shape': { label: 'U Shape', wallCount: 3 },
    parallel: { label: 'Parallel', wallCount: 2 },
  });
  assert.deepEqual(constants.packages, {
    PG1: { label: 'PG 1', pricePerSqft: 10460 },
    PG2: { label: 'PG 2', pricePerSqft: 9367 },
  });
  assert.deepEqual(constants.wallHeightsMM, [720, 1080]);
  assert.deepEqual(constants.defaults, { shape: 'linear', packageType: 'PG1', wallHeightMM: 720 });
  assert.equal(constants.baseHeightMM, 820);
  assert.equal(constants.heightDivisor, 304);
  assert.equal(Object.isFrozen(constants), true);
  assert.equal(Object.isFrozen(constants.shapes), true);
  assert.equal(Object.isFrozen(constants.shapes.linear), true);
  assert.equal(Object.isFrozen(constants.packages), true);
  assert.equal(Object.isFrozen(constants.packages.PG1), true);
  assert.equal(Object.isFrozen(constants.wallHeightsMM), true);
  assert.equal(Object.isFrozen(constants.defaults), true);
  assert.throws(() => { constants.packages.PG1.pricePerSqft = 1; }, TypeError);
  assert.equal(constants.packages.PG1.pricePerSqft, 10460);
});

test('reproduces the exact Linear PG1 720mm vector', () => {
  const result = calculateEstimate(input());
  assert.deepEqual(result, {
    shape: 'linear',
    shapeLabel: 'Linear',
    wallCount: 1,
    packageType: 'PG1',
    packageLabel: 'PG 1',
    wallHeightMM: 720,
    wallFeetTotal: 10,
    heightFactor: 1540 / 304,
    totalSqft: 51,
    pricePerSqft: 10460,
    totalPrice: 533460,
    formattedTotalPrice: '5,33,460',
    priceInLakhs: 5,
  });
  assert.equal(Object.isFrozen(result), true);
});

test('rounds square feet before pricing for the exact L-shape PG2 vector', () => {
  const result = calculateEstimate(input({
    shape: 'l-shape',
    packageType: 'PG2',
    wallHeightMM: 1080,
    wallFeet: [10, 8],
  }));
  assert.equal(result.wallFeetTotal, 18);
  assert.equal(result.heightFactor, 6.25);
  assert.equal(result.totalSqft, 113);
  assert.equal(result.totalPrice, 1058471);
  assert.equal(result.formattedTotalPrice, '10,58,471');
  assert.equal(result.priceInLakhs, 11);
});

test('uses the exact wall count for every shape', () => {
  const cases = [
    ['linear', [2], 1],
    ['l-shape', [2, 3], 2],
    ['u-shape', [2, 3, 4], 3],
    ['parallel', [2, 3], 2],
  ];
  for (const [shape, wallFeet, wallCount] of cases) {
    const result = calculateEstimate(input({ shape, wallFeet }));
    assert.equal(result.wallCount, wallCount);
    assert.equal(result.wallFeetTotal, wallFeet.reduce((sum, value) => sum + value, 0));
  }
});

test('sums only finite positive wall lengths and returns null with no positive wall', () => {
  const result = calculateEstimate(input({
    shape: 'u-shape',
    wallFeet: ['10.5', 0, -4],
  }));
  assert.equal(result.wallFeetTotal, 10.5);
  assert.equal(result.totalSqft, 53);

  assert.equal(calculateEstimate(input({ wallFeet: [0] })), null);
  assert.equal(calculateEstimate(input({ wallFeet: [-3] })), null);
  assert.equal(calculateEstimate(input({ wallFeet: [''] })), null);
  assert.equal(calculateEstimate(input({ wallFeet: [null] })), null);
});

test('preserves JavaScript half-up behavior at the square-foot and lakh boundaries', () => {
  const halfSqft = calculateEstimate(input({
    shape: 'l-shape',
    packageType: 'PG2',
    wallHeightMM: 1080,
    wallFeet: [10, 8],
  }));
  assert.equal(18 * 6.25, 112.5);
  assert.equal(halfSqft.totalSqft, 113);

  const roundsToOneLakh = calculateEstimate(input({ wallFeet: [1] }));
  assert.equal(roundsToOneLakh.totalSqft, 5);
  assert.equal(roundsToOneLakh.totalPrice, 52300);
  assert.equal(roundsToOneLakh.priceInLakhs, 1);

  const roundsToZeroLakh = calculateEstimate(input({ wallFeet: [0.7] }));
  assert.equal(roundsToZeroLakh.totalSqft, 4);
  assert.equal(roundsToZeroLakh.totalPrice, 41840);
  assert.equal(roundsToZeroLakh.priceInLakhs, 0);
});

test('formats non-negative finite values with exact Indian digit grouping', () => {
  assert.equal(formatIndian(0), '0');
  assert.equal(formatIndian(999), '999');
  assert.equal(formatIndian(1000), '1,000');
  assert.equal(formatIndian(10460), '10,460');
  assert.equal(formatIndian(533460), '5,33,460');
  assert.equal(formatIndian(1058471), '10,58,471');
  assert.equal(formatIndian(123456789), '12,34,56,789');
  assert.equal(formatIndian(999.5), '1,000');
});

test('fails closed for invalid or expanded input contracts', () => {
  assertPreviewError(() => calculateEstimate(), 'INPUT_INVALID');
  assertPreviewError(() => calculateEstimate([]), 'INPUT_INVALID');
  assertPreviewError(() => calculateEstimate({ ...input(), extra: true }), 'INPUT_INVALID');
  assertPreviewError(() => calculateEstimate(input({ shape: 'island' })), 'SHAPE_UNSUPPORTED');
  assertPreviewError(() => calculateEstimate(input({ packageType: 'PG3' })), 'PACKAGE_UNSUPPORTED');
  assertPreviewError(() => calculateEstimate(input({ wallHeightMM: 900 })), 'HEIGHT_UNSUPPORTED');
  assertPreviewError(() => calculateEstimate(input({ wallHeightMM: '720' })), 'HEIGHT_UNSUPPORTED');
  assertPreviewError(() => calculateEstimate(input({ wallFeet: [10, 8] })), 'WALL_COUNT_INVALID');
  assertPreviewError(() => calculateEstimate(input({ wallFeet: '10' })), 'WALL_COUNT_INVALID');

  const inherited = Object.assign(Object.create({ unexpected: true }), input());
  assertPreviewError(() => calculateEstimate(inherited), 'INPUT_INVALID');
});

test('fails closed for malformed, non-finite, sparse, accessor, and symbolic wall inputs', () => {
  assertPreviewError(() => calculateEstimate(input({ wallFeet: ['10 feet'] })), 'WALL_INPUT_INVALID');
  assertPreviewError(() => calculateEstimate(input({ wallFeet: [Number.NaN] })), 'WALL_INPUT_INVALID');
  assertPreviewError(() => calculateEstimate(input({ wallFeet: [Number.POSITIVE_INFINITY] })), 'WALL_INPUT_INVALID');
  assertPreviewError(() => calculateEstimate(input({ wallFeet: [{}] })), 'WALL_INPUT_INVALID');
  assertPreviewError(() => calculateEstimate(input({ wallFeet: new Array(1) })), 'WALL_INPUT_INVALID');

  const accessorWalls = [];
  Object.defineProperty(accessorWalls, '0', { enumerable: true, get: () => 10 });
  accessorWalls.length = 1;
  assertPreviewError(() => calculateEstimate(input({ wallFeet: accessorWalls })), 'WALL_INPUT_INVALID');

  const symbolicWalls = [10];
  symbolicWalls[Symbol('unexpected')] = true;
  assertPreviewError(() => calculateEstimate(input({ wallFeet: symbolicWalls })), 'WALL_COUNT_INVALID');

  const expandedWalls = [10];
  expandedWalls.unexpected = true;
  assertPreviewError(() => calculateEstimate(input({ wallFeet: expandedWalls })), 'WALL_COUNT_INVALID');

  assertPreviewError(() => calculateEstimate(input({ wallFeet: [Number.MAX_VALUE] })), 'CALCULATION_RANGE_INVALID');
});

test('fails closed for invalid formatting values without echoing input', () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, '1000', null]) {
    assertPreviewError(() => formatIndian(value), 'FORMAT_INPUT_INVALID');
  }
});

test('attaches one frozen browser global when CommonJS is unavailable', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(engineSource, context, { filename: 'estimate-widget-preview.js' });
  assert.equal(typeof context.EstimateWidgetPreview.calculateEstimate, 'function');
  assert.equal(Object.isFrozen(context.EstimateWidgetPreview), true);
  assert.equal(context.EstimateWidgetPreview.constants.packages.PG2.pricePerSqft, 9367);
  const descriptor = Object.getOwnPropertyDescriptor(context, 'EstimateWidgetPreview');
  assert.equal(descriptor.configurable, false);
  assert.equal(descriptor.writable, false);
});

test('contains no outbound, provider, persistence, dynamic-code, context-id, or mutation capability', () => {
  const forbidden = [
    /\bfetch\b/i,
    /\bXMLHttpRequest\b/i,
    /\bXHR\b/,
    /\bSDK\b/i,
    /\bZOHO\b/i,
    /\bupdateRecord\b/i,
    /\b(?:local|session)Storage\b/i,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /\brecord[ _-]?id\b/i,
    /\b(?:POST|PUT|PATCH|DELETE)\b/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(engineSource, pattern);
});
