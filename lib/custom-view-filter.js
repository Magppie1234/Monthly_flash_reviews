'use strict';

class CustomViewFilterError extends Error {
  constructor(message, { code = 'CUSTOM_VIEW_CRITERIA_UNSUPPORTED', status = 422, details = {} } = {}) {
    super(message);
    this.name = 'CustomViewFilterError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const ident = value => {
  if (!/^[A-Za-z0-9_$]+$/.test(String(value || ''))) {
    throw new CustomViewFilterError('Custom view criterion contains an invalid field name.');
  }
  return String(value);
};

const lit = value => "'" + String(value).replace(/'/g, "''") + "'";
const EMPTY_SENTINEL = '${EMPTY}';
const REFERENCE_DATA_TYPES = new Set(['lookup', 'ownerlookup', 'userlookup', 'layout']);

function isDynamic(value) {
  if (typeof value === 'string') return value.includes('${');
  if (Array.isArray(value)) return value.some(isDynamic);
  if (value && typeof value === 'object') return Object.values(value).some(isDynamic);
  return false;
}

function fail(message, context = {}) {
  throw new CustomViewFilterError(message, { details: context });
}

function lookupProjection(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.id !== null && value.id !== undefined && value.id !== '') return 'id';
    if (value.name !== null && value.name !== undefined) return 'name';
    fail('Custom view lookup criterion has no id or name.');
  }
  return /^\d{15,}$/.test(String(value ?? '')) ? 'id' : 'name';
}

function lookupValue(value, projection) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const selected = value[projection];
    if (selected === null || selected === undefined) {
      fail(`Custom view lookup criterion is missing ${projection}.`);
    }
    return selected;
  }
  return value;
}

function fieldExpression(fieldName, field, sample) {
  if (REFERENCE_DATA_TYPES.has(field.data_type)) {
    return `data->'${fieldName}'->>'${lookupProjection(sample)}'`;
  }
  return `data->>'${fieldName}'`;
}

function criterionSQL(criterion, fieldMap, context = {}) {
  if (!criterion || typeof criterion !== 'object' || Array.isArray(criterion)) {
    fail('Custom view criterion is missing or malformed.', context);
  }
  if (criterion.$disrupted === true) {
    fail('Zoho marked this custom view criterion as disrupted.', context);
  }

  if (Object.prototype.hasOwnProperty.call(criterion, 'group_operator')) {
    const operator = String(criterion.group_operator || '').toUpperCase();
    if (!['AND', 'OR'].includes(operator)) {
      fail(`Unsupported custom view group operator: ${criterion.group_operator || '(empty)'}.`, context);
    }
    if (!Array.isArray(criterion.group) || criterion.group.length === 0) {
      fail('Custom view criterion group must contain at least one criterion.', context);
    }
    const parts = criterion.group.map((child, index) => criterionSQL(child, fieldMap, { ...context, path: `${context.path || 'criteria'}.${index}` }));
    return `(${parts.join(` ${operator.toLowerCase()} `)})`;
  }
  if (Object.prototype.hasOwnProperty.call(criterion, 'group')) {
    fail('Custom view criterion group has no group operator.', context);
  }

  const fieldName = ident(criterion.field?.api_name);
  if (fieldName.startsWith('$')) fail('Custom view uses an unsupported system field.', context);
  const field = fieldMap[fieldName];
  if (!field) fail(`Custom view references unavailable field ${fieldName}.`, context);

  const comparator = String(criterion.comparator || '').toLowerCase();
  const supported = new Set([
    'equal', 'not_equal', 'contains', 'not_contains', 'starts_with', 'ends_with',
    'in', 'not_in', 'greater_than', 'greater_equal', 'less_than', 'less_equal', 'between',
  ]);
  if (!supported.has(comparator)) {
    fail(`Unsupported custom view comparator: ${criterion.comparator || '(empty)'}.`, context);
  }
  if (!Object.prototype.hasOwnProperty.call(criterion, 'value')) {
    fail(`Custom view criterion for ${fieldName} has no usable value.`, context);
  }

  const sourceValue = criterion.value;
  const emptySentinel = sourceValue === EMPTY_SENTINEL;
  if (isDynamic(sourceValue) && !emptySentinel) fail('Dynamic custom view values are not supported locally.', context);
  if (emptySentinel && !['equal', 'not_equal'].includes(comparator)) {
    fail('The Zoho empty-value sentinel is supported only with equal or not_equal.', context);
  }
  const value = emptySentinel ? null : sourceValue;

  const numeric = ['integer', 'double', 'currency', 'bigint', 'percent'].includes(field.data_type);
  const isLookup = REFERENCE_DATA_TYPES.has(field.data_type);
  const scalar = raw => {
    if (raw && typeof raw === 'object') {
      if (!isLookup || Array.isArray(raw)) fail(`Custom view value for ${fieldName} is malformed.`, context);
      return lookupValue(raw, lookupProjection(raw));
    }
    return raw;
  };
  const numericLiteral = raw => {
    const number = Number(scalar(raw));
    if (!Number.isFinite(number)) fail(`Custom view value for numeric field ${fieldName} is invalid.`, context);
    return String(number);
  };
  const valueLiteral = raw => numeric ? numericLiteral(raw) : lit(scalar(raw));

  const listComparator = Array.isArray(value) && comparator === 'equal'
    ? 'in'
    : Array.isArray(value) && comparator === 'not_equal'
      ? 'not_in'
      : comparator;
  if (['in', 'not_in'].includes(listComparator)) {
    if (!Array.isArray(value) || value.length === 0) fail(`${comparator} requires a non-empty value list.`, context);
    let projection = null;
    if (isLookup) {
      const projections = new Set(value.map(lookupProjection));
      if (projections.size !== 1) fail('Custom view lookup list mixes ids and names.', context);
      projection = [...projections][0];
    }
    const expression = isLookup ? `data->'${fieldName}'->>'${projection}'` : fieldExpression(fieldName, field, value[0]);
    const values = value.map(raw => valueLiteral(isLookup ? lookupValue(raw, projection) : raw)).join(',');
    if (listComparator === 'in') return `${expression} in (${values})`;
    return `(${expression} is null or ${expression} not in (${values}))`;
  }

  if (comparator === 'between') {
    if (!Array.isArray(value) || value.length !== 2) fail('between requires exactly two values.', context);
    const expression0 = fieldExpression(fieldName, field, value[0]);
    const expression = numeric ? `nullif(${expression0},'')::numeric` : expression0;
    return `${expression} between ${valueLiteral(value[0])} and ${valueLiteral(value[1])}`;
  }
  if (Array.isArray(value)) fail(`${comparator} requires a single value.`, context);

  const expression0 = fieldExpression(fieldName, field, value);
  const expression = numeric ? `nullif(${expression0},'')::numeric` : expression0;
  const normalizedValue = isLookup ? lookupValue(value, lookupProjection(value)) : value;

  switch (comparator) {
    case 'equal':
      return normalizedValue === null || normalizedValue === '' ? `(${expression0} is null or ${expression0} = '')` : `${expression} = ${valueLiteral(normalizedValue)}`;
    case 'not_equal':
      return normalizedValue === null || normalizedValue === '' ? `${expression0} is not null and ${expression0} != ''` : `(${expression} is distinct from ${valueLiteral(normalizedValue)})`;
    case 'contains': return `${expression0} ilike ${lit('%' + normalizedValue + '%')}`;
    case 'not_contains': return `(${expression0} is null or ${expression0} not ilike ${lit('%' + normalizedValue + '%')})`;
    case 'starts_with': return `${expression0} ilike ${lit(normalizedValue + '%')}`;
    case 'ends_with': return `${expression0} ilike ${lit('%' + normalizedValue)}`;
    case 'greater_than': return `${expression} > ${valueLiteral(normalizedValue)}`;
    case 'greater_equal': return `${expression} >= ${valueLiteral(normalizedValue)}`;
    case 'less_than': return `${expression} < ${valueLiteral(normalizedValue)}`;
    case 'less_equal': return `${expression} <= ${valueLiteral(normalizedValue)}`;
    default: fail(`Unsupported custom view comparator: ${comparator}.`, context);
  }
}

function compileCustomViewFilter({ module, cvid, views, fields }) {
  if (!cvid) return { view: null, sql: null };
  if (!Array.isArray(views)) {
    throw new CustomViewFilterError(`Custom view metadata is unavailable for ${module}.`, {
      code: 'CUSTOM_VIEW_METADATA_UNAVAILABLE', status: 503, details: { module },
    });
  }
  const view = views.find(item => String(item.id) === String(cvid));
  if (!view) {
    throw new CustomViewFilterError(`Custom view ${cvid} was not found for ${module}.`, {
      code: 'CUSTOM_VIEW_NOT_FOUND', status: 404, details: { module, cvid: String(cvid) },
    });
  }
  if (!Object.prototype.hasOwnProperty.call(view, 'criteria')) {
    throw new CustomViewFilterError(`Custom view ${cvid} has incomplete criterion metadata.`, {
      code: 'CUSTOM_VIEW_CRITERIA_UNAVAILABLE', status: 422, details: { module, cvid: String(cvid) },
    });
  }
  if (view.criteria === null) return { view, sql: null };

  const fieldList = Array.isArray(fields) ? fields : fields?.fields;
  if (!Array.isArray(fieldList)) {
    throw new CustomViewFilterError(`Field metadata is unavailable for ${module}.`, {
      code: 'CUSTOM_VIEW_METADATA_UNAVAILABLE', status: 503, details: { module },
    });
  }
  const fieldMap = Object.fromEntries(fieldList.map(field => [field.api_name, field]));
  const sql = criterionSQL(view.criteria, fieldMap, { module, cvid: String(cvid), path: 'criteria' });
  if (!sql) fail('Custom view criterion produced no filter.', { module, cvid: String(cvid) });
  return { view, sql };
}

module.exports = { CustomViewFilterError, compileCustomViewFilter, criterionSQL };
