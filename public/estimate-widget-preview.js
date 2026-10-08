(function attachEstimateWidgetPreview(root, createPreview) {
  'use strict';

  const preview = createPreview();

  if (typeof module === 'object' && module && module.exports) {
    module.exports = preview;
    return;
  }

  if (!root || Object.prototype.hasOwnProperty.call(root, 'EstimateWidgetPreview')) {
    throw new Error('Estimate preview namespace is unavailable.');
  }
  Object.defineProperty(root, 'EstimateWidgetPreview', {
    configurable: false,
    enumerable: true,
    value: preview,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createEstimateWidgetPreview() {
  'use strict';

  class EstimatePreviewError extends Error {
    constructor(code) {
      super('Estimate preview input is invalid.');
      this.name = 'EstimatePreviewError';
      this.code = code;
    }
  }

  const SHAPES = Object.freeze({
    linear: Object.freeze({ label: 'Linear', wallCount: 1 }),
    'l-shape': Object.freeze({ label: 'L Shape', wallCount: 2 }),
    'u-shape': Object.freeze({ label: 'U Shape', wallCount: 3 }),
    parallel: Object.freeze({ label: 'Parallel', wallCount: 2 }),
  });

  const PACKAGES = Object.freeze({
    PG1: Object.freeze({ label: 'PG 1', pricePerSqft: 10460 }),
    PG2: Object.freeze({ label: 'PG 2', pricePerSqft: 9367 }),
  });

  const WALL_HEIGHTS_MM = Object.freeze([720, 1080]);
  const DEFAULTS = Object.freeze({
    shape: 'linear',
    packageType: 'PG1',
    wallHeightMM: 720,
  });
  const CONSTANTS = Object.freeze({
    shapes: SHAPES,
    packages: PACKAGES,
    wallHeightsMM: WALL_HEIGHTS_MM,
    defaults: DEFAULTS,
    baseHeightMM: 820,
    heightDivisor: 304,
  });
  const INPUT_KEYS = Object.freeze(['packageType', 'shape', 'wallFeet', 'wallHeightMM']);
  const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

  function fail(code) {
    throw new EstimatePreviewError(code);
  }

  function inputObject(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INPUT_INVALID');
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) fail('INPUT_INVALID');
    if (Object.getOwnPropertySymbols(input).length !== 0) fail('INPUT_INVALID');
    const keys = Object.keys(input).sort();
    if (keys.length !== INPUT_KEYS.length || keys.some((key, index) => key !== INPUT_KEYS[index])) {
      fail('INPUT_INVALID');
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (keys.some(key => !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) fail('INPUT_INVALID');
    return input;
  }

  function wallNumber(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    let parsed;
    if (typeof raw === 'number') parsed = raw;
    else if (typeof raw === 'string' && DECIMAL.test(raw.trim())) parsed = Number(raw.trim());
    else fail('WALL_INPUT_INVALID');
    if (!Number.isFinite(parsed)) fail('WALL_INPUT_INVALID');
    return parsed > 0 ? parsed : null;
  }

  function wallValues(input, expectedCount) {
    if (!Array.isArray(input) || input.length !== expectedCount || Object.getOwnPropertySymbols(input).length !== 0) {
      fail('WALL_COUNT_INVALID');
    }
    const keys = Object.keys(input);
    if (keys.some(key => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= expectedCount)) fail('WALL_COUNT_INVALID');
    const values = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('WALL_INPUT_INVALID');
      values.push(wallNumber(descriptor.value));
    }
    return values;
  }

  function formatIndian(number) {
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) fail('FORMAT_INPUT_INVALID');
    const text = String(Math.round(number));
    if (text.length <= 3) return text;
    const lastThree = text.slice(-3);
    const leading = text.slice(0, -3);
    const groups = [];
    for (let end = leading.length; end > 0; end -= 2) {
      groups.unshift(leading.slice(Math.max(0, end - 2), end));
    }
    return `${groups.join(',')},${lastThree}`;
  }

  function calculateEstimate(rawInput) {
    const input = inputObject(rawInput);
    const shape = SHAPES[input.shape];
    if (!shape) fail('SHAPE_UNSUPPORTED');
    const selectedPackage = PACKAGES[input.packageType];
    if (!selectedPackage) fail('PACKAGE_UNSUPPORTED');
    if (typeof input.wallHeightMM !== 'number' || !WALL_HEIGHTS_MM.includes(input.wallHeightMM)) {
      fail('HEIGHT_UNSUPPORTED');
    }

    const walls = wallValues(input.wallFeet, shape.wallCount);
    const wallFeetTotal = walls.reduce((total, value) => total + (value === null ? 0 : value), 0);
    if (!(wallFeetTotal > 0) || !Number.isFinite(wallFeetTotal)) return null;

    const heightFactor = (input.wallHeightMM + CONSTANTS.baseHeightMM) / CONSTANTS.heightDivisor;
    const totalSqft = Math.round(wallFeetTotal * heightFactor);
    const totalPrice = Math.round(totalSqft * selectedPackage.pricePerSqft);
    const priceInLakhs = Math.round(totalPrice / 100000);
    if (!Number.isSafeInteger(totalSqft) || !Number.isSafeInteger(totalPrice) || !Number.isSafeInteger(priceInLakhs)) {
      fail('CALCULATION_RANGE_INVALID');
    }

    return Object.freeze({
      shape: input.shape,
      shapeLabel: shape.label,
      wallCount: shape.wallCount,
      packageType: input.packageType,
      packageLabel: selectedPackage.label,
      wallHeightMM: input.wallHeightMM,
      wallFeetTotal,
      heightFactor,
      totalSqft,
      pricePerSqft: selectedPackage.pricePerSqft,
      totalPrice,
      formattedTotalPrice: formatIndian(totalPrice),
      priceInLakhs,
    });
  }

  Object.freeze(EstimatePreviewError.prototype);
  Object.freeze(EstimatePreviewError);
  return Object.freeze({
    EstimatePreviewError,
    constants: CONSTANTS,
    calculateEstimate,
    formatIndian,
  });
});
