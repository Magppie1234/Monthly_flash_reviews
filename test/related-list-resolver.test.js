'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRelatedListLinkFields } = require('../lib/related-list-resolver');

const lookup = (apiName, parentModule, relationName, relationId = null) => ({
  api_name: apiName,
  data_type: 'lookup',
  lookup: {
    id: relationId,
    api_name: relationName,
    module: { api_name: parentModule },
  },
});

test('related-list resolver uses the exact source lookup and never aliases sibling relationships', () => {
  const fields = [
    lookup('Opportunity_Name', 'Contacts', 'All_Orders', 'lookup-all-orders'),
    lookup('Different_Contact', 'Contacts', 'Different_Relation', 'lookup-different'),
  ];
  assert.deepEqual(resolveRelatedListLinkFields({
    parentModule: 'Contacts',
    relatedList: { id: 'lookup-all-orders', api_name: 'All_Orders', module: { api_name: 'Deals' } },
    fields,
  }), {
    available: true,
    reason_code: null,
    link_fields: ['Opportunity_Name'],
    basis: 'Exact source lookup relation',
  });

  assert.deepEqual(resolveRelatedListLinkFields({
    parentModule: 'Contacts',
    relatedList: { id: 'default-deals', api_name: 'Deals', module: { api_name: 'Deals' } },
    fields,
  }), {
    available: false,
    reason_code: 'RELATED_LINK_PATH_UNRESOLVED',
    link_fields: [],
  });
});

test('related-list resolver permits only the base polymorphic activity relation', () => {
  const fields = [
    lookup('Who_Id', 'Contacts', 'Tasks', 'contact-tasks'),
    lookup('What_Id', 'se_module', null),
  ];
  assert.deepEqual(resolveRelatedListLinkFields({
    parentModule: 'Leads',
    relatedList: { api_name: 'Tasks', module: { api_name: 'Tasks' } },
    fields,
  }).link_fields, ['What_Id']);

  assert.deepEqual(resolveRelatedListLinkFields({
    parentModule: 'Leads',
    relatedList: { api_name: 'Tasks_History', module: { api_name: 'Tasks' } },
    fields,
  }), {
    available: false,
    reason_code: 'RELATED_LINK_PATH_UNRESOLVED',
    link_fields: [],
  });

  assert.deepEqual(resolveRelatedListLinkFields({
    parentModule: 'Contacts',
    relatedList: { id: 'contact-tasks', api_name: 'Tasks', module: { api_name: 'Tasks' } },
    fields,
  }).link_fields, ['Who_Id']);
});

test('related-list resolver fails closed for incomplete metadata', () => {
  for (const relatedList of [null, {}, { api_name: 'Anything' }]) {
    const result = resolveRelatedListLinkFields({ parentModule: 'Contacts', relatedList, fields: [] });
    assert.equal(result.available, false);
    assert.equal(result.reason_code, 'RELATED_TARGET_MODULE_UNRESOLVED');
    assert.deepEqual(result.link_fields, []);
  }
});
