#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3197;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 120_000;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function writeArtifact(artifact) {
  const outDir = path.join(ROOT, '.private', 'qa');
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const target = path.join(outDir, 'cold-read-contention.json');
  fs.writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
}

async function timedJson(pathname) {
  const startedAt = Date.now();
  const response = await fetch(`${ORIGIN}${pathname}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await response.json().catch(() => null);
  return { status: response.status, duration_ms: Date.now() - startedAt, body };
}

function waitUntilListening(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Isolated CRM server did not become ready in time.')), READY_TIMEOUT_MS);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      if (error) reject(error); else resolve();
    };
    const onData = chunk => {
      if (String(chunk).includes('MAGPPIE CRM (own database)')) finish();
    };
    const onExit = () => finish(new Error('Isolated CRM server exited before becoming ready.'));
    child.stdout.on('data', onData);
    child.on('exit', onExit);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      CLONE_HOST: '127.0.0.1',
      CLONE_PORT: String(PORT),
      ACCESS_CODE: '',
      ZOHO_REFRESH_TOKEN: '',
      ZOHO_CLIENT_ID: '',
      VERCEL_DEPLOYMENT_ID: '',
      VERCEL_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.resume();

  try {
    await waitUntilListening(child);
    const probeStartedAt = new Date().toISOString();
    const [assistant, analytics, version] = await Promise.all([
      timedJson('/api/agent/status'),
      timedJson('/api/analytics/overview'),
      timedJson('/api/version'),
    ]);
    const assistantOk = assistant.status === 200;
    const analyticsOk = analytics.status === 200;
    const versionOk = version.status === 200 && typeof version.body?.v === 'string';
    const scopeOk = assistant.body?.permission_scope?.module_count === 41;
    const metricsOk = Array.isArray(analytics.body?.datasets?.period_comparison)
      && analytics.body.datasets.period_comparison.length === 5;
    const attemptsOk = Number.isSafeInteger(analytics.body?.source?.query_attempts)
      && analytics.body.source.query_attempts >= 1
      && analytics.body.source.query_attempts <= 2;
    const boundaryOk = analytics.body?.source?.query_mode === 'local-read-only'
      && analytics.body?.source?.upstream_boundary === 'Zoho CRM GET/HEAD read-only replication'
      && analytics.body?.source?.customer_rows_or_identifiers === false;
    const passed = assistantOk && analyticsOk && versionOk && scopeOk && metricsOk && attemptsOk && boundaryOk;

    const artifact = {
      generated_at: new Date().toISOString(),
      outcome: passed ? 'passed' : 'failed',
      build: { package_version: require('../package.json').version, runtime_version: version.body?.v || null },
      conditions: {
        isolated_process: true,
        zoho_source_enabled: false,
        startup_warmup_wait_ms: 0,
        requests_started_concurrently: true,
        probe_started_at: probeStartedAt,
      },
      checks: {
        analytics_http_200: analyticsOk ? 'passed' : 'failed',
        assistant_http_200: assistantOk ? 'passed' : 'failed',
        build_identity_http_200: versionOk ? 'passed' : 'failed',
        assistant_exact_41_module_scope: scopeOk ? 'passed' : 'failed',
        analytics_exact_five_period_metrics: metricsOk ? 'passed' : 'failed',
        analytics_source_attempts_bounded: attemptsOk ? 'passed' : 'failed',
        local_read_only_boundary: boundaryOk ? 'passed' : 'failed',
      },
      analytics: {
        http_status: analytics.status,
        duration_ms: analytics.duration_ms,
        comparison_metric_count: metricsOk ? analytics.body.datasets.period_comparison.length : null,
        source_query_attempts: attemptsOk ? analytics.body.source.query_attempts : null,
      },
      assistant: {
        http_status: assistant.status,
        duration_ms: assistant.duration_ms,
        module_count: Number.isSafeInteger(assistant.body?.permission_scope?.module_count)
          ? assistant.body.permission_scope.module_count : null,
      },
    };
    writeArtifact(artifact);
    check(assistantOk, `Assistant cold request returned HTTP ${assistant.status}.`);
    check(analyticsOk, `Analytics cold request returned HTTP ${analytics.status}.`);
    check(versionOk, 'Build identity endpoint is unavailable.');
    check(scopeOk, 'Assistant cold scope is not the exact 41-module permission scope.');
    check(metricsOk, 'Analytics cold response is missing the exact five comparison metrics.');
    check(attemptsOk, 'Analytics source attempts are missing or outside the reviewed bound.');
    check(boundaryOk, 'Analytics left the approved aggregate-only local read-only boundary.');
    console.log(`Cold-read contention QA passed: Analytics ${analytics.duration_ms} ms; assistant ${assistant.duration_ms} ms; 41 modules.`);
  } finally {
    await stopChild(child);
  }
}

main().catch(error => {
  console.error(`Cold-read contention QA failed: ${error.message}`);
  process.exitCode = 1;
});
