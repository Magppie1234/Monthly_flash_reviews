'use strict';

const FORBIDDEN_VALUE = /(?:https?:\/\/|Zoho-oauthtoken|client_secret|refresh_token|access_token|authorization|cookie|password|secret|token|\/Users\/)/i;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function jsonEqual(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function duringInputContract(input) {
  return {
    kind: input?.kind ?? null,
    api_name: input?.api_name ?? null,
    label: input?.label ?? null,
    data_type: input?.data_type ?? null,
    required: input?.required === true,
    ...(input?.validation ? { validation: canonical(input.validation) } : {}),
  };
}

function transitionExecutionContract(blueprint, transition, definition) {
  return {
    name: definition?.name ?? String(transition?.name || '').replace(/C$/, ''),
    common: definition?.common === true || transition?.global === true,
    include_all_states: definition?.include_all_states === true,
    trigger_type: definition?.trigger_type || transition?.trigger_type || 'manual',
    from: {
      actual_value: transition?.from?.actual_value ?? null,
      display_value: transition?.from?.display_value ?? null,
    },
    to: {
      actual_value: transition?.to?.actual_value ?? null,
      display_value: transition?.to?.display_value ?? null,
    },
    before: {
      owners: Array.isArray(definition?.before?.owners) ? [...definition.before.owners] : [],
      criteria: Array.isArray(definition?.before?.criteria) ? canonical(definition.before.criteria) : [],
    },
    during_inputs: Array.isArray(definition?.during_inputs) ? definition.during_inputs.map(duringInputContract) : [],
    after_actions: Array.isArray(definition?.after_actions) ? canonical(definition.after_actions) : [],
  };
}

function validatePolicyConfig(config) {
  if (!config || config.version !== 1 || config.source_mode !== 'reviewed-local-execution-policy' || !Array.isArray(config.policies)) {
    throw new Error('Blueprint execution policy is invalid.');
  }
  if (FORBIDDEN_VALUE.test(JSON.stringify(config))) throw new Error('Blueprint execution policy contains a forbidden value.');
  const ids = new Set();
  for (const policy of config.policies) {
    if (!/^\d+$/.test(String(policy?.blueprint_id || '')) || !/^\d+$/.test(String(policy?.transition_id || ''))
      || !/^[A-Za-z0-9_$]+$/.test(String(policy?.module || '')) || !policy?.contract || typeof policy.contract !== 'object') {
      throw new Error('Blueprint execution policy entry is invalid.');
    }
    const key = `${policy.blueprint_id}:${policy.transition_id}`;
    if (ids.has(key)) throw new Error('Blueprint execution policy contains a duplicate transition.');
    ids.add(key);
  }
  return config;
}

function executionPolicyDecision(config, blueprint, transition, definition) {
  validatePolicyConfig(config);
  const policy = config.policies.find(item => String(item.blueprint_id) === String(blueprint?.id)
    && String(item.transition_id) === String(transition?.id));
  if (!policy || policy.module !== blueprint?.module) {
    return { approved: false, reason: 'This transition has no reviewed local execution policy.' };
  }
  const contract = transitionExecutionContract(blueprint, transition, definition);
  if (!jsonEqual(contract, policy.contract)) {
    return { approved: false, reason: 'The source transition contract drifted from its reviewed local execution policy.' };
  }
  return { approved: true, reason: null };
}

module.exports = {
  executionPolicyDecision,
  transitionExecutionContract,
  validatePolicyConfig,
};
