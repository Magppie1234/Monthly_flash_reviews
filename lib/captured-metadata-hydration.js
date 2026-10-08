'use strict';

const DATASETS = Object.freeze([
  Object.freeze({ result: 'fields', keyPrefix: 'fields:', property: 'fields' }),
  Object.freeze({ result: 'layouts', keyPrefix: 'layouts:', property: 'layouts' }),
  Object.freeze({ result: 'views', keyPrefix: 'views:', property: 'custom_views' }),
  Object.freeze({ result: 'related_lists', keyPrefix: 'related_lists:', property: 'related_lists' }),
]);

const SAFE_MODULE = /^[A-Za-z][A-Za-z0-9_]*$/;
const FORBIDDEN_KEY = /(?:^|_)(?:authorization|cookie|credential|credentials|password|secret|token|access_token|refresh_token|api_key)(?:$|_)/i;
const FORBIDDEN_VALUE = /\bbearer\s+[A-Z0-9._~+/=-]{8,}/i;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function moduleName(entry) {
  const name = String(entry?.module?.api_name || '');
  if (!SAFE_MODULE.test(name)) throw new Error('Captured metadata contains an unsafe module API name.');
  return name;
}

function assertNoSecrets(value, currentPath = 'metadata') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${currentPath}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) throw new Error(`Captured metadata contains a forbidden key at ${currentPath}.${key}.`);
      assertNoSecrets(child, `${currentPath}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && FORBIDDEN_VALUE.test(value)) {
    throw new Error(`Captured metadata contains a forbidden credential-shaped value at ${currentPath}.`);
  }
}

function organizationId(value) {
  const source = object(value);
  if (source.data && typeof source.data === 'object' && !Array.isArray(source.data)) {
    return organizationId(source.data);
  }
  const organization = Array.isArray(source.org) ? object(source.org[0]) : source;
  const id = organization.id ?? organization.zgid ?? organization.org_id ?? organization.organization_id;
  return id === null || id === undefined ? '' : String(id);
}

function assertOrganizationMatch(snapshot, localOrg) {
  if (snapshot?.source_mode !== 'read-only' || snapshot?.organization_verified !== true) {
    throw new Error('Captured metadata is not a verified read-only Zoho snapshot.');
  }
  const capturedId = organizationId(snapshot.organization);
  const localId = organizationId(localOrg);
  if (!capturedId || !localId || capturedId !== localId) {
    throw new Error('Captured and local CRM organization identities do not match.');
  }
  return true;
}

function normalizedDataset(result, definition) {
  if (result?.ok !== true || ![200, 204].includes(Number(result.status))) return null;
  const data = object(result.data);
  const values = Array.isArray(data[definition.property]) ? data[definition.property] : [];
  const normalized = { ...data, [definition.property]: values };
  assertNoSecrets(normalized, definition.result);
  return normalized;
}

function buildCapturedMetadataHydrationPlan(snapshot, localKeys = []) {
  if (!Array.isArray(snapshot?.modules) || !snapshot.modules.length) {
    throw new Error('Captured metadata snapshot has no module collection.');
  }
  const existing = new Set([...localKeys].map(String));
  const entries = [];
  const coverage = Object.fromEntries(DATASETS.map(item => [item.result, {
    captured_successful: 0,
    planned_missing: 0,
    preserved_existing: 0,
    capture_unavailable: 0,
    definitions_planned: 0,
  }]));
  const seenModules = new Set();

  for (const entry of snapshot.modules) {
    const module = moduleName(entry);
    if (seenModules.has(module)) throw new Error('Captured metadata contains duplicate module scopes.');
    seenModules.add(module);
    for (const definition of DATASETS) {
      const result = entry?.results?.[definition.result];
      const data = normalizedDataset(result, definition);
      const stats = coverage[definition.result];
      if (!data) {
        stats.capture_unavailable += 1;
        continue;
      }
      stats.captured_successful += 1;
      const key = `${definition.keyPrefix}${module}`;
      if (existing.has(key)) {
        stats.preserved_existing += 1;
        continue;
      }
      stats.planned_missing += 1;
      stats.definitions_planned += data[definition.property].length;
      entries.push({ key, module, dataset: definition.result, data });
    }
  }

  return {
    source_mode: 'read-only-capture',
    overwrite_existing: false,
    module_scopes: seenModules.size,
    entries,
    coverage,
  };
}

module.exports = {
  DATASETS,
  assertNoSecrets,
  assertOrganizationMatch,
  buildCapturedMetadataHydrationPlan,
  organizationId,
};
