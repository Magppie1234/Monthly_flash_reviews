# Blueprint atomic runtime acceptance gate

## Current status

The local catalog remains truthful at **5 policy-eligible, 0 atomically runtime-ready, and 197 policy-blocked transitions**. The five eligible forms and their mandatory During evidence remain inspectable, but production execution is disabled.

The runtime is fail-closed behind two independent prerequisites:

1. A fresh, bounded read-only verifier must match the staged function's exact signature, argument defaults and modes, return contract, settings, owner, complete direct ACL, effective-role boundary, function body, and protected-field rejection canary.
2. A server-owned request principal, Blueprint authorization decision, and audit-actor binding must all be verified. The current provider returns false for all three and cannot be widened by a request or environment assertion.

Installing the SQL alone is therefore insufficient to enable a transition. Every attempted execution forces a fresh verification; timeout or drift prevents the RPC call. There is no split patch, Note, rollback, asynchronous-log, or fallback write path.

## Staged database contract

[`database/migrations/20260830_blueprint_transition_rpc.sql`](../database/migrations/20260830_blueprint_transition_rpc.sql) is staged only and is not installed automatically. Its matching bootstrap copy is in [`database/schema.sql`](../database/schema.sql). Both preserve full-precision optimistic concurrency and serialize the same microsecond `Modified_Time` value into record JSON and the response.

The migration may be applied only through an explicitly authorized PostgreSQL administration session after review. This repository's verifier is read-only and never installs DDL.

## Blocked disposable-database proof

[`test/blueprint-transaction-rpc.integration.test.js`](../test/blueprint-transaction-rpc.integration.test.js) is intentionally skipped because no isolated disposable PostgreSQL runtime is available in this task and no live DDL or successful mutation is authorized. Before any production installation or successful transition, a disposable database populated only with synthetic records must prove:

- two simultaneous requests with the same state/version yield exactly one commit and one `40001` conflict;
- the returned six-digit offset timestamp equals the stored `modified_time` instant and supports a legitimate second transition;
- a forced Note insert failure rolls back the record update and every audit insert;
- a forced audit failure rolls back the record and optional Note;
- lock waiting terminates within the function statement timeout;
- the returned record id, destination state, every requested scalar patch value, and JSON `Modified_Time` match the immutable request and response contract.

Until that gate runs successfully, static SQL and mocked transport tests are evidence of contract shape only—not evidence that PostgreSQL transaction behavior has executed.

## Public failure contract

Unknown database, RPC, provider, network, and internal errors return one fixed sanitized response. Only explicitly reviewed error classes may expose bounded safe codes and messages; the reviewed atomic adapter may use its sanitized `502` contract, while an arbitrary `502` is reduced to the fixed internal error. Stale state and stale `Modified_Time` conflicts remain separate safe `409` responses.
