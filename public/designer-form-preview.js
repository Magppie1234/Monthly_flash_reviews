(function attachDesignerFormPreview(root, createPreview) {
  'use strict';

  const preview = createPreview();

  if (typeof module === 'object' && module && module.exports) {
    module.exports = preview;
    return;
  }

  if (!root || Object.prototype.hasOwnProperty.call(root, 'DesignerFormPreview')) {
    throw new Error('Designer Form preview namespace is unavailable.');
  }
  Object.defineProperty(root, 'DesignerFormPreview', {
    configurable: false,
    enumerable: true,
    value: preview,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createDesignerFormPreview() {
  'use strict';

  class DesignerFormPreviewError extends Error {
    constructor(code) {
      super('Designer Form preview input is invalid.');
      this.name = 'DesignerFormPreviewError';
      this.code = code;
    }
  }

  const LIMITS = Object.freeze({
    projects: 100,
    ceilingHeight: 64,
    city: 120,
    roomAreaName: 255,
    fieldMetadata: 20,
  });
  const CONTEXT_KEYS = Object.freeze(['fieldMetadata', 'projects']);
  const CONTEXT_PROJECT_KEYS = Object.freeze(['ordinal', 'productType']);
  const DRAFT_KEYS = Object.freeze(['context', 'projects']);
  const PROJECT_INPUT_KEYS = Object.freeze([
    'ceilingHeight',
    'city',
    'designRequiredOn',
    'designTheme',
    'gas',
    'island',
    'kitchenHeight',
    'kitchenTypes',
    'ordinal',
    'presentation',
    'roomAreaName',
    'vastu',
    'wardrobeHeight',
    'wardrobeTypes',
  ]);
  const FIELD_METADATA_KEYS = Object.freeze(['apiName', 'dataType']);
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const DISALLOWED_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  const createdContexts = new WeakSet();

  const DEFAULT_THEMES = Object.freeze([
    'Modern PG1',
    'Modern PG2',
    'Classic PG1',
    'Classic PG2',
  ]);
  const SUNROOOF_THEMES = Object.freeze([
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
  const PRESENTATIONS = Object.freeze({
    Kitchen: Object.freeze(['Kitchen 3D', 'Kitchen L & F', 'Kitchen L & F + EST', 'Kitchen EST', 'Kitchen 3D + EST']),
    Wardrobe: Object.freeze(['Wardrobe 3D', 'Wardrobe L & F', 'Wardrobe L & F + EST', 'Wardrobe EST', 'Wardrobe 3D + EST']),
    SUNROOOF: Object.freeze(['Sunrooof 3D', 'Sunrooof L & F', 'Sunrooof L & F + EST', 'Sunrooof EST', 'Sunrooof 3D + EST']),
    'Countertop / Backplash': Object.freeze(['Laundry Area 3D', 'Laundry Area L & F', 'Laundry Area L & F + EST', 'Laundry Area EST', 'Laundry Area 3D + EST']),
    Pantry: Object.freeze(['Pantry / Utility 3D', 'Pantry / Utility L & F', 'Pantry / Utility L & F + EST', 'Pantry / Utility EST', 'Pantry / Utility 3D + EST']),
  });
  const KITCHEN_TYPES = Object.freeze(['Chef', 'Show', 'Storage', 'Laundry', 'Utility']);
  const KITCHEN_HEIGHTS = Object.freeze(['2500', '2140']);
  const ISLAND_OPTIONS = Object.freeze(['No', 'Both Side Storage', 'One side storage & one side sitting']);
  const GAS_OPTIONS = Object.freeze(['Piped Gas', 'Cylinder inside kitchen', 'Cylinder outside kitchen']);
  const VASTU_OPTIONS = Object.freeze(['Yes', 'No']);
  const WARDROBE_TYPES = Object.freeze(['Glass Hinged', 'Solid Hinged']);
  const WARDROBE_HEIGHTS = Object.freeze(['8', '9']);
  const FIELD_TYPES = Object.freeze({
    Design_Presentation: 'picklist',
    Design_Theme: 'picklist',
    Finished_Kitchen_Ceiling_Height: 'textarea',
    Design_Required_on: 'date',
    city: 'text',
    Room_Area_Name: 'text',
    Any_Vastu_requirement: 'picklist',
    Gas_Arrangement: 'picklist',
    Kitchen_Type: 'multiselectpicklist',
    Kitche_Height: 'picklist',
    Island: 'picklist',
    Wardrobe_Type: 'multiselectpicklist',
    Wardrobe_Height: 'picklist',
  });
  const COMMON_FIELDS = Object.freeze([
    'Design_Presentation',
    'Design_Theme',
    'Finished_Kitchen_Ceiling_Height',
    'Design_Required_on',
    'city',
    'Room_Area_Name',
  ]);
  const KITCHEN_FIELDS = Object.freeze([
    'Any_Vastu_requirement',
    'Gas_Arrangement',
    'Kitchen_Type',
    'Kitche_Height',
    'Island',
  ]);
  const WARDROBE_FIELDS = Object.freeze(['Wardrobe_Type', 'Wardrobe_Height']);

  function fail(code) {
    throw new DesignerFormPreviewError(code);
  }

  function exactObject(value, keys, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    if (Object.getOwnPropertySymbols(value).length !== 0) fail(code);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (actual.some(key => !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) fail(code);
    return value;
  }

  function denseArray(value, maxItems, code) {
    if (
      !Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > maxItems
      || Object.getOwnPropertySymbols(value).length !== 0
    ) fail(code);
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.some(key => !Object.prototype.hasOwnProperty.call(descriptors[key], 'value'))) fail(code);
    return value;
  }

  function boundedText(value, maxLength, code, { optional = false } = {}) {
    if (value === null || value === undefined || value === '') {
      if (optional) return '';
      fail(code);
    }
    if (typeof value !== 'string') fail(code);
    const normalized = value.trim();
    if (!normalized) {
      if (optional) return '';
      fail(code);
    }
    if (normalized.length > maxLength || DISALLOWED_CONTROL.test(normalized)) fail(code);
    return normalized;
  }

  function validDate(value, code) {
    const text = boundedText(value, 10, code);
    const match = text.match(DATE);
    if (!match) fail(code);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail(code);
    return text;
  }

  function supportedOption(value, options, code, { optional = false } = {}) {
    const normalized = boundedText(value, 120, code, { optional });
    if (!normalized) return '';
    if (normalized === '-None-' || !options.includes(normalized)) fail(code);
    return normalized;
  }

  function supportedSelections(value, options, code, { required = true } = {}) {
    const values = denseArray(value, options.length, code).map(item => boundedText(item, 120, code));
    if (required && values.length === 0) fail(code);
    if (new Set(values).size !== values.length || values.some(item => item === '-None-' || !options.includes(item))) fail(code);
    return Object.freeze(values);
  }

  function normalizeFieldMetadata(value) {
    const fields = denseArray(value, LIMITS.fieldMetadata, 'FIELD_METADATA_INVALID');
    const normalized = fields.map(raw => {
      const field = exactObject(raw, FIELD_METADATA_KEYS, 'FIELD_METADATA_INVALID');
      const apiName = boundedText(field.apiName, 80, 'FIELD_METADATA_INVALID');
      const dataType = boundedText(field.dataType, 40, 'FIELD_METADATA_INVALID');
      if (!Object.prototype.hasOwnProperty.call(FIELD_TYPES, apiName) || FIELD_TYPES[apiName] !== dataType) {
        fail('FIELD_METADATA_INVALID');
      }
      return Object.freeze({ apiName, dataType });
    });
    if (new Set(normalized.map(field => field.apiName)).size !== normalized.length) fail('FIELD_METADATA_INVALID');
    return Object.freeze(normalized);
  }

  function normalizeContextProjects(value) {
    const projects = denseArray(value, LIMITS.projects, 'PROJECTS_INVALID');
    if (projects.length === 0) fail('PROJECTS_REQUIRED');
    return Object.freeze(projects.map((raw, index) => {
      const project = exactObject(raw, CONTEXT_PROJECT_KEYS, 'PROJECT_INVALID');
      if (!Number.isInteger(project.ordinal) || project.ordinal !== index + 1) fail('PROJECT_ORDINAL_INVALID');
      const productType = boundedText(project.productType, 80, 'PRODUCT_TYPE_INVALID');
      if (!Object.prototype.hasOwnProperty.call(PRESENTATIONS, productType)) fail('PRODUCT_TYPE_UNSUPPORTED');
      return Object.freeze({
        ordinal: project.ordinal,
        label: `Project ${project.ordinal}`,
        productType,
        presentationOptions: PRESENTATIONS[productType],
        themeOptions: productType === 'SUNROOOF' ? SUNROOOF_THEMES : DEFAULT_THEMES,
      });
    }));
  }

  function requiredFieldsFor(projects) {
    const required = new Set(COMMON_FIELDS);
    if (projects.some(project => project.productType === 'Kitchen')) KITCHEN_FIELDS.forEach(field => required.add(field));
    if (projects.some(project => project.productType === 'Wardrobe')) WARDROBE_FIELDS.forEach(field => required.add(field));
    return required;
  }

  function createContext(raw) {
    const input = exactObject(raw, CONTEXT_KEYS, 'CONTEXT_INVALID');
    const fieldMetadata = normalizeFieldMetadata(input.fieldMetadata);
    const projects = normalizeContextProjects(input.projects);
    const available = new Set(fieldMetadata.map(field => field.apiName));
    if ([...requiredFieldsFor(projects)].some(field => !available.has(field))) fail('REQUIRED_METADATA_MISSING');
    const context = Object.freeze({ fieldMetadata, projects });
    createdContexts.add(context);
    return context;
  }

  function emptyProductValues(input, fields, code) {
    if (fields.some(field => Array.isArray(input[field]) ? input[field].length !== 0 : input[field] !== '')) fail(code);
  }

  function buildProjectFields(input, project) {
    const presentation = supportedOption(input.presentation, project.presentationOptions, 'PRESENTATION_UNSUPPORTED');
    const designTheme = supportedOption(input.designTheme, project.themeOptions, 'THEME_UNSUPPORTED');
    const ceilingHeight = boundedText(input.ceilingHeight, LIMITS.ceilingHeight, 'CEILING_HEIGHT_REQUIRED');
    const designRequiredOn = validDate(input.designRequiredOn, 'DESIGN_DATE_INVALID');
    const city = boundedText(input.city, LIMITS.city, 'CITY_REQUIRED');
    const roomAreaName = boundedText(input.roomAreaName, LIMITS.roomAreaName, 'ROOM_AREA_REQUIRED');
    const fields = {
      Design_Presentation: presentation,
      Design_Theme: designTheme,
      Finished_Kitchen_Ceiling_Height: ceilingHeight,
      Design_Required_on: designRequiredOn,
      city,
      Room_Area_Name: roomAreaName,
    };

    if (project.productType === 'Kitchen') {
      fields.Any_Vastu_requirement = supportedOption(input.vastu, VASTU_OPTIONS, 'VASTU_UNSUPPORTED');
      fields.Gas_Arrangement = supportedOption(input.gas, GAS_OPTIONS, 'GAS_UNSUPPORTED');
      fields.Kitchen_Type = supportedSelections(input.kitchenTypes, KITCHEN_TYPES, 'KITCHEN_TYPE_REQUIRED');
      fields.Kitche_Height = supportedOption(input.kitchenHeight, KITCHEN_HEIGHTS, 'KITCHEN_HEIGHT_UNSUPPORTED');
      fields.Island = supportedOption(input.island, ISLAND_OPTIONS, 'ISLAND_UNSUPPORTED');
      emptyProductValues(input, ['wardrobeTypes', 'wardrobeHeight'], 'NON_APPLICABLE_VALUES');
    } else if (project.productType === 'Wardrobe') {
      fields.Wardrobe_Type = supportedSelections(input.wardrobeTypes, WARDROBE_TYPES, 'WARDROBE_TYPE_REQUIRED');
      fields.Wardrobe_Height = supportedOption(input.wardrobeHeight, WARDROBE_HEIGHTS, 'WARDROBE_HEIGHT_UNSUPPORTED');
      emptyProductValues(input, ['kitchenTypes', 'kitchenHeight', 'island', 'gas', 'vastu'], 'NON_APPLICABLE_VALUES');
    } else {
      emptyProductValues(input, [
        'kitchenTypes', 'kitchenHeight', 'island', 'gas', 'vastu', 'wardrobeTypes', 'wardrobeHeight',
      ], 'NON_APPLICABLE_VALUES');
    }
    return Object.freeze(fields);
  }

  function buildDesignerDraft(raw) {
    const input = exactObject(raw, DRAFT_KEYS, 'INPUT_INVALID');
    if (!createdContexts.has(input.context)) fail('CONTEXT_INVALID');
    const values = denseArray(input.projects, LIMITS.projects, 'PROJECT_VALUES_INVALID');
    if (values.length !== input.context.projects.length) fail('PROJECT_COUNT_MISMATCH');
    const projects = Object.freeze(values.map((rawProject, index) => {
      const value = exactObject(rawProject, PROJECT_INPUT_KEYS, 'PROJECT_VALUE_INVALID');
      const project = input.context.projects[index];
      if (!Number.isInteger(value.ordinal) || value.ordinal !== project.ordinal) fail('PROJECT_ORDINAL_INVALID');
      return Object.freeze({
        project_label: project.label,
        product_type: project.productType,
        fields: buildProjectFields(value, project),
      });
    }));
    return Object.freeze({
      preview_only: true,
      persistence: 'disabled',
      projects,
      blocked_actions: Object.freeze([
        'Order update',
        'Note creation',
        'Attachment upload',
        'Workflow trigger',
        'Blueprint continuation',
      ]),
    });
  }

  Object.freeze(DesignerFormPreviewError.prototype);
  Object.freeze(DesignerFormPreviewError);
  return Object.freeze({
    DesignerFormPreviewError,
    constants: Object.freeze({
      limits: LIMITS,
      fieldTypes: FIELD_TYPES,
      productTypes: Object.freeze(Object.keys(PRESENTATIONS)),
      kitchenTypes: KITCHEN_TYPES,
      kitchenHeights: KITCHEN_HEIGHTS,
      islandOptions: ISLAND_OPTIONS,
      gasOptions: GAS_OPTIONS,
      vastuOptions: VASTU_OPTIONS,
      wardrobeTypes: WARDROBE_TYPES,
      wardrobeHeights: WARDROBE_HEIGHTS,
    }),
    createContext,
    buildDesignerDraft,
  });
});
