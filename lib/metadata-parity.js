'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'metadata-parity-audit.json');

const AREA_PROPERTIES = Object.freeze({
  modules: 'modules',
  fields: 'fields',
  layouts: 'layouts',
  views: 'custom_views',
  related_lists: 'related_lists',
  pipelines: 'pipelines',
});

const COMPARISON_IGNORED_KEYS = /^(?:id|.*_id|.*_ids|owner|created_by|modified_by|shared_to|last_accessed_time|web_link|url|href|created_time|modified_time|generated_at|\$.*)$/i;
const SAFE_SCOPE = /^[A-Za-z][A-Za-z0-9_]*$/;
const PUBLIC_FORBIDDEN_KEYS = /^(?:id|ids|source_id|source_ids|organization|organization_id|org_id|url|urls|href|hrefs|path|paths|private_path|credential|credentials|secret|token|hash|sha256|customer_data|identities)$/i;
const PUBLIC_FORBIDDEN_VALUES = [
  /https?:\/\//i,
  /\bwww\./i,
  /\/(?:Users|home|var|tmp|opt|etc)\//i,
  /\.private\//i,
  /\borg\d{6,}\b/i,
  /\b\d{15,}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i,
  /\b(?:api[_ -]?key|authorization|password|secret|token|credential)\b\s*(?:[:=]|is)\s*["']?[A-Z0-9._~+/=-]{8,}/i,
  /\b[A-F0-9]{32,128}\b/i,
];

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseData(value) {
  if (typeof value !== 'string') return object(value);
  try {
    return object(JSON.parse(value));
  } catch {
    throw new Error('Local metadata contains invalid JSON.');
  }
}

function safeScope(value) {
  const scope = String(value || '');
  if (!SAFE_SCOPE.test(scope)) throw new Error('Metadata scope is not safe for the public aggregate.');
  return scope;
}

function isIgnoredKey(key) {
  return COMPARISON_IGNORED_KEYS.test(String(key));
}

function collectSharedDiffPaths(source, local, currentPath = '', output = new Set()) {
  if (source === undefined || local === undefined) return output;
  if (Array.isArray(source) || Array.isArray(local)) {
    if (!Array.isArray(source) || !Array.isArray(local)) {
      output.add(currentPath || 'value');
      return output;
    }
    if (source.length !== local.length) output.add(currentPath || 'value');
    const length = Math.min(source.length, local.length);
    for (let index = 0; index < length; index += 1) {
      collectSharedDiffPaths(source[index], local[index], currentPath, output);
    }
    return output;
  }
  const sourceObject = source && typeof source === 'object';
  const localObject = local && typeof local === 'object';
  if (sourceObject || localObject) {
    if (!sourceObject || !localObject) {
      output.add(currentPath || 'value');
      return output;
    }
    const sharedKeys = Object.keys(source)
      .filter(key => Object.prototype.hasOwnProperty.call(local, key) && !isIgnoredKey(key))
      .sort();
    for (const key of sharedKeys) {
      collectSharedDiffPaths(source[key], local[key], currentPath ? `${currentPath}.${key}` : key, output);
    }
    return output;
  }
  if (!Object.is(source, local)) output.add(currentPath || 'value');
  return output;
}

function definitionKey(area, definition) {
  const item = object(definition);
  if (area === 'modules' || area === 'fields' || area === 'global_picklists' || area === 'field_picklists') {
    return item.api_name ? `api:${item.api_name}` : '';
  }
  // IDs are used only as an in-memory matching key for metadata whose display
  // names are not unique. They are never copied into the public result.
  if (item.id !== undefined && item.id !== null && String(item.id)) return `internal:${String(item.id)}`;
  if (area === 'picklist_options') {
    const option = item.actual_value ?? item.reference_value ?? item.display_value;
    return option === undefined || option === null ? '' : `option:${String(option)}`;
  }
  const fallback = item.api_name || item.system_name || item.name;
  return fallback ? `name:${String(fallback)}` : '';
}

function indexDefinitions(area, definitions) {
  const index = new Map();
  let invalidKeys = 0;
  let duplicateKeys = 0;
  for (const definition of arr(definitions)) {
    const key = definitionKey(area, definition);
    if (!key) {
      invalidKeys += 1;
      continue;
    }
    if (index.has(key)) {
      duplicateKeys += 1;
      continue;
    }
    index.set(key, definition);
  }
  return { index, invalidKeys, duplicateKeys };
}

function compareScopes(area, sourceScopes, localScopes) {
  const scopeNames = [...new Set([...sourceScopes.keys(), ...localScopes.keys()])].sort();
  const totals = {
    source_definitions: 0,
    local_definitions: 0,
    matched_definitions: 0,
    source_only: 0,
    local_only: 0,
    semantic_drift: 0,
  };
  const keyIntegrity = { missing_keys: 0, duplicate_keys: 0 };
  const driftAttributes = new Map();
  const affectedScopes = [];

  for (const scope of scopeNames) {
    safeScope(scope);
    const source = arr(sourceScopes.get(scope));
    const local = arr(localScopes.get(scope));
    totals.source_definitions += source.length;
    totals.local_definitions += local.length;
    const sourceIndex = indexDefinitions(area, source);
    const localIndex = indexDefinitions(area, local);
    keyIntegrity.missing_keys += sourceIndex.invalidKeys + localIndex.invalidKeys;
    keyIntegrity.duplicate_keys += sourceIndex.duplicateKeys + localIndex.duplicateKeys;
    let matched = 0;
    let sourceOnly = 0;
    let localOnly = 0;
    let drift = 0;

    for (const [key, sourceDefinition] of sourceIndex.index) {
      if (!localIndex.index.has(key)) {
        sourceOnly += 1;
        continue;
      }
      matched += 1;
      const paths = collectSharedDiffPaths(sourceDefinition, localIndex.index.get(key));
      if (paths.size) {
        drift += 1;
        for (const diffPath of paths) {
          const attribute = String(diffPath).split('.')[0] || 'value';
          if (!isIgnoredKey(attribute)) driftAttributes.set(attribute, (driftAttributes.get(attribute) || 0) + 1);
        }
      }
    }
    for (const key of localIndex.index.keys()) {
      if (!sourceIndex.index.has(key)) localOnly += 1;
    }

    totals.matched_definitions += matched;
    totals.source_only += sourceOnly;
    totals.local_only += localOnly;
    totals.semantic_drift += drift;
    if (sourceOnly || localOnly || drift) {
      affectedScopes.push({
        scope,
        source_definitions: source.length,
        local_definitions: local.length,
        matched_definitions: matched,
        source_only: sourceOnly,
        local_only: localOnly,
        semantic_drift: drift,
      });
    }
  }

  if (keyIntegrity.missing_keys || keyIntegrity.duplicate_keys) {
    throw new Error(`Cannot reconcile ${area}: definition matching keys are incomplete or duplicated.`);
  }
  const coverage = totals.source_definitions
    ? Number(((totals.local_definitions / totals.source_definitions) * 100).toFixed(2))
    : null;
  return {
    ...totals,
    local_definition_coverage_percent: coverage,
    source_scopes: sourceScopes.size,
    local_scopes: localScopes.size,
    affected_scopes: affectedScopes,
    drift_attributes: [...driftAttributes]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([attribute, definitions]) => ({ attribute, definitions })),
  };
}

function statusCount(results) {
  const counts = new Map();
  for (const result of results) {
    const status = Number.isInteger(result?.status) ? result.status : 0;
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left - right)
    .map(([http_status, requests]) => ({ http_status, requests }));
}

function captureSummary(requests) {
  const successful = requests.filter(item => item.result?.ok === true);
  const failed = requests.filter(item => item.result?.ok !== true);
  return {
    requests: requests.length,
    successful_requests: successful.length,
    failed_requests: failed.length,
    status_counts: statusCount(requests.map(item => item.result)),
    failed_scopes: [...new Set(failed.map(item => safeScope(item.scope)))].sort(),
    complete: failed.length === 0,
  };
}

function sourceModuleScopes(snapshot, area) {
  const property = AREA_PROPERTIES[area];
  const scopes = new Map();
  const requests = [];
  for (const entry of arr(snapshot.modules)) {
    const scope = safeScope(entry?.module?.api_name);
    const result = entry?.results?.[area] || {};
    scopes.set(scope, arr(result?.data?.[property]));
    requests.push({ scope, result });
  }
  return { scopes, capture: captureSummary(requests) };
}

function sourcePipelineScopes(snapshot) {
  const scopes = new Map();
  const requests = [];
  for (const entry of arr(snapshot.modules)) {
    const scope = safeScope(entry?.module?.api_name);
    const definitions = [];
    for (const result of arr(entry?.results?.pipelines)) {
      requests.push({ scope, result });
      const data = object(result?.data);
      definitions.push(...arr(data.pipelines), ...arr(data.pipeline));
    }
    scopes.set(scope, definitions);
  }
  return { scopes, capture: captureSummary(requests) };
}

function localScopes(localRows, area) {
  const property = AREA_PROPERTIES[area];
  const scopes = new Map();
  for (const row of arr(localRows)) {
    if (!String(row?.key || '').startsWith(`${area}:`)) continue;
    const scope = safeScope(String(row.key).slice(area.length + 1));
    scopes.set(scope, arr(parseData(row.data)[property]));
  }
  return scopes;
}

function moduleScopes(snapshot, localRows) {
  const sourceResult = object(snapshot?.global?.modules);
  const localRow = arr(localRows).find(row => row?.key === 'modules');
  return {
    source: new Map([['Global', arr(sourceResult?.data?.modules)]]),
    local: new Map([['Global', arr(parseData(localRow?.data).modules)]]),
    capture: captureSummary([{ scope: 'Global', result: sourceResult }]),
  };
}

function pipelineLocalScopes(localRows) {
  const scopes = localScopes(localRows, 'pipelines');
  const globalRow = arr(localRows).find(row => row?.key === 'pipelines');
  if (globalRow) scopes.set('Global', arr(parseData(globalRow.data).pipelines));
  return scopes;
}

function isFieldPicklist(field) {
  return /picklist/i.test(String(field?.data_type || '')) || arr(field?.pick_list_values).length > 0;
}

function fieldPicklistDefinition(field) {
  return {
    api_name: field.api_name,
    data_type: field.data_type,
    global_picklist: field.global_picklist,
    pick_list_values_sorted_lexically: field.pick_list_values_sorted_lexically,
    pick_list_values: arr(field.pick_list_values),
  };
}

function sourceFieldPicklistScopes(snapshot) {
  const scopes = new Map();
  for (const entry of arr(snapshot.modules)) {
    const scope = safeScope(entry?.module?.api_name);
    const fields = arr(entry?.results?.fields?.data?.fields);
    scopes.set(scope, fields.filter(isFieldPicklist).map(fieldPicklistDefinition));
  }
  return scopes;
}

function localFieldPicklistScopes(localRows) {
  const scopes = new Map();
  for (const [scope, fields] of localScopes(localRows, 'fields')) {
    scopes.set(scope, fields.filter(isFieldPicklist).map(fieldPicklistDefinition));
  }
  return scopes;
}

function globalPicklistScopes(snapshot, localRows) {
  const sourceResult = object(snapshot?.global?.global_picklists);
  const localRow = arr(localRows).find(row => row?.key === 'global_picklists');
  return {
    source: new Map([['Global', arr(sourceResult?.data?.global_picklists)]]),
    local: localRow
      ? new Map([['Global', arr(parseData(localRow.data).global_picklists)]])
      : new Map(),
    capture: captureSummary([{ scope: 'Global', result: sourceResult }]),
  };
}

function optionCounts(scopes) {
  let definitions_with_values = 0;
  let option_values = 0;
  for (const definitions of scopes.values()) {
    for (const definition of definitions) {
      const options = arr(definition.pick_list_values);
      if (options.length) definitions_with_values += 1;
      option_values += options.length;
    }
  }
  return { definitions_with_values, option_values };
}

function compareFieldPicklistOptions(sourceScopes, localScopes) {
  const totals = {
    source_field_option_values: 0,
    local_field_option_values: 0,
    matched_field_option_values: 0,
    source_only_field_option_values: 0,
    local_only_field_option_values: 0,
    field_option_semantic_drift: 0,
  };
  for (const scope of new Set([...sourceScopes.keys(), ...localScopes.keys()])) {
    const sourceFields = indexDefinitions('field_picklists', sourceScopes.get(scope));
    const localFields = indexDefinitions('field_picklists', localScopes.get(scope));
    if (sourceFields.invalidKeys || sourceFields.duplicateKeys || localFields.invalidKeys || localFields.duplicateKeys) {
      throw new Error('Cannot reconcile picklist options: field keys are incomplete or duplicated.');
    }
    for (const sourceField of sourceFields.index.values()) totals.source_field_option_values += arr(sourceField.pick_list_values).length;
    for (const localField of localFields.index.values()) totals.local_field_option_values += arr(localField.pick_list_values).length;

    for (const [fieldKey, sourceField] of sourceFields.index) {
      const sourceOptions = arr(sourceField.pick_list_values);
      if (!localFields.index.has(fieldKey)) {
        totals.source_only_field_option_values += sourceOptions.length;
        continue;
      }
      const localOptions = arr(localFields.index.get(fieldKey).pick_list_values);
      const sourceIndex = indexDefinitions('picklist_options', sourceOptions);
      const localIndex = indexDefinitions('picklist_options', localOptions);
      if (sourceIndex.invalidKeys || sourceIndex.duplicateKeys || localIndex.invalidKeys || localIndex.duplicateKeys) {
        throw new Error('Cannot reconcile picklist options: option keys are incomplete or duplicated.');
      }
      for (const [optionKey, sourceOption] of sourceIndex.index) {
        if (!localIndex.index.has(optionKey)) {
          totals.source_only_field_option_values += 1;
          continue;
        }
        totals.matched_field_option_values += 1;
        if (collectSharedDiffPaths(sourceOption, localIndex.index.get(optionKey)).size) {
          totals.field_option_semantic_drift += 1;
        }
      }
      for (const optionKey of localIndex.index.keys()) {
        if (!sourceIndex.index.has(optionKey)) totals.local_only_field_option_values += 1;
      }
    }
    for (const [fieldKey, localField] of localFields.index) {
      if (!sourceFields.index.has(fieldKey)) {
        totals.local_only_field_option_values += arr(localField.pick_list_values).length;
      }
    }
  }
  return totals;
}

function areaStatus(comparison, capture, forceBlocked = false) {
  if (forceBlocked || !capture.complete || comparison.source_only || comparison.local_only || comparison.semantic_drift) return 'Blocked';
  return 'Reconciled';
}

function combinePicklistComparisons(field, global) {
  const keys = ['source_definitions', 'local_definitions', 'matched_definitions', 'source_only', 'local_only', 'semantic_drift'];
  const output = Object.fromEntries(keys.map(key => [key, field[key] + global[key]]));
  output.local_definition_coverage_percent = output.source_definitions
    ? Number(((output.local_definitions / output.source_definitions) * 100).toFixed(2))
    : null;
  output.source_scopes = field.source_scopes + global.source_scopes;
  output.local_scopes = field.local_scopes + global.local_scopes;
  output.affected_scopes = [
    ...field.affected_scopes.map(item => ({ kind: 'field', ...item })),
    ...global.affected_scopes.map(item => ({ kind: 'global', ...item })),
  ];
  output.drift_attributes = [...field.drift_attributes, ...global.drift_attributes];
  return output;
}

function assertNoSensitivePublicData(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitivePublicData);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (PUBLIC_FORBIDDEN_KEYS.test(key)) throw new Error('Metadata parity output contains a forbidden sensitive key.');
      assertNoSensitivePublicData(child);
    }
    return;
  }
  if (typeof value === 'string' && PUBLIC_FORBIDDEN_VALUES.some(pattern => pattern.test(value))) {
    throw new Error('Metadata parity output contains a forbidden sensitive value.');
  }
}

function buildMetadataParityAudit(snapshotInput, localRowsInput, generatedAt = new Date().toISOString()) {
  const snapshot = object(snapshotInput);
  const localRows = arr(localRowsInput);
  const modules = moduleScopes(snapshot, localRows);
  const sourceFields = sourceModuleScopes(snapshot, 'fields');
  const sourceLayouts = sourceModuleScopes(snapshot, 'layouts');
  const sourceViews = sourceModuleScopes(snapshot, 'views');
  const sourceRelated = sourceModuleScopes(snapshot, 'related_lists');
  const sourcePipelines = sourcePipelineScopes(snapshot);

  const moduleComparison = compareScopes('modules', modules.source, modules.local);
  const fieldComparison = compareScopes('fields', sourceFields.scopes, localScopes(localRows, 'fields'));
  const layoutComparison = compareScopes('layouts', sourceLayouts.scopes, localScopes(localRows, 'layouts'));
  const viewComparison = compareScopes('views', sourceViews.scopes, localScopes(localRows, 'views'));
  const relatedComparison = compareScopes('related_lists', sourceRelated.scopes, localScopes(localRows, 'related_lists'));
  const pipelineComparison = compareScopes('pipelines', sourcePipelines.scopes, pipelineLocalScopes(localRows));

  const sourceFieldPicklists = sourceFieldPicklistScopes(snapshot);
  const localFieldPicklists = localFieldPicklistScopes(localRows);
  const globalPicklists = globalPicklistScopes(snapshot, localRows);
  const fieldPicklistComparison = compareScopes('field_picklists', sourceFieldPicklists, localFieldPicklists);
  const globalPicklistComparison = compareScopes('global_picklists', globalPicklists.source, globalPicklists.local);
  const picklistComparison = combinePicklistComparisons(fieldPicklistComparison, globalPicklistComparison);
  const sourceOptions = optionCounts(sourceFieldPicklists);
  const localOptions = optionCounts(localFieldPicklists);
  const optionComparison = compareFieldPicklistOptions(sourceFieldPicklists, localFieldPicklists);

  const areas = {
    modules: { ...moduleComparison, source_capture: modules.capture },
    fields: { ...fieldComparison, source_capture: sourceFields.capture },
    layouts: { ...layoutComparison, source_capture: sourceLayouts.capture },
    picklists: {
      ...picklistComparison,
      source_capture: {
        field_metadata: sourceFields.capture,
        global_picklists: globalPicklists.capture,
      },
      components: {
        field_picklists: fieldPicklistComparison,
        global_picklists: globalPicklistComparison,
      },
      option_coverage: {
        ...optionComparison,
        source_definitions_with_values: sourceOptions.definitions_with_values,
        local_definitions_with_values: localOptions.definitions_with_values,
        captured_global_option_values: false,
      },
    },
    pipelines: { ...pipelineComparison, source_capture: sourcePipelines.capture },
    custom_views: {
      ...viewComparison,
      source_capture: sourceViews.capture,
      criteria_coverage: {
        captured_rows: [...sourceViews.scopes.values()].reduce((sum, rows) => sum + rows.length, 0),
        captured_rows_with_criteria: [...sourceViews.scopes.values()].reduce((sum, rows) => sum + rows.filter(row => Object.prototype.hasOwnProperty.call(row || {}, 'criteria')).length, 0),
        local_rows_with_criteria: [...localScopes(localRows, 'views').values()].reduce((sum, rows) => sum + rows.filter(row => Object.prototype.hasOwnProperty.call(row || {}, 'criteria')).length, 0),
      },
    },
    related_lists: { ...relatedComparison, source_capture: sourceRelated.capture },
  };

  areas.modules.status = areaStatus(moduleComparison, modules.capture);
  areas.fields.status = areaStatus(fieldComparison, sourceFields.capture);
  areas.layouts.status = areaStatus(layoutComparison, sourceLayouts.capture);
  areas.picklists.status = areaStatus(picklistComparison, {
    complete: sourceFields.capture.complete && globalPicklists.capture.complete,
  });
  areas.pipelines.status = areaStatus(pipelineComparison, sourcePipelines.capture, true);
  areas.custom_views.status = areaStatus(viewComparison, sourceViews.capture);
  areas.related_lists.status = areaStatus(relatedComparison, sourceRelated.capture);

  const blockers = [];
  const definitionGaps = [
    ['fields', fieldComparison],
    ['layouts', layoutComparison],
    ['field picklists', fieldPicklistComparison],
    ['custom views', viewComparison],
    ['related lists', relatedComparison],
  ].filter(([, comparison]) => comparison.source_only || comparison.local_only);
  if (definitionGaps.length) {
    blockers.push(`Captured definition gaps remain: ${definitionGaps.map(([label, comparison]) => `${label} ${comparison.source_only} source-only / ${comparison.local_only} local-only`).join('; ')}.`);
  }
  const incompleteCaptures = [
    ['field', sourceFields.capture],
    ['layout', sourceLayouts.capture],
    ['custom-view', sourceViews.capture],
    ['related-list', sourceRelated.capture],
  ].filter(([, capture]) => !capture.complete);
  if (incompleteCaptures.length) {
    blockers.push(`Captured source evidence remains incomplete: ${incompleteCaptures.map(([label, capture]) => `${label} ${capture.failed_requests}/${capture.requests} failed requests`).join('; ')}. Definitions behind failed scopes are unknown.`);
  }
  if (viewComparison.semantic_drift) blockers.push(`${viewComparison.semantic_drift} matched custom-view definitions differ on shared semantic attributes.`);
  const missingViewCriteria = areas.custom_views.criteria_coverage.captured_rows - areas.custom_views.criteria_coverage.captured_rows_with_criteria;
  if (missingViewCriteria) blockers.push(`${missingViewCriteria} captured custom-view list rows do not include executable criteria bodies and remain fail-closed.`);
  blockers.push(`Pipeline evidence is incomplete: ${sourcePipelines.capture.failed_requests} of ${sourcePipelines.capture.requests} captured requests failed, with ${pipelineComparison.source_definitions} source and ${pipelineComparison.local_definitions} local definitions available for comparison.`);
  if (globalPicklistComparison.source_only || !areas.picklists.option_coverage.captured_global_option_values) {
    blockers.push(`${globalPicklistComparison.source_only} captured global picklist definitions are absent locally, and the captured global catalog does not include option values.`);
  }

  const output = {
    schema_version: 1,
    generated_at: String(generatedAt),
    mode: 'read-only metadata audit',
    evidence: 'existing private source discovery plus restricted local metadata query',
    parity_status: 'Blocked',
    comparison_rule: 'Definitions match by stable configuration key or internal-only ID; drift compares shared non-sensitive semantic attributes and omits identifiers, identities, links, and volatile audit fields.',
    areas,
    blockers,
    mutation_boundary: {
      source_calls_enabled: false,
      source_writes_enabled: false,
      local_metadata_writes_enabled: false,
      updater_available: false,
      automatic_delete_enabled: false,
      status: 'Blocked',
      reason: 'This artifact is audit-only. A separate guarded hydrator may insert missing successfully captured local definitions, but this adapter cannot mutate metadata.',
    },
    privacy: {
      customer_records_exposed: false,
      identities_exposed: false,
      raw_source_identifiers_exposed: false,
      links_exposed: false,
      credentials_exposed: false,
      private_locations_exposed: false,
      hashes_exposed: false,
    },
  };
  assertNoSensitivePublicData(output);
  return output;
}

function validateMetadataParityAudit(input) {
  const audit = structuredClone(object(input));
  if (audit.schema_version !== 1 || audit.parity_status !== 'Blocked') throw new Error('Metadata parity audit must remain fail-closed.');
  for (const key of ['source_calls_enabled', 'source_writes_enabled', 'local_metadata_writes_enabled', 'updater_available', 'automatic_delete_enabled']) {
    if (audit.mutation_boundary?.[key] !== false) throw new Error('Metadata parity mutation boundary must remain fail-closed.');
  }
  for (const area of ['modules', 'fields', 'layouts', 'picklists', 'pipelines', 'custom_views', 'related_lists']) {
    const counts = audit.areas?.[area];
    const countKeys = ['source_definitions', 'local_definitions', 'matched_definitions', 'source_only', 'local_only', 'semantic_drift'];
    if (!counts || countKeys.some(key => !Number.isInteger(counts[key]) || counts[key] < 0)) {
      throw new Error(`Metadata parity ${area} counts are invalid.`);
    }
    if (counts.source_definitions !== counts.matched_definitions + counts.source_only
        || counts.local_definitions !== counts.matched_definitions + counts.local_only
        || counts.semantic_drift > counts.matched_definitions) {
      throw new Error(`Metadata parity ${area} counts do not reconcile.`);
    }
    if (!Array.isArray(counts.affected_scopes)) throw new Error(`Metadata parity ${area} scope summary is invalid.`);
    const affected = counts.affected_scopes.reduce((sum, scope) => ({
      sourceOnly: sum.sourceOnly + Number(scope.source_only || 0),
      localOnly: sum.localOnly + Number(scope.local_only || 0),
      drift: sum.drift + Number(scope.semantic_drift || 0),
    }), { sourceOnly: 0, localOnly: 0, drift: 0 });
    if (affected.sourceOnly !== counts.source_only || affected.localOnly !== counts.local_only || affected.drift !== counts.semantic_drift) {
      throw new Error(`Metadata parity ${area} scope summary does not reconcile.`);
    }
    if (counts.status === 'Reconciled' && (counts.source_only || counts.local_only || counts.semantic_drift)) {
      throw new Error(`Metadata parity ${area} cannot be marked reconciled.`);
    }
  }
  if (audit.areas.pipelines.status !== 'Blocked') throw new Error('Pipeline parity must remain fail-closed.');
  const fieldPicklists = audit.areas.picklists.components?.field_picklists;
  const globalPicklists = audit.areas.picklists.components?.global_picklists;
  for (const key of ['source_definitions', 'local_definitions', 'matched_definitions', 'source_only', 'local_only', 'semantic_drift']) {
    if (audit.areas.picklists[key] !== Number(fieldPicklists?.[key] || 0) + Number(globalPicklists?.[key] || 0)) {
      throw new Error('Picklist component counts do not reconcile.');
    }
  }
  if (!audit.privacy || Object.values(audit.privacy).some(value => value !== false)) {
    throw new Error('Metadata parity privacy boundary must remain fail-closed.');
  }
  assertNoSensitivePublicData(audit);
  return audit;
}

function getMetadataParityAudit(configPath = DEFAULT_CONFIG_PATH) {
  return validateMetadataParityAudit(JSON.parse(fs.readFileSync(configPath, 'utf8')));
}

function blockedError() {
  const error = new Error('Metadata mutation is blocked; this adapter is audit-only.');
  error.code = 'METADATA_MUTATION_BLOCKED';
  return error;
}

function createMetadataParityAdapter(configPath = DEFAULT_CONFIG_PATH) {
  return Object.freeze({
    getAudit: () => getMetadataParityAudit(configPath),
    fetchSourceMetadata: () => { throw blockedError(); },
    applyLocalMetadataUpdate: () => { throw blockedError(); },
    deleteLocalMetadata: () => { throw blockedError(); },
  });
}

module.exports = {
  AREA_PROPERTIES,
  collectSharedDiffPaths,
  compareScopes,
  captureSummary,
  assertNoSensitivePublicData,
  buildMetadataParityAudit,
  validateMetadataParityAudit,
  getMetadataParityAudit,
  createMetadataParityAdapter,
};
