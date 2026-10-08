'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AnalyticsInputError,
  AnalyticsSourceError,
  EXPECTED_META_KEYS,
  MAX_WINDOW_DAYS,
  PERIOD_COMPARISON_METRICS,
  buildAnalyticsOverview,
  buildAnalyticsOverviewQueryPlan,
  createAnalyticsOverviewService,
  isRetryableAnalyticsStatementTimeout,
  normalizeAnalyticsOverviewRequest,
} = require('../lib/crm-analytics-overview');

const NOW = new Date('2026-08-30T05:30:00.000Z');

function request(overrides = {}) {
  return {
    from: '2026-08-01',
    to: '2026-08-30',
    as_of: '2026-08-30',
    days: 30,
    time_zone: 'Asia/Kolkata',
    defaulted: false,
    ...overrides,
  };
}

function metadataRows(overrides = {}) {
  return EXPECTED_META_KEYS.map(key => ({
    key,
    available: true,
    required_fields_available: true,
    updated_at: '2026-08-30T05:20:00.000Z',
    ...(overrides[key] || {}),
  }));
}

function baseRaw(overrides = {}) {
  return {
    module_totals: [
      { module: 'Leads', count: 10, missing_created_time: 0, missing_modified_time: 0 },
      { module: 'Contacts', count: 4, missing_created_time: 0, missing_modified_time: 0 },
      { module: 'Deals', count: 2, missing_created_time: 0, missing_modified_time: 0 },
      { module: 'Tasks', count: 5, missing_created_time: 0, missing_modified_time: 0 },
      { module: 'Calls', count: 3, missing_created_time: 0, missing_modified_time: 0 },
      { module: 'Events', count: 2, missing_created_time: 0, missing_modified_time: 0 },
    ],
    range_created: [
      { module: 'Leads', count: 3, previous_count: 2 }, { module: 'Contacts', count: 2, previous_count: 1 },
      { module: 'Deals', count: 1, previous_count: 0 }, { module: 'Tasks', count: 1, previous_count: 2 },
      { module: 'Calls', count: 0, previous_count: 1 }, { module: 'Events', count: 0, previous_count: 0 },
    ],
    current_stage_mix: [
      { module: 'Leads', value: 'Not Contacted Yet', count: 6 },
      { module: 'Leads', value: 'Qualified/ Drawings Awiated', count: 4 },
      { module: 'Contacts', value: 'Opportunity Receieved', count: 4 },
      { module: 'Deals', value: 'Installation', count: 2 },
    ],
    cohort_stage_mix: [
      { module: 'Leads', value: 'Not Contacted Yet', count: 2 },
      { module: 'Leads', value: 'Qualified/ Drawings Awiated', count: 1 },
      { module: 'Contacts', value: 'Opportunity Receieved', count: 2 },
      { module: 'Deals', value: 'Installation', count: 1 },
    ],
    activity_daily: [
      { module: 'Calls', day: '2026-08-29', count: 2 },
      { module: 'Calls', day: '2026-08-30', count: 1 },
      { module: 'Events', day: '2026-08-30', count: 2 },
    ],
    activity_totals: [
      { module: 'Calls', count: 3, previous_count: 4 },
      { module: 'Events', count: 2, previous_count: 1 },
    ],
    activity_quality: [
      { module: 'Calls', missing_activity_time: 0, malformed_activity_time: 0 },
      { module: 'Events', missing_activity_time: 0, malformed_activity_time: 0 },
    ],
    task_summary: {
      total: 5,
      open: 3,
      completed: 2,
      due_today: 1,
      overdue: 1,
      open_missing_or_malformed_due_date: 0,
    },
    task_status_mix: [{ value: 'Completed', count: 2 }, { value: 'Not Started', count: 3 }],
    excluded_test_artifacts: [
      { module: 'Leads', count: 0 }, { module: 'Contacts', count: 0 },
      { module: 'Deals', count: 0 }, { module: 'Tasks', count: 1 },
      { module: 'Calls', count: 0 }, { module: 'Events', count: 0 },
    ],
    metadata_coverage: metadataRows(),
    source_sync: {
      snapshot_at: '2026-08-30T05:20:00.000Z',
      metadata_updated_at: '2026-08-30T05:21:00.000Z',
    },
    ...overrides,
  };
}

test('request defaults to the latest 30 CRM calendar days in Asia/Kolkata', () => {
  const normalized = normalizeAnalyticsOverviewRequest({}, { now: new Date('2026-08-29T20:00:00.000Z') });
  assert.deepEqual(normalized, {
    from: '2026-08-01',
    to: '2026-08-30',
    as_of: '2026-08-30',
    days: 30,
    time_zone: 'Asia/Kolkata',
    defaulted: true,
  });
});

test('request validates both endpoints, calendar dates, order, future dates and range bound', () => {
  const options = { now: NOW };
  assert.throws(() => normalizeAnalyticsOverviewRequest({ from: '2026-08-01' }, options), AnalyticsInputError);
  assert.throws(
    () => normalizeAnalyticsOverviewRequest({ from: '2026-08-01', to: '2026-08-30', owner: 'someone' }, options),
    error => error.code === 'UNSUPPORTED_ANALYTICS_FILTER',
  );
  assert.throws(() => normalizeAnalyticsOverviewRequest({ from: '2026-02-30', to: '2026-03-01' }, options), /valid calendar date/);
  assert.throws(() => normalizeAnalyticsOverviewRequest({ from: '2026-08-30', to: '2026-08-01' }, options), /on or before/);
  assert.throws(() => normalizeAnalyticsOverviewRequest({ from: '2026-08-01', to: '2026-08-31' }, options), /later than/);
  assert.throws(
    () => normalizeAnalyticsOverviewRequest({ from: '2025-08-29', to: '2026-08-30' }, options),
    error => error.code === 'ANALYTICS_RANGE_TOO_LARGE',
  );
  const maximum = normalizeAnalyticsOverviewRequest({ from: '2025-08-30', to: '2026-08-30' }, options);
  assert.equal(maximum.days, MAX_WINDOW_DAYS);
  const maximumPlan = buildAnalyticsOverviewQueryPlan(maximum);
  assert.deepEqual(maximumPlan.comparison_date_range, {
    from: '2024-08-29', to: '2025-08-29', days: 366, time_zone: 'Asia/Kolkata',
  });
});

test('query plan is a single bounded SELECT-only aggregate over approved local tables', () => {
  const plan = buildAnalyticsOverviewQueryPlan(request());
  assert.equal(plan.read_only, true);
  assert.equal(plan.output_grain, 'aggregate-only');
  assert.equal(plan.customer_rows_or_identifiers, false);
  assert.deepEqual(plan.source_tables, ['crm_records', 'crm_meta']);
  assert.match(plan.statement, /^with bounds as/i);
  assert.match(plan.statement, /from crm_records/i);
  assert.match(plan.statement, /join crm_meta/i);
  assert.match(plan.statement, /excluded_records as materialized/);
  assert.match(plan.statement, /record_metrics as materialized/);
  assert.match(plan.statement, /module_metrics as materialized/);
  assert.match(plan.statement, /status_metrics as materialized/);
  assert.match(plan.statement, /activity_metrics as materialized/);
  assert.deepEqual(plan.comparison_date_range, {
    from: '2026-07-02', to: '2026-07-31', days: 30, time_zone: 'Asia/Kolkata',
  });
  assert.match(plan.statement, /'2026-07-02'::date as previous_from_day/);
  assert.match(plan.statement, /'2026-07-31'::date as previous_to_day/);
  assert.match(plan.statement, /created_time[\s\S]*previous_from_day[\s\S]*previous_to_day/);
  assert.match(plan.statement, /r\.ts2[\s\S]*previous_from_day[\s\S]*previous_to_day/);
  assert.match(plan.statement, /previous_cohort_count/);
  assert.match(plan.statement, /previous_activity_count/);
  assert.match(plan.statement, /previous_range_count/);
  assert.match(plan.statement, /previous_count/);
  assert.doesNotMatch(plan.statement, /pipeline_metrics as materialized|task_metrics as materialized/);
  assert.match(plan.statement, /id >= 'local-' and id < 'local\.'[\s\S]*coalesce\(data->>'__test_artifact', 'false'\) = 'true'/);
  assert.equal((plan.statement.match(/from crm_records/gi) || []).length, 2);
  assert.doesNotMatch(plan.statement, /scoped as not materialized/);
  assert.doesNotMatch(plan.statement, /\b(insert|update|delete|alter|drop|truncate|execute)\b/i);
  assert.doesNotMatch(plan.statement, /\bcrm_secret\b|\bcrm_audit\b/i);
  assert.doesNotMatch(plan.statement, /\b(name|owner|email|phone|record_id)\b/i);
  assert.doesNotMatch(plan.statement, /select\s+(?:\w+\.)?data\b/i);
  assert.equal(plan.statement.includes(';'), false);
});

test('query plan revalidates normalized-looking input instead of interpolating it', () => {
  assert.throws(() => buildAnalyticsOverviewQueryPlan({ ...request(), from: "2026-08-01' or true" }), AnalyticsInputError);
  assert.throws(() => buildAnalyticsOverviewQueryPlan({ ...request(), days: 29 }), /day count is inconsistent/);
  assert.throws(() => buildAnalyticsOverviewQueryPlan({ ...request(), time_zone: 'UTC' }), /Asia\/Kolkata/);
});

test('read-only SQL guard rejects unapproved relations even when approved table names are also present', () => {
  const { assertReadOnlyAnalyticsSql } = require('../lib/crm-analytics-overview');
  assert.throws(
    () => assertReadOnlyAnalyticsSql('with x as (select * from users), y as (select * from crm_records), z as (select * from crm_meta) select * from x'),
    /unapproved relation/,
  );
});

test('overview exposes decision metrics, aggregate datasets, freshness and explicit non-conversion semantics', () => {
  const overview = buildAnalyticsOverview(baseRaw(), request(), { generatedAt: NOW.toISOString() });
  assert.equal(overview.schema_version, 1);
  assert.equal(overview.generated_at, NOW.toISOString());
  assert.equal(overview.source.query_mode, 'local-read-only');
  assert.equal(overview.source.output_grain, 'aggregate-only');
  assert.equal(overview.source.customer_rows_or_identifiers, false);
  assert.equal(overview.source.query_attempts, 1);
  assert.equal(overview.source.freshness.status, 'fresh');
  assert.equal(overview.source.freshness.age_minutes, 10);
  assert.deepEqual(overview.date_range, {
    from: '2026-08-01', to: '2026-08-30', days: 30, time_zone: 'Asia/Kolkata', defaulted: false,
    created_record_semantics: 'created_time inside the inclusive CRM calendar-date range',
    activity_semantics: 'Call_Start_Time or Event Start_DateTime inside the inclusive CRM calendar-date range',
    task_semantics: 'current Task status and due date as of 2026-08-30',
    comparison_period: {
      from: '2026-07-02', to: '2026-07-31', days: 30, time_zone: 'Asia/Kolkata',
    },
  });
  assert.equal(overview.hero_metrics.find(metric => metric.id === 'leads_created').value, 3);
  assert.equal(overview.hero_metrics.find(metric => metric.id === 'qualified_opportunities_created').value, 2);
  assert.equal(overview.hero_metrics.find(metric => metric.id === 'calls_logged').value, 3);
  assert.equal(overview.hero_metrics.find(metric => metric.id === 'overdue_tasks').value, 1);
  assert.equal(overview.datasets.pipeline_stage_mix.find(lane => lane.module === 'Leads').record_count, 10);
  assert.equal(overview.datasets.activity_daily.length, 30);
  assert.deepEqual(overview.datasets.activity_daily.at(-1), { date: '2026-08-30', calls: 1, events: 2 });
  assert.equal(overview.datasets.task_summary.open, 3);
  assert.deepEqual(overview.datasets.period_comparison, [
    {
      id: 'leads_created', label: 'Leads created', module: 'Leads', source_field: 'Created_Time',
      current_count: 3, previous_count: 2, absolute_change: 1, percentage_change: 50,
      availability: 'available', data_status: 'Available',
    },
    {
      id: 'qualified_opportunities_created', label: 'Qualified opportunities created', module: 'Contacts', source_field: 'Created_Time',
      current_count: 2, previous_count: 1, absolute_change: 1, percentage_change: 100,
      availability: 'available', data_status: 'Available',
    },
    {
      id: 'deals_created', label: 'Deals created', module: 'Deals', source_field: 'Created_Time',
      current_count: 1, previous_count: 0, absolute_change: 1, percentage_change: null,
      availability: 'available', data_status: 'Available',
    },
    {
      id: 'calls_logged', label: 'Calls logged', module: 'Calls', source_field: 'Call_Start_Time',
      current_count: 3, previous_count: 4, absolute_change: -1, percentage_change: -25,
      availability: 'available', data_status: 'Available',
    },
    {
      id: 'events_logged', label: 'Events logged', module: 'Events', source_field: 'Start_DateTime',
      current_count: 2, previous_count: 1, absolute_change: 1, percentage_change: 100,
      availability: 'available', data_status: 'Available',
    },
  ]);
  assert.equal(overview.datasets.period_comparison.length, PERIOD_COMPARISON_METRICS.length);
  assert.deepEqual(overview.datasets.period_comparison.map(metric => metric.module), ['Leads', 'Contacts', 'Deals', 'Calls', 'Events']);
  assert.equal(overview.datasets.period_comparison.some(metric => metric.module === 'Tasks'), false);
  assert.equal(overview.data_quality.status, 'pass');
  assert.equal(overview.data_quality.excluded_test_artifacts.find(row => row.module === 'Tasks').count, 1);
  assert.ok(overview.unsupported_metrics.includes('lead_to_qualified_opportunity_conversion_rate'));
  assert.match(overview.caveats.join(' '), /No cross-module conversion rate/i);
  assert.match(overview.caveats.join(' '), /same current local snapshot/i);
});

test('missing required metadata is Data Not Available and never silently converted to zero', () => {
  const raw = baseRaw({
    metadata_coverage: metadataRows({
      'fields:Calls': { required_fields_available: false },
      'fields:Contacts': { available: false, required_fields_available: false },
      'fields:Tasks': { available: false, required_fields_available: false },
    }),
  });
  const overview = buildAnalyticsOverview(raw, request(), { generatedAt: NOW.toISOString() });
  const calls = overview.hero_metrics.find(metric => metric.id === 'calls_logged');
  const opportunities = overview.hero_metrics.find(metric => metric.id === 'qualified_opportunities_created');
  const openTasks = overview.hero_metrics.find(metric => metric.id === 'open_tasks');
  assert.deepEqual([calls.value, opportunities.value, openTasks.value], [null, null, null]);
  assert.deepEqual([calls.availability, opportunities.availability, openTasks.availability], ['data_not_available', 'data_not_available', 'data_not_available']);
  assert.equal(overview.datasets.activity_daily[0].calls, null);
  assert.equal(overview.datasets.pipeline_stage_mix.find(lane => lane.module === 'Contacts').record_count, null);
  assert.equal(overview.datasets.task_summary.total, null);
  assert.deepEqual(
    overview.datasets.period_comparison.find(metric => metric.module === 'Contacts'),
    {
      id: 'qualified_opportunities_created', label: 'Qualified opportunities created', module: 'Contacts', source_field: 'Created_Time',
      current_count: null, previous_count: null, absolute_change: null, percentage_change: null,
      availability: 'data_not_available', data_status: 'Data Not Available',
    },
  );
  assert.deepEqual(
    overview.datasets.period_comparison.find(metric => metric.module === 'Calls'),
    {
      id: 'calls_logged', label: 'Calls logged', module: 'Calls', source_field: 'Call_Start_Time',
      current_count: null, previous_count: null, absolute_change: null, percentage_change: null,
      availability: 'data_not_available', data_status: 'Data Not Available',
    },
  );
  assert.equal(overview.data_quality.status, 'warn');
});

test('PII-like and overlong dimension labels are collapsed without exposing the source value', () => {
  const raw = baseRaw({
    current_stage_mix: [
      { module: 'Leads', value: 'person@example.com', count: 6 },
      { module: 'Leads', value: '+91 99999 88888', count: 4 },
      { module: 'Contacts', value: 'Opportunity Receieved', count: 4 },
      { module: 'Deals', value: 'Installation', count: 2 },
    ],
  });
  const overview = buildAnalyticsOverview(raw, request(), { generatedAt: NOW.toISOString() });
  const serialized = JSON.stringify(overview);
  assert.doesNotMatch(serialized, /person@example\.com|99999 88888/);
  assert.deepEqual(
    overview.datasets.pipeline_stage_mix.find(lane => lane.module === 'Leads').current_stage_mix,
    [{ name: 'Suppressed unexpected value', count: 10 }],
  );
  assert.equal(overview.data_quality.checks.find(item => item.id === 'unexpected_dimension_values_suppressed').actual, 10);
  assert.equal(overview.data_quality.status, 'warn');
});

test('failed reconciliation is visible and never repaired by changing a source count', () => {
  const raw = baseRaw({
    activity_totals: [
      { module: 'Calls', count: 99, previous_count: 4 },
      { module: 'Events', count: 2, previous_count: 1 },
    ],
  });
  const overview = buildAnalyticsOverview(raw, request(), { generatedAt: NOW.toISOString() });
  const reconciliation = overview.data_quality.checks.find(item => item.id === 'activity_daily_reconciles_Calls');
  assert.deepEqual({ status: reconciliation.status, actual: reconciliation.actual, expected: reconciliation.expected }, { status: 'fail', actual: 3, expected: 99 });
  assert.equal(overview.data_quality.status, 'fail');
  assert.equal(overview.hero_metrics.find(metric => metric.id === 'calls_logged').value, 99);
});

test('freshness is unavailable without a verified snapshot timestamp and delayed after two refresh intervals', () => {
  const unavailable = buildAnalyticsOverview(baseRaw({ source_sync: { metadata_updated_at: '2026-08-30T05:29:00Z' } }), request(), { generatedAt: NOW.toISOString() });
  assert.deepEqual(unavailable.source.freshness, {
    status: 'unavailable', snapshot_at: null, age_minutes: null, expected_refresh_minutes: 15,
  });
  assert.equal(unavailable.data_quality.status, 'warn');
  const delayed = buildAnalyticsOverview(baseRaw({ source_sync: { snapshot_at: '2026-08-30T04:00:00Z' } }), request(), { generatedAt: NOW.toISOString() });
  assert.equal(delayed.source.freshness.status, 'delayed');
  assert.equal(delayed.source.freshness.age_minutes, 90);
  const future = buildAnalyticsOverview(baseRaw({ source_sync: { snapshot_at: '2026-08-30T06:30:00Z' } }), request(), { generatedAt: NOW.toISOString() });
  assert.equal(future.source.freshness.status, 'clock_skew');
  assert.equal(future.source.freshness.age_minutes, null);
});

test('source-shape validation rejects duplicate modules, negative counts and unbounded results', () => {
  assert.throws(() => buildAnalyticsOverview(baseRaw({
    module_totals: [...baseRaw().module_totals, baseRaw().module_totals[0]],
  }), request(), { generatedAt: NOW.toISOString() }), AnalyticsSourceError);
  assert.throws(() => buildAnalyticsOverview(baseRaw({
    activity_totals: [
      { module: 'Calls', count: -1, previous_count: 4 },
      { module: 'Events', count: 2, previous_count: 1 },
    ],
  }), request(), { generatedAt: NOW.toISOString() }), /non-negative safe integer/);
  assert.throws(() => buildAnalyticsOverview(baseRaw({
    activity_totals: [
      { module: 'Calls', count: 3, previous_count: -1 },
      { module: 'Events', count: 2, previous_count: 1 },
    ],
  }), request(), { generatedAt: NOW.toISOString() }), /non-negative safe integer/);
  assert.throws(() => buildAnalyticsOverview(baseRaw({
    range_created: baseRaw().range_created.map(row => row.module === 'Leads' ? { module: row.module, count: row.count } : row),
  }), request(), { generatedAt: NOW.toISOString() }), /previous_count.*non-negative safe integer/);
  assert.throws(() => buildAnalyticsOverview(baseRaw({
    range_created: baseRaw().range_created.filter(row => row.module !== 'Events'),
  }), request(), { generatedAt: NOW.toISOString() }), /every required module aggregate/);
  assert.throws(() => buildAnalyticsOverview(baseRaw({
    current_stage_mix: Array.from({ length: 601 }, (_, index) => ({ module: 'Leads', value: `Stage ${index}`, count: 0 })),
  }), request(), { generatedAt: NOW.toISOString() }), /aggregate-row bound/);
});

test('service performs one read-only query and returns no raw metadata or customer rows', async () => {
  const calls = [];
  let metaCalls = 0;
  const service = createAnalyticsOverviewService({
    readOnlyQuery: async (statement, options) => {
      calls.push(statement);
      assert.equal(options.signal.aborted, false);
      return [{ analytics: baseRaw() }];
    },
    loadMeta: async () => { metaCalls++; },
    clock: () => NOW,
  });
  const overview = await service.overview({ from: '2026-08-01', to: '2026-08-30' });
  assert.equal(calls.length, 1);
  assert.equal(metaCalls, 0);
  assert.equal(service.contract.route, 'GET /api/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD');
  assert.equal(service.contract.read_only, true);
  assert.equal(overview.hero_metrics[0].value, 3);
  const serialized = JSON.stringify(overview);
  for (const forbidden of ['record_id', 'search_text', 'Full_Name', 'Email', 'Phone', 'Owner']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('service rejects non-singleton query envelopes and validates dependencies', async () => {
  assert.throws(() => createAnalyticsOverviewService(), /readOnlyQuery/);
  assert.throws(() => createAnalyticsOverviewService({ readOnlyQuery: async () => [], loadMeta: true }), /loadMeta/);
  const service = createAnalyticsOverviewService({ readOnlyQuery: async () => [] , clock: () => NOW });
  await assert.rejects(() => service.overview({ from: '2026-08-01', to: '2026-08-30' }), /exactly one aggregate row/);
});

test('service retries exactly once only for the classified PostgreSQL statement-timeout signature', async () => {
  let calls = 0;
  const service = createAnalyticsOverviewService({
    readOnlyQuery: async () => {
      calls++;
      if (calls === 1) {
        throw new Error('db 500: {"code":"57014","message":"canceling statement due to statement timeout"}');
      }
      return [{ analytics: baseRaw() }];
    },
    clock: () => NOW,
  });
  const overview = await service.overview({ from: '2026-08-01', to: '2026-08-30' });
  assert.equal(calls, 2);
  assert.equal(overview.hero_metrics[0].value, 3);
  assert.equal(overview.source.query_attempts, 2);
  assert.equal(isRetryableAnalyticsStatementTimeout({ dbCode: '57014', message: 'canceling statement due to statement timeout' }), true);
});

test('service does not retry generic source errors and releases after the second classified timeout', async () => {
  let genericCalls = 0;
  const generic = createAnalyticsOverviewService({
    readOnlyQuery: async () => {
      genericCalls++;
      throw new Error('db 500: upstream unavailable');
    },
    clock: () => NOW,
  });
  await assert.rejects(() => generic.overview({ from: '2026-08-01', to: '2026-08-30' }), /upstream unavailable/);
  assert.equal(genericCalls, 1);

  let timeoutCalls = 0;
  const exhausted = createAnalyticsOverviewService({
    readOnlyQuery: async () => {
      timeoutCalls++;
      const error = new Error('canceling statement due to statement timeout');
      error.code = '57014';
      throw error;
    },
    clock: () => NOW,
  });
  await assert.rejects(() => exhausted.overview({ from: '2026-08-01', to: '2026-08-30' }), /statement timeout/);
  assert.equal(timeoutCalls, 2);
  assert.equal(isRetryableAnalyticsStatementTimeout(new Error('statement timeout')), false);
});
