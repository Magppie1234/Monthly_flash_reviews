'use strict';

// Presentation groupings for the active source picklists. The stage labels and
// their order always come from current field metadata; these boundaries only
// divide that ordered inventory into readable operating phases.
const LEAD_PHASES = Object.freeze([
  Object.freeze({
    id: 'lead-intake',
    title: 'Intake & first contact',
    description: 'New, unworked and first-contact outcomes.',
    endLabel: 'No Response/ Call Back Later',
  }),
  Object.freeze({
    id: 'lead-qualification',
    title: 'Qualification & nurture',
    description: 'Leads being assessed, followed up or held for future demand.',
    endLabel: 'Will buy in Future',
  }),
  Object.freeze({
    id: 'lead-resolution',
    title: 'Resolution & handoff',
    description: 'Closed lead outcomes, qualification and escalation.',
    endLabel: null,
  }),
]);

const OPPORTUNITY_PHASES = Object.freeze([
  Object.freeze({
    id: 'opportunity-commercial',
    title: 'Qualification & commercial closure',
    description: 'From opportunity receipt through commercial agreement and post-design handoff.',
    endLabel: 'Handover To Post Design',
  }),
  Object.freeze({
    id: 'opportunity-order-setup',
    title: 'Order setup & ownership',
    description: 'Order validation, team assignment and first-measurement coordination.',
    endLabel: 'Align First Measurement',
  }),
  Object.freeze({
    id: 'opportunity-measurement-design',
    title: 'Measurement & design development',
    description: 'Site measurements, design revisions and technical drawing preparation.',
    endLabel: 'Design Revision After Site Measurement',
  }),
  Object.freeze({
    id: 'opportunity-finishes-approval',
    title: 'Finishes & final design approval',
    description: 'Selections, 3D work, sign-off documentation and client approval.',
    endLabel: 'Sent For Design Approval',
  }),
  Object.freeze({
    id: 'opportunity-production-dispatch',
    title: 'Factory, production & dispatch',
    description: 'Factory handoff, procurement, production readiness, PDI and first dispatch.',
    endLabel: 'First Dispatch Done',
  }),
  Object.freeze({
    id: 'opportunity-installation-handover',
    title: 'Installation & final handover',
    description: 'Installation cycles, final client handover and complaint material closure.',
    endLabel: null,
  }),
]);

const LANE_DEFINITIONS = Object.freeze({
  leads: Object.freeze({
    key: 'leads',
    module: 'Leads',
    field: 'Lead_Status',
    fieldLabel: 'Lead Status',
    title: 'Lead Statuses',
    phases: LEAD_PHASES,
    valueField: null,
  }),
  opportunities: Object.freeze({
    key: 'opportunities',
    module: 'Contacts',
    field: 'Stage',
    fieldLabel: 'Status',
    title: 'Qualified Opportunity Stages',
    phases: OPPORTUNITY_PHASES,
    valueField: 'Total_Opportunity_Value',
    valueLabel: 'Value (₹ Lacs)',
    valueUnit: 'lacs',
  }),
});

const HANDOFF_LABELS = new Set(['Qualified/ Drawings Awiated', 'Convert']);

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderedActiveOptions(fieldMetadata) {
  const values = Array.isArray(fieldMetadata?.pick_list_values) ? fieldMetadata.pick_list_values : [];
  return values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value && value.type !== 'unused')
    .sort((left, right) => {
      const a = finiteNumber(left.value.sequence_number) || left.index + 1;
      const b = finiteNumber(right.value.sequence_number) || right.index + 1;
      return a - b || left.index - right.index;
    })
    .map(({ value }, index) => {
      const actualValue = String(value.actual_value ?? value.display_value ?? '').trim();
      const displayValue = String(value.display_value ?? value.actual_value ?? '').trim();
      return {
        sequence: index + 1,
        source_sequence: finiteNumber(value.sequence_number) || index + 1,
        label: displayValue || actualValue || '(unnamed configured value)',
        match_values: [...new Set([displayValue, actualValue].filter(Boolean))],
      };
    });
}

function normalizeAggregateRows(rows) {
  const byRawValue = new Map();
  let missing = { raw_value: null, count: 0, value_lacs: 0, value_count: 0, invalid_value_count: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = row?.raw_value;
    const aggregate = {
      raw_value: raw === null || raw === undefined ? null : String(raw),
      count: Math.max(0, finiteNumber(row?.count ?? row?.cnt)),
      value_lacs: finiteNumber(row?.value_lacs),
      value_count: Math.max(0, finiteNumber(row?.value_count)),
      invalid_value_count: Math.max(0, finiteNumber(row?.invalid_value_count)),
    };
    if (!aggregate.raw_value || !aggregate.raw_value.trim()) {
      missing = {
        raw_value: null,
        count: missing.count + aggregate.count,
        value_lacs: missing.value_lacs + aggregate.value_lacs,
        value_count: missing.value_count + aggregate.value_count,
        invalid_value_count: missing.invalid_value_count + aggregate.invalid_value_count,
      };
      continue;
    }
    const previous = byRawValue.get(aggregate.raw_value);
    byRawValue.set(aggregate.raw_value, previous ? {
      ...aggregate,
      count: previous.count + aggregate.count,
      value_lacs: previous.value_lacs + aggregate.value_lacs,
      value_count: previous.value_count + aggregate.value_count,
      invalid_value_count: previous.invalid_value_count + aggregate.invalid_value_count,
    } : aggregate);
  }
  return { byRawValue, missing };
}

function aggregateStage(option, byRawValue, consumed) {
  const matches = option.match_values.filter(value => byRawValue.has(value));
  const aggregate = matches.reduce((sum, value) => {
    consumed.add(value);
    const row = byRawValue.get(value);
    sum.count += row.count;
    sum.value_lacs += row.value_lacs;
    sum.value_count += row.value_count;
    sum.invalid_value_count += row.invalid_value_count;
    return sum;
  }, { count: 0, value_lacs: 0, value_count: 0, invalid_value_count: 0 });
  return {
    key: `configured-${option.sequence}`,
    kind: 'configured',
    configured: true,
    missing: false,
    sequence: option.sequence,
    source_sequence: option.source_sequence,
    label: option.label,
    raw_values: matches,
    ...aggregate,
  };
}

function groupConfiguredStages(stages, phaseDefinitions) {
  let cursor = 0;
  return phaseDefinitions.map((phase, index) => {
    let end = stages.length;
    if (phase.endLabel) {
      const boundary = stages.findIndex((stage, stageIndex) => stageIndex >= cursor && stage.label === phase.endLabel);
      if (boundary >= cursor) end = boundary + 1;
      else if (index < phaseDefinitions.length - 1) end = cursor;
    }
    const phaseStages = stages.slice(cursor, end);
    cursor = end;
    return {
      id: phase.id,
      title: phase.title,
      description: phase.description,
      kind: 'configured',
      count: phaseStages.reduce((sum, stage) => sum + stage.count, 0),
      value_lacs: phaseStages.reduce((sum, stage) => sum + stage.value_lacs, 0),
      stages: phaseStages,
    };
  });
}

function buildJourneyLane({ definition, fieldMetadata, aggregateRows }) {
  if (!definition) throw new Error('Journey lane definition is required.');
  const options = orderedActiveOptions(fieldMetadata);
  const { byRawValue, missing } = normalizeAggregateRows(aggregateRows);
  const consumed = new Set();
  const configuredStages = options.map(option => aggregateStage(option, byRawValue, consumed));
  const legacyStages = [...byRawValue.values()]
    .filter(row => !consumed.has(row.raw_value))
    .sort((left, right) => left.raw_value.localeCompare(right.raw_value, 'en-IN'))
    .map((row, index) => ({
      key: `legacy-${index + 1}`,
      kind: 'legacy',
      configured: false,
      missing: false,
      sequence: configuredStages.length + index + 1,
      source_sequence: null,
      label: row.raw_value,
      raw_values: [row.raw_value],
      count: row.count,
      value_lacs: row.value_lacs,
      value_count: row.value_count,
      invalid_value_count: row.invalid_value_count,
    }));
  const unconfiguredStages = [];
  if (missing.count > 0) {
    unconfiguredStages.push({
      key: 'missing',
      kind: 'missing',
      configured: false,
      missing: true,
      sequence: configuredStages.length + 1,
      source_sequence: null,
      label: 'Missing / no value',
      raw_values: [],
      count: missing.count,
      value_lacs: missing.value_lacs,
      value_count: missing.value_count,
      invalid_value_count: missing.invalid_value_count,
    });
  }
  unconfiguredStages.push(...legacyStages);

  const phases = groupConfiguredStages(configuredStages, definition.phases);
  if (unconfiguredStages.length) {
    phases.push({
      id: `${definition.key}-legacy`,
      title: 'Missing or legacy labels observed',
      description: 'Values present on local records but not represented by an active configured picklist label.',
      kind: 'legacy',
      count: unconfiguredStages.reduce((sum, stage) => sum + stage.count, 0),
      value_lacs: unconfiguredStages.reduce((sum, stage) => sum + stage.value_lacs, 0),
      stages: unconfiguredStages,
    });
  }

  const allStages = [...configuredStages, ...unconfiguredStages];
  return {
    key: definition.key,
    module: definition.module,
    field: definition.field,
    field_label: fieldMetadata?.field_label || definition.fieldLabel,
    title: definition.title,
    value_field: definition.valueField,
    value_label: definition.valueLabel || null,
    value_unit: definition.valueUnit || null,
    configured_count: configuredStages.length,
    configured_observed_count: configuredStages.filter(stage => stage.count > 0).length,
    observed_count: allStages.filter(stage => stage.count > 0).length,
    empty_count: configuredStages.filter(stage => stage.count === 0).length,
    record_count: allStages.reduce((sum, stage) => sum + stage.count, 0),
    value_lacs: allStages.reduce((sum, stage) => sum + stage.value_lacs, 0),
    value_count: allStages.reduce((sum, stage) => sum + stage.value_count, 0),
    invalid_value_count: allStages.reduce((sum, stage) => sum + stage.invalid_value_count, 0),
    missing_count: missing.count,
    legacy_record_count: legacyStages.reduce((sum, stage) => sum + stage.count, 0),
    phases,
  };
}

function findField(fieldsMetadata, apiName) {
  return (Array.isArray(fieldsMetadata?.fields) ? fieldsMetadata.fields : [])
    .find(field => field?.api_name === apiName) || null;
}

function buildJourneyDashboard({ leadFields, contactFields, leadRows, contactRows, snapshotAt, generatedAt, range = null }) {
  const leads = buildJourneyLane({
    definition: LANE_DEFINITIONS.leads,
    fieldMetadata: findField(leadFields, LANE_DEFINITIONS.leads.field),
    aggregateRows: leadRows,
  });
  const opportunities = buildJourneyLane({
    definition: LANE_DEFINITIONS.opportunities,
    fieldMetadata: findField(contactFields, LANE_DEFINITIONS.opportunities.field),
    aggregateRows: contactRows,
  });
  const opportunityValueField = findField(contactFields, LANE_DEFINITIONS.opportunities.valueField);
  opportunities.value_label = opportunityValueField?.field_label || opportunities.value_label;
  opportunities.value_data_type = opportunityValueField?.data_type || null;
  const handoffLeadCount = leads.phases
    .flatMap(phase => phase.stages)
    .filter(stage => HANDOFF_LABELS.has(stage.label))
    .reduce((sum, stage) => sum + stage.count, 0);
  return {
    schema_version: 1,
    source: {
      database: 'Local CRM replica',
      upstream_boundary: 'Zoho CRM read-only replication',
      snapshot_at: snapshotAt || null,
      recomputed_at: generatedAt,
    },
    cohort: range ? { kind: 'created_in_range', from: range.from, to: range.to } : { kind: 'all_records' },
    bridge: {
      lead_records: leads.record_count,
      leads_in_handoff_statuses: handoffLeadCount,
      qualified_opportunity_records: opportunities.record_count,
      linked_conversion_available: false,
    },
    caveat: 'Counts show each record\'s current Lead_Status or Contacts.Stage within the selected creation-date cohort. Lead-to-opportunity linkage is not retained, so no conversion rate is inferred.',
    lanes: { leads, opportunities },
  };
}

function normalizeDrilldownValues(value) {
  const values = Array.isArray(value) ? value : (value === undefined ? [] : [value]);
  if (values.length > 4) throw new Error('At most four exact values may be requested.');
  const normalized = values.map(item => String(item));
  if (normalized.some(item => !item.length || item.length > 200 || /[\u0000-\u001f\u007f]/.test(item))) {
    throw new Error('Journey drilldown values must be non-empty bounded text without control characters.');
  }
  return [...new Set(normalized)];
}

module.exports = {
  HANDOFF_LABELS,
  LANE_DEFINITIONS,
  LEAD_PHASES,
  OPPORTUNITY_PHASES,
  buildJourneyDashboard,
  buildJourneyLane,
  normalizeDrilldownValues,
  orderedActiveOptions,
};
