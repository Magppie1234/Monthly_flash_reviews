'use strict';

const {
  LOCAL_READ_ATTEMPT_TIMEOUT_MS,
  LOCAL_READ_MAX_ATTEMPTS,
  executeBoundedLocalRead,
  isRetryableStatementTimeout,
} = require('./local-read-retry');

const ANALYTICS_SCHEMA_VERSION = 1;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;
const SOURCE_TIME_ZONE = 'Asia/Kolkata';
const EXPECTED_REFRESH_MINUTES = 15;
const FRESH_AFTER_MINUTES = EXPECTED_REFRESH_MINUTES * 2;
const MAX_ANALYTICS_SOURCE_ATTEMPTS = LOCAL_READ_MAX_ATTEMPTS;
const ANALYTICS_SOURCE_ATTEMPT_TIMEOUT_MS = LOCAL_READ_ATTEMPT_TIMEOUT_MS;

const RECORD_MODULES = Object.freeze(['Leads', 'Contacts', 'Deals', 'Tasks', 'Calls', 'Events']);
const PIPELINE_MODULES = Object.freeze(['Leads', 'Contacts', 'Deals']);
const ACTIVITY_MODULES = Object.freeze(['Calls', 'Events']);
const EXPECTED_META_KEYS = Object.freeze(RECORD_MODULES.map(module => `fields:${module}`));
const PERIOD_COMPARISON_METRICS = Object.freeze([
  Object.freeze({ id: 'leads_created', label: 'Leads created', module: 'Leads', source_field: 'Created_Time', source_kind: 'created_time' }),
  Object.freeze({ id: 'qualified_opportunities_created', label: 'Qualified opportunities created', module: 'Contacts', source_field: 'Created_Time', source_kind: 'created_time' }),
  Object.freeze({ id: 'deals_created', label: 'Deals created', module: 'Deals', source_field: 'Created_Time', source_kind: 'created_time' }),
  Object.freeze({ id: 'calls_logged', label: 'Calls logged', module: 'Calls', source_field: 'Call_Start_Time', source_kind: 'activity_time' }),
  Object.freeze({ id: 'events_logged', label: 'Events logged', module: 'Events', source_field: 'Start_DateTime', source_kind: 'activity_time' }),
]);

const MODULE_SET = new Set(RECORD_MODULES);
const PIPELINE_SET = new Set(PIPELINE_MODULES);
const ACTIVITY_SET = new Set(ACTIVITY_MODULES);
const EMAIL_LIKE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_LIKE = /(?:^|\D)(?:\+?\d[\s().-]*){10,}(?:$|\D)/;
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;
const ANALYTICS_RELATIONS = new Set([
  'crm_records', 'crm_meta', 'bounds', 'excluded_records', 'module_metrics',
  'record_metrics', 'status_metrics', 'activity_metrics', 'expected_modules', 'module_totals',
  'range_created', 'current_stage_mix', 'cohort_stage_mix', 'activity_daily',
  'activity_totals', 'activity_quality', 'task_summary', 'task_status_mix',
  'excluded_test_artifacts', 'metadata_coverage', 'source_sync', 'jsonb_array_elements',
]);

class AnalyticsInputError extends Error {
  constructor(message, code = 'INVALID_ANALYTICS_REQUEST') {
    super(message);
    this.name = 'AnalyticsInputError';
    this.code = code;
    this.status = 400;
  }
}

class AnalyticsSourceError extends Error {
  constructor(message, code = 'INVALID_ANALYTICS_SOURCE_RESULT') {
    super(message);
    this.name = 'AnalyticsSourceError';
    this.code = code;
    this.status = 502;
  }
}

const isRetryableAnalyticsStatementTimeout = isRetryableStatementTimeout;

function calendarDay(value, label) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new AnalyticsInputError(`${label} must be a calendar date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new AnalyticsInputError(`${label} must be a valid calendar date.`);
  }
  return text;
}

function dayInTimeZone(now, timeZone = SOURCE_TIME_ZONE) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new AnalyticsInputError('The analytics clock is invalid.');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function shiftDay(day, offset) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function inclusiveDayCount(from, to) {
  return Math.round((new Date(`${to}T00:00:00.000Z`) - new Date(`${from}T00:00:00.000Z`)) / 86_400_000) + 1;
}

function normalizeAnalyticsOverviewRequest(input = {}, { now = new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AnalyticsInputError('Analytics request parameters must be an object.');
  }
  const unsupported = Object.keys(input).filter(key => !['from', 'to'].includes(key));
  if (unsupported.length) {
    throw new AnalyticsInputError('Only the bounded from and to analytics filters are supported.', 'UNSUPPORTED_ANALYTICS_FILTER');
  }
  const today = dayInTimeZone(now);
  const defaulted = !input.from && !input.to;
  if (Boolean(input.from) !== Boolean(input.to)) {
    throw new AnalyticsInputError('Provide both from and to, or omit both for the default 30-day window.');
  }
  const to = calendarDay(input.to || today, 'to');
  const from = calendarDay(input.from || shiftDay(to, -(DEFAULT_WINDOW_DAYS - 1)), 'from');
  if (from > to) throw new AnalyticsInputError('from must be on or before to.');
  if (to > today) throw new AnalyticsInputError('to cannot be later than the current CRM calendar day.');
  const days = inclusiveDayCount(from, to);
  if (days > MAX_WINDOW_DAYS) {
    throw new AnalyticsInputError(`Analytics date ranges are limited to ${MAX_WINDOW_DAYS} calendar days.`, 'ANALYTICS_RANGE_TOO_LARGE');
  }
  return Object.freeze({
    from,
    to,
    as_of: today,
    days,
    time_zone: SOURCE_TIME_ZONE,
    defaulted,
  });
}

function sqlDate(value) {
  return `'${value}'::date`;
}

function assertReadOnlyAnalyticsSql(statement) {
  const sql = String(statement || '').trim();
  if (!/^with\b/i.test(sql)) throw new AnalyticsSourceError('Analytics SQL must be a fixed read-only CTE query.');
  if (sql.includes(';') || /--|\/\*/.test(sql)) throw new AnalyticsSourceError('Analytics SQL may not contain statement separators or comments.');
  if (/\b(insert|update|delete|alter|drop|truncate|grant|revoke|copy|call|execute|create|merge|vacuum)\b/i.test(sql)) {
    throw new AnalyticsSourceError('Analytics SQL is restricted to SELECT-only access.');
  }
  if (/\b(crm_secret|crm_audit)\b/i.test(sql)) throw new AnalyticsSourceError('Analytics SQL references an unapproved table.');
  if (!/\bcrm_records\b/i.test(sql) || !/\bcrm_meta\b/i.test(sql)) {
    throw new AnalyticsSourceError('Analytics SQL must use the approved crm_records and crm_meta sources.');
  }
  for (const match of sql.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)) {
    if (!ANALYTICS_RELATIONS.has(match[1].toLowerCase())) throw new AnalyticsSourceError('Analytics SQL references an unapproved relation.');
  }
  return sql;
}

function validatedPlanRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || !('as_of' in request)) {
    return normalizeAnalyticsOverviewRequest(request || {});
  }
  const from = calendarDay(request.from, 'from');
  const to = calendarDay(request.to, 'to');
  const asOf = calendarDay(request.as_of, 'as_of');
  if (from > to) throw new AnalyticsInputError('from must be on or before to.');
  const days = inclusiveDayCount(from, to);
  if (days > MAX_WINDOW_DAYS) throw new AnalyticsInputError(`Analytics date ranges are limited to ${MAX_WINDOW_DAYS} calendar days.`, 'ANALYTICS_RANGE_TOO_LARGE');
  if (request.days !== undefined && Number(request.days) !== days) throw new AnalyticsInputError('The normalized analytics day count is inconsistent.');
  if (request.time_zone !== undefined && request.time_zone !== SOURCE_TIME_ZONE) throw new AnalyticsInputError(`Analytics time_zone must be ${SOURCE_TIME_ZONE}.`);
  return Object.freeze({ from, to, as_of: asOf, days, time_zone: SOURCE_TIME_ZONE, defaulted: Boolean(request.defaulted) });
}

function immediatelyPrecedingRange(request) {
  return Object.freeze({
    from: shiftDay(request.from, -request.days),
    to: shiftDay(request.from, -1),
    days: request.days,
    time_zone: SOURCE_TIME_ZONE,
  });
}

function buildAnalyticsOverviewQueryPlan(request) {
  const normalized = validatedPlanRequest(request);
  const previousRange = immediatelyPrecedingRange(normalized);
  const modulesSql = RECORD_MODULES.map(module => `'${module}'`).join(',');
  const pipelineSql = PIPELINE_MODULES.map(module => `'${module}'`).join(',');
  const activitySql = ACTIVITY_MODULES.map(module => `'${module}'`).join(',');
  const from = sqlDate(normalized.from);
  const to = sqlDate(normalized.to);
  const asOf = sqlDate(normalized.as_of);
  const previousFrom = sqlDate(previousRange.from);
  const previousTo = sqlDate(previousRange.to);
  const statement = `with bounds as (
  select ${from} as from_day, ${to} as to_day, ${asOf} as as_of_day,
    ${previousFrom} as previous_from_day, ${previousTo} as previous_to_day
), excluded_records as materialized (
  select module, id
  from crm_records
  where module in (${modulesSql})
    and id >= 'local-' and id < 'local.'
    and coalesce(data->>'__test_artifact', 'false') = 'true'
), record_metrics as materialized (
  select r.module,
    case when r.module in (${pipelineSql},'Tasks') then nullif(btrim(r.status), '') else null end as value,
    case when r.module in (${activitySql})
      and r.ts2 ~ '^\\d{4}-\\d{2}-\\d{2}'
      and left(r.ts2, 10) >= b.from_day::text
      and left(r.ts2, 10) < (b.to_day + 1)::text
      then left(r.ts2, 10) else null end as activity_day,
    count(*)::int as count,
    count(*) filter (where r.created_time >= (b.from_day::timestamp at time zone '${SOURCE_TIME_ZONE}')
      and r.created_time < ((b.to_day + 1)::timestamp at time zone '${SOURCE_TIME_ZONE}'))::int as cohort_count,
    count(*) filter (where r.created_time >= (b.previous_from_day::timestamp at time zone '${SOURCE_TIME_ZONE}')
      and r.created_time < ((b.previous_to_day + 1)::timestamp at time zone '${SOURCE_TIME_ZONE}'))::int as previous_cohort_count,
    count(*) filter (where r.created_time is null)::int as missing_created_time,
    count(*) filter (where r.modified_time is null)::int as missing_modified_time,
    count(*) filter (where r.module = 'Tasks' and lower(btrim(coalesce(r.status, ''))) <> 'completed')::int as task_open,
    count(*) filter (where r.module = 'Tasks' and lower(btrim(coalesce(r.status, ''))) = 'completed')::int as task_completed,
    count(*) filter (where r.module = 'Tasks' and lower(btrim(coalesce(r.status, ''))) <> 'completed' and r.due_date = b.as_of_day::text)::int as task_due_today,
    count(*) filter (where r.module = 'Tasks' and lower(btrim(coalesce(r.status, ''))) <> 'completed' and r.due_date ~ '^\\d{4}-\\d{2}-\\d{2}$' and r.due_date < b.as_of_day::text)::int as task_overdue,
    count(*) filter (where r.module = 'Tasks' and lower(btrim(coalesce(r.status, ''))) <> 'completed' and (r.due_date is null or btrim(r.due_date) = '' or r.due_date !~ '^\\d{4}-\\d{2}-\\d{2}$'))::int as task_missing_due_date,
    count(*) filter (where r.ts2 ~ '^\\d{4}-\\d{2}-\\d{2}'
      and left(r.ts2, 10) >= b.previous_from_day::text
      and left(r.ts2, 10) < (b.previous_to_day + 1)::text)::int as previous_activity_count,
    count(*) filter (where r.module in (${activitySql}) and (r.ts2 is null or btrim(r.ts2) = ''))::int as missing_activity_time,
    count(*) filter (where r.module in (${activitySql}) and r.ts2 is not null and btrim(r.ts2) <> '' and r.ts2 !~ '^\\d{4}-\\d{2}-\\d{2}')::int as malformed_activity_time
  from crm_records r cross join bounds b
  left join excluded_records x on x.module = r.module and x.id = r.id
  where r.module in (${modulesSql}) and x.id is null
  group by r.module, 2, 3
), status_metrics as materialized (
  select module, value, count, cohort_count, previous_cohort_count,
    missing_created_time, missing_modified_time,
    task_open, task_completed, task_due_today, task_overdue, task_missing_due_date
  from record_metrics where module in (${pipelineSql},'Tasks')
), activity_metrics as materialized (
  select module, activity_day, count, cohort_count, previous_cohort_count,
    previous_activity_count, missing_created_time, missing_modified_time,
    missing_activity_time, malformed_activity_time
  from record_metrics where module in (${activitySql})
), module_metrics as materialized (
  select module, sum(count)::int as count, sum(cohort_count)::int as range_count,
    sum(previous_cohort_count)::int as previous_range_count,
    sum(missing_created_time)::int as missing_created_time,
    sum(missing_modified_time)::int as missing_modified_time
  from (
    select module, count, cohort_count, previous_cohort_count, missing_created_time, missing_modified_time from status_metrics
    union all
    select module, count, cohort_count, previous_cohort_count, missing_created_time, missing_modified_time from activity_metrics
  ) metrics
  group by module
), expected_modules(module) as (
  values ${RECORD_MODULES.map(module => `('${module}')`).join(',')}
), module_totals as (
  select e.module, coalesce(m.count, 0)::int as count,
    coalesce(m.missing_created_time, 0)::int as missing_created_time,
    coalesce(m.missing_modified_time, 0)::int as missing_modified_time
  from expected_modules e left join module_metrics m on m.module = e.module
), range_created as (
  select e.module, coalesce(m.range_count, 0)::int as count,
    coalesce(m.previous_range_count, 0)::int as previous_count
  from expected_modules e left join module_metrics m on m.module = e.module
), current_stage_mix as (
  select module, value, count from status_metrics where module in (${pipelineSql})
), cohort_stage_mix as (
  select module, value, cohort_count as count from status_metrics where module in (${pipelineSql}) and cohort_count > 0
), activity_daily as (
  select module, activity_day as day, count from activity_metrics where activity_day is not null
), activity_totals as (
  select e.module,
    coalesce(sum(g.count) filter (where g.activity_day is not null), 0)::int as count,
    coalesce(sum(g.previous_activity_count), 0)::int as previous_count
  from (values ${ACTIVITY_MODULES.map(module => `('${module}')`).join(',')}) e(module)
  left join activity_metrics g on g.module = e.module group by e.module
), activity_quality as (
  select e.module,
    coalesce(sum(g.missing_activity_time), 0)::int as missing_activity_time,
    coalesce(sum(g.malformed_activity_time), 0)::int as malformed_activity_time
  from (values ${ACTIVITY_MODULES.map(module => `('${module}')`).join(',')}) e(module)
  left join activity_metrics g on g.module = e.module group by e.module
), task_summary as (
  select jsonb_build_object(
    'total', coalesce(sum(count), 0)::int,
    'open', coalesce(sum(task_open), 0)::int,
    'completed', coalesce(sum(task_completed), 0)::int,
    'due_today', coalesce(sum(task_due_today), 0)::int,
    'overdue', coalesce(sum(task_overdue), 0)::int,
    'open_missing_or_malformed_due_date', coalesce(sum(task_missing_due_date), 0)::int
  ) as value
  from status_metrics where module = 'Tasks'
), task_status_mix as (
  select value, count from status_metrics where module = 'Tasks'
), excluded_test_artifacts as (
  select e.module, count(x.id)::int as count
  from expected_modules e left join excluded_records x on x.module = e.module group by e.module
), metadata_coverage as (
  select expected.key, (m.key is not null) as available,
    case expected.key
      when 'fields:Leads' then (select count(distinct f->>'api_name') = 2 from jsonb_array_elements(coalesce(m.data->'fields', '[]'::jsonb)) f where f->>'api_name' in ('Lead_Status', 'Created_Time'))
      when 'fields:Contacts' then (select count(distinct f->>'api_name') = 2 from jsonb_array_elements(coalesce(m.data->'fields', '[]'::jsonb)) f where f->>'api_name' in ('Stage', 'Created_Time'))
      when 'fields:Deals' then (select count(distinct f->>'api_name') = 2 from jsonb_array_elements(coalesce(m.data->'fields', '[]'::jsonb)) f where f->>'api_name' in ('Stage', 'Created_Time'))
      when 'fields:Tasks' then (select count(distinct f->>'api_name') = 2 from jsonb_array_elements(coalesce(m.data->'fields', '[]'::jsonb)) f where f->>'api_name' in ('Status', 'Due_Date'))
      when 'fields:Calls' then exists (select 1 from jsonb_array_elements(coalesce(m.data->'fields', '[]'::jsonb)) f where f->>'api_name' = 'Call_Start_Time')
      when 'fields:Events' then exists (select 1 from jsonb_array_elements(coalesce(m.data->'fields', '[]'::jsonb)) f where f->>'api_name' = 'Start_DateTime')
      else false
    end as required_fields_available,
    m.updated_at
  from (values ${EXPECTED_META_KEYS.map(key => `('${key}')`).join(',')}) expected(key)
  left join crm_meta m on m.key = expected.key
), source_sync as (
  select coalesce(data->>'delta_at', data->>'at') as snapshot_at, updated_at as metadata_updated_at
  from crm_meta where key = 'sync_info' limit 1
)
select jsonb_build_object(
  'module_totals', (select coalesce(jsonb_agg(to_jsonb(t) order by module), '[]') from module_totals t),
  'range_created', (select coalesce(jsonb_agg(to_jsonb(t) order by module), '[]') from range_created t),
  'current_stage_mix', (select coalesce(jsonb_agg(to_jsonb(t) order by module, value nulls first), '[]') from current_stage_mix t),
  'cohort_stage_mix', (select coalesce(jsonb_agg(to_jsonb(t) order by module, value nulls first), '[]') from cohort_stage_mix t),
  'activity_daily', (select coalesce(jsonb_agg(to_jsonb(t) order by day, module), '[]') from activity_daily t),
  'activity_totals', (select coalesce(jsonb_agg(to_jsonb(t) order by module), '[]') from activity_totals t),
  'activity_quality', (select coalesce(jsonb_agg(to_jsonb(t) order by module), '[]') from activity_quality t),
  'task_summary', (select coalesce(value, '{}'::jsonb) from task_summary),
  'task_status_mix', (select coalesce(jsonb_agg(to_jsonb(t) order by value nulls first), '[]') from task_status_mix t),
  'excluded_test_artifacts', (select coalesce(jsonb_agg(to_jsonb(t) order by module), '[]') from excluded_test_artifacts t),
  'metadata_coverage', (select coalesce(jsonb_agg(to_jsonb(t) order by key), '[]') from metadata_coverage t),
  'source_sync', (select coalesce(to_jsonb(t), '{}'::jsonb) from source_sync t)
) as analytics`;
  return Object.freeze({
    id: 'crm-analytics-overview-v1',
    statement: assertReadOnlyAnalyticsSql(statement),
    read_only: true,
    source_tables: Object.freeze(['crm_records', 'crm_meta']),
    output_grain: 'aggregate-only',
    customer_rows_or_identifiers: false,
    date_range: normalized,
    comparison_date_range: previousRange,
  });
}

function boundedArray(value, label, maximum) {
  if (!Array.isArray(value)) throw new AnalyticsSourceError(`${label} must be an array.`);
  if (value.length > maximum) throw new AnalyticsSourceError(`${label} exceeded its aggregate-row bound.`);
  return value;
}

function countValue(value, label) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new AnalyticsSourceError(`${label} must be a non-negative safe integer.`);
  return parsed;
}

function safeTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeDimensionValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { label: 'Missing / no value', suppressed: false };
  }
  const label = String(value).trim();
  if (label.length > 160 || CONTROL_CHAR.test(label) || EMAIL_LIKE.test(label) || PHONE_LIKE.test(label)) {
    return { label: 'Suppressed unexpected value', suppressed: true };
  }
  return { label, suppressed: false };
}

function rowsByModule(rows, label, allowedModules = MODULE_SET) {
  const result = new Map();
  for (const row of boundedArray(rows, label, 32)) {
    const module = String(row?.module || '');
    if (!allowedModules.has(module)) throw new AnalyticsSourceError(`${label} returned an unexpected module.`);
    if (result.has(module)) throw new AnalyticsSourceError(`${label} returned a duplicate module.`);
    result.set(module, countValue(row?.count, `${label}.${module}.count`));
  }
  if (result.size !== allowedModules.size) throw new AnalyticsSourceError(`${label} did not return every required module aggregate.`);
  return result;
}

function periodCountsByModule(rows, label, allowedModules = MODULE_SET) {
  const current = new Map();
  const previous = new Map();
  for (const row of boundedArray(rows, label, 32)) {
    const module = String(row?.module || '');
    if (!allowedModules.has(module)) throw new AnalyticsSourceError(`${label} returned an unexpected module.`);
    if (current.has(module)) throw new AnalyticsSourceError(`${label} returned a duplicate module.`);
    current.set(module, countValue(row?.count, `${label}.${module}.count`));
    previous.set(module, countValue(row?.previous_count, `${label}.${module}.previous_count`));
  }
  if (current.size !== allowedModules.size) throw new AnalyticsSourceError(`${label} did not return every required module aggregate.`);
  return { current, previous };
}

function totalsByModule(rows) {
  const result = new Map();
  for (const row of boundedArray(rows, 'module_totals', RECORD_MODULES.length)) {
    const module = String(row?.module || '');
    if (!MODULE_SET.has(module) || result.has(module)) throw new AnalyticsSourceError('module_totals returned an unexpected or duplicate module.');
    result.set(module, {
      count: countValue(row?.count, `module_totals.${module}.count`),
      missing_created_time: countValue(row?.missing_created_time, `module_totals.${module}.missing_created_time`),
      missing_modified_time: countValue(row?.missing_modified_time, `module_totals.${module}.missing_modified_time`),
    });
  }
  if (result.size !== RECORD_MODULES.length) throw new AnalyticsSourceError('module_totals did not return every required module aggregate.');
  return result;
}

function dimensionMix(rows, label, allowedModules, maximum) {
  const byModule = new Map([...allowedModules].map(module => [module, new Map()]));
  let suppressedRecordCount = 0;
  for (const row of boundedArray(rows, label, maximum)) {
    const module = String(row?.module || '');
    if (!allowedModules.has(module)) throw new AnalyticsSourceError(`${label} returned an unexpected module.`);
    const count = countValue(row?.count, `${label}.${module}.count`);
    const safe = safeDimensionValue(row?.value);
    if (safe.suppressed) suppressedRecordCount += count;
    const moduleRows = byModule.get(module);
    moduleRows.set(safe.label, (moduleRows.get(safe.label) || 0) + count);
  }
  return {
    byModule: new Map([...byModule].map(([module, values]) => [module, [...values].map(([name, count]) => ({ name, count }))])),
    suppressedRecordCount,
  };
}

function normalizeMetadata(rows) {
  const expected = new Set(EXPECTED_META_KEYS);
  const seen = new Set();
  const entries = [];
  for (const row of boundedArray(rows, 'metadata_coverage', EXPECTED_META_KEYS.length)) {
    const key = String(row?.key || '');
    if (!expected.has(key) || seen.has(key)) throw new AnalyticsSourceError('metadata_coverage returned an unexpected or duplicate key.');
    seen.add(key);
    entries.push({
      module: key.slice('fields:'.length),
      available: row?.available === true || row?.available === 'true',
      required_fields_available: row?.required_fields_available === true || row?.required_fields_available === 'true',
      updated_at: safeTimestamp(row?.updated_at),
    });
  }
  for (const key of EXPECTED_META_KEYS) {
    if (!seen.has(key)) entries.push({ module: key.slice('fields:'.length), available: false, required_fields_available: false, updated_at: null });
  }
  return entries.sort((left, right) => RECORD_MODULES.indexOf(left.module) - RECORD_MODULES.indexOf(right.module));
}

function daySeries(rows, request) {
  const result = new Map();
  for (let day = request.from; day <= request.to; day = shiftDay(day, 1)) {
    result.set(day, { date: day, calls: 0, events: 0 });
  }
  for (const row of boundedArray(rows, 'activity_daily', request.days * ACTIVITY_MODULES.length)) {
    const module = String(row?.module || '');
    const day = String(row?.day || '');
    if (!ACTIVITY_SET.has(module) || !result.has(day)) throw new AnalyticsSourceError('activity_daily returned an out-of-scope module or date.');
    const key = module === 'Calls' ? 'calls' : 'events';
    result.get(day)[key] += countValue(row?.count, `activity_daily.${module}.${day}`);
  }
  return [...result.values()];
}

function check(id, status, actual, expected, note) {
  return { id, status, actual, expected, note };
}

function freshness(snapshotAt, generatedAt) {
  if (!snapshotAt) {
    return { status: 'unavailable', snapshot_at: null, age_minutes: null, expected_refresh_minutes: EXPECTED_REFRESH_MINUTES };
  }
  const deltaMinutes = Math.floor((new Date(generatedAt) - new Date(snapshotAt)) / 60_000);
  if (deltaMinutes < -5) {
    return { status: 'clock_skew', snapshot_at: snapshotAt, age_minutes: null, expected_refresh_minutes: EXPECTED_REFRESH_MINUTES };
  }
  const ageMinutes = Math.max(0, deltaMinutes);
  return {
    status: ageMinutes <= FRESH_AFTER_MINUTES ? 'fresh' : 'delayed',
    snapshot_at: snapshotAt,
    age_minutes: ageMinutes,
    expected_refresh_minutes: EXPECTED_REFRESH_MINUTES,
  };
}

function periodComparisonMetric(definition, currentCount, previousCount, available) {
  if (!available) {
    return {
      id: definition.id,
      label: definition.label,
      module: definition.module,
      source_field: definition.source_field,
      current_count: null,
      previous_count: null,
      absolute_change: null,
      percentage_change: null,
      availability: 'data_not_available',
      data_status: 'Data Not Available',
    };
  }
  const absoluteChange = currentCount - previousCount;
  const calculatedPercentage = previousCount === 0 ? null : Number(((absoluteChange / previousCount) * 100).toFixed(1));
  return {
    id: definition.id,
    label: definition.label,
    module: definition.module,
    source_field: definition.source_field,
    current_count: currentCount,
    previous_count: previousCount,
    absolute_change: absoluteChange,
    percentage_change: Object.is(calculatedPercentage, -0) ? 0 : calculatedPercentage,
    availability: 'available',
    data_status: 'Available',
  };
}

function buildAnalyticsOverview(raw, request, { generatedAt = new Date().toISOString(), sourceAttempts = 1 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AnalyticsSourceError('Analytics source payload must be an object.');
  request = validatedPlanRequest(request);
  const comparisonRange = immediatelyPrecedingRange(request);
  const totals = totalsByModule(raw.module_totals || []);
  const createdPeriodCounts = periodCountsByModule(raw.range_created || [], 'range_created');
  const rangeCreated = createdPeriodCounts.current;
  const previousRangeCreated = createdPeriodCounts.previous;
  const currentMix = dimensionMix(raw.current_stage_mix || [], 'current_stage_mix', PIPELINE_SET, 600);
  const cohortMix = dimensionMix(raw.cohort_stage_mix || [], 'cohort_stage_mix', PIPELINE_SET, 600);
  const activityPeriodCounts = periodCountsByModule(raw.activity_totals || [], 'activity_totals', ACTIVITY_SET);
  const activityTotals = activityPeriodCounts.current;
  const previousActivityTotals = activityPeriodCounts.previous;
  const daily = daySeries(raw.activity_daily || [], request);
  const excluded = rowsByModule(raw.excluded_test_artifacts || [], 'excluded_test_artifacts');
  const taskMix = dimensionMix(
    (raw.task_status_mix || []).map(row => ({ ...row, module: 'Tasks' })),
    'task_status_mix',
    new Set(['Tasks']),
    200,
  );
  const metadata = normalizeMetadata(raw.metadata_coverage || []);
  const metadataByModule = new Map(metadata.map(entry => [entry.module, entry]));
  const moduleAvailable = module => Boolean(metadataByModule.get(module)?.available);
  const metricAvailable = module => Boolean(metadataByModule.get(module)?.available && metadataByModule.get(module)?.required_fields_available);
  const activityQuality = new Map();
  for (const row of boundedArray(raw.activity_quality || [], 'activity_quality', ACTIVITY_MODULES.length)) {
    const module = String(row?.module || '');
    if (!ACTIVITY_SET.has(module) || activityQuality.has(module)) throw new AnalyticsSourceError('activity_quality returned an unexpected or duplicate module.');
    activityQuality.set(module, {
      missing: countValue(row?.missing_activity_time, `activity_quality.${module}.missing_activity_time`),
      malformed: countValue(row?.malformed_activity_time, `activity_quality.${module}.malformed_activity_time`),
    });
  }
  if (!raw.task_summary || typeof raw.task_summary !== 'object' || Array.isArray(raw.task_summary)) {
    throw new AnalyticsSourceError('task_summary must be an aggregate object.');
  }
  if (activityQuality.size !== ACTIVITY_MODULES.length) throw new AnalyticsSourceError('activity_quality did not return every required module aggregate.');
  const taskRaw = raw.task_summary;
  const taskKeys = ['total', 'open', 'completed', 'due_today', 'overdue', 'open_missing_or_malformed_due_date'];
  if (taskKeys.some(key => !(key in taskRaw))) throw new AnalyticsSourceError('task_summary did not return every required aggregate.');
  const taskSummary = {
    total: countValue(taskRaw.total || 0, 'task_summary.total'),
    open: countValue(taskRaw.open || 0, 'task_summary.open'),
    completed: countValue(taskRaw.completed || 0, 'task_summary.completed'),
    due_today: countValue(taskRaw.due_today || 0, 'task_summary.due_today'),
    overdue: countValue(taskRaw.overdue || 0, 'task_summary.overdue'),
    open_missing_or_malformed_due_date: countValue(taskRaw.open_missing_or_malformed_due_date || 0, 'task_summary.open_missing_or_malformed_due_date'),
  };
  const generated = safeTimestamp(generatedAt);
  if (!generated) throw new AnalyticsSourceError('generated_at must be a valid timestamp.');
  if (!Number.isSafeInteger(sourceAttempts) || sourceAttempts < 1 || sourceAttempts > MAX_ANALYTICS_SOURCE_ATTEMPTS) {
    throw new AnalyticsSourceError('source query attempts are outside the reviewed bound.');
  }
  const snapshotAt = safeTimestamp(raw.source_sync?.snapshot_at);
  const syncMetadataUpdatedAt = safeTimestamp(raw.source_sync?.metadata_updated_at);
  const sourceFreshness = freshness(snapshotAt, generated);
  const taskAvailable = metricAvailable('Tasks');

  const pipeline = PIPELINE_MODULES.map(module => {
    const available = metricAvailable(module);
    const total = totals.get(module)?.count || 0;
    const current = currentMix.byModule.get(module) || [];
    const cohortCount = rangeCreated.get(module) || 0;
    const cohort = cohortMix.byModule.get(module) || [];
    return {
      module,
      availability: available ? 'available' : 'data_not_available',
      data_status: available ? 'Available' : 'Data Not Available',
      record_count: available ? total : null,
      current_stage_mix: available ? current : [],
      created_in_range_count: available ? cohortCount : null,
      created_in_range_current_stage_mix: available ? cohort : [],
    };
  });

  const checks = [];
  for (const module of PIPELINE_MODULES) {
    const lane = pipeline.find(item => item.module === module);
    if (lane.availability !== 'available') {
      checks.push(check(`stage_mix_reconciles_${module}`, 'warn', null, null, 'Data Not Available because required field metadata is missing.'));
      checks.push(check(`cohort_stage_mix_reconciles_${module}`, 'warn', null, null, 'Data Not Available because required field metadata is missing.'));
      continue;
    }
    const currentSum = lane.current_stage_mix.reduce((sum, row) => sum + row.count, 0);
    const cohortSum = lane.created_in_range_current_stage_mix.reduce((sum, row) => sum + row.count, 0);
    checks.push(check(`stage_mix_reconciles_${module}`, currentSum === lane.record_count ? 'pass' : 'fail', currentSum, lane.record_count, 'Current-stage partitions must equal the module record count.'));
    checks.push(check(`cohort_stage_mix_reconciles_${module}`, cohortSum === lane.created_in_range_count ? 'pass' : 'fail', cohortSum, lane.created_in_range_count, 'Created-in-range stage partitions must equal the created-in-range module count.'));
  }
  for (const module of ACTIVITY_MODULES) {
    if (!metricAvailable(module)) {
      checks.push(check(`activity_daily_reconciles_${module}`, 'warn', null, null, 'Data Not Available because required activity-time metadata is missing.'));
      continue;
    }
    const key = module === 'Calls' ? 'calls' : 'events';
    const dailySum = daily.reduce((sum, row) => sum + row[key], 0);
    const total = activityTotals.get(module) || 0;
    checks.push(check(`activity_daily_reconciles_${module}`, dailySum === total ? 'pass' : 'fail', dailySum, total, 'Daily activity counts must equal the range total.'));
  }
  if (taskAvailable) {
    checks.push(check('task_status_partition', taskSummary.open + taskSummary.completed === taskSummary.total ? 'pass' : 'fail', taskSummary.open + taskSummary.completed, taskSummary.total, 'Open and completed task counts must partition all Tasks.'));
  } else {
    checks.push(check('task_status_partition', 'warn', null, null, 'Data Not Available because required Task field metadata is missing.'));
  }
  const usableMetadata = metadata.filter(entry => entry.available && entry.required_fields_available).length;
  checks.push(check('field_metadata_coverage', usableMetadata === metadata.length ? 'pass' : 'warn', usableMetadata, metadata.length, 'Every aggregate is exposed only when its required field metadata is available.'));
  const suppressedRecordCount = currentMix.suppressedRecordCount + cohortMix.suppressedRecordCount + taskMix.suppressedRecordCount;
  checks.push(check('unexpected_dimension_values_suppressed', suppressedRecordCount === 0 ? 'pass' : 'warn', suppressedRecordCount, 0, 'PII-like, overlong, or control-character dimension values are suppressed.'));
  const invalidActivityTimes = [...activityQuality.values()].reduce((sum, item) => sum + item.missing + item.malformed, 0);
  const activitiesAvailable = ACTIVITY_MODULES.every(metricAvailable);
  checks.push(check('activity_time_coverage', activitiesAvailable && invalidActivityTimes === 0 ? 'pass' : 'warn', activitiesAvailable ? invalidActivityTimes : null, 0, activitiesAvailable ? 'Calls and Events without a usable activity timestamp are excluded from date-window metrics.' : 'Data Not Available for at least one activity module because required metadata is missing.'));
  checks.push(check('task_due_date_coverage', taskAvailable && taskSummary.open_missing_or_malformed_due_date === 0 ? 'pass' : 'warn', taskAvailable ? taskSummary.open_missing_or_malformed_due_date : null, 0, taskAvailable ? 'Open Tasks without a usable due date cannot be classified as due or overdue.' : 'Data Not Available because required Task metadata is missing.'));
  checks.push(check('source_freshness', sourceFreshness.status === 'fresh' ? 'pass' : 'warn', sourceFreshness.age_minutes, FRESH_AFTER_MINUTES, 'Fresh means the snapshot is no more than two expected 15-minute refresh intervals old.'));

  const overallStatus = checks.some(item => item.status === 'fail') ? 'fail' : checks.some(item => item.status === 'warn') ? 'warn' : 'pass';
  const calls = activityTotals.get('Calls') || 0;
  const events = activityTotals.get('Events') || 0;
  const periodComparison = PERIOD_COMPARISON_METRICS.map(definition => {
    const current = definition.source_kind === 'created_time'
      ? rangeCreated.get(definition.module)
      : activityTotals.get(definition.module);
    const previous = definition.source_kind === 'created_time'
      ? previousRangeCreated.get(definition.module)
      : previousActivityTotals.get(definition.module);
    return periodComparisonMetric(definition, current, previous, metricAvailable(definition.module));
  });
  const hero = (id, label, value, unit, module, extra = {}) => ({
    id,
    label,
    value: metricAvailable(module) ? value : null,
    unit,
    availability: metricAvailable(module) ? 'available' : 'data_not_available',
    data_status: metricAvailable(module) ? 'Available' : 'Data Not Available',
    ...extra,
  });
  return {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    generated_at: generated,
    source: {
      name: 'Local CRM replica',
      tables: ['crm_records', 'crm_meta'],
      upstream_boundary: 'Zoho CRM GET/HEAD read-only replication',
      query_mode: 'local-read-only',
      query_plan_id: 'crm-analytics-overview-v1',
      query_attempts: sourceAttempts,
      output_grain: 'aggregate-only',
      customer_rows_or_identifiers: false,
      sync_metadata_updated_at: syncMetadataUpdatedAt,
      freshness: sourceFreshness,
    },
    date_range: {
      from: request.from,
      to: request.to,
      days: request.days,
      time_zone: request.time_zone,
      defaulted: request.defaulted,
      created_record_semantics: 'created_time inside the inclusive CRM calendar-date range',
      activity_semantics: 'Call_Start_Time or Event Start_DateTime inside the inclusive CRM calendar-date range',
      task_semantics: `current Task status and due date as of ${request.as_of}`,
      comparison_period: comparisonRange,
    },
    hero_metrics: [
      hero('leads_created', 'Leads created', rangeCreated.get('Leads') || 0, 'records', 'Leads'),
      hero('qualified_opportunities_created', 'Qualified opportunities created', rangeCreated.get('Contacts') || 0, 'records', 'Contacts', { source_module: 'Contacts' }),
      hero('calls_logged', 'Calls logged', calls, 'activities', 'Calls'),
      hero('events_logged', 'Events logged', events, 'activities', 'Events'),
      hero('open_tasks', 'Open Tasks', taskSummary.open, 'records', 'Tasks', { as_of: request.as_of }),
      hero('overdue_tasks', 'Overdue Tasks', taskSummary.overdue, 'records', 'Tasks', { as_of: request.as_of }),
    ],
    datasets: {
      module_inventory: RECORD_MODULES.map(module => ({
        module,
        availability: moduleAvailable(module) ? 'available' : 'data_not_available',
        data_status: moduleAvailable(module) ? 'Available' : 'Data Not Available',
        record_count: moduleAvailable(module) ? totals.get(module)?.count || 0 : null,
        created_in_range_count: moduleAvailable(module) ? rangeCreated.get(module) || 0 : null,
      })),
      pipeline_stage_mix: pipeline,
      activity_daily: daily.map(row => ({
        date: row.date,
        calls: metricAvailable('Calls') ? row.calls : null,
        events: metricAvailable('Events') ? row.events : null,
      })),
      activity_totals: ACTIVITY_MODULES.map(module => ({
        module,
        availability: metricAvailable(module) ? 'available' : 'data_not_available',
        data_status: metricAvailable(module) ? 'Available' : 'Data Not Available',
        count: metricAvailable(module) ? activityTotals.get(module) || 0 : null,
      })),
      task_status_mix: taskAvailable ? taskMix.byModule.get('Tasks') || [] : [],
      period_comparison: periodComparison,
      task_summary: taskAvailable ? { availability: 'available', data_status: 'Available', ...taskSummary } : {
        availability: 'data_not_available',
        data_status: 'Data Not Available',
        total: null,
        open: null,
        completed: null,
        due_today: null,
        overdue: null,
        open_missing_or_malformed_due_date: null,
      },
    },
    data_quality: {
      status: overallStatus,
      checks,
      metadata_coverage: metadata,
      excluded_test_artifacts: RECORD_MODULES.map(module => ({ module, count: excluded.get(module) || 0 })),
      missing_record_timestamps: RECORD_MODULES.map(module => ({
        module,
        missing_created_time: totals.get(module)?.missing_created_time || 0,
        missing_modified_time: totals.get(module)?.missing_modified_time || 0,
      })),
    },
    caveats: [
      'All outputs are aggregate counts; no customer rows, record identifiers, names, owners, phone numbers, email addresses, notes, or attachment contents are returned.',
      'Pipeline charts show each record\'s current status or stage. Stage history and stage-to-stage movement are not inferred.',
      'Leads, qualified opportunities, and Deals are separate module cohorts. No cross-module conversion rate, attribution, win rate, or funnel progression is calculated without a verified relationship and history model.',
      'Qualified opportunities use the CRM\'s locally replicated Contacts module convention; this is a module count, not a deduplicated customer count.',
      'Calls and Events with missing or malformed activity timestamps are excluded from date-window activity totals and reported as a data-quality guardrail.',
      'Period comparisons use immediately preceding equal-length cohorts from the same current local snapshot. They are not historical snapshot, conversion, attribution, or stage-movement metrics.',
      'When required source metadata is missing, affected values are returned as null with Data Not Available status; missing evidence is never converted to zero.',
    ],
    unsupported_metrics: [
      'lead_to_qualified_opportunity_conversion_rate',
      'qualified_opportunity_to_deal_conversion_rate',
      'stage_velocity',
      'sales_attribution',
      'forecast_accuracy',
    ],
  };
}

function extractAnalyticsPayload(result) {
  if (Array.isArray(result)) {
    if (result.length !== 1 || !result[0] || typeof result[0] !== 'object') {
      throw new AnalyticsSourceError('Analytics query must return exactly one aggregate row.');
    }
    return result[0].analytics;
  }
  if (result && typeof result === 'object' && 'analytics' in result) return result.analytics;
  return result;
}

function createAnalyticsOverviewService({ readOnlyQuery, loadMeta, clock = () => new Date() } = {}) {
  if (typeof readOnlyQuery !== 'function') throw new TypeError('readOnlyQuery must be a function.');
  if (loadMeta !== undefined && typeof loadMeta !== 'function') throw new TypeError('loadMeta must be a function when provided.');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
  return Object.freeze({
    contract: Object.freeze({
      route: 'GET /api/analytics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD',
      read_only: true,
      source_tables: Object.freeze(['crm_records', 'crm_meta']),
      max_range_days: MAX_WINDOW_DAYS,
      output_grain: 'aggregate-only',
      customer_rows_or_identifiers: false,
    }),
    plan(input = {}) {
      const now = clock();
      return buildAnalyticsOverviewQueryPlan(normalizeAnalyticsOverviewRequest(input, { now }));
    },
    async overview(input = {}) {
      const now = clock();
      const request = normalizeAnalyticsOverviewRequest(input, { now });
      const plan = buildAnalyticsOverviewQueryPlan(request);
      const execution = await executeBoundedLocalRead({ readOnlyQuery, statement: plan.statement });
      const result = execution.result;
      const sourceAttempts = execution.attempts;
      const raw = extractAnalyticsPayload(result);
      // The fixed query reads the approved crm_meta keys in the same round
      // trip. loadMeta is accepted for adapter compatibility but deliberately
      // not called, avoiding extra reads and any accidental raw-meta exposure.
      void loadMeta;
      return buildAnalyticsOverview(raw, request, {
        generatedAt: new Date(now).toISOString(),
        sourceAttempts,
      });
    },
  });
}

module.exports = {
  ACTIVITY_MODULES,
  ANALYTICS_SCHEMA_VERSION,
  ANALYTICS_SOURCE_ATTEMPT_TIMEOUT_MS,
  AnalyticsInputError,
  AnalyticsSourceError,
  DEFAULT_WINDOW_DAYS,
  EXPECTED_META_KEYS,
  EXPECTED_REFRESH_MINUTES,
  MAX_WINDOW_DAYS,
  MAX_ANALYTICS_SOURCE_ATTEMPTS,
  PERIOD_COMPARISON_METRICS,
  PIPELINE_MODULES,
  RECORD_MODULES,
  SOURCE_TIME_ZONE,
  assertReadOnlyAnalyticsSql,
  buildAnalyticsOverview,
  buildAnalyticsOverviewQueryPlan,
  createAnalyticsOverviewService,
  isRetryableAnalyticsStatementTimeout,
  normalizeAnalyticsOverviewRequest,
};
