'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const fullSync = fs.readFileSync(path.join(root, 'sync', 'pull-zoho.js'), 'utf8');
const taskReconciliation = fs.readFileSync(
  path.join(root, 'scripts', 'reconcile-task-subform-gaps.js'),
  'utf8',
);

test('scheduled source upserts carry canonical organization and observation evidence', () => {
  assert.match(server, /EXPECTED_ZOHO_ZGID/);
  assert.match(server, /const ZOHO_SOURCE_ORG_ID = `org\$\{EXPECTED_ZOHO_ZGID\}`/);
  assert.match(server, /source_org_id: ZOHO_SOURCE_ORG_ID/);
  assert.match(server, /source_seen_at: new Date\(sourceSeenAt\)\.toISOString\(\)/);
  assert.match(server, /await paymentMilestoneSnapshotAdapter\.assertStorageCapability\(\);[\s\S]*await zohoOrgGuard\.assertExpectedOrg\(\{ signal \}\);[\s\S]*runZohoDeltaSync\(\{/);
});

test('full source pull verifies the exact organization before stamping rows', () => {
  assert.match(fullSync, /createZohoOrgGuard/);
  assert.match(fullSync, /const SOURCE_ORG_ID = `org\$\{EXPECTED_ZOHO_ZGID\}`/);
  assert.match(fullSync, /await sourceOrgGuard\.assertExpectedOrg\(\);/);
  assert.match(fullSync, /source_org_id: SOURCE_ORG_ID, source_seen_at: sourceSeenAt/);
  assert.ok(
    fullSync.indexOf('await sourceOrgGuard.assertExpectedOrg();')
      < fullSync.indexOf('fieldsByModule = await syncMeta();'),
  );
});

test('task/subform apply derives a canonical organization only from the verified response', () => {
  assert.match(taskReconciliation, /VERIFIED_SOURCE_ORG_ID = `org\$\{stableNumericIdentity\}`/);
  assert.match(taskReconciliation, /source_org_id: VERIFIED_SOURCE_ORG_ID/);
  assert.match(taskReconciliation, /source_seen_at: sourceSeenAt/);
  assert.match(taskReconciliation, /if \(!\/\^org\\d\{8,32\}\$\/\.test\(String\(VERIFIED_SOURCE_ORG_ID \|\| ''\)\)\)/);
  assert.ok(
    taskReconciliation.indexOf('await verifyOrganization();')
      < taskReconciliation.indexOf('await upsertMissing('),
  );
});
