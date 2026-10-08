'use strict';

const finiteNumber = value => value === null || value === undefined || value === ''
  ? null
  : (Number.isFinite(Number(value)) ? Number(value) : null);
const nonNegative = value => {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
};

function buildReconciliationEvidence(dataCompleteness = {}, taskSubformReconciliation = {}) {
  const modules = {};
  const notes = dataCompleteness && typeof dataCompleteness.notes === 'object'
    ? dataCompleteness.notes
    : null;
  const noteSource = nonNegative(notes?.source_active_id_count);
  const noteLocal = nonNegative(notes?.local_source_derived_id_count);
  const noteSourceOnly = nonNegative(notes?.source_only_id_count);
  const noteLocalOnly = nonNegative(notes?.local_only_source_id_count);

  if (notes && noteSource !== null && noteLocal !== null) {
    modules.Notes = {
      module: 'Notes',
      evidence_kind: 'active-id-audit',
      audited_at: typeof dataCompleteness.audited_at === 'string' ? dataCompleteness.audited_at : null,
      source_active_ids: noteSource,
      local_active_ids: noteLocal,
      source_only_active_ids: noteSourceOnly,
      local_only_active_ids: noteLocalOnly,
      active_id_parity: notes.id_parity === true
        && noteSource === noteLocal
        && noteSourceOnly === 0
        && noteLocalOnly === 0,
      count_scope_kind: 'aggregate-scope',
      captured_count_endpoint: nonNegative(notes.source_count_endpoint),
      exact_payloads_verified: notes.content_comparison ? 1 : 0,
    };
  }

  const datasets = Array.isArray(taskSubformReconciliation?.datasets)
    ? taskSubformReconciliation.datasets
    : [];
  for (const dataset of datasets) {
    if (!dataset || typeof dataset.module !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(dataset.module)) continue;
    const sourceActive = nonNegative(dataset.source_active_ids);
    const localActive = nonNegative(dataset.local_after);
    const sourceOnly = nonNegative(dataset.source_only_after);
    const localOnly = nonNegative(dataset.local_only_after);
    if (sourceActive === null || localActive === null) continue;
    const countOnly = nonNegative(dataset.count_only_unavailable) || 0;
    modules[dataset.module] = {
      module: dataset.module,
      evidence_kind: dataset.module === 'Tasks' ? 'active-id-audit' : 'generated-child-active-id-audit',
      audited_at: typeof taskSubformReconciliation.audited_at === 'string' ? taskSubformReconciliation.audited_at : null,
      source_active_ids: sourceActive,
      local_active_ids: localActive,
      source_only_active_ids: sourceOnly,
      local_only_active_ids: localOnly,
      active_id_parity: sourceActive === localActive && sourceOnly === 0 && localOnly === 0,
      count_scope_kind: countOnly > 0 ? 'count-only' : null,
      count_only_unavailable: countOnly,
      captured_count_endpoint: nonNegative(dataset.source_count_endpoint),
      exact_payloads_verified: nonNegative(dataset.historical_exact_payloads_verified)
        ?? nonNegative(dataset.exact_payloads_verified)
        ?? 0,
    };
  }

  const childModules = Object.values(modules).filter(item => item.evidence_kind === 'generated-child-active-id-audit');
  return {
    modules,
    summary: {
      child_source_active_ids: childModules.reduce((sum, item) => sum + item.source_active_ids, 0),
      child_local_active_ids: childModules.reduce((sum, item) => sum + item.local_active_ids, 0),
      child_count_only_unavailable: childModules.reduce((sum, item) => sum + item.count_only_unavailable, 0),
      child_active_id_parity: childModules.length > 0 && childModules.every(item => item.active_id_parity),
    },
  };
}

function resolveModuleEvidence(evidence, moduleName, sourceCountEndpoint) {
  const item = evidence?.modules?.[moduleName];
  if (!item) return null;
  const endpoint = nonNegative(sourceCountEndpoint);
  const capturedEndpoint = nonNegative(item.captured_count_endpoint);
  const effectiveEndpoint = endpoint === null ? capturedEndpoint : endpoint;
  const computedDelta = effectiveEndpoint === null
    ? null
    : Math.max(0, effectiveEndpoint - item.source_active_ids);
  const countEndpointDrift = endpoint !== null
    && capturedEndpoint !== null
    && endpoint !== capturedEndpoint;
  const scopeDelta = item.count_scope_kind === 'count-only'
    ? item.count_only_unavailable
    : computedDelta;
  return {
    ...item,
    source_count_endpoint: effectiveEndpoint,
    count_scope_delta: scopeDelta,
    count_endpoint_drift: countEndpointDrift,
  };
}

module.exports = {
  buildReconciliationEvidence,
  resolveModuleEvidence,
};
