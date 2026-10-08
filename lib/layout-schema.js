'use strict';

class LayoutSchemaError extends Error {
  constructor(message, { code = 'LAYOUT_METADATA_INCOMPLETE', status = 503, details = {} } = {}) {
    super(message);
    this.name = 'LayoutSchemaError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const asLayoutId = value => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return asLayoutId(value.id);
  return String(value);
};

const layoutList = value => {
  const layouts = Array.isArray(value) ? value : value?.layouts;
  return (Array.isArray(layouts) ? layouts : []).filter(layout =>
    layout && layout.id && layout.visible !== false && String(layout.status || 'active').toLowerCase() !== 'inactive');
};

const recordLayoutId = record => asLayoutId(record?.Layout) || asLayoutId(record?.$layout_id);

function resolveLayout(layoutsOrMeta, { layoutId = null, record = null } = {}) {
  const layouts = layoutList(layoutsOrMeta);
  const requestedId = asLayoutId(layoutId);
  const storedId = recordLayoutId(record);
  const candidateId = requestedId || storedId;

  if (candidateId) {
    const layout = layouts.find(item => asLayoutId(item.id) === candidateId) || null;
    return {
      layout,
      exact: Boolean(layout),
      source: requestedId ? 'request' : 'record',
      requested_id: candidateId,
      reason: layout ? null : 'unknown_layout',
      candidates: layouts,
    };
  }

  if (layouts.length === 1) {
    return { layout: layouts[0], exact: true, source: 'only_active_layout', requested_id: null, reason: null, candidates: layouts };
  }

  return {
    layout: null,
    exact: false,
    source: null,
    requested_id: null,
    reason: layouts.length > 1 ? 'ambiguous_layout' : 'layout_metadata_unavailable',
    candidates: layouts,
  };
}

function layoutFields(layout) {
  return (layout?.sections || []).flatMap(section => section?.fields || []).filter(field => field?.api_name);
}

function validatedLayoutFields(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout) || !Array.isArray(layout.sections) || layout.sections.length === 0) {
    throw new LayoutSchemaError('The resolved layout has no usable section metadata.', {
      details: { reason: 'layout_sections_unavailable' },
    });
  }

  const fields = [];
  for (const section of layout.sections) {
    if (!section || typeof section !== 'object' || Array.isArray(section) || !Array.isArray(section.fields)) {
      throw new LayoutSchemaError('The resolved layout contains incomplete section field metadata.', {
        details: { reason: 'layout_section_fields_unavailable' },
      });
    }
    for (const field of section.fields) {
      if (!field || typeof field !== 'object' || Array.isArray(field) || !field.api_name) {
        throw new LayoutSchemaError('The resolved layout contains a field without an API name.', {
          details: { reason: 'layout_field_identity_unavailable' },
        });
      }
      fields.push(field);
    }
  }

  if (fields.length === 0) {
    throw new LayoutSchemaError('The resolved layout has no usable field metadata.', {
      details: { reason: 'layout_fields_unavailable' },
    });
  }

  const unique = new Map();
  for (const field of fields) {
    const existing = unique.get(field.api_name);
    if (existing?.data_type && field.data_type && existing.data_type !== field.data_type) {
      throw new LayoutSchemaError('The resolved layout contains conflicting field definitions.', {
        details: { reason: 'conflicting_layout_field', field: field.api_name },
      });
    }
    unique.set(field.api_name, existing ? mergeFieldWithLayout(existing, field) : field);
  }
  return [...unique.values()];
}

function mergeFieldWithLayout(field, layoutField) {
  if (!field && !layoutField) return null;
  const base = field || {};
  const scoped = layoutField || {};
  return {
    ...base,
    ...scoped,
    api_name: scoped.api_name || base.api_name,
    required: base.required === true || base.system_mandatory === true || scoped.required === true || scoped.system_mandatory === true,
    system_mandatory: base.system_mandatory === true || scoped.system_mandatory === true,
    read_only: base.read_only === true || scoped.read_only === true || scoped.field_read_only === true,
    virtual_field: base.virtual_field === true || scoped.virtual_field === true,
    data_type: base.data_type || scoped.data_type,
    view_type: { ...(base.view_type || {}), ...(scoped.view_type || {}) },
  };
}

function mergeLayoutFields(fields, layout) {
  if (!layout) return fields || [];
  const moduleFields = Array.isArray(fields) ? fields.filter(field => field?.api_name) : [];
  const moduleByName = new Map(moduleFields.map(field => [field.api_name, field]));
  const scopedFields = validatedLayoutFields(layout);
  const missing = scopedFields.filter(field => !moduleByName.has(field.api_name)).map(field => field.api_name);
  if (missing.length) {
    throw new LayoutSchemaError('The resolved layout references fields missing from module metadata.', {
      details: { reason: 'module_fields_unavailable', fields: missing },
    });
  }
  return scopedFields.map(field => mergeFieldWithLayout(moduleByName.get(field.api_name), field));
}

module.exports = {
  LayoutSchemaError,
  asLayoutId,
  layoutList,
  recordLayoutId,
  resolveLayout,
  layoutFields,
  mergeFieldWithLayout,
  mergeLayoutFields,
};
