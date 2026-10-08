'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ValidationError, validatePayload } = require('../lib/crm-validation');
const { LayoutSchemaError, mergeLayoutFields, resolveLayout } = require('../lib/layout-schema');

const contactFields = [
  { api_name: 'Last_Name', field_label: 'Last Name', data_type: 'text', system_mandatory: true },
  { api_name: 'Product_Details1', field_label: 'Product Detail', data_type: 'subform', system_mandatory: false, virtual_field: true },
  { api_name: 'Date_of_Birth', field_label: 'Date of Birth', data_type: 'date', system_mandatory: false },
];

const developerLayout = {
  id: '1032257000005515301', name: 'Developer/Pro-Retail', visible: true, status: 'active',
  sections: [{ fields: [
    { api_name: 'Last_Name', field_label: 'Last Name', data_type: 'text', required: true },
  ] }],
};

const standardLayout = {
  id: '1032257000000000171', name: 'Standard', visible: true, status: 'active',
  sections: [{ isSubformSection: true, fields: [
    { api_name: 'Last_Name', field_label: 'Last Name', data_type: 'text', required: true },
    { api_name: 'Product_Details1', field_label: 'Product Detail', data_type: 'subform', required: true, virtual_field: false },
    { api_name: 'Date_of_Birth', field_label: 'Date of Birth', data_type: 'date', required: false },
  ] }],
};

test('resolves a stored or explicitly selected layout but does not guess among multiple layouts', () => {
  const layouts = { layouts: [developerLayout, standardLayout] };
  assert.equal(resolveLayout(layouts, { record: { Layout: { id: standardLayout.id } } }).layout.name, 'Standard');
  assert.equal(resolveLayout(layouts, { layoutId: developerLayout.id }).layout.name, 'Developer/Pro-Retail');
  assert.deepEqual(resolveLayout(layouts).reason, 'ambiguous_layout');
  assert.deepEqual(resolveLayout({ layouts: [standardLayout] }).source, 'only_active_layout');
});

test('standard Contacts layout makes Product_Details1 required while Developer/Pro-Retail excludes it', () => {
  const standardFields = mergeLayoutFields(contactFields, standardLayout);
  const developerFields = mergeLayoutFields(contactFields, developerLayout);
  assert.equal(standardFields.find(field => field.api_name === 'Product_Details1').required, true);
  assert.equal(standardFields.find(field => field.api_name === 'Product_Details1').virtual_field, true);
  assert.equal(developerFields.find(field => field.api_name === 'Product_Details1'), undefined);

  assert.throws(
    () => validatePayload(standardFields, { Last_Name: 'Example' }, { isCreate: true }),
    error => error instanceof ValidationError && error.errors.some(item => item.field === 'Product_Details1' && item.code === 'required'),
  );
  assert.doesNotThrow(() => validatePayload(developerFields, { Last_Name: 'Example' }, { isCreate: true }));
});

test('Developer/Pro-Retail rejects writable Contacts fields that are absent from that layout', () => {
  const fields = mergeLayoutFields(contactFields, developerLayout);
  assert.deepEqual(fields.map(field => field.api_name), ['Last_Name']);
  assert.throws(
    () => validatePayload(fields, { Last_Name: 'Example', Date_of_Birth: '1990-01-01' }, { isCreate: true }),
    error => error instanceof ValidationError && error.errors.some(item => item.field === 'Date_of_Birth' && item.code === 'unknown_field'),
  );
  assert.throws(
    () => validatePayload(fields, { Last_Name: 'Example', Product_Details1: [] }),
    error => error instanceof ValidationError && error.errors.some(item => item.field === 'Product_Details1' && item.code === 'unknown_field'),
  );
});

test('required virtual subform cannot be bypassed with invented inline values', () => {
  const fields = mergeLayoutFields(contactFields, standardLayout);
  assert.throws(
    () => validatePayload(fields, { Last_Name: 'Example', Product_Details1: [{ Product: 'SUNROOOF' }] }, { isCreate: true }),
    error => error instanceof ValidationError && error.errors.some(item => item.field === 'Product_Details1' && item.code === 'read_only'),
  );
});

test('a writable subform, when configured, must contain structured rows', () => {
  const fields = [{ api_name: 'Rows', field_label: 'Rows', data_type: 'subform', required: true, virtual_field: false }];
  assert.doesNotThrow(() => validatePayload(fields, { Rows: [{ Name: 'Real row' }] }, { isCreate: true }));
  assert.throws(
    () => validatePayload(fields, { Rows: 'placeholder' }, { isCreate: true }),
    error => error instanceof ValidationError && error.errors.some(item => item.field === 'Rows' && item.code === 'invalid_subform'),
  );
});

test('resolved-layout validation fails closed when layout or module field metadata is incomplete', () => {
  assert.throws(
    () => mergeLayoutFields(contactFields, { ...developerLayout, sections: [] }),
    error => error instanceof LayoutSchemaError && error.code === 'LAYOUT_METADATA_INCOMPLETE' && error.details.reason === 'layout_sections_unavailable',
  );
  assert.throws(
    () => mergeLayoutFields(contactFields, {
      ...developerLayout,
      sections: [{ fields: [{ api_name: 'Missing_From_Module_Metadata', data_type: 'text' }] }],
    }),
    error => error instanceof LayoutSchemaError && error.code === 'LAYOUT_METADATA_INCOMPLETE' && error.details.reason === 'module_fields_unavailable',
  );
});

test('single AMS/Complaints layout makes Record_Type required without inventing complaint values', () => {
  const fields = [
    { api_name: 'Name', field_label: 'Name', data_type: 'text', system_mandatory: true },
    { api_name: 'Record_Type', field_label: 'Record Type', data_type: 'picklist', system_mandatory: false, pick_list_values: [
      { actual_value: 'AMS', display_value: 'AMS' },
      { actual_value: 'Complaint', display_value: 'Complaint' },
    ] },
    { api_name: 'Complaint_From', field_label: 'Complaint From', data_type: 'picklist', system_mandatory: false },
  ];
  const layout = { id: '1032257000023545362', name: 'Standard', sections: [{ fields: [
    { api_name: 'Name', field_label: 'Name', data_type: 'text', required: true },
    { api_name: 'Record_Type', field_label: 'Record Type', data_type: 'picklist', required: true },
    { api_name: 'Complaint_From', field_label: 'Complaint From', data_type: 'picklist', required: false },
  ] }] };
  const merged = mergeLayoutFields(fields, layout);
  assert.throws(
    () => validatePayload(merged, { Name: 'Example' }, { isCreate: true }),
    error => error instanceof ValidationError && error.errors.some(item => item.field === 'Record_Type' && item.code === 'required') && !error.errors.some(item => item.field === 'Complaint_From'),
  );
  assert.doesNotThrow(() => validatePayload(merged, { Name: 'Example', Record_Type: 'AMS' }, { isCreate: true }));
});
