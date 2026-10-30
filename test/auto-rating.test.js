'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { rate, rateItems, RULES } = require('../lib/auto-rating');
const { constants } = require('../public/flash-review.js');

test('every rule names a real Work row', () => {
  const work = new Set(Object.values(constants.ROLE_CONFIGS).flatMap(config => config.workItems.map(item => item.id)));
  for (const id of Object.keys(RULES)) assert.ok(work.has(id), id);
});

test('higher-is-better percentages: Below under target, Meets at target, Above at the stretch level', () => {
  assert.equal(rate({ id: 'sm_w9', value: '94%' }, {}).value, 'below');
  assert.equal(rate({ id: 'sm_w9', value: '95%' }, {}).value, 'meets');
  assert.equal(rate({ id: 'sm_w9', value: '99%' }, {}).value, 'above');
  assert.equal(rate({ id: 'sm_w9', value: '95%' }, {}).basis, 'Meets at ≥ 95%, Above at ≥ 99%');
  // a 100% target has no Above
  assert.equal(rate({ id: 'sm_w7', value: '100%' }, {}).value, 'meets');
});

test('lower-is-better rows: zero discount incidents, and installation days', () => {
  assert.equal(rate({ id: 'sm_w4', value: '0' }, {}).value, 'meets');
  assert.equal(rate({ id: 'sm_w4', value: '2' }, {}).value, 'below');
  assert.equal(rate({ id: 'installation_manager_v2_w1', value: '6.0 days' }, {}).value, 'meets');
  assert.equal(rate({ id: 'installation_manager_v2_w1', value: '4.5 days' }, {}).value, 'above');
  assert.equal(rate({ id: 'installation_manager_v2_w1', value: '8.0 days' }, {}).value, 'below');
});

test('booking value is judged against the designation target, and meetings per Sales Manager', () => {
  assert.equal(rate({ id: 'sm_w6', value: '₹1.15 Cr', crore: 1.15 }, { policy: 'sales_manager' }).value, 'below');
  assert.equal(rate({ id: 'sm_w6', value: '₹3.40 Cr', crore: 3.4 }, { policy: 'sales_manager' }).value, 'above');
  assert.equal(rate({ id: 'asm_w8', value: '₹1.50 Cr', crore: 1.5 }, { policy: 'asm' }).value, 'meets');
  const team = [{ role: 'sales_manager' }, { role: 'sales_manager' }, { role: 'asm' }];
  assert.equal(rate({ id: 'avp_w15', value: '21' }, { team }).value, 'meets');
  assert.equal(rate({ id: 'avp_w15', value: '19' }, { team }).value, 'below');
  assert.equal(rate({ id: 'avp_w15', value: '21' }, { team: [] }), null);
});

test('no mark without a rule, a figure, or on a figure that carries a warning', () => {
  assert.equal(rate({ id: 'sm_w2', value: '4' }, {}), null);
  assert.equal(rate({ id: 'sm_w9', value: null }, {}), null);
  assert.equal(rate({ id: 'avp_w14', value: '100%', warning: 'Based on 6 of 10 records.' }, {}), null);
  const items = rateItems([{ id: 'sm_w9', value: '96%' }, { id: 'sm_w2', value: '4' }], {});
  assert.deepEqual(items.map(item => item.rating?.value ?? null), ['meets', null]);
});
