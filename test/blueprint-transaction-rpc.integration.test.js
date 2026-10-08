'use strict';

const test = require('node:test');

// Acceptance gate only. This test must be replaced by an isolated disposable
// PostgreSQL harness before the staged migration can be installed. It must
// prove, with synthetic rows only: (1) two concurrent transitions have one
// winner and one 40001 conflict, (2) the returned microsecond Modified_Time
// round-trips to storage and permits a second transition, (3) forced Note and
// audit failures roll back the record update and every related insert, and
// (4) lock waits stop within the function statement timeout. This repository
// currently has no disposable PostgreSQL runtime, and this task must not run
// DDL or successful record mutations against the configured database.
test('disposable PostgreSQL proves Blueprint concurrency, timestamp round-trip, and transactional rollback', {
  skip: 'BLOCKED acceptance gate: an isolated disposable PostgreSQL runtime is not available; no live DDL or successful mutation is authorized.',
}, () => {});
