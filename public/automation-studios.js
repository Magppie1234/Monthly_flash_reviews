/* First-class, source-backed Blueprint and Workflow inspection surfaces. */
'use strict';

function studioText(tag, className, value) {
  const node = el(tag, className);
  node.textContent = String(value ?? '');
  return node;
}

function studioBadge(label, tone = 'neutral') {
  const badge = el('span', `studio-badge ${tone}`);
  badge.textContent = label;
  return badge;
}

function studioMetric(label, value, detail) {
  const card = el('div', 'studio-metric');
  card.appendChild(studioText('span', null, label));
  card.appendChild(studioText('b', null, Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-IN') : String(value ?? '—')));
  if (detail) card.appendChild(studioText('small', null, detail));
  return card;
}

function studioHeader(title, eyebrow, description) {
  const header = el('div', 'studio-hero');
  const copy = el('div', 'studio-hero-copy');
  copy.appendChild(studioText('div', 'studio-eyebrow', eyebrow));
  copy.appendChild(studioText('h1', null, title));
  copy.appendChild(studioText('p', null, description));
  header.appendChild(copy);
  const links = el('div', 'studio-links');
  const automation = el('button', null, 'Automation overview');
  automation.onclick = () => { location.hash = '#/automation'; };
  links.appendChild(automation);
  header.appendChild(links);
  return header;
}

function studioField(label, control) {
  const wrapper = el('label', 'studio-filter-field');
  wrapper.appendChild(studioText('span', null, label));
  wrapper.appendChild(control);
  return wrapper;
}

function studioOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function normalizedSearch(value) {
  return String(value || '').trim().toLocaleLowerCase('en-IN');
}

function criterionLabel(criterion) {
  if (!criterion) return 'No criterion';
  if (criterion.kind === 'match_all') return 'All records';
  const field = criterion.field || 'field';
  const operator = String(criterion.operator || 'matches').replaceAll('_', ' ');
  const value = criterion.value === undefined ? '' : ` ${String(criterion.value)}`;
  return `${field} ${operator}${value}`.trim();
}

function blueprintInputText(input) {
  const label = input.label || input.name || input.api_name || 'Source input';
  return `${label} ${input.api_name || ''} ${input.data_type || ''} ${input.message || ''}`;
}

function blueprintActionText(action) {
  return `${action.type || ''} ${action.name || action.api_name || ''} ${action.status || ''} ${action.priority || ''}`;
}

function blueprintTransitionSearchText(transition) {
  return normalizedSearch([
    transition.name,
    transition.from?.display_value,
    transition.from?.actual_value,
    transition.to?.display_value,
    transition.to?.actual_value,
    transition.trigger_type,
    transition.before?.owners?.join(' '),
    ...(transition.before?.criteria || []).map(criterionLabel),
    ...(transition.during?.inputs || []).map(blueprintInputText),
    ...(transition.after?.actions || []).map(blueprintActionText),
    transition.execution?.policy_block_reason,
    transition.execution?.runtime_block_reason,
  ].join(' '));
}

function blueprintPhase(title, countLabel) {
  const column = el('section', 'studio-phase');
  const heading = el('div', 'studio-phase-title');
  heading.appendChild(studioText('b', null, title));
  if (countLabel) heading.appendChild(studioText('span', null, countLabel));
  column.appendChild(heading);
  return column;
}

function renderBlueprintTransition(transition) {
  const details = el('details', 'studio-transition');
  const summary = el('summary');
  const title = el('div', 'studio-transition-title');
  title.appendChild(studioText('b', null, transition.name));
  title.appendChild(studioText('span', null, `${transition.from.display_value} → ${transition.to.display_value}`));
  const badges = el('div', 'studio-badges');
  badges.appendChild(studioBadge(transition.trigger_type === 'automatic' ? 'Automatic' : 'Manual'));
  if (transition.common) badges.appendChild(studioBadge('Common'));
  const executionLabel = transition.execution.runtime_executable
    ? 'Atomic runtime ready'
    : transition.execution.policy_eligible
      ? 'Policy eligible · atomic unavailable'
      : 'Policy blocked';
  const executionTone = transition.execution.runtime_executable
    ? 'success'
    : transition.execution.policy_eligible ? 'warning' : 'danger';
  badges.appendChild(studioBadge(executionLabel, executionTone));
  if (transition.during.required_input_count) badges.appendChild(studioBadge(`${transition.during.required_input_count} mandatory`, 'warning'));
  summary.appendChild(title);
  summary.appendChild(badges);
  details.appendChild(summary);

  const body = el('div', 'studio-transition-body');
  const grid = el('div', 'studio-phase-grid');

  const before = blueprintPhase('Before', transition.before.available ? 'Specified' : 'Unavailable');
  if (transition.before.owners.length) {
    const owners = el('div', 'studio-data-row');
    owners.appendChild(el('span', null, 'Owners'));
    owners.appendChild(studioText('b', null, transition.before.owners.join(', ')));
    before.appendChild(owners);
  }
  (transition.before.criteria || []).forEach(criterion => {
    const row = el('div', 'studio-data-row');
    row.appendChild(el('span', null, 'Criterion'));
    row.appendChild(studioText('b', null, criterionLabel(criterion)));
    before.appendChild(row);
  });
  if (!transition.before.owners.length && !transition.before.criteria.length) {
    before.appendChild(el('div', 'studio-empty', transition.before.available ? 'No owner or entry criterion is configured.' : 'Before-phase evidence is unavailable.'));
  }
  if (!transition.before.criteria_logic_supported) before.appendChild(el('div', 'studio-inline-warning', 'Source criteria logic is not locally executable.'));

  const during = blueprintPhase('During', `${transition.during.input_count} input${transition.during.input_count === 1 ? '' : 's'}`);
  (transition.during.inputs || []).forEach(input => {
    const row = el('div', 'studio-input-row');
    const copy = el('div');
    copy.appendChild(studioText('b', null, input.label || input.name || input.api_name || 'Source input'));
    copy.appendChild(studioText('small', null, [input.api_name, input.data_type, input.kind].filter(Boolean).join(' · ')));
    row.appendChild(copy);
    row.appendChild(studioBadge(input.required ? 'Mandatory' : 'Optional', input.required ? 'warning' : 'neutral'));
    during.appendChild(row);
    if (input.message) during.appendChild(studioText('div', 'studio-input-note', input.message));
    if (input.validation) {
      const validation = [
        input.validation.kind,
        input.validation.allowed_values?.length ? `${input.validation.allowed_values.length} allowed values` : null,
        input.validation.message,
      ].filter(Boolean).join(' · ');
      if (validation) during.appendChild(studioText('div', 'studio-input-note', `Validation: ${validation}`));
    }
    if (input.checklist?.items?.length) {
      during.appendChild(studioText('div', 'studio-input-note', `${input.checklist.title}: ${input.checklist.items.map(item => `${item.name}${item.required ? ' (mandatory)' : ''}`).join(', ')}`));
    }
  });
  if (!transition.during.input_count) during.appendChild(el('div', 'studio-empty', 'No user input is required.'));

  const after = blueprintPhase('After', `${transition.after.action_count} action${transition.after.action_count === 1 ? '' : 's'}`);
  (transition.after.actions || []).forEach(action => {
    const row = el('div', 'studio-input-row');
    const copy = el('div');
    copy.appendChild(studioText('b', null, action.name || action.api_name || String(action.type || 'Source action').replaceAll('_', ' ')));
    const detail = [action.type, action.status, action.priority, action.external ? 'external' : null].filter(Boolean).join(' · ');
    copy.appendChild(studioText('small', null, detail || 'Source-defined action'));
    row.appendChild(copy);
    if (action.external) row.appendChild(studioBadge('Outbound blocked', 'danger'));
    after.appendChild(row);
  });
  if (!transition.after.action_count) after.appendChild(el('div', 'studio-empty', 'No after-transition action is configured.'));

  grid.appendChild(before);
  grid.appendChild(during);
  grid.appendChild(after);
  body.appendChild(grid);
  const decision = el('div', `studio-decision ${transition.execution.runtime_executable ? 'success' : 'blocked'}`);
  const decisionTitle = transition.execution.runtime_executable
    ? 'Atomic transition path available'
    : transition.execution.policy_eligible ? 'Policy eligible · atomic execution unavailable' : 'Policy blocked';
  const decisionText = transition.execution.runtime_executable
    ? 'This exact transition can run as one verified atomic transaction after mandatory During inputs pass validation.'
    : transition.execution.policy_eligible
      ? transition.execution.runtime_block_reason
      : (transition.execution.policy_block_reason || 'This transition remains inspection-only until its complete behavior is reproduced and verified.');
  decision.appendChild(el('b', null, decisionTitle));
  decision.appendChild(studioText('span', null, decisionText));
  body.appendChild(decision);
  details.appendChild(body);
  return details;
}

function renderBlueprintCard(blueprint, transitions, openInitially) {
  const details = el('details', 'studio-catalog-card');
  details.open = openInitially;
  const summary = el('summary', 'studio-catalog-summary');
  const identity = el('div', 'studio-catalog-title');
  identity.appendChild(studioText('b', null, blueprint.name));
  identity.appendChild(studioText('span', null, `${blueprint.module} · ${blueprint.state_field} · ${blueprint.layout?.name || 'Source layout'}`));
  const badges = el('div', 'studio-badges');
  badges.appendChild(studioBadge(blueprint.status, blueprint.status === 'Active' ? 'success' : 'neutral'));
  badges.appendChild(studioBadge(`${transitions.length}/${blueprint.coverage.transition_count} transitions`));
  badges.appendChild(studioBadge(`${blueprint.coverage.required_input_count} mandatory`, 'warning'));
  summary.appendChild(identity);
  summary.appendChild(badges);
  details.appendChild(summary);

  const body = el('div', 'studio-catalog-body');
  const stateBlock = el('section', 'studio-state-block');
  const stateHeading = el('div', 'studio-section-heading');
  stateHeading.appendChild(el('b', null, 'Captured states'));
  stateHeading.appendChild(studioText('span', null, `${blueprint.coverage.state_count} states · ${blueprint.coverage.connection_count} authoritative paths`));
  stateBlock.appendChild(stateHeading);
  const states = el('div', 'studio-state-track');
  blueprint.states.forEach((item, index) => {
    if (index) states.appendChild(el('span', 'studio-state-arrow', '·'));
    states.appendChild(studioText('span', 'studio-state', item.name));
  });
  stateBlock.appendChild(states);
  if (blueprint.entry.criteria.length) {
    stateBlock.appendChild(studioText('div', 'studio-entry-rule', `Entry: ${blueprint.entry.criteria.map(criterionLabel).join(' AND ')}`));
  } else {
    stateBlock.appendChild(el('div', 'studio-entry-rule', blueprint.continuous ? 'Continuous Blueprint · source entry applies to the captured layout and field.' : 'No source entry criterion was captured.'));
  }
  const connectionDetails = el('details', 'studio-connections');
  const connectionSummary = studioText('summary', null, `Authoritative connection paths (${blueprint.connections.length})`);
  connectionDetails.appendChild(connectionSummary);
  const connectionList = el('div', 'studio-connection-list');
  blueprint.connections.forEach(connection => {
    const path = el('div', 'studio-connection-row');
    path.appendChild(studioText('span', 'studio-connection-state', connection.from_state.name));
    path.appendChild(studioText('b', 'studio-connection-transition', connection.transition.name));
    path.appendChild(studioText('span', 'studio-connection-state', connection.to_state.name));
    connectionList.appendChild(path);
  });
  connectionDetails.appendChild(connectionList);
  stateBlock.appendChild(connectionDetails);
  body.appendChild(stateBlock);
  const transitionList = el('div', 'studio-transition-list');
  transitions.forEach(transition => transitionList.appendChild(renderBlueprintTransition(transition)));
  body.appendChild(transitionList);
  details.appendChild(body);
  return details;
}

async function renderBlueprintStudio() {
  const nav = ++state.nav;
  state.current = null;
  setActiveTab('__blueprints');
  const content = $('#content');
  content.innerHTML = '<div class="loading">Loading the Blueprint catalog…</div>';
  try {
    const catalog = await api('/api/meta/blueprint_studio');
    if (nav !== state.nav) return;
    content.innerHTML = '';
    const page = el('div', 'studio-page');
    page.appendChild(studioHeader(
      'Blueprint Studio',
      'Process control',
      'Inspect every captured state, transition, mandatory During field, and Before/After action without guessing or writing to Zoho.',
    ));
    const coverage = catalog.coverage || {};
    const metrics = el('div', 'studio-metrics');
    metrics.appendChild(studioMetric('Blueprints', coverage.blueprint_count, `${coverage.active_blueprint_count} active`));
    metrics.appendChild(studioMetric('Transitions', coverage.transition_count, `${coverage.phase_detail_count} phase-complete`));
    metrics.appendChild(studioMetric('Mandatory inputs', coverage.required_input_count, `${coverage.during_input_count} During inputs`));
    metrics.appendChild(studioMetric('Policy eligible', coverage.policy_eligible_transition_count, `${coverage.policy_blocked_transition_count} policy blocked`));
    metrics.appendChild(studioMetric('Atomic ready', coverage.atomic_runtime_ready_transition_count, 'Exact verifier required'));
    metrics.appendChild(studioMetric('After actions', coverage.after_action_count, 'Visible by transition'));
    page.appendChild(metrics);
    const boundary = el('div', 'studio-boundary');
    boundary.appendChild(el('b', null, 'Inspection boundary'));
    const policyEligibleCount = Number(coverage.policy_eligible_transition_count || 0);
    const policyBlockedCount = Number(coverage.policy_blocked_transition_count || 0);
    const atomicReadyCount = Number(coverage.atomic_runtime_ready_transition_count || 0);
    const identityReady = catalog.atomic_runtime?.request_principal_verified === true
      && catalog.atomic_runtime?.identity_authorization_verified === true
      && catalog.atomic_runtime?.audit_actor_binding_verified === true;
    const atomicBoundary = atomicReadyCount > 0
      ? `${atomicReadyCount} are atomically runtime-ready after exact verification`
      : 'zero are atomically runtime-ready';
    const identityBoundary = identityReady
      ? 'Local request-principal authorization and audit-actor binding are verified.'
      : 'Exact SQL verification alone is not sufficient: verified local request-principal authorization and audit-actor binding are also required and are not implemented.';
    boundary.appendChild(studioText('span', null, `The complete seven-Blueprint catalog is visible: ${policyEligibleCount} transitions are policy eligible, ${policyBlockedCount} are policy blocked, and ${atomicBoundary}. ${identityBoundary} Zoho writes and outbound actions remain disabled.`));
    page.appendChild(boundary);

    const filters = el('div', 'studio-filters blueprint-studio-filters');
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Search transitions, fields, states, or actions'; search.setAttribute('aria-label', 'Search Blueprint catalog');
    const moduleSelect = document.createElement('select');
    studioOption(moduleSelect, '', 'All modules');
    [...new Set(catalog.blueprints.map(item => item.module))].sort().forEach(module => studioOption(moduleSelect, module, module));
    const executionSelect = document.createElement('select');
    studioOption(executionSelect, '', 'All policy states');
    studioOption(executionSelect, 'eligible', 'Policy eligible');
    studioOption(executionSelect, 'blocked', 'Policy blocked');
    filters.appendChild(studioField('Search', search));
    filters.appendChild(studioField('Module', moduleSelect));
    filters.appendChild(studioField('Execution', executionSelect));
    page.appendChild(filters);
    const results = el('div', 'studio-results');
    page.appendChild(results);

    const paint = () => {
      results.innerHTML = '';
      const query = normalizedSearch(search.value);
      let shownBlueprints = 0;
      let shownTransitions = 0;
      catalog.blueprints.forEach(blueprint => {
        if (moduleSelect.value && blueprint.module !== moduleSelect.value) return;
        const blueprintMatch = !query || normalizedSearch(`${blueprint.name} ${blueprint.module} ${blueprint.state_field} ${blueprint.states.map(item => item.name).join(' ')}`).includes(query);
        const transitions = blueprint.transitions.filter(transition => {
          if (executionSelect.value === 'eligible' && !transition.execution.policy_eligible) return false;
          if (executionSelect.value === 'blocked' && transition.execution.policy_eligible) return false;
          return blueprintMatch || blueprintTransitionSearchText(transition).includes(query);
        });
        if (!transitions.length) return;
        shownBlueprints += 1;
        shownTransitions += transitions.length;
        results.appendChild(renderBlueprintCard(blueprint, transitions, shownBlueprints === 1));
      });
      if (!shownBlueprints) results.appendChild(el('div', 'studio-no-results', 'No Blueprint transition matches these filters.'));
      const resultCount = studioText('div', 'studio-result-count', `${shownBlueprints} Blueprint${shownBlueprints === 1 ? '' : 's'} · ${shownTransitions} transition${shownTransitions === 1 ? '' : 's'}`);
      resultCount.setAttribute('role', 'status');
      resultCount.setAttribute('aria-live', 'polite');
      results.prepend(resultCount);
    };
    search.oninput = paint;
    moduleSelect.onchange = paint;
    executionSelect.onchange = paint;
    paint();
    content.appendChild(page);
  } catch (error) {
    if (nav !== state.nav) return;
    content.innerHTML = `<div class="loading">Could not load Blueprint Studio: ${esc(error.message)}</div>`;
  }
}

function workflowValueLabel(value) {
  if (!value) return 'source-defined value';
  if (value.kind === 'record_field') return `value from ${value.field}`;
  if (value.kind === 'execution_date') return 'execution date';
  if (value.kind === 'execution_datetime') return 'execution date and time';
  if (Object.prototype.hasOwnProperty.call(value, 'value')) return String(value.value);
  return String(value.kind || 'source-defined value').replaceAll('_', ' ');
}

function workflowAdapterLabel(adapter) {
  if (adapter?.adapter === 'increment_integer_field_v1') {
    return `${adapter.field} ← current whole number + ${adapter.increment}; blank starts at ${adapter.default_value}`;
  }
  if (adapter?.adapter === 'compare_counts_set_picklist_v1') {
    return `${adapter.field} ← ${adapter.value} when ${adapter.record_count_field} equals ${adapter.team_count_field}; unequal counts produce no mutation`;
  }
  return 'Reviewed deterministic adapter contract';
}

function workflowSearchText(rule) {
  return normalizedSearch([
    rule.name,
    rule.module,
    rule.studio_status,
    rule.trigger?.type,
    rule.trigger?.watched_fields?.join(' '),
    criterionLabel(rule.trigger?.criteria),
    ...(rule.planned_field_mutations || []).map(item => `${item.action_name} ${item.field} ${workflowValueLabel(item.value)}`),
    ...(rule.planned_function_adapters || []).map(item => `${item.action_name} ${workflowAdapterLabel(item)}`),
    ...(rule.block_reasons || []).map(item => `${item.code} ${item.message}`),
  ].join(' '));
}

function renderWorkflowRule(rule) {
  const details = el('details', 'studio-catalog-card workflow-rule');
  const summary = el('summary', 'studio-catalog-summary');
  const identity = el('div', 'studio-catalog-title');
  identity.appendChild(studioText('b', null, rule.name));
  identity.appendChild(studioText('span', null, `${rule.module} · ${rule.trigger ? String(rule.trigger.type).replaceAll('_', ' ') : 'source definition unavailable'}`));
  const badges = el('div', 'studio-badges');
  badges.appendChild(studioBadge(rule.source_active ? 'Active' : 'Inactive', rule.source_active ? 'success' : 'neutral'));
  const statusTone = rule.studio_status === 'Eligible plan only' ? 'warning' : (rule.studio_status === 'Blocked active' ? 'danger' : 'neutral');
  badges.appendChild(studioBadge(rule.studio_status, statusTone));
  summary.appendChild(identity);
  summary.appendChild(badges);
  details.appendChild(summary);
  const body = el('div', 'studio-catalog-body');

  const grid = el('div', 'workflow-detail-grid');
  const trigger = el('section', 'studio-phase');
  const triggerTitle = el('div', 'studio-phase-title');
  triggerTitle.appendChild(el('b', null, 'Trigger'));
  trigger.appendChild(triggerTitle);
  if (rule.trigger) {
    [
      ['Type', String(rule.trigger.type).replaceAll('_', ' ')],
      ['Watched fields', rule.trigger.watched_fields?.join(', ') || 'None'],
      ['Criteria', criterionLabel(rule.trigger.criteria)],
      ['Repeat', rule.trigger.repeat === null ? 'Source default' : (rule.trigger.repeat ? 'Yes' : 'No')],
    ].forEach(([label, value]) => {
      const row = el('div', 'studio-data-row'); row.appendChild(studioText('span', null, label)); row.appendChild(studioText('b', null, value)); trigger.appendChild(row);
    });
  } else trigger.appendChild(el('div', 'studio-empty', 'A safe executable trigger definition is unavailable.'));
  grid.appendChild(trigger);

  const plan = el('section', 'studio-phase workflow-plan');
  const planTitle = el('div', 'studio-phase-title');
  const functionAdapters = rule.planned_function_adapters || [];
  const planItemCount = rule.planned_field_mutations.length + functionAdapters.length;
  planTitle.appendChild(el('b', null, 'Local plan'));
  planTitle.appendChild(el('span', null, `${planItemCount} item${planItemCount === 1 ? '' : 's'}`));
  plan.appendChild(planTitle);
  rule.planned_field_mutations.forEach(mutation => {
    const row = el('div', 'studio-input-row');
    const copy = el('div');
    copy.appendChild(studioText('b', null, mutation.action_name));
    copy.appendChild(studioText('small', null, `${mutation.field} ← ${workflowValueLabel(mutation.value)}`));
    row.appendChild(copy);
    row.appendChild(studioBadge('Plan only', 'warning'));
    plan.appendChild(row);
  });
  functionAdapters.forEach(adapter => {
    const row = el('div', 'studio-input-row');
    const copy = el('div');
    copy.appendChild(studioText('b', null, adapter.action_name));
    copy.appendChild(studioText('small', null, workflowAdapterLabel(adapter)));
    row.appendChild(copy);
    row.appendChild(studioBadge('Reviewed adapter · plan only', 'warning'));
    plan.appendChild(row);
  });
  if (!planItemCount) plan.appendChild(el('div', 'studio-empty', 'No complete deterministic mutation plan is available.'));
  grid.appendChild(plan);
  body.appendChild(grid);

  if (rule.block_reasons.length) {
    const blockers = el('section', 'workflow-blockers');
    const blockersTitle = el('div', 'studio-section-heading');
    blockersTitle.appendChild(el('b', null, 'Execution blockers'));
    blockers.appendChild(blockersTitle);
    rule.block_reasons.forEach(reason => {
      const row = el('div', 'workflow-blocker');
      row.appendChild(studioBadge(reason.code.replaceAll('_', ' '), 'danger'));
      row.appendChild(studioText('span', null, reason.message));
      blockers.appendChild(row);
    });
    body.appendChild(blockers);
  }
  const decision = el('div', 'studio-decision blocked');
  decision.appendChild(el('b', null, rule.studio_status === 'Eligible plan only' ? 'Plan verified; write execution not enabled' : 'Execution blocked'));
  decision.appendChild(el('span', null, rule.studio_status === 'Eligible plan only'
    ? 'The deterministic field changes and reviewed adapter result are inspectable, but no local, source, scheduled, or outbound write runs from this catalog.'
    : 'This rule remains fail-closed until every trigger, condition, identity, action, and rollback requirement is reproduced safely.'));
  body.appendChild(decision);
  details.appendChild(body);
  return details;
}

async function renderWorkflowStudio() {
  const nav = ++state.nav;
  state.current = null;
  setActiveTab('__workflows');
  const content = $('#content');
  content.innerHTML = '<div class="loading">Loading Workflow Rules…</div>';
  try {
    const catalog = await api('/api/meta/workflow_studio');
    if (nav !== state.nav) return;
    content.innerHTML = '';
    const page = el('div', 'studio-page');
    page.appendChild(studioHeader(
      'Workflow Rules',
      'Automation control',
      'Inspect the exact captured rule status, trigger coverage, deterministic field-update and reviewed function-adapter plans, and the blockers that keep unsafe automation disabled.',
    ));
    const aggregate = catalog.aggregates || {};
    const metrics = el('div', 'studio-metrics');
    metrics.appendChild(studioMetric('Rules', aggregate.total_rules, `${aggregate.detailed_rules} detailed`));
    metrics.appendChild(studioMetric('Active', aggregate.active_rules, `${aggregate.inactive_rules} inactive`));
    metrics.appendChild(studioMetric('Plan eligible', aggregate.eligible_plan_only_rules, `${aggregate.planned_field_mutations} field mutations · ${aggregate.function_adapters} adapters`));
    metrics.appendChild(studioMetric('Blocked active', aggregate.blocked_active_rules, 'Fail-closed by rule'));
    metrics.appendChild(studioMetric('Referenced actions', aggregate.referenced_actions?.total, `${aggregate.referenced_actions?.missing_field_update_definitions || 0} definition missing`));
    page.appendChild(metrics);
    const boundary = el('div', 'studio-boundary warning');
    boundary.appendChild(el('b', null, 'Catalog-only mode'));
    boundary.appendChild(el('span', null, 'All 44 rules are visible. One reviewed function adapter can produce a deterministic plan; Mark Visit Done remains blocked until its parameter bindings are authoritative. Runtime writes, source calls, scheduled actions, and outbound delivery remain disabled.'));
    page.appendChild(boundary);

    const filters = el('div', 'studio-filters');
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Search rules, triggers, fields, or blockers'; search.setAttribute('aria-label', 'Search Workflow Rules');
    const moduleSelect = document.createElement('select');
    studioOption(moduleSelect, '', 'All modules');
    aggregate.modules.forEach(item => studioOption(moduleSelect, item.module, `${item.module} (${item.total_rules})`));
    const statusSelect = document.createElement('select');
    studioOption(statusSelect, '', 'All statuses');
    studioOption(statusSelect, 'Eligible plan only', 'Eligible plan only');
    studioOption(statusSelect, 'Blocked active', 'Blocked active');
    studioOption(statusSelect, 'Inactive', 'Inactive');
    const triggerSelect = document.createElement('select');
    studioOption(triggerSelect, '', 'All trigger types');
    [...new Set(catalog.rules.map(rule => rule.trigger?.type).filter(Boolean))].sort().forEach(type => studioOption(triggerSelect, type, String(type).replaceAll('_', ' ')));
    filters.appendChild(studioField('Search', search));
    filters.appendChild(studioField('Module', moduleSelect));
    filters.appendChild(studioField('Status', statusSelect));
    filters.appendChild(studioField('Trigger', triggerSelect));
    page.appendChild(filters);
    const results = el('div', 'studio-results');
    page.appendChild(results);
    const paint = () => {
      results.innerHTML = '';
      const query = normalizedSearch(search.value);
      const rules = catalog.rules.filter(rule => {
        if (moduleSelect.value && rule.module !== moduleSelect.value) return false;
        if (statusSelect.value && rule.studio_status !== statusSelect.value) return false;
        if (triggerSelect.value && rule.trigger?.type !== triggerSelect.value) return false;
        return !query || workflowSearchText(rule).includes(query);
      });
      const resultCount = studioText('div', 'studio-result-count', `${rules.length} of ${catalog.rules.length} rules`);
      resultCount.setAttribute('role', 'status');
      resultCount.setAttribute('aria-live', 'polite');
      results.appendChild(resultCount);
      rules.forEach(rule => results.appendChild(renderWorkflowRule(rule)));
      if (!rules.length) results.appendChild(el('div', 'studio-no-results', 'No Workflow Rule matches these filters.'));
    };
    search.oninput = paint;
    moduleSelect.onchange = paint;
    statusSelect.onchange = paint;
    triggerSelect.onchange = paint;
    paint();
    content.appendChild(page);
  } catch (error) {
    if (nav !== state.nav) return;
    content.innerHTML = `<div class="loading">Could not load Workflow Rules: ${esc(error.message)}</div>`;
  }
}
