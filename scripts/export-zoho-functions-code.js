#!/usr/bin/env node
'use strict';

// Downloads published Zoho CRM Function source without executing or changing
// any CRM resource. CRM traffic is restricted to the GET endpoints allowlisted
// below. OAuth token refresh is sent only to the configured Accounts host.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.umask(0o077);

const ROOT = path.join(__dirname, '..');
const PRIVATE_ROOT = path.join(ROOT, '.private');
const DISCOVERY_DIR = path.join(PRIVATE_ROOT, 'zoho-discovery');
const CODE_DIR = path.join(DISCOVERY_DIR, 'functions-code');
const MANIFEST_PATH = path.join(CODE_DIR, 'manifest.json');
const TARGET_ZGID = '60046349006';
const TARGET_DOMAIN = `org${TARGET_ZGID}`;
const REQUIRED_ENV = [
  'ZOHO_API_DOMAIN',
  'ZOHO_ACCOUNTS_URL',
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
];

const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required environment keys: ${missing.join(', ')}`);
}

function normalizedHttpsBase(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must be a credential-free HTTPS base URL`);
  }
  return raw.replace(/\/+$/, '');
}

const API = normalizedHttpsBase(process.env.ZOHO_API_DOMAIN, 'ZOHO_API_DOMAIN');
const ACCOUNTS = normalizedHttpsBase(process.env.ZOHO_ACCOUNTS_URL, 'ZOHO_ACCOUNTS_URL');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Private export path is not a regular directory: ${path.basename(directory)}`);
  }
  fs.chmodSync(directory, 0o700);
}

function assertPrivateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Private export is not a regular file: ${path.basename(file)}`);
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error(`Private export permissions are not 0600: ${path.basename(file)}`);
  }
  return stat;
}

function writePrivateFileExclusive(file, bytes) {
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  fs.chmodSync(file, 0o600);
  assertPrivateFile(file);
}

function writePrivateJsonAtomic(file, value) {
  const temp = path.join(path.dirname(file), `.manifest-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    writePrivateFileExclusive(temp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
    assertPrivateFile(file);
  } catch (error) {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    throw error;
  }
}

function removeStagingDirectory(directory) {
  const relative = path.relative(CODE_DIR, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(directory).startsWith('.staging-')) {
    throw new Error('Refusing to clean an unexpected staging path');
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

let accessToken = null;
async function token() {
  if (accessToken) return accessToken;
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const response = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error(`Zoho authentication failed (${response.status})`);
  }
  accessToken = body.access_token;
  return accessToken;
}

function assertAllowedCrmGet(endpoint) {
  const parsed = new URL(endpoint, 'https://crm-get.invalid');
  const isOrg = parsed.pathname === '/crm/v8/org' && !parsed.search;
  const isFunctionList = parsed.pathname === '/crm/v8/settings/functions'
    && [...parsed.searchParams.keys()].every(key => ['page', 'per_page', 'page_token'].includes(key));
  const isFunctionCode = /^\/crm\/v8\/settings\/functions\/\d+\/code$/.test(parsed.pathname)
    && !parsed.search;
  if (!isOrg && !isFunctionList && !isFunctionCode) {
    throw new Error('Refusing a CRM GET outside the function-export allowlist');
  }
}

async function crmGet(endpoint, retries = 3) {
  assertAllowedCrmGet(endpoint);
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response;
    try {
      response = await fetch(`${API}${endpoint}`, {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: `Zoho-oauthtoken ${await token()}` },
      });
    } catch (error) {
      if (attempt >= retries) throw new Error('Zoho CRM GET failed after retries');
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    return response;
  }
  throw new Error('Zoho CRM GET failed after retries');
}

async function crmJsonGet(endpoint) {
  const response = await crmGet(endpoint);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Zoho CRM GET returned HTTP ${response.status}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Zoho CRM GET returned invalid JSON');
  }
  return data;
}

async function verifyTargetOrganization() {
  const data = await crmJsonGet('/crm/v8/org');
  const source = Array.isArray(data.org) ? data.org[0] : null;
  if (!source || typeof source !== 'object') {
    throw new Error('Organization inspection returned no organization');
  }
  const zgid = String(source.zgid || '');
  const domain = String(source.domain_name || '');
  const domainLabel = domain.split('.')[0];
  if (zgid !== TARGET_ZGID && domain !== TARGET_DOMAIN && domainLabel !== TARGET_DOMAIN) {
    throw new Error(`Authenticated Zoho organization is not ${TARGET_DOMAIN}`);
  }

  const configured = String(process.env.ZOHO_CRM_ORG_ID || '').trim();
  const candidates = [source.id, source.zgid, source.domain_name].filter(Boolean).map(String);
  if (configured && !candidates.includes(configured)) {
    throw new Error('ZOHO_CRM_ORG_ID does not match the authenticated organization');
  }

  return {
    id: source.id == null ? null : String(source.id),
    zgid: source.zgid == null ? null : String(source.zgid),
    domain_name: source.domain_name == null ? null : String(source.domain_name),
  };
}

async function listFunctions() {
  const functions = [];
  const seenPageTokens = new Set();
  let page = 1;
  let pageToken = null;
  let complete = false;

  for (let requestCount = 0; requestCount < 100; requestCount++) {
    const endpoint = pageToken
      ? `/crm/v8/settings/functions?per_page=200&page_token=${encodeURIComponent(pageToken)}`
      : `/crm/v8/settings/functions?per_page=200&page=${page}`;
    const data = await crmJsonGet(endpoint);
    if (!Array.isArray(data.functions)) {
      throw new Error('Function list response does not contain a functions array');
    }
    functions.push(...data.functions);

    if (!data.info?.more_records) {
      complete = true;
      break;
    }
    if (data.info.next_page_token) {
      const nextToken = String(data.info.next_page_token);
      if (seenPageTokens.has(nextToken)) throw new Error('Function pagination repeated a page token');
      seenPageTokens.add(nextToken);
      pageToken = nextToken;
    } else if (pageToken) {
      throw new Error('Function pagination omitted the next page token');
    } else {
      page += 1;
    }
  }

  if (!complete) throw new Error('Function pagination exceeded the safety limit');
  if (!functions.length) throw new Error('No functions were returned by Zoho CRM');
  const ids = new Set();
  const apiNames = new Set();
  for (const item of functions) {
    const id = String(item?.id || '');
    const apiName = String(item?.api_name || '');
    if (!/^\d+$/.test(id) || !apiName || !item?.name) {
      throw new Error('Function metadata is missing a required identifier or name');
    }
    if (ids.has(id)) throw new Error(`Function list contains duplicate ID ${id}`);
    if (apiNames.has(apiName)) throw new Error('Function list contains a duplicate API name');
    ids.add(id);
    apiNames.add(apiName);
  }
  return functions;
}

function codeExtension(item, contentType) {
  if (String(item.language || '').toLowerCase() === 'deluge') return 'ds';
  if (String(contentType || '').toLowerCase().includes('zip')) return 'zip';
  return 'zip';
}

function exactArguments(item) {
  if (item.arguments == null) return null;
  if (!Array.isArray(item.arguments)) throw new Error('Function arguments metadata is not an array');
  return item.arguments.map(argument => {
    if (!argument || typeof argument.name !== 'string' || typeof argument.type !== 'string') {
      throw new Error('Function argument metadata is incomplete');
    }
    return { name: argument.name, type: argument.type };
  });
}

function verifyBodyFile(file, expectedBytes, expectedHash) {
  const stat = assertPrivateFile(file);
  if (stat.size !== expectedBytes || stat.size <= 0) {
    throw new Error(`Function body size reconciliation failed for ${path.basename(file)}`);
  }
  const actualHash = sha256(fs.readFileSync(file));
  if (actualHash !== expectedHash || !/^[a-f0-9]{64}$/.test(actualHash)) {
    throw new Error(`Function body hash reconciliation failed for ${path.basename(file)}`);
  }
}

async function downloadFunctions(functions) {
  const stagingDir = path.join(CODE_DIR, `.staging-${process.pid}-${crypto.randomUUID()}`);
  ensurePrivateDirectory(stagingDir);
  const entries = [];

  try {
    for (const item of functions) {
      const id = String(item.id);
      const response = await crmGet(`/crm/v8/settings/functions/${id}/code`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) {
        throw new Error(`Function code GET failed for ID ${id} (HTTP ${response.status})`);
      }
      if (!bytes.length) throw new Error(`Function code GET returned an empty body for ID ${id}`);

      const contentType = String(response.headers.get('content-type') || '').split(';')[0];
      const digest = sha256(bytes);
      if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Function hash generation failed for ID ${id}`);

      const fileName = `${id}.${codeExtension(item, contentType)}`;
      const stagingFile = path.join(stagingDir, fileName);
      writePrivateFileExclusive(stagingFile, bytes);
      verifyBodyFile(stagingFile, bytes.length, digest);

      entries.push({
        id,
        api_name: item.api_name,
        display_name: item.name,
        arguments: exactArguments(item),
        category: item.category ?? null,
        language: item.language ?? null,
        runtime: item.runtime ?? null,
        file: fileName,
        byte_length: bytes.length,
        sha256: digest,
        status: response.status,
        content_type: contentType || null,
      });
    }

    if (entries.length !== functions.length) {
      throw new Error(`Function count reconciliation failed (${entries.length}/${functions.length})`);
    }
    if (entries.some(entry => entry.status !== 200 || entry.byte_length <= 0 || !entry.sha256)) {
      throw new Error('Function nonempty/status/hash reconciliation failed');
    }

    for (const entry of entries) {
      const stagingFile = path.join(stagingDir, entry.file);
      const finalFile = path.join(CODE_DIR, entry.file);
      fs.renameSync(stagingFile, finalFile);
      fs.chmodSync(finalFile, 0o600);
      verifyBodyFile(finalFile, entry.byte_length, entry.sha256);
    }
    removeStagingDirectory(stagingDir);
    return entries;
  } catch (error) {
    if (fs.existsSync(stagingDir)) removeStagingDirectory(stagingDir);
    throw error;
  }
}

async function main() {
  ensurePrivateDirectory(PRIVATE_ROOT);
  ensurePrivateDirectory(DISCOVERY_DIR);
  ensurePrivateDirectory(CODE_DIR);

  const sourceOrg = await verifyTargetOrganization();
  const functions = await listFunctions();
  const entries = await downloadFunctions(functions);
  const nonemptyCount = entries.filter(entry => entry.byte_length > 0).length;
  const hashCount = entries.filter(entry => /^[a-f0-9]{64}$/.test(entry.sha256)).length;
  if (functions.length !== entries.length || entries.length !== nonemptyCount || entries.length !== hashCount) {
    throw new Error('Final function export reconciliation failed');
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    source_mode: 'read-only',
    crm_methods_used: ['GET'],
    target_org: TARGET_DOMAIN,
    source_org: sourceOrg,
    endpoint_pattern: '/crm/v8/settings/functions/{id}/code',
    reconciliation: {
      listed_count: functions.length,
      downloaded_count: entries.length,
      nonempty_count: nonemptyCount,
      valid_sha256_count: hashCount,
      distinct_sha256_count: new Set(entries.map(entry => entry.sha256)).size,
    },
    functions: entries,
  };
  writePrivateJsonAtomic(MANIFEST_PATH, manifest);

  const persisted = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(persisted.functions)
      || persisted.functions.length !== functions.length
      || persisted.reconciliation?.downloaded_count !== functions.length) {
    throw new Error('Private manifest reconciliation failed');
  }

  console.log(`Zoho Function code export complete: ${entries.length}/${functions.length} downloaded; ${nonemptyCount} nonempty; ${hashCount} SHA-256 verified.`);
  console.log(`Private manifest: ${path.relative(ROOT, MANIFEST_PATH)}`);
}

main().catch(error => {
  console.error(`Zoho Function code export failed: ${error.message}`);
  process.exitCode = 1;
});
