'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LANE_DEFINITIONS,
  buildJourneyDashboard,
  buildJourneyLane,
  normalizeDrilldownValues,
  orderedActiveOptions,
} = require('../lib/journey-dashboard');

const picklistField = (apiName, labels) => ({
  api_name: apiName,
  field_label: apiName === 'Stage' ? 'Status' : 'Lead Status',
  pick_list_values: labels.map((entry, index) => ({
    type: entry.type || 'used',
    sequence_number: entry.sequence ?? index + 1,
    actual_value: entry.actual ?? entry.label,
    display_value: entry.label,
  })),
});

const leadOptions = [
  { label: '-None-' }, { label: 'Junk Lead' }, { label: 'Not Contacted Yet', actual: 'Raw' },
  { label: 'No Response/ Call Back Later', actual: 'Semi-Fresh' }, { label: 'Under Follow Up', actual: 'Propect' },
  { label: 'Qualified/ Drawings Awiated' }, { label: 'Will buy in Future', actual: 'Future Propect' },
  { label: 'Not Interested' }, { label: 'Convert' }, { label: 'Human Intervention Required(AI)' },
  { label: 'Retired option', type: 'unused' },
];

const opportunityOptions = [
  { label: '-None-' }, { label: 'Opportunity Receieved', actual: 'Option 2' },
  { label: 'Handover To Post Design' }, { label: 'Align First Measurement' },
  { label: 'Design Revision After Site Measurement' }, { label: 'Sent For Design Approval' },
  { label: 'First Dispatch Done' }, { label: 'Final Handover' },
];

test('active picklist options preserve source sequence, display text and actual-value aliases', () => {
  const field = picklistField('Lead_Status', [
    { label: 'Second', actual: 'internal-second', sequence: 2 },
    { label: 'Retired', sequence: 3, type: 'unused' },
    { label: 'First', sequence: 1 },
  ]);
  assert.deepEqual(orderedActiveOptions(field), [
    { sequence: 1, source_sequence: 1, label: 'First', match_values: ['First'] },
    { sequence: 2, source_sequence: 2, label: 'Second', match_values: ['Second', 'internal-second'] },
  ]);
});

test('journey lane keeps configured labels ordered and separates missing and legacy evidence', () => {
  const lane = buildJourneyLane({
    definition: LANE_DEFINITIONS.leads,
    fieldMetadata: picklistField('Lead_Status', leadOptions),
    aggregateRows: [
      { raw_value: 'Raw', count: 2 }, { raw_value: 'Not Contacted Yet', count: 1 },
      { raw_value: '-None-', count: 4 }, { raw_value: null, count: 3 },
      { raw_value: 'Retired option', count: 5 },
    ],
  });
  const configured = lane.phases.filter(phase => phase.kind === 'configured').flatMap(phase => phase.stages);
  assert.deepEqual(configured.map(stage => stage.label), leadOptions.filter(option => option.type !== 'unused').map(option => option.label));
  assert.equal(configured.find(stage => stage.label === 'Not Contacted Yet').count, 3);
  assert.deepEqual(configured.find(stage => stage.label === 'Not Contacted Yet').raw_values, ['Not Contacted Yet', 'Raw']);
  assert.equal(configured.find(stage => stage.label === '-None-').count, 4);
  const evidence = lane.phases.find(phase => phase.kind === 'legacy').stages;
  assert.deepEqual(evidence.map(stage => stage.label), ['Missing / no value', 'Retired option']);
  assert.equal(lane.missing_count, 3);
  assert.equal(lane.legacy_record_count, 5);
  assert.equal(lane.record_count, 15);
});

test('qualified opportunities aggregate lacs across exact display and actual values', () => {
  const lane = buildJourneyLane({
    definition: LANE_DEFINITIONS.opportunities,
    fieldMetadata: picklistField('Stage', opportunityOptions),
    aggregateRows: [
      { raw_value: 'Opportunity Receieved', count: 2, value_lacs: 80, value_count: 2 },
      { raw_value: 'Option 2', count: 1, value_lacs: 20, value_count: 1 },
      { raw_value: 'Final Handover', count: 1, value_lacs: 40, value_count: 1 },
    ],
  });
  const configured = lane.phases.flatMap(phase => phase.stages);
  const received = configured.find(stage => stage.label === 'Opportunity Receieved');
  assert.equal(received.count, 3);
  assert.equal(received.value_lacs, 100);
  assert.deepEqual(received.raw_values, ['Opportunity Receieved', 'Option 2']);
  assert.equal(lane.value_lacs, 140);
  assert.equal(lane.value_count, 4);
  assert.deepEqual(lane.phases.map(phase => phase.title), [
    'Qualification & commercial closure', 'Order setup & ownership', 'Measurement & design development',
    'Finishes & final design approval', 'Factory, production & dispatch', 'Installation & final handover',
  ]);
});

test('dashboard bridge is an explicit current-state aggregate, never a linked conversion claim', () => {
  const dashboard = buildJourneyDashboard({
    leadFields: { fields: [picklistField('Lead_Status', leadOptions)] },
    contactFields: { fields: [
      picklistField('Stage', opportunityOptions),
      { api_name: 'Total_Opportunity_Value', field_label: 'Value(₹ Lacs)', data_type: 'formula' },
    ] },
    leadRows: [
      { raw_value: 'Qualified/ Drawings Awiated', count: 6 },
      { raw_value: 'Convert', count: 2 }, { raw_value: 'Under Follow Up', count: 4 },
    ],
    contactRows: [{ raw_value: 'Opportunity Receieved', count: 3, value_lacs: 250, value_count: 3 }],
    snapshotAt: '2026-08-30T00:00:00.000Z', generatedAt: '2026-08-30T01:00:00.000Z',
    range: { from: '2026-08-01', to: '2026-08-30' },
  });
  assert.equal(dashboard.schema_version, 1);
  assert.deepEqual(dashboard.cohort, { kind: 'created_in_range', from: '2026-08-01', to: '2026-08-30' });
  assert.equal(dashboard.bridge.lead_records, 12);
  assert.equal(dashboard.bridge.leads_in_handoff_statuses, 8);
  assert.equal(dashboard.bridge.qualified_opportunity_records, 3);
  assert.equal(dashboard.bridge.linked_conversion_available, false);
  assert.equal(dashboard.lanes.opportunities.value_label, 'Value(₹ Lacs)');
  assert.equal(dashboard.lanes.opportunities.value_data_type, 'formula');
  assert.match(dashboard.caveat, /no conversion rate is inferred/i);
});

test('drilldown accepts only a bounded set of exact values', () => {
  assert.deepEqual(normalizeDrilldownValues(['Raw', 'Raw', 'Not Contacted Yet']), ['Raw', 'Not Contacted Yet']);
  assert.throws(() => normalizeDrilldownValues(['a', 'b', 'c', 'd', 'e']), /At most four/);
  assert.throws(() => normalizeDrilldownValues('x'.repeat(201)), /bounded text/);
  assert.throws(() => normalizeDrilldownValues('bad\nvalue'), /bounded text/);
});
