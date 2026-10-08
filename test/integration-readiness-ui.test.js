'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const start = appSource.indexOf('/* Integration readiness card start */');
const end = appSource.indexOf('/* Integration readiness card end */', start);
assert.ok(start >= 0 && end > start, 'Integration readiness UI source was not found.');
const segment = appSource.slice(start, end);

test('Automation requests only the credential-safe integration status endpoint', () => {
  assert.match(appSource, /api\('\/api\/integrations\/status'\)/);
  assert.match(appSource, /wrap\.appendChild\(buildIntegrationReadinessCard\(integrationStatus\)\)[\s\S]*const syncedAt/);
  assert.doesNotMatch(segment, /fetch\s*\(|method\s*:|\/dial|\/send|AgentManualDial|\/push/i);
});

test('readiness card is text-only and never exposes integration secrets or action controls', () => {
  assert.match(segment, /node\.textContent = String\(text\)/);
  assert.match(segment, /No dial or message controls are exposed here/);
  assert.match(segment, /This card cannot send a message, start a call, or change configuration/);
  assert.doesNotMatch(segment, /\.innerHTML\s*=|insertAdjacentHTML|document\.write|createElement\(['"]button|base_url|push_url|allowed_paths|manual_dial_confirmation|message_confirmation/i);
});

test('both integrations show exact configuration, outbound, next-step, and unavailable labels', () => {
  [
    'Ozonetel', 'Picky Assist', 'API key', 'Username', 'Reporting timezone offset',
    'API token', 'Application', 'Project ID', 'Webhook secret', 'Outbound calls',
    'Outbound messages', 'Disabled · not live', 'Next step', 'Integration status unavailable',
  ].forEach(label => assert.match(segment, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
});

test('readiness card has compact two-column desktop and single-column mobile layouts', () => {
  assert.match(styles, /\.integration-readiness-grid\s*\{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media \(max-width:820px\)[\s\S]*\.integration-readiness-grid\s*\{ grid-template-columns:1fr; \}/);
  assert.match(styles, /@media \(max-width:440px\)[\s\S]*\.integration-provider-metrics\s*\{ grid-template-columns:1fr; \}/);
});
