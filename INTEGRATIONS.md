# Ozonetel and Picky Assist connector foundations

## Scope and current state

These are server-side connector libraries. The current server mounts their router at `/api/integrations` **after** the application access gate. The Automation browser view consumes only the credential-safe `GET /api/integrations/status` response; it exposes no dial or WhatsApp action control. There is no integration scheduler, webhook HTTP route, configured live credential, or enabled outbound flag. No provider request was made while building or testing them; all transport tests use mocks.

| Provider | Implemented foundation | Default state |
| --- | --- | --- |
| Ozonetel CloudAgent | token cache/single-flight, paginated CDR read, `CallAudio` reference accounting, status helper, guarded Agent Manual Dial, authenticated webhook parser | CDR is callable only by server-side code with configuration; outbound calling is disabled |
| Picky Assist | session-message and approved-template-message builders, status helper, authenticated webhook parser | all outbound messaging is disabled |

The libraries deliberately expose no caller-supplied base URL or path. A request can only target the exact HTTPS destinations listed below, redirects are rejected, errors are bounded and credential-redacted, and provider credentials never appear in status output.

Every fetch-based Ozonetel token/manual-dial request and Picky Assist push request has a 15-second application timeout with a hard 30-second configuration ceiling. The timeout owns an `AbortController`, clears its timer on every success or failure path, reports a local timeout as `TRANSPORT_TIMEOUT`/HTTP `504`, and distinguishes an independent transport abort as `TRANSPORT_ABORTED`/HTTP `502`. The direct Node HTTPS Ozonetel CDR transport retains its separate 15-second socket timeout.

## Mounted Express router

`lib/integration-router.js` exports `createIntegrationRouter()`. `server.js` mounts it after the existing access-code middleware:

```js
const { createIntegrationRouter } = require('./lib/integration-router');
app.use('/api/integrations', createIntegrationRouter());
```

All responses set `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. POST bodies must be `application/json`, are limited to 32 KiB, and reject fields outside each route's allowlist. The size guard checks both declared bytes and an already-parsed JSON body, so a larger application-level JSON parser cannot bypass it. The router has no webhook route.

The router does not replace the application's access-control layer. It inherits the current trusted-local/access-code middleware; CDR responses contain operational call data. Per-user identity, role authorization, consent/opt-out enforcement, trusted server-derived preflight evidence, and durable audit/idempotency state remain required before any outbound flag can be enabled.

| Router-relative route | Success | Client method |
| --- | --- | --- |
| `GET /status` | `200` | credential-safe whitelist of both `status()` results |
| `POST /ozonetel/cdr` | `200` | `fetchCdrByPagination(body)` |
| `POST /ozonetel/dial` | `202` | `agentManualDial(body)` |
| `POST /picky/session` | `202` | `sendSessionMessage(body)` |
| `POST /picky/template` | `202` | `sendApprovedTemplateMessage(body)` |

Success uses `{ "ok": true, "data": ... }`; status uses `{ "ok": true, "integrations": ... }`. Failures use `{ "ok": false, "error": { "code": "...", "message": "...", "retry_after_ms": 0 } }`, with `retry_after_ms` present only when applicable. Known client errors preserve a bounded status/code/message; unexpected errors are returned only as generic HTTP `500` without the original message or stack. The router delegates all number/date, rate, outbound-enable, confirmation, idempotency, manual-dial preflight, valid-session, and approved-template enforcement to the existing clients.

## Official contracts represented

### Ozonetel CloudAgent

- Domestic base: `https://in1-ccaas-api.ozonetel.com`.
- Token: `POST /ca_apis/CAToken/generateToken`, `apiKey` request header, JSON body with `userName`. The official token lifetime is 60 minutes; this implementation caches it for 55 minutes as a safety margin, single-flights concurrent refreshes, and locally enforces no more than 10 generations in a rolling hour. A newly generated token invalidates the previous token.
- CDR: `GET /ca_reports/fetchCdrByPagination`, bearer token, `pageNo` and `pageSize` query parameters, and the documented JSON body. This implementation enforces one calendar day, the configured reporting-timezone offset, no future time, a conservative 15-calendar-day window including the current day, `pageSize <= 500`, and no more than two requests in a rolling minute. Because the official contract documents a JSON body on a GET request, the default CDR transport uses Node HTTPS directly instead of WHATWG `fetch`, which forbids GET bodies.
- A CDR record's `CallAudio` value is returned only as provider data and counted. The connector never downloads, follows, proxies, transcribes, or validates recording content.
- Agent Manual Dial: `POST /ca_apis/AgentManualDial` with bearer token and exact required body fields `userName`, `agentID`, `campaignName`, and `customerNumber`. The optional `UCID` and `uui` fields are represented. `skipCustomerNumberValidation` is always `false` and an attempt to enable it is rejected.
- Before Agent Manual Dial, the caller must assert a preflight checked within two minutes: the agent is logged in and available, agent mode is `manual` or `blended`, the campaign is running with manual dial enabled, and the date is not blocked as a holiday. Ozonetel remains authoritative and may still reject the action.

Official references: [Generate Token](https://docs.ozonetel.com/reference/post_ca-apis-catoken-generatetoken), [Fetch CDR By Pagination](https://docs.ozonetel.com/reference/get_ca-reports-fetchcdrbypagination), and [Agent Manual Dial — token authentication](https://docs.ozonetel.com/reference/post_ca-apis-agentmanualdial-3).

### Picky Assist

- Push endpoint: `POST https://pickyassist.com/app/api/v2/push` with JSON. The project API token is sent in the JSON `token` field, not in a header.
- The numeric `application`/channel ID must come from the intended Picky Assist project. Recipient numbers must contain the full country code without `0`, `+`, spaces, or punctuation; the local validator accepts 5–15 digits and requires the first digit to be non-zero.
- The local rolling limit is 90 push requests per minute. There are no automatic retries. A provider response with `status: 100` is reported as accepted for processing and explicitly **not** as delivered.
- `sendSessionMessage` requires a timestamp showing that the inbound session opened within the preceding 24 hours.
- `sendApprovedTemplateMessage` requires a template ID, language, template status `3` (Approved), a status check from the preceding 24 hours, and only the ordered template variable values. The 24-hour status freshness requirement is a local fail-closed policy; the provider's Template Status API is the source of truth.
- V4 webhooks are configured separately for every project under **Project > Settings > Developers > Webhooks**.

Official references: [Quick Start Guide](https://help.pickyassist.com/api-documentation-v2/quick-start-guide), [Push API variables](https://help.pickyassist.com/api-documentation-v2/push-api/api-variables), [template text messages](https://help.pickyassist.com/api-documentation-v2/push-api/sending-whatsapp-template-messages/sending-whatsapp-template-text-messages), [rate limits](https://help.pickyassist.com/general-guidelines/rate-limits), and [webhook configuration](https://help.pickyassist.com/api-documentation-v2/webhook/configuring-webhook-url).

## Configuration

Copy `.env.example` to a local untracked environment file and set only the values issued for the intended provider account/project. Do not paste credentials into source, documentation, tickets, or browser code.

| Variable | Required for | Accepted value |
| --- | --- | --- |
| `OZONETEL_API_KEY` | any Ozonetel request | CloudAgent API key; never exposed in status/errors |
| `OZONETEL_USERNAME` | any Ozonetel request | CloudAgent account username |
| `OZONETEL_REPORTING_TIMEZONE_OFFSET_MINUTES` | CDR reads | signed UTC offset in minutes, `-720` through `840`; confirm from the CloudAgent account rather than assuming |
| `OZONETEL_OUTBOUND_CALLS_ENABLED` | Agent Manual Dial | exact string `true`; any other value keeps calls disabled |
| `OZONETEL_WEBHOOK_SECRET` | Ozonetel inbound webhook parsing | separate random local secret, 24–256 characters |
| `PICKY_ASSIST_API_TOKEN` | any Picky Assist push | token generated for the selected project |
| `PICKY_ASSIST_APPLICATION_ID` | any Picky Assist push | positive numeric channel/application ID from that project |
| `PICKY_ASSIST_PROJECT_ID` | project/webhook traceability | exact selected project ID; not sent to the Push API |
| `PICKY_ASSIST_OUTBOUND_MESSAGES_ENABLED` | message sends | exact string `true`; any other value keeps messages disabled |
| `PICKY_ASSIST_WEBHOOK_SECRET` | Picky Assist inbound webhook parsing | separate random local secret, 24–256 characters |

The two webhook secrets must be different from provider API credentials and from each other.

## Safe readiness check

The status helpers do not make network requests:

```js
require('dotenv').config();
const { createOzonetelClientFromEnv } = require('./lib/ozonetel-client');
const { createPickyAssistClientFromEnv } = require('./lib/picky-assist-client');

console.log(createOzonetelClientFromEnv().status());
console.log(createPickyAssistClientFromEnv().status());
```

Keep both outbound enable flags `false` during credential and read-path validation.

## Outbound action gates

No outbound method can run with an enable flag alone. Every action additionally needs the exact confirmation phrase and a unique 16–128 character idempotency key:

| Action | Required confirmation |
| --- | --- |
| Ozonetel Agent Manual Dial | `CONFIRM_OZONETEL_AGENT_MANUAL_DIAL` |
| Picky Assist session/template message | `CONFIRM_PICKY_ASSIST_MESSAGE` |

Idempotency keys are remembered only in the current Node process and capped at 10,000 entries. Picky Assist also receives the key as `reference_number`, but its documentation says this value is echoed rather than deduplicated. Before using either outbound connector in multiple processes or after restarts, add an atomic durable idempotency store; otherwise keep outbound flags disabled. A key is retained after an attempted action because a transport failure can leave delivery outcome uncertain.

## Inbound webhook boundary

Both parsers require `X-Magppie-Webhook-Secret` and reject the request before parsing JSON if the secret is missing or wrong. Raw JSON is capped at 256 KiB.

Picky Assist documents POST/JSON webhooks but does not document a provider signature or a custom authentication header. Therefore, do **not** point its V4 project webhook directly at an application handler that relies on this local header. Put a trusted HTTPS ingress/gateway in front of the application; the gateway must authenticate/restrict the provider request and inject the local header over a protected hop. Do not place the secret in a webhook query string because URLs are commonly logged. The same gateway rule applies to any Ozonetel event source that cannot send the header.

No webhook HTTP route is added by this foundation. Route ownership, public HTTPS ingress, project-specific mapping, replay protection, and event schemas must be reviewed before wiring one.

## Exact values and decisions still required

### Ozonetel

1. API key and CloudAgent username for the intended account, with admin setting **API Authentication = TOKEN_AUTH**.
2. Confirmation of the reporting timezone's signed UTC offset in minutes.
3. Coordination with any other token consumer, because generating a token invalidates previously issued tokens.
4. For each dial: exact `agentID`, exact running/manual-enabled `campaignName`, validated customer number, and a fresh agent/campaign/holiday preflight.
5. A separately generated webhook secret and an authenticated ingress design if Ozonetel events will be received.
6. Explicit approval to set `OZONETEL_OUTBOUND_CALLS_ENABLED=true`. Until then, Agent Manual Dial remains blocked.

### Picky Assist

1. Exact project API token, numeric project channel/application ID, and project ID.
2. For session messages, the trustworthy source of the last inbound-session timestamp.
3. For template messages, the approved template ID, language, ordered variables, and a recent Template Status result of `3`.
4. Per-project V4 webhook URL plus a trusted ingress that can authenticate/restrict Picky Assist and inject the separate local secret.
5. An event/delivery reconciliation design using webhook `push_id`, `msg_id`, and `reference_number`; Push API status `100` alone is not delivery proof.
6. Explicit approval to set `PICKY_ASSIST_OUTBOUND_MESSAGES_ENABLED=true`. Until then, all sends remain blocked.

## Verification

Run the focused mock suite and syntax checks:

```bash
npm run test:integrations
npm run check
```

The focused tests verify fixed origins/paths, token single-flight/cache and generation rate, CDR bounds/rate, number/date rules, disabled outbound behavior, readiness/session/template preconditions, idempotency, sanitized errors, and unauthenticated webhook rejection. They never contact Ozonetel or Picky Assist.
