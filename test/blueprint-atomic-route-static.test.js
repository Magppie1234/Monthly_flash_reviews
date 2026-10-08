'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const postStart = source.indexOf("app.post('/api/blueprint/:module/:id'");
const postEnd = source.indexOf('// ---------- dashboard', postStart);
const postRoute = source.slice(postStart, postEnd);
const rpcStart = source.indexOf('async function blueprintAtomicRpc(');
const rpcEnd = source.indexOf('const lit =', rpcStart);
const rpcAdapter = source.slice(rpcStart, rpcEnd);

test('Blueprint POST has no split patch, Note, rollback, or asynchronous log fallback path', () => {
  assert.ok(postStart >= 0 && postEnd > postStart);
  assert.match(postRoute, /await blueprintAtomicRuntime\.execute\(\{/);
  assert.match(postRoute, /expectedState: current/);
  assert.match(postRoute, /expectedModifiedTime: record\.Modified_Time/);
  assert.match(postRoute, /patch: data/);
  assert.match(postRoute, /note: notes \? \{ title:/);
  assert.doesNotMatch(postRoute, /\bcrm_patch\b/);
  assert.doesNotMatch(postRoute, /\binsertLocalNote\b/);
  assert.doesNotMatch(postRoute, /\bcrm_log\b/);
  assert.doesNotMatch(postRoute, /\brollback\b/i);
  assert.doesNotMatch(postRoute, /\.catch\(\(\) => \{\}\)/);
});

test('server wires the exact verifier and sends one immutable atomic RPC body', () => {
  assert.match(source, /verify: \(\{ signal \}\) => verifyBlueprintTransitionRpc\(\{ env: process\.env, fetchImpl: fetch, signal \}\)/);
  assert.match(source, /getIdentityAuthorizationStatus: getBlueprintIdentityAuthorizationStatus/);
  assert.ok(rpcStart >= 0 && rpcEnd > rpcStart);
  assert.equal((rpcAdapter.match(/fetch\(/g) || []).length, 1);
  assert.match(rpcAdapter, /Object\.freeze\(\{ \.\.\.request, s: SECRET \}\)/);
  assert.match(rpcAdapter, /\/rest\/v1\/rpc\/crm_blueprint_transition/);
  assert.doesNotMatch(rpcAdapter, /crm_(?:patch|insert|log)/);
});

test('only exact allowlisted database conflicts cross the route adapter boundary', () => {
  assert.match(source, /Blueprint expected-current-state conflict/);
  assert.match(source, /Blueprint expected-modified-time conflict/);
  assert.match(rpcAdapter, /The atomic Blueprint transaction was rejected\./);
  assert.doesNotMatch(rpcAdapter, /throw new Error\([^\n]*response\.text/);
  assert.doesNotMatch(rpcAdapter, /console\.(?:log|error)/);
});
