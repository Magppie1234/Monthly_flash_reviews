'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const enginePath = path.resolve(__dirname, '..', 'public', 'designer-form-preview.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const {
  DesignerFormPreviewError,
  constants,
  createContext,
  buildDesignerDraft,
} = require('../public/designer-form-preview');

const PRODUCT_TYPES = Object.freeze([
  'Kitchen',
  'Wardrobe',
  'SUNROOOF',
  'Countertop / Backplash',
  'Pantry',
]);
const PRESENTATION = Object.freeze({
  Kitchen: 'Kitchen 3D',
  Wardrobe: 'Wardrobe 3D',
  SUNROOOF: 'Sunrooof 3D',
  'Countertop / Backplash': 'Laundry Area 3D',
  Pantry: 'Pantry / Utility 3D',
});

function allFieldMetadata() {
  return Object.entries(constants.fieldTypes).map(([apiName, dataType]) => ({ apiName, dataType }));
}

function metadataFor(apiNames) {
  return apiNames.map(apiName => ({ apiName, dataType: constants.fieldTypes[apiName] }));
}

function context(productTypes = PRODUCT_TYPES, overrides = {}) {
  return createContext({
    fieldMetadata: allFieldMetadata(),
    projects: productTypes.map((productType, index) => ({ ordinal: index + 1, productType })),
    ...overrides,
  });
}

function projectValue(ordinal, productType, overrides = {}) {
  const value = {
    ceilingHeight: '2700 mm',
    city: 'New Delhi',
    designRequiredOn: '2026-09-15',
    designTheme: productType === 'SUNROOOF' ? 'Classical White' : 'Modern PG1',
    gas: '',
    island: '',
    kitchenHeight: '',
    kitchenTypes: [],
    ordinal,
    presentation: PRESENTATION[productType],
    roomAreaName: `Room ${ordinal}`,
    vastu: '',
    wardrobeHeight: '',
    wardrobeTypes: [],
  };
  if (productType === 'Kitchen') {
    Object.assign(value, {
      gas: 'Piped Gas',
      island: 'Both Side Storage',
      kitchenHeight: '2500',
      kitchenTypes: ['Chef', 'Utility'],
      vastu: 'Yes',
    });
  }
  if (productType === 'Wardrobe') {
    Object.assign(value, {
      wardrobeHeight: '9',
      wardrobeTypes: ['Glass Hinged', 'Solid Hinged'],
    });
  }
  return { ...value, ...overrides };
}

function draftInput(productTypes = PRODUCT_TYPES, overrides = {}) {
  const previewContext = context(productTypes);
  return {
    context: previewContext,
    projects: productTypes.map((productType, index) => projectValue(index + 1, productType)),
    ...overrides,
  };
}

function assertPreviewError(callback, code) {
  assert.throws(callback, error => {
    assert.equal(error instanceof DesignerFormPreviewError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, 'Designer Form preview input is invalid.');
    return true;
  });
}

test('exports the exact bounded product and current field contract', () => {
  assert.deepEqual(constants.productTypes, PRODUCT_TYPES);
  assert.equal(constants.fieldTypes.city, 'text');
  assert.equal(Object.hasOwn(constants.fieldTypes, 'City'), false);
  assert.deepEqual(constants.kitchenTypes, ['Chef', 'Show', 'Storage', 'Laundry', 'Utility']);
  assert.deepEqual(constants.kitchenHeights, ['2500', '2140']);
  assert.deepEqual(constants.wardrobeTypes, ['Glass Hinged', 'Solid Hinged']);
  assert.deepEqual(constants.wardrobeHeights, ['8', '9']);
  assert.equal(Object.isFrozen(constants), true);
  assert.equal(Object.isFrozen(constants.fieldTypes), true);
  assert.equal(Object.isFrozen(constants.productTypes), true);
});

test('creates an immutable, anonymized context for every supported product type', () => {
  const rawProjects = PRODUCT_TYPES.map((productType, index) => ({ ordinal: index + 1, productType }));
  const previewContext = createContext({ fieldMetadata: allFieldMetadata(), projects: rawProjects });

  assert.deepEqual(previewContext.projects.map(project => project.label), [
    'Project 1', 'Project 2', 'Project 3', 'Project 4', 'Project 5',
  ]);
  assert.deepEqual(previewContext.projects.map(project => project.productType), PRODUCT_TYPES);
  assert.deepEqual(previewContext.projects[0].presentationOptions, [
    'Kitchen 3D', 'Kitchen L & F', 'Kitchen L & F + EST', 'Kitchen EST', 'Kitchen 3D + EST',
  ]);
  assert.deepEqual(previewContext.projects[2].themeOptions, [
    'Classical White',
    'Classical Wood - Teak',
    'Classical Wood - Raw',
    'Modern Wooden - Teak',
    'Modern Wooden - Raw',
    'Modern White',
    'Modern Bronze',
    'Modern Grey',
    'Fluted Minimalist Wooden - Teak',
    'Fluted Minimalist Wooden - Raw',
    'Fluted Minimalist White',
    'Fluted Minimalist Grey',
    'Fluted Minimalist Bronze',
    'French Window White',
    'Louvered Window White',
    'Classical Atrium White',
    'Classical Atrium Wooden - Teak',
    'Classical Atrium Wooden - Raw',
    'Fluted Minimalist Atrium Wooden - Teak',
    'Fluted Minimalist Atrium Wooden - Raw',
    'Fluted Minimalist Atrium White',
    'Fluted Minimalist Atrium Bronze',
    'Fluted Minimalist Atrium Grey',
    'Arch Window White',
    'Double Arch Window White',
  ]);
  assert.deepEqual(Object.keys(previewContext.projects[0]), [
    'ordinal', 'label', 'productType', 'presentationOptions', 'themeOptions',
  ]);
  assert.equal(Object.isFrozen(previewContext), true);
  assert.equal(Object.isFrozen(previewContext.fieldMetadata), true);
  assert.ok(previewContext.fieldMetadata.every(Object.isFrozen));
  assert.equal(Object.isFrozen(previewContext.projects), true);
  assert.ok(previewContext.projects.every(project => (
    Object.isFrozen(project)
    && Object.isFrozen(project.presentationOptions)
    && Object.isFrozen(project.themeOptions)
  )));

  rawProjects[0].productType = 'Wardrobe';
  assert.equal(previewContext.projects[0].productType, 'Kitchen');
  assert.doesNotMatch(JSON.stringify(previewContext), /\b\d{18,19}\b|Deal_Name|Contact_Name|Owner|Email|Phone|Mobile/i);
});

test('builds immutable sanitized drafts for all product types with exact product rules and lowercase city', () => {
  const input = draftInput();
  input.projects[0].city = '  New Delhi  ';
  input.projects[2].designRequiredOn = '2028-02-29';
  const draft = buildDesignerDraft(input);

  assert.deepEqual(draft, {
    preview_only: true,
    persistence: 'disabled',
    projects: [
      {
        project_label: 'Project 1',
        product_type: 'Kitchen',
        fields: {
          Design_Presentation: 'Kitchen 3D',
          Design_Theme: 'Modern PG1',
          Finished_Kitchen_Ceiling_Height: '2700 mm',
          Design_Required_on: '2026-09-15',
          city: 'New Delhi',
          Room_Area_Name: 'Room 1',
          Any_Vastu_requirement: 'Yes',
          Gas_Arrangement: 'Piped Gas',
          Kitchen_Type: ['Chef', 'Utility'],
          Kitche_Height: '2500',
          Island: 'Both Side Storage',
        },
      },
      {
        project_label: 'Project 2',
        product_type: 'Wardrobe',
        fields: {
          Design_Presentation: 'Wardrobe 3D',
          Design_Theme: 'Modern PG1',
          Finished_Kitchen_Ceiling_Height: '2700 mm',
          Design_Required_on: '2026-09-15',
          city: 'New Delhi',
          Room_Area_Name: 'Room 2',
          Wardrobe_Type: ['Glass Hinged', 'Solid Hinged'],
          Wardrobe_Height: '9',
        },
      },
      {
        project_label: 'Project 3',
        product_type: 'SUNROOOF',
        fields: {
          Design_Presentation: 'Sunrooof 3D',
          Design_Theme: 'Classical White',
          Finished_Kitchen_Ceiling_Height: '2700 mm',
          Design_Required_on: '2028-02-29',
          city: 'New Delhi',
          Room_Area_Name: 'Room 3',
        },
      },
      {
        project_label: 'Project 4',
        product_type: 'Countertop / Backplash',
        fields: {
          Design_Presentation: 'Laundry Area 3D',
          Design_Theme: 'Modern PG1',
          Finished_Kitchen_Ceiling_Height: '2700 mm',
          Design_Required_on: '2026-09-15',
          city: 'New Delhi',
          Room_Area_Name: 'Room 4',
        },
      },
      {
        project_label: 'Project 5',
        product_type: 'Pantry',
        fields: {
          Design_Presentation: 'Pantry / Utility 3D',
          Design_Theme: 'Modern PG1',
          Finished_Kitchen_Ceiling_Height: '2700 mm',
          Design_Required_on: '2026-09-15',
          city: 'New Delhi',
          Room_Area_Name: 'Room 5',
        },
      },
    ],
    blocked_actions: [
      'Order update',
      'Note creation',
      'Attachment upload',
      'Workflow trigger',
      'Blueprint continuation',
    ],
  });

  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft.projects), true);
  assert.ok(draft.projects.every(project => Object.isFrozen(project) && Object.isFrozen(project.fields)));
  assert.equal(Object.isFrozen(draft.projects[0].fields.Kitchen_Type), true);
  assert.equal(Object.isFrozen(draft.projects[1].fields.Wardrobe_Type), true);
  assert.equal(Object.isFrozen(draft.blocked_actions), true);
  assert.equal(Object.hasOwn(draft.projects[0].fields, 'City'), false);
  assert.deepEqual(Object.keys(draft.projects[0]), ['project_label', 'product_type', 'fields']);

  input.projects[0].kitchenTypes.push('Show');
  input.projects[0].city = 'Changed after generation';
  assert.deepEqual(draft.projects[0].fields.Kitchen_Type, ['Chef', 'Utility']);
  assert.equal(draft.projects[0].fields.city, 'New Delhi');
  assert.throws(() => { draft.projects[0].fields.city = 'Mutation'; }, TypeError);
  assert.doesNotMatch(JSON.stringify(draft), /\b\d{18,19}\b|Deal_Name|Contact_Name|Owner|Email|Phone|Mobile/i);
});

test('requires only source-backed metadata needed by the selected product types', () => {
  const common = [
    'Design_Presentation',
    'Design_Theme',
    'Finished_Kitchen_Ceiling_Height',
    'Design_Required_on',
    'city',
    'Room_Area_Name',
  ];
  assert.doesNotThrow(() => createContext({
    fieldMetadata: metadataFor(common),
    projects: [{ ordinal: 1, productType: 'Pantry' }],
  }));
  assertPreviewError(() => createContext({
    fieldMetadata: metadataFor(common),
    projects: [{ ordinal: 1, productType: 'Kitchen' }],
  }), 'REQUIRED_METADATA_MISSING');
  assertPreviewError(() => createContext({
    fieldMetadata: metadataFor(common),
    projects: [{ ordinal: 1, productType: 'Wardrobe' }],
  }), 'REQUIRED_METADATA_MISSING');
});

test('fails closed for missing, duplicate, unknown, wrong-type, or wrong-case field metadata', () => {
  const metadata = allFieldMetadata();
  assertPreviewError(() => context(['Kitchen'], {
    fieldMetadata: metadata.filter(field => field.apiName !== 'city'),
  }), 'REQUIRED_METADATA_MISSING');
  assertPreviewError(() => context(['Kitchen'], {
    fieldMetadata: [...metadata, { apiName: 'city', dataType: 'text' }],
  }), 'FIELD_METADATA_INVALID');
  assertPreviewError(() => context(['Kitchen'], {
    fieldMetadata: metadata.map(field => field.apiName === 'city' ? { apiName: 'city', dataType: 'textarea' } : field),
  }), 'FIELD_METADATA_INVALID');
  assertPreviewError(() => context(['Kitchen'], {
    fieldMetadata: metadata.map(field => field.apiName === 'city' ? { apiName: 'City', dataType: 'text' } : field),
  }), 'FIELD_METADATA_INVALID');
  assertPreviewError(() => context(['Kitchen'], {
    fieldMetadata: [...metadata, { apiName: 'Unsupported_Field', dataType: 'text' }],
  }), 'FIELD_METADATA_INVALID');
  assertPreviewError(() => context(['Kitchen'], {
    fieldMetadata: metadata.map((field, index) => index === 0 ? { ...field, extra: true } : field),
  }), 'FIELD_METADATA_INVALID');
});

test('rejects malformed, sparse, accessor, expanded, symbolic, and prototype-bearing metadata inputs', () => {
  const sparse = new Array(1);
  assertPreviewError(() => context(['Pantry'], { fieldMetadata: sparse }), 'FIELD_METADATA_INVALID');

  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    get: () => ({ apiName: 'city', dataType: 'text' }),
  });
  accessorArray.length = 1;
  assertPreviewError(() => context(['Pantry'], { fieldMetadata: accessorArray }), 'FIELD_METADATA_INVALID');

  const expanded = allFieldMetadata();
  expanded.extra = true;
  assertPreviewError(() => context(['Pantry'], { fieldMetadata: expanded }), 'FIELD_METADATA_INVALID');

  const symbolic = allFieldMetadata();
  symbolic[Symbol('extra')] = true;
  assertPreviewError(() => context(['Pantry'], { fieldMetadata: symbolic }), 'FIELD_METADATA_INVALID');

  const accessorField = { dataType: 'text' };
  Object.defineProperty(accessorField, 'apiName', { enumerable: true, get: () => 'city' });
  assertPreviewError(() => context(['Pantry'], { fieldMetadata: [accessorField] }), 'FIELD_METADATA_INVALID');

  class MetadataField {
    constructor() {
      this.apiName = 'city';
      this.dataType = 'text';
    }
  }
  assertPreviewError(() => context(['Pantry'], { fieldMetadata: [new MetadataField()] }), 'FIELD_METADATA_INVALID');

  const customArrayPrototype = Object.create(Array.prototype);
  const prototypeArray = allFieldMetadata();
  Object.setPrototypeOf(prototypeArray, customArrayPrototype);
  assertPreviewError(() => context(['Pantry'], { fieldMetadata: prototypeArray }), 'FIELD_METADATA_INVALID');
});

test('rejects malformed project descriptors and enforces a bounded contiguous source order', () => {
  assertPreviewError(() => createContext({ fieldMetadata: allFieldMetadata(), projects: [] }), 'PROJECTS_REQUIRED');
  assertPreviewError(() => context(['Kitchen'], {
    projects: [{ ordinal: 2, productType: 'Kitchen' }],
  }), 'PROJECT_ORDINAL_INVALID');
  assertPreviewError(() => context(['Unsupported']), 'PRODUCT_TYPE_UNSUPPORTED');
  assertPreviewError(() => context(['']), 'PRODUCT_TYPE_INVALID');
  assertPreviewError(() => context(['Kitchen'], {
    projects: [{ ordinal: 1, productType: 'Kitchen', recordId: 'forbidden' }],
  }), 'PROJECT_INVALID');
  assertPreviewError(() => context(['Kitchen'], {
    projects: new Array(1),
  }), 'PROJECTS_INVALID');

  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    get: () => ({ ordinal: 1, productType: 'Kitchen' }),
  });
  accessorArray.length = 1;
  assertPreviewError(() => context(['Kitchen'], { projects: accessorArray }), 'PROJECTS_INVALID');

  const expanded = [{ ordinal: 1, productType: 'Kitchen' }];
  expanded.extra = true;
  assertPreviewError(() => context(['Kitchen'], { projects: expanded }), 'PROJECTS_INVALID');

  const accessorProject = { ordinal: 1 };
  Object.defineProperty(accessorProject, 'productType', { enumerable: true, get: () => 'Kitchen' });
  assertPreviewError(() => context(['Kitchen'], { projects: [accessorProject] }), 'PROJECT_INVALID');

  class ProjectDescriptor {
    constructor() {
      this.ordinal = 1;
      this.productType = 'Kitchen';
    }
  }
  assertPreviewError(() => context(['Kitchen'], { projects: [new ProjectDescriptor()] }), 'PROJECT_INVALID');

  const tooMany = Array.from({ length: constants.limits.projects + 1 }, (_, index) => ({
    ordinal: index + 1,
    productType: 'Pantry',
  }));
  assertPreviewError(() => context(['Pantry'], { projects: tooMany }), 'PROJECTS_INVALID');
});

test('rejects forged contexts, project-count drift, ordinal drift, and expanded draft envelopes', () => {
  const one = draftInput(['Kitchen']);
  assertPreviewError(() => buildDesignerDraft(), 'INPUT_INVALID');
  assertPreviewError(() => buildDesignerDraft({ ...one, extra: true }), 'INPUT_INVALID');
  assertPreviewError(() => buildDesignerDraft({ ...one, context: { ...one.context } }), 'CONTEXT_INVALID');
  assertPreviewError(() => buildDesignerDraft({ context: one.context, projects: [] }), 'PROJECT_COUNT_MISMATCH');
  assertPreviewError(() => buildDesignerDraft({
    context: one.context,
    projects: [projectValue(2, 'Kitchen')],
  }), 'PROJECT_ORDINAL_INVALID');
  assertPreviewError(() => buildDesignerDraft({
    context: one.context,
    projects: [{ ...one.projects[0], extra: true }],
  }), 'PROJECT_VALUE_INVALID');

  const prototypeInput = Object.create({ inherited: true });
  prototypeInput.context = one.context;
  prototypeInput.projects = one.projects;
  assertPreviewError(() => buildDesignerDraft(prototypeInput), 'INPUT_INVALID');

  const accessorInput = { projects: one.projects };
  Object.defineProperty(accessorInput, 'context', { enumerable: true, get: () => one.context });
  assertPreviewError(() => buildDesignerDraft(accessorInput), 'INPUT_INVALID');

  const accessorProject = { ...one.projects[0] };
  delete accessorProject.city;
  Object.defineProperty(accessorProject, 'city', { enumerable: true, get: () => 'New Delhi' });
  assertPreviewError(() => buildDesignerDraft({ context: one.context, projects: [accessorProject] }), 'PROJECT_VALUE_INVALID');

  class ProjectValue {
    constructor(value) {
      Object.assign(this, value);
    }
  }
  assertPreviewError(() => buildDesignerDraft({
    context: one.context,
    projects: [new ProjectValue(one.projects[0])],
  }), 'PROJECT_VALUE_INVALID');
});

test('rejects sparse, accessor, expanded, symbolic, and prototype-bearing project-value arrays', () => {
  const one = draftInput(['Kitchen']);
  assertPreviewError(() => buildDesignerDraft({ context: one.context, projects: new Array(1) }), 'PROJECT_VALUES_INVALID');

  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get: () => one.projects[0] });
  accessor.length = 1;
  assertPreviewError(() => buildDesignerDraft({ context: one.context, projects: accessor }), 'PROJECT_VALUES_INVALID');

  const expanded = [one.projects[0]];
  expanded.extra = true;
  assertPreviewError(() => buildDesignerDraft({ context: one.context, projects: expanded }), 'PROJECT_VALUES_INVALID');

  const symbolic = [one.projects[0]];
  symbolic[Symbol('extra')] = true;
  assertPreviewError(() => buildDesignerDraft({ context: one.context, projects: symbolic }), 'PROJECT_VALUES_INVALID');

  const customArrayPrototype = Object.create(Array.prototype);
  const prototypeArray = [one.projects[0]];
  Object.setPrototypeOf(prototypeArray, customArrayPrototype);
  assertPreviewError(() => buildDesignerDraft({ context: one.context, projects: prototypeArray }), 'PROJECT_VALUES_INVALID');
});

test('enforces Kitchen and Wardrobe selections and rejects non-applicable product values', () => {
  const kitchen = draftInput(['Kitchen']);
  const kitchenFailure = (overrides, code) => assertPreviewError(() => buildDesignerDraft({
    context: kitchen.context,
    projects: [projectValue(1, 'Kitchen', overrides)],
  }), code);
  kitchenFailure({ kitchenTypes: [] }, 'KITCHEN_TYPE_REQUIRED');
  kitchenFailure({ kitchenTypes: ['Chef', 'Chef'] }, 'KITCHEN_TYPE_REQUIRED');
  kitchenFailure({ kitchenTypes: ['-None-'] }, 'KITCHEN_TYPE_REQUIRED');
  kitchenFailure({ kitchenTypes: ['Unknown'] }, 'KITCHEN_TYPE_REQUIRED');
  kitchenFailure({ kitchenHeight: '2600' }, 'KITCHEN_HEIGHT_UNSUPPORTED');
  kitchenFailure({ island: 'Maybe' }, 'ISLAND_UNSUPPORTED');
  kitchenFailure({ gas: 'Electric' }, 'GAS_UNSUPPORTED');
  kitchenFailure({ vastu: 'Maybe' }, 'VASTU_UNSUPPORTED');
  kitchenFailure({ wardrobeTypes: ['Glass Hinged'] }, 'NON_APPLICABLE_VALUES');
  kitchenFailure({ wardrobeHeight: '8' }, 'NON_APPLICABLE_VALUES');

  const wardrobe = draftInput(['Wardrobe']);
  const wardrobeFailure = (overrides, code) => assertPreviewError(() => buildDesignerDraft({
    context: wardrobe.context,
    projects: [projectValue(1, 'Wardrobe', overrides)],
  }), code);
  wardrobeFailure({ wardrobeTypes: [] }, 'WARDROBE_TYPE_REQUIRED');
  wardrobeFailure({ wardrobeTypes: ['Solid Hinged', 'Solid Hinged'] }, 'WARDROBE_TYPE_REQUIRED');
  wardrobeFailure({ wardrobeTypes: ['-None-'] }, 'WARDROBE_TYPE_REQUIRED');
  wardrobeFailure({ wardrobeTypes: ['Sliding'] }, 'WARDROBE_TYPE_REQUIRED');
  wardrobeFailure({ wardrobeHeight: '10' }, 'WARDROBE_HEIGHT_UNSUPPORTED');
  wardrobeFailure({ kitchenTypes: ['Chef'] }, 'NON_APPLICABLE_VALUES');
  wardrobeFailure({ gas: 'Piped Gas' }, 'NON_APPLICABLE_VALUES');

  const pantry = draftInput(['Pantry']);
  assertPreviewError(() => buildDesignerDraft({
    context: pantry.context,
    projects: [projectValue(1, 'Pantry', { kitchenHeight: '2500' })],
  }), 'NON_APPLICABLE_VALUES');
  assertPreviewError(() => buildDesignerDraft({
    context: pantry.context,
    projects: [projectValue(1, 'Pantry', { wardrobeTypes: ['Glass Hinged'] })],
  }), 'NON_APPLICABLE_VALUES');
});

test('rejects malformed selection arrays without invoking accessors or accepting prototype expansion', () => {
  const kitchen = draftInput(['Kitchen']);
  const failSelection = selection => assertPreviewError(() => buildDesignerDraft({
    context: kitchen.context,
    projects: [projectValue(1, 'Kitchen', { kitchenTypes: selection })],
  }), 'KITCHEN_TYPE_REQUIRED');

  failSelection(new Array(1));
  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get: () => 'Chef' });
  accessor.length = 1;
  failSelection(accessor);
  const expanded = ['Chef'];
  expanded.extra = true;
  failSelection(expanded);
  const symbolic = ['Chef'];
  symbolic[Symbol('extra')] = true;
  failSelection(symbolic);
  const customArrayPrototype = Object.create(Array.prototype);
  const prototypeArray = ['Chef'];
  Object.setPrototypeOf(prototypeArray, customArrayPrototype);
  failSelection(prototypeArray);
});

test('validates exact presentation and theme options per product type', () => {
  const kitchen = draftInput(['Kitchen']);
  assertPreviewError(() => buildDesignerDraft({
    context: kitchen.context,
    projects: [projectValue(1, 'Kitchen', { presentation: 'Wardrobe 3D' })],
  }), 'PRESENTATION_UNSUPPORTED');
  assertPreviewError(() => buildDesignerDraft({
    context: kitchen.context,
    projects: [projectValue(1, 'Kitchen', { presentation: '-None-' })],
  }), 'PRESENTATION_UNSUPPORTED');
  assertPreviewError(() => buildDesignerDraft({
    context: kitchen.context,
    projects: [projectValue(1, 'Kitchen', { designTheme: 'Classical White' })],
  }), 'THEME_UNSUPPORTED');

  const sunrooof = draftInput(['SUNROOOF']);
  assertPreviewError(() => buildDesignerDraft({
    context: sunrooof.context,
    projects: [projectValue(1, 'SUNROOOF', { designTheme: 'Modern PG1' })],
  }), 'THEME_UNSUPPORTED');
  assertPreviewError(() => buildDesignerDraft({
    context: sunrooof.context,
    projects: [projectValue(1, 'SUNROOOF', { designTheme: '-None-' })],
  }), 'THEME_UNSUPPORTED');
});

test('rejects invalid dates, missing text, overlong text, non-string text, and control characters', () => {
  const pantry = draftInput(['Pantry']);
  const failValue = (overrides, code) => assertPreviewError(() => buildDesignerDraft({
    context: pantry.context,
    projects: [projectValue(1, 'Pantry', overrides)],
  }), code);

  failValue({ designRequiredOn: '' }, 'DESIGN_DATE_INVALID');
  failValue({ designRequiredOn: '15-09-2026' }, 'DESIGN_DATE_INVALID');
  failValue({ designRequiredOn: '2026-02-29' }, 'DESIGN_DATE_INVALID');
  failValue({ designRequiredOn: '2026-04-31' }, 'DESIGN_DATE_INVALID');
  failValue({ city: '   ' }, 'CITY_REQUIRED');
  failValue({ city: 42 }, 'CITY_REQUIRED');
  failValue({ city: 'x'.repeat(constants.limits.city + 1) }, 'CITY_REQUIRED');
  failValue({ city: 'Unsafe\u0000city' }, 'CITY_REQUIRED');
  failValue({ ceilingHeight: '' }, 'CEILING_HEIGHT_REQUIRED');
  failValue({ ceilingHeight: 'x'.repeat(constants.limits.ceilingHeight + 1) }, 'CEILING_HEIGHT_REQUIRED');
  failValue({ roomAreaName: '' }, 'ROOM_AREA_REQUIRED');
  failValue({ roomAreaName: 'x'.repeat(constants.limits.roomAreaName + 1) }, 'ROOM_AREA_REQUIRED');
  failValue({ roomAreaName: 'Unsafe\u000broom' }, 'ROOM_AREA_REQUIRED');
});

test('attaches one frozen browser global when CommonJS is unavailable', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(engineSource, sandbox, { filename: 'designer-form-preview.js' });
  assert.equal(typeof sandbox.DesignerFormPreview.createContext, 'function');
  assert.equal(typeof sandbox.DesignerFormPreview.buildDesignerDraft, 'function');
  assert.equal(Object.isFrozen(sandbox.DesignerFormPreview), true);
  const descriptor = Object.getOwnPropertyDescriptor(sandbox, 'DesignerFormPreview');
  assert.equal(descriptor.configurable, false);
  assert.equal(descriptor.enumerable, true);
  assert.equal(descriptor.writable, false);
  assert.throws(
    () => vm.runInContext(engineSource, sandbox, { filename: 'designer-form-preview.js' }),
    /namespace is unavailable/,
  );
});

test('engine contains no network, provider SDK, persistence, mutation, file, identity, dynamic-code, logging, or captured-ID capability', () => {
  const forbidden = [
    /\bfetch\b/i,
    /XMLHttpRequest/i,
    /\b(?:WebSocket|EventSource|sendBeacon)\b/i,
    /\b(?:ZOHO|ZDK)\b/i,
    /\.(?:insertRecord|updateRecord|deleteRecord|addNotes?|attachFile|uploadFile|proceed)\s*\(/i,
    /\b(?:POST|PUT|PATCH|DELETE)\b/,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/i,
    /\bdocument\.cookie\b/i,
    /\b(?:FormData|FileReader|Blob)\b/,
    /\bconsole\s*\./i,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /https?:\/\//i,
    /\b\d{18,19}\b/,
    /\b(?:Deal_Name|Contact_Name|Full_Name|Owner|Email|Phone|Mobile|recordId|entityId)\b/i,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(engineSource, pattern);
});
