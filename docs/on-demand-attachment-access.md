# Zoho CRM attachments: safe on-demand access design

## Outcome

No attachment-body migration or attachment download route is live. The implemented, tested library can eventually expose source attachments without pre-downloading the approximately 205 GB corpus by streaming a requested file directly from Zoho CRM only after the request passes three independent checks:

1. the local user is authenticated and may read the parent record;
2. the exact module, record ID, and attachment ID triple exists in the owner-only private metadata manifest; and
3. the access token is verified against the locked Zoho organization before it is used to download the file.

The reviewed implementation is in `lib/on-demand-attachment-access.js`. It is intentionally not mounted in `server.js` because the current application gate does not provide a stable per-user identity or a record-level permission decision. Implemented and tested does not mean activated, downloaded, cached, copied, or migrated.

## Current source evidence

The private manifest at `.private/attachment-replication/manifest.jsonl` was loaded through the new fail-closed index on 30 August 2026:

| Evidence | Verified value |
| --- | ---: |
| Source attachment IDs | 78,758 |
| Exact addressable module/record/attachment triples | 78,327 |
| Quarantined rows with incomplete parent metadata | 431 |
| User-visible locally linked attachment IDs | 2 |
| Source IDs absent from local CRM records | 78,756 |
| Declared source bytes | 205,279,257,214 |
| Largest declared attachment | 99,072,222 bytes |
| Attachment bodies migrated | 0 |
| Attachment bodies cached by this path | No |

The 100 MiB hard per-request cap is 104,857,600 bytes, so it covers every currently non-quarantined manifest entry. The 431 quarantined entries remain unavailable until their source parent module and record identifiers are recovered and reconciled. The two locally linked objects predate this work and are not evidence of body migration. No attachment bytes were downloaded while validating the index, and the current private manifest has zero verified migrated bodies and zero rows with uploaded bytes.

## Request flow

| Stage | Required result | Fail-closed behavior |
| --- | --- | --- |
| Application authentication | A stable internal actor ID | HTTP 401; no manifest or Zoho read |
| Parent-record authorization | Actor may read the exact module and record | Generic HTTP 404 to avoid an attachment-existence oracle |
| Protected-request header | `X-CRM-Attachment-Request: 1` | HTTP 403; reduces cross-site download requests |
| URL shape | No query parameters and no `Range` header | HTTP 400 or 416 |
| Private manifest | Owner-only regular file; exact locked org; no duplicate attachment IDs | HTTP 503 at startup/load time |
| Manifest lookup | Exact module + record ID + attachment ID match | Generic HTTP 404 |
| Size gate | Declared size is no more than 100 MiB | HTTP 413 before token or network access |
| Organization guard | Exactly one org and exact ZGID `60046349006` | HTTP 503 before attachment download |
| Zoho request | Exact India API origin, V8 CRM path, GET only, redirect disabled | HTTP 502/503 |
| Response preflight | HTTP 200, body present, identity encoding, exact `Content-Length` | HTTP 502 before downstream headers |
| Stream | Exact declared byte count, maximum two global streams and one per actor; 120 global and 30 per-actor opens per five minutes | Abort or HTTP 429 on truncation, overrun, timeout, disconnect, concurrency, or rate excess |
| Browser response | Forced download, `application/octet-stream`, no-store, same-origin resource policy, sandbox | No inline active-content execution or shared caching |

The library never logs. Tokens are accepted only from a server-side provider, sent only in the `Authorization` header, fingerprinted only with SHA-256 for organization-verification cache isolation, and never included in a URL or error message. Redirects are blocked so an authorization header cannot be forwarded to another origin.

## Zoho API contract

Zoho documents the file download as:

`GET /crm/v8/{module_api_name}/{record_ID}/Attachments/{attachment_ID}`

The official API requires both module read access and attachment read access. It downloads file attachments only; link-type attachments return `DOWNLOAD_NOT_ALLOWED`. Attachment IDs are normally discovered through the related-records API. See [Download an Attachment API, Zoho CRM V8](https://www.zoho.com/crm/developer/docs/api/v8/download-attachments.html).

The organization lock uses:

`GET /crm/v8/org`

and requires exactly one returned organization whose `zgid` is `60046349006`. See [Get Organization Details, Zoho CRM V8](https://www.zoho.com/crm/developer/docs/api/v8/get-org-data.html).

The implementation restricts CRM traffic to the canonical India data-centre origin `https://www.zohoapis.in`, uses GET only for both operations, rejects redirects, and requests identity encoding so the response byte count remains verifiable. OAuth token refresh is deliberately outside this library; a reviewed server-only token provider must supply an access token without placing credentials in application URLs or browser code.

## Safe mounting plan

Mount only after the existing application access gate and only after both callbacks below are backed by real server-side authorization. Do not replace either callback with `() => true`.

```js
const path = require('path');
const {
  loadPrivateAttachmentAllowlist,
  ZohoOnDemandAttachmentService,
  createAttachmentAccessRouter,
} = require('./lib/on-demand-attachment-access');

const allowlist = await loadPrivateAttachmentAllowlist(
  path.join(__dirname, '.private', 'attachment-replication', 'manifest.jsonl'),
);

const attachmentService = new ZohoOnDemandAttachmentService({
  allowlist,
  accessTokenProvider: () => readOnlyZohoTokenProvider.accessToken(),
});

app.use('/api/attachments/open', createAttachmentAccessRouter({
  service: attachmentService,
  authorizeRequest: request => authenticatedActorFromServerSession(request),
  authorizeRecord: ({ actorId, module, recordId }) => localPermissions.canReadRecord({
    actorId,
    module,
    recordId,
  }),
}));
```

The browser must use a same-origin `fetch` request with `X-CRM-Attachment-Request: 1`, turn the response into a Blob, and initiate the download locally. The access token and Zoho URL must never be returned to the browser. Do not place authentication data in query parameters.

## Activation blockers

1. **Per-user record authorization is not implemented.** The current optional shared `ACCESS_CODE` proves possession of one shared code but does not identify a user, profile, role, or record-access scope. The router therefore requires `authorizeRequest` and `authorizeRecord` callbacks and refuses construction without them.
2. **Attachment OAuth scope is not verified by this change.** Before activation, confirm the server-only token has the official module READ and attachments READ scopes for the locked production organization. Do not test by exposing a token or by enabling source writes.
3. **Link attachments are not identified in the current manifest.** Zoho documents that link-type attachments cannot be downloaded through the file endpoint. Such a request will fail generically and safely until the metadata scan records attachment type.
4. **The 431 quarantined entries lack a complete source parent.** They cannot be addressed safely and remain excluded.
5. **No private byte cache is enabled.** Each successful open consumes a Zoho API read and source bandwidth. This is intentional until a private storage bucket, retention policy, recovery plan, and signed-access model are approved.
6. **The allowlist is an immutable audited snapshot.** To preserve the requested 15-minute freshness, the metadata sync must write a new owner-only manifest to a temporary file, validate its organization, duplicates, row bounds, and reconciliation, atomically rename it, build a new index, and swap the in-memory reference only after every check passes. A failed refresh must leave the last verified index active.
7. **Existing anonymously reachable linked objects are not a trusted fallback.** On-demand access must use the guarded Zoho path until storage privacy is corrected and reverified.

## Verification

The count-only audit below reads the ignored owner-only manifest and sanitized baseline locally. In this mode the discovery script does not load `.env`, makes no source request, performs no write, and prints only aggregate counts and booleans—never attachment IDs, filenames, customer data, object paths, URLs, or credentials:

```bash
node scripts/discover-zoho.js --audit-attachment-manifest-counts
```

The verified result is 78,758 unique IDs, 78,327 exact addressable triples, 431 quarantined rows, 2 locally linked IDs, 78,756 source IDs absent locally, 0 verified migrated bodies, and 0 rows with uploaded bytes.

Focused implementation checks:

```text
node --check lib/on-demand-attachment-access.js
node --test test/on-demand-attachment-access.test.js
```

The tests cover private-manifest permissions and scope, exact triple matching, quarantine, duplicate IDs, method and origin allowlists, token-bound organization verification, redirect rejection, response-length validation, stream truncation and overrun, size gating before network access, bounded concurrency, safe filenames, protected request headers, record authorization, security headers, and fail-closed router construction.

## Evidence cross-links

- [Attachment replication runbook](../ATTACHMENT_REPLICATION.md)
- [Zoho source inventory](../ZOHO_SOURCE_INVENTORY.md)
- [Zoho migration manifest](../ZOHO_MIGRATION_MANIFEST.md)
- [Zoho reconciliation report](../ZOHO_RECONCILIATION_REPORT.md)
