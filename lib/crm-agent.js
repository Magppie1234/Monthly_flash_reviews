'use strict';

const { CRM_AGENT_TOOL_NAMES, CrmAgentPolicyError, getCrmAgentAvailability } = require('./crm-agent-policy');
const { createCrmAgentTools } = require('./crm-agent-tools');

const CRM_AGENT_ID = 'magppie-crm-data-agent';
const MAX_AGENT_STEPS = 6;
const MAX_OUTPUT_TOKENS = 1200;

const CRM_AGENT_INSTRUCTIONS = [
  'You are the MAGPPIE CRM data assistant operating only on a permission-scoped local CRM replica.',
  'Use only the supplied allowlisted tools. Never invent, request, generate, or execute SQL, shell commands, HTTP requests, source-system calls, webhooks, messages, emails, or other outbound actions.',
  'Never ask for or reveal passwords, tokens, API keys, cookies, authorization headers, database connection values, or other credentials.',
  'Respect module and field permissions. If a tool denies access or omits a field, do not infer or reconstruct it.',
  'Aggregate and record answers must come from tool results. State when a result is bounded or incomplete.',
  'Record creation is preview-only. The draft tool never creates a record. Clearly present the draft validation result and tell the user that the app requires explicit approval before it may call the existing validated local create route.',
  'Never claim that a record, workflow, Blueprint transition, call, WhatsApp message, email, webhook, or source update was executed.',
  'If a tool call is denied or unavailable, explain the limitation once and do not retry it with altered inputs.',
].join(' ');

function assertAgentRuntime(aiRuntime) {
  const required = ['ToolLoopAgent', 'tool', 'jsonSchema', 'gateway', 'isStepCount'];
  if (!aiRuntime || required.some(name => typeof aiRuntime[name] !== 'function')) {
    throw new CrmAgentPolicyError('AGENT_RUNTIME_INVALID', 'The current AI SDK ToolLoopAgent runtime is unavailable.');
  }
  return aiRuntime;
}

function toolApprovalPolicy({ toolCall }) {
  if (!toolCall || toolCall.dynamic === true || !CRM_AGENT_TOOL_NAMES.includes(toolCall.toolName)) {
    return { type: 'denied', reason: 'Tool is outside the reviewed local CRM read/preview allowlist.' };
  }
  return 'not-applicable';
}

function unavailableResult(availability) {
  return Object.freeze({
    available: false,
    availability,
    agent: null,
    tools: null,
    fallback: Object.freeze({
      type: 'crm-agent-unavailable',
      reason_code: availability.reason_code,
      message: availability.fallback.message,
      mode: availability.fallback.mode,
      network_attempted: false,
    }),
  });
}

async function createCrmAgent({ handlers, permissions, env = process.env, aiRuntime = null } = {}) {
  const availability = getCrmAgentAvailability(env);
  if (!availability.available) return unavailableResult(availability);
  const runtime = assertAgentRuntime(aiRuntime || await import('ai'));
  const tools = createCrmAgentTools({ aiRuntime: runtime, handlers, permissions });
  const model = runtime.gateway(availability.model);
  const agent = new runtime.ToolLoopAgent({
    id: CRM_AGENT_ID,
    model,
    instructions: CRM_AGENT_INSTRUCTIONS,
    allowSystemInMessages: false,
    tools,
    activeTools: CRM_AGENT_TOOL_NAMES,
    toolOrder: CRM_AGENT_TOOL_NAMES,
    toolChoice: 'auto',
    toolApproval: toolApprovalPolicy,
    stopWhen: runtime.isStepCount(MAX_AGENT_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    maxRetries: 1,
    telemetry: {
      isEnabled: false,
      recordInputs: false,
      recordOutputs: false,
    },
  });
  return Object.freeze({
    available: true,
    availability,
    agent,
    tools,
    fallback: null,
  });
}

module.exports = {
  CRM_AGENT_ID,
  CRM_AGENT_INSTRUCTIONS,
  MAX_AGENT_STEPS,
  MAX_OUTPUT_TOKENS,
  assertAgentRuntime,
  createCrmAgent,
  toolApprovalPolicy,
  unavailableResult,
};
