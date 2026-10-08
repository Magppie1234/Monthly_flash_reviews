'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { getBlueprintStudioCatalog } = require('../lib/blueprint-studio');
const { buildWorkflowStudioCatalog } = require('../lib/workflow-studio');
const workflowRuntime = require('../config/workflow-runtime.json');

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const studioSource = fs.readFileSync(path.join(root, 'public', 'automation-studios.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

const blueprintCatalog = getBlueprintStudioCatalog();
const workflowCatalog = buildWorkflowStudioCatalog(workflowRuntime);

function stripMarkup(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.className = '';
    this.children = [];
    this.attributes = {};
    this._innerHTML = '';
    this._textContent = '';
    this.value = '';
    this.type = '';
    this.placeholder = '';
    this.open = false;
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this._textContent = '';
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this._innerHTML = '';
    this.children = [];
  }

  get textContent() {
    return [this._textContent || stripMarkup(this._innerHTML), ...this.children.map(child => child.textContent)]
      .filter(Boolean)
      .join(' ');
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  prepend(child) {
    this.children.unshift(child);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

function flatten(rootNode) {
  const output = [rootNode];
  rootNode.children.forEach(child => output.push(...flatten(child)));
  return output;
}

function hasClass(node, className) {
  return String(node.className || '').split(/\s+/).includes(className);
}

function nodesByClass(rootNode, className) {
  return flatten(rootNode).filter(node => hasClass(node, className));
}

function normalizedText(node) {
  return node.textContent.replace(/\s+/g, ' ').trim();
}

function createRenderHarness({ blueprint = blueprintCatalog, workflow = workflowCatalog } = {}) {
  const content = new FakeElement('main');
  const activeTabs = [];
  const requestedEndpoints = [];
  const document = {
    createElement: tagName => new FakeElement(tagName),
  };
  const el = (tagName, className, html) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (html !== null && html !== undefined) element.innerHTML = html;
    return element;
  };
  const context = vm.createContext({
    document,
    location: { hash: '' },
    state: { nav: 0, current: null },
    el,
    esc: value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]),
    $: selector => {
      assert.equal(selector, '#content');
      return content;
    },
    setActiveTab: value => activeTabs.push(value),
    api: async endpoint => {
      requestedEndpoints.push(endpoint);
      if (endpoint === '/api/meta/blueprint_studio') return blueprint;
      if (endpoint === '/api/meta/workflow_studio') return workflow;
      throw new Error(`Unexpected endpoint ${endpoint}`);
    },
  });
  vm.runInContext(studioSource, context, { filename: 'public/automation-studios.js' });
  return { activeTabs, content, context, requestedEndpoints };
}

test('server endpoints, script order, routes, and sidebar entries are wired exactly once', () => {
  assert.match(serverSource, /app\.get\('\/api\/meta\/blueprint_studio',[\s\S]*?blueprintAtomicRuntime\.initialize\(\)[\s\S]*?getBlueprintStudioCatalog\(atomicRuntime\)/);
  assert.match(serverSource, /app\.get\('\/api\/meta\/workflow_studio',[\s\S]*?buildWorkflowStudioCatalog\(workflowRuntimeConfig\)\)\);/);
  assert.equal((serverSource.match(/\/api\/meta\/blueprint_studio/g) || []).length, 1);
  assert.equal((serverSource.match(/\/api\/meta\/workflow_studio/g) || []).length, 1);

  const studioScript = indexSource.indexOf('<script src="/automation-studios.js"></script>');
  const appScript = indexSource.indexOf('<script src="/app.js"></script>');
  assert.ok(studioScript >= 0 && appScript > studioScript, 'Studio functions must load before app.js calls boot and route');

  assert.match(appSource, /const blueprints = el\('button', 'tab', 'Blueprints'\);[\s\S]*?location\.hash = '#\/blueprints'/);
  assert.match(appSource, /blueprints\.dataset\.mod = '__blueprints'/);
  assert.match(appSource, /const workflows = el\('button', 'tab', 'Workflow Rules'\);[\s\S]*?location\.hash = '#\/workflows'/);
  assert.match(appSource, /workflows\.dataset\.mod = '__workflows'/);
  assert.match(appSource, /if \(active\) d\.setAttribute\('aria-current', 'page'\);/);
  assert.match(appSource, /else d\.removeAttribute\('aria-current'\);/);
  assert.match(appSource, /parts\[0\] === 'blueprints'[\s\S]*?renderBlueprintStudio\(\)/);
  assert.match(appSource, /parts\[0\] === 'workflows'[\s\S]*?renderWorkflowStudio\(\)/);
});

test('Studio endpoints expose the complete reviewed catalogs and no private payloads', () => {
  assert.deepEqual({
    blueprints: blueprintCatalog.coverage.blueprint_count,
    states: blueprintCatalog.coverage.state_count,
    transitions: blueprintCatalog.coverage.transition_count,
    connections: blueprintCatalog.coverage.connection_count,
    phases: blueprintCatalog.coverage.phase_detail_count,
  }, { blueprints: 7, states: 175, transitions: 202, connections: 245, phases: 202 });
  assert.deepEqual({
    rules: workflowCatalog.aggregates.total_rules,
    detailed: workflowCatalog.aggregates.detailed_rules,
    active: workflowCatalog.aggregates.active_rules,
    eligible: workflowCatalog.aggregates.eligible_plan_only_rules,
    blocked: workflowCatalog.aggregates.blocked_active_rules,
    inactive: workflowCatalog.aggregates.inactive_rules,
  }, { rules: 44, detailed: 44, active: 39, eligible: 4, blocked: 35, inactive: 5 });
  assert.equal(blueprintCatalog.execution_boundary.customer_records_included, false);
  assert.equal(blueprintCatalog.execution_boundary.credentials_included, false);
  assert.equal(blueprintCatalog.execution_boundary.filesystem_locations_included, false);
  assert.equal(blueprintCatalog.coverage.policy_eligible_transition_count, 5);
  assert.equal(blueprintCatalog.coverage.policy_blocked_transition_count, 197);
  assert.equal(blueprintCatalog.coverage.atomic_runtime_ready_transition_count, 0);
  assert.deepEqual(workflowCatalog.privacy, {
    crm_records_included: false,
    credentials_included: false,
    private_paths_included: false,
    external_targets_included: false,
    source_code_included: false,
  });

  const serialized = JSON.stringify([blueprintCatalog, workflowCatalog]);
  assert.doesNotMatch(serialized, /https?:\/\/|file:\/\/|\/Users\/|\.private[\\/]/i);
  assert.doesNotMatch(serialized, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(serialized, /\bbearer\s|password\s*[:=]|api[_ -]?key\s*[:=]/i);
});

test('Blueprint Studio renders every Blueprint, state, and transition with all required controls and phases', async () => {
  const harness = createRenderHarness();
  await vm.runInContext('renderBlueprintStudio()', harness.context);
  assert.deepEqual(harness.requestedEndpoints, ['/api/meta/blueprint_studio']);
  assert.deepEqual(harness.activeTabs, ['__blueprints']);

  const nodes = flatten(harness.content);
  assert.equal(nodesByClass(harness.content, 'studio-metric').length, 6);
  assert.deepEqual(nodesByClass(harness.content, 'studio-metric').map(node => normalizedText(node).split(' ')[0]), [
    'Blueprints', 'Transitions', 'Mandatory', 'Policy', 'Atomic', 'After',
  ]);
  assert.equal(nodesByClass(harness.content, 'studio-catalog-card').length, 7);
  assert.equal(nodesByClass(harness.content, 'studio-state').length, 175);
  assert.equal(nodesByClass(harness.content, 'studio-connections').length, 7);
  assert.equal(nodesByClass(harness.content, 'studio-connection-row').length, 245);
  assert.ok(nodesByClass(harness.content, 'studio-connection-row').every(node => node.children.length === 3));
  assert.equal(nodesByClass(harness.content, 'studio-transition').length, 202);

  const phases = nodesByClass(harness.content, 'studio-phase-title').map(normalizedText);
  assert.equal(phases.filter(value => value.startsWith('Before')).length, 202);
  assert.equal(phases.filter(value => value.startsWith('During')).length, 202);
  assert.equal(phases.filter(value => value.startsWith('After')).length, 202);
  assert.match(normalizedText(harness.content), /7 Blueprints · 202 transitions/);
  assert.match(normalizedText(harness.content), /The complete seven-Blueprint catalog is visible/);
  assert.match(normalizedText(harness.content), /5 transitions are policy eligible, 197 are policy blocked/);
  assert.match(normalizedText(harness.content), /zero are atomically runtime-ready/);
  assert.match(normalizedText(harness.content), /Exact SQL verification alone is not sufficient/);
  assert.match(normalizedText(harness.content), /request-principal authorization and audit-actor binding/);
  assert.match(normalizedText(harness.content), /Zoho writes and outbound actions remain disabled/);

  const filterLabels = nodesByClass(harness.content, 'studio-filter-field');
  assert.deepEqual(filterLabels.map(node => normalizedText(node.children[0])), ['Search', 'Module', 'Execution']);
  const search = nodes.find(node => node.tagName === 'INPUT' && node.type === 'search');
  assert.equal(search.attributes['aria-label'], 'Search Blueprint catalog');
  assert.ok(nodes.some(node => node.tagName === 'OPTION' && normalizedText(node) === 'All modules'));
  assert.ok(nodes.some(node => node.tagName === 'OPTION' && normalizedText(node) === 'All policy states'));
  assert.ok(nodes.some(node => node.tagName === 'OPTION' && normalizedText(node) === 'Policy eligible'));
  assert.ok(nodes.some(node => node.tagName === 'OPTION' && normalizedText(node) === 'Policy blocked'));
  assert.equal(nodesByClass(harness.content, 'studio-transition').filter(node => /Policy eligible · atomic unavailable/.test(normalizedText(node))).length, 5);
  const resultCount = nodesByClass(harness.content, 'studio-result-count')[0];
  assert.equal(resultCount.attributes.role, 'status');
  assert.equal(resultCount.attributes['aria-live'], 'polite');
});

test('Workflow Studio renders all 44 rules with required metrics, filters, plans, and boundary text', async () => {
  const harness = createRenderHarness();
  await vm.runInContext('renderWorkflowStudio()', harness.context);
  assert.deepEqual(harness.requestedEndpoints, ['/api/meta/workflow_studio']);
  assert.deepEqual(harness.activeTabs, ['__workflows']);

  const nodes = flatten(harness.content);
  assert.equal(nodesByClass(harness.content, 'studio-metric').length, 5);
  assert.deepEqual(nodesByClass(harness.content, 'studio-metric').map(node => normalizedText(node).split(' ')[0]), [
    'Rules', 'Active', 'Plan', 'Blocked', 'Referenced',
  ]);
  assert.equal(nodesByClass(harness.content, 'workflow-rule').length, 44);
  assert.equal(nodesByClass(harness.content, 'workflow-detail-grid').length, 44);
  assert.equal(nodesByClass(harness.content, 'workflow-blockers').length, 40);
  assert.match(normalizedText(harness.content), /44 of 44 rules/);
  assert.match(normalizedText(harness.content), /All 44 rules are visible/);
  assert.match(normalizedText(harness.content), /One reviewed function adapter can produce a deterministic plan/);
  assert.match(normalizedText(harness.content), /Mark Visit Done remains blocked until its parameter bindings are authoritative/);
  assert.match(normalizedText(harness.content), /Expected_Closing_Date_Change_Counter ← current whole number \+ 1; blank starts at 0/);
  assert.match(normalizedText(harness.content), /FUNCTION PARAMETER BINDING UNVERIFIED/);
  assert.match(normalizedText(harness.content), /does not expose authoritative function parameter-to-field bindings/);
  assert.match(normalizedText(harness.content), /Reviewed adapter · plan only/);

  const phaseTitles = nodesByClass(harness.content, 'studio-phase-title').map(normalizedText);
  assert.equal(phaseTitles.filter(value => value.startsWith('Trigger')).length, 44);
  assert.equal(phaseTitles.filter(value => value.startsWith('Local plan')).length, 44);
  assert.equal(nodesByClass(harness.content, 'workflow-blocker').length,
    workflowCatalog.rules.reduce((sum, rule) => sum + rule.block_reasons.length, 0));

  const filterLabels = nodesByClass(harness.content, 'studio-filter-field');
  assert.deepEqual(filterLabels.map(node => normalizedText(node.children[0])), ['Search', 'Module', 'Status', 'Trigger']);
  const search = nodes.find(node => node.tagName === 'INPUT' && node.type === 'search');
  assert.equal(search.attributes['aria-label'], 'Search Workflow Rules');
  for (const label of ['All statuses', 'Eligible plan only', 'Blocked active', 'Inactive', 'All trigger types']) {
    assert.ok(nodes.some(node => node.tagName === 'OPTION' && normalizedText(node) === label), label);
  }
  const resultCount = nodesByClass(harness.content, 'studio-result-count')[0];
  assert.equal(resultCount.attributes.role, 'status');
  assert.equal(resultCount.attributes['aria-live'], 'polite');
});

test('Blueprint Studio boundary derives atomic-ready wording from the returned runtime coverage', async () => {
  const verifiedCatalog = getBlueprintStudioCatalog({
    verification_complete: true,
    catalog_verified: true,
    fail_closed_canary_rejected: true,
    database_changes: 0,
    request_principal_verified: true,
    identity_authorization_verified: true,
    audit_actor_binding_verified: true,
    runtime_executable: true,
  });
  const harness = createRenderHarness({ blueprint: verifiedCatalog });
  await vm.runInContext('renderBlueprintStudio()', harness.context);
  assert.match(normalizedText(harness.content), /5 transitions are policy eligible, 197 are policy blocked/);
  assert.match(normalizedText(harness.content), /5 are atomically runtime-ready after exact verification/);
  assert.doesNotMatch(normalizedText(harness.content), /zero are atomically runtime-ready/);
});

test('rendered catalogs omit raw evidence and use native labeled in-page controls', async () => {
  assert.match(studioSource, /function studioText\([\s\S]*?node\.textContent = String\(value \?\? ''\);/);
  for (const safeExpression of [
    /studioText\('b', null, transition\.name\)/,
    /studioText\('b', null, blueprint\.name\)/,
    /studioText\('span', 'studio-connection-state', connection\.from_state\.name\)/,
    /studioText\('span', 'studio-connection-state', connection\.to_state\.name\)/,
    /studioText\('b', null, rule\.name\)/,
    /studioText\('span', null, reason\.message\)/,
  ]) assert.match(studioSource, safeExpression);
  const forbiddenMembers = [
    'source_evidence', 'owner_details', 'criteria_tree', 'entry_criteria_tree', 'details_available',
    'target', 'target_url', 'private_path', 'source_code', 'credentials', 'records', 'evidence',
  ];
  for (const member of forbiddenMembers) {
    const property = member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(studioSource, new RegExp(`\\.${property}\\b|\\[['\"]${property}['\"]\\]`), member);
  }

  for (const renderFunction of ['renderBlueprintStudio()', 'renderWorkflowStudio()']) {
    const harness = createRenderHarness();
    await vm.runInContext(renderFunction, harness.context);
    const nodes = flatten(harness.content);
    const visible = normalizedText(harness.content);
    assert.doesNotMatch(visible, /https?:\/\/|file:\/\/|\/Users\/|\.private[\\/]/i);
    assert.doesNotMatch(visible, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    assert.doesNotMatch(visible, /\b\d{19}\b/);
    assert.ok(nodesByClass(harness.content, 'studio-filter-field').every(node => node.tagName === 'LABEL'));
    assert.ok(nodes.filter(node => node.tagName === 'DETAILS').every(node => node.children[0]?.tagName === 'SUMMARY'));
    assert.ok(nodes.some(node => node.tagName === 'BUTTON' && normalizedText(node) === 'Automation overview'));
  }

  assert.match(stylesSource, /\.studio-filter-field input:focus,\.studio-filter-field select:focus/);
  assert.match(stylesSource, /@media \(max-width:820px\)[\s\S]*?\.studio-phase-grid \{ grid-template-columns:1fr; \}/);
  assert.match(stylesSource, /@media \(max-width:520px\)[\s\S]*?\.studio-filters,\.workflow-detail-grid \{ grid-template-columns:1fr; \}/);
  assert.match(stylesSource, /@media \(max-width:520px\)[\s\S]*?\.studio-connection-row \{ grid-template-columns:1fr;/);
});
