'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { Readable } = require('stream');
const {
  AttachmentReplicationError,
  EXPECTED_SOURCE_ORG,
  assertCrmReadMethod,
  assertExpectedSourceOrg,
  validatePrivateBucket,
} = require('./attachment-replication');

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function encodeObjectPath(value) {
  return String(value).split('/').map(encodeURIComponent).join('/');
}

async function safeJson(response) {
  return response.json().catch(() => null);
}

function retryDelay(response, attempt) {
  const retryAfterSeconds = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(10_000, retryAfterSeconds * 1000);
  }
  return Math.min(5_000, 250 * (2 ** attempt));
}

class ZohoAttachmentSourceAdapter {
  constructor({ accountsUrl, apiDomain, clientId, clientSecret, refreshToken, sourceOrgId }) {
    this.accountsUrl = trimSlash(accountsUrl);
    this.apiDomain = trimSlash(apiDomain);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.sourceOrgId = assertExpectedSourceOrg(sourceOrgId);
    this.cachedToken = null;
    this.cachedTokenAt = 0;
    if (!this.accountsUrl || !this.apiDomain || !clientId || !clientSecret || !refreshToken) {
      throw new AttachmentReplicationError('ZOHO_CONFIG_INCOMPLETE', 'Zoho read-only source configuration is incomplete.');
    }
  }

  async accessToken() {
    if (this.cachedToken && Date.now() - this.cachedTokenAt < 50 * 60 * 1000) return this.cachedToken;
    const query = new URLSearchParams({
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
    });
    const response = await fetch(`${this.accountsUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: query,
    });
    const body = await safeJson(response);
    if (!response.ok || !body?.access_token) {
      throw new AttachmentReplicationError('ZOHO_OAUTH_FAILED', `Zoho OAuth token exchange failed with HTTP ${response.status}.`);
    }
    this.cachedToken = body.access_token;
    this.cachedTokenAt = Date.now();
    return this.cachedToken;
  }

  async crmRequest(endpoint, options = {}) {
    const method = assertCrmReadMethod(options.method || 'GET');
    if (!String(endpoint).startsWith('/crm/')) {
      throw new AttachmentReplicationError('INVALID_CRM_ENDPOINT', 'Zoho source endpoint must remain under /crm/.');
    }
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      const headers = {
        Authorization: `Zoho-oauthtoken ${await this.accessToken()}`,
        ...(options.headers || {}),
      };
      const response = await fetch(`${this.apiDomain}${endpoint}`, { ...options, method, headers });
      if (response.status === 401 && attempt === 0) {
        this.cachedToken = null;
        this.cachedTokenAt = 0;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      return response;
    }
    throw new AttachmentReplicationError('SOURCE_RETRY_EXHAUSTED', 'Zoho source GET retries were exhausted.');
  }

  async verifyOrganization() {
    const response = await this.crmRequest('/crm/v8/org');
    const body = await safeJson(response);
    if (!response.ok) {
      throw new AttachmentReplicationError('ORG_READ_FAILED', `Zoho organization GET failed with HTTP ${response.status}.`);
    }
    const org = Array.isArray(body?.org) ? body.org[0] : null;
    assertExpectedSourceOrg(this.sourceOrgId, org || {});
    return true;
  }

  async listAttachmentPage({ pageToken, pageNumber }) {
    const query = new URLSearchParams({
      fields: 'id,Parent_Id,File_Name,Size,Created_Time,Modified_Time',
      per_page: '200',
    });
    if (pageToken) query.set('page_token', pageToken);
    else query.set('page', String(pageNumber || 1));
    const response = await this.crmRequest(`/crm/v8/Attachments?${query}`);
    if (response.status === 204) return { data: [], info: { more_records: false } };
    const body = await safeJson(response);
    if (!response.ok) {
      const error = new AttachmentReplicationError(
        String(body?.code || 'ATTACHMENT_METADATA_READ_FAILED'),
        `Attachment metadata GET failed with HTTP ${response.status}.`,
      );
      error.status = response.status;
      throw error;
    }
    return body || { data: [], info: { more_records: false } };
  }

  async openAttachmentStream(row, { offset = 0 } = {}) {
    if (!row.parent_module || !row.parent_record_id || !row.attachment_id) {
      throw new AttachmentReplicationError('INCOMPLETE_ATTACHMENT_PARENT', 'Attachment parent metadata is incomplete.');
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new AttachmentReplicationError('INVALID_DOWNLOAD_OFFSET', 'Attachment download offset is invalid.');
    }
    const headers = offset ? { Range: `bytes=${offset}-` } : {};
    const endpoint = `/crm/v8/${encodeURIComponent(row.parent_module)}/${encodeURIComponent(row.parent_record_id)}/Attachments/${encodeURIComponent(row.attachment_id)}`;
    const response = await this.crmRequest(endpoint, { headers });
    if (!response.ok || !response.body) {
      throw new AttachmentReplicationError('ATTACHMENT_DOWNLOAD_FAILED', `Attachment GET failed with HTTP ${response.status}.`);
    }
    if (offset > 0 && response.status !== 206) {
      throw new AttachmentReplicationError('SOURCE_RANGE_UNSUPPORTED', 'Source did not honor the resumable byte range request.');
    }
    return {
      body: response.body,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      contentLength: Number(response.headers.get('content-length') || 0) || null,
    };
  }
}

class SupabasePrivateStorageAdapter {
  constructor({ supabaseUrl, serviceRoleKey, bucketName, resumableUploader = null }) {
    this.supabaseUrl = trimSlash(supabaseUrl);
    this.serviceRoleKey = serviceRoleKey;
    this.bucketName = String(bucketName || '').trim();
    this.resumableUploader = resumableUploader;
    this.preflightComplete = false;
    if (!this.supabaseUrl || !serviceRoleKey) {
      throw new AttachmentReplicationError('STORAGE_CONFIG_INCOMPLETE', 'Private storage URL and service-role key are required.');
    }
  }

  headers(extra = {}) {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      ...extra,
    };
  }

  async preflightPrivateBucket() {
    if (!this.bucketName) validatePrivateBucket(null, this.bucketName);
    const response = await fetch(`${this.supabaseUrl}/storage/v1/bucket/${encodeURIComponent(this.bucketName)}`, {
      method: 'GET',
      headers: this.headers(),
    });
    const body = await safeJson(response);
    if (!response.ok) {
      throw new AttachmentReplicationError('BUCKET_NOT_FOUND', `Private bucket preflight failed with HTTP ${response.status}.`);
    }
    validatePrivateBucket(body, this.bucketName);
    this.preflightComplete = true;
    return { name: this.bucketName, private: true };
  }

  assertPreflight() {
    if (!this.preflightComplete) {
      throw new AttachmentReplicationError('BUCKET_PREFLIGHT_REQUIRED', 'Private bucket preflight must pass before attachment metadata or bytes are written.');
    }
  }

  async uploadStream({ objectPath, body, declaredSizeBytes, contentType }) {
    this.assertPreflight();
    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucketName)}/${encodeObjectPath(objectPath)}`,
      {
        method: 'POST',
        headers: this.headers({
          'Content-Type': contentType || 'application/octet-stream',
          'Content-Length': String(declaredSizeBytes),
          'x-upsert': 'false',
        }),
        body,
        duplex: 'half',
      },
    );
    if (!response.ok) {
      throw new AttachmentReplicationError('PRIVATE_UPLOAD_FAILED', `Private object upload failed with HTTP ${response.status}.`);
    }
    return { stored: true };
  }

  async uploadResumable(request) {
    this.assertPreflight();
    if (!this.resumableUploader || typeof this.resumableUploader.uploadResumable !== 'function') {
      throw new AttachmentReplicationError('RESUMABLE_ADAPTER_REQUIRED', 'A reviewed resumable storage adapter is required for attachments over 6 MB.');
    }
    return this.resumableUploader.uploadResumable({ ...request, bucketName: this.bucketName });
  }

  async headPrivateObject(objectPath) {
    this.assertPreflight();
    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucketName)}/${encodeObjectPath(objectPath)}`,
      { method: 'HEAD', headers: this.headers() },
    );
    if (!response.ok) {
      throw new AttachmentReplicationError('PRIVATE_HEAD_FAILED', `Private object HEAD failed with HTTP ${response.status}.`);
    }
    return {
      size: Number(response.headers.get('content-length')),
      etag: response.headers.get('etag') || null,
    };
  }

  async verifyPrivateObject({ objectPath, expectedSizeBytes, expectedSha256 }) {
    this.assertPreflight();
    if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 0 || !/^[a-f0-9]{64}$/.test(String(expectedSha256 || ''))) {
      throw new AttachmentReplicationError('INVALID_VERIFICATION_EXPECTATION', 'Private-object verification requires an exact size and SHA-256.');
    }
    const head = await this.headPrivateObject(objectPath);
    if (head.size !== expectedSizeBytes) {
      throw new AttachmentReplicationError('STORAGE_SIZE_MISMATCH', 'Private-object HEAD size does not match the streamed source size.');
    }
    const response = await fetch(
      `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucketName)}/${encodeObjectPath(objectPath)}`,
      { method: 'GET', headers: this.headers({ 'Cache-Control': 'no-store' }) },
    );
    if (!response.ok || !response.body) {
      throw new AttachmentReplicationError('PRIVATE_READBACK_FAILED', `Authenticated private-object read-back failed with HTTP ${response.status}.`);
    }
    const readable = typeof response.body.getReader === 'function' ? Readable.fromWeb(response.body) : response.body;
    const digest = crypto.createHash('sha256');
    let size = 0;
    for await (const chunk of readable) {
      size += chunk.length;
      digest.update(chunk);
    }
    const actualSha256 = digest.digest('hex');
    if (size !== expectedSizeBytes || actualSha256 !== expectedSha256) {
      throw new AttachmentReplicationError('STORAGE_CONTENT_MISMATCH', 'Authenticated private-object read-back does not match the streamed source.');
    }
    const anonymousHead = await fetch(
      `${this.supabaseUrl}/storage/v1/object/public/${encodeURIComponent(this.bucketName)}/${encodeObjectPath(objectPath)}`,
      { method: 'HEAD', redirect: 'manual' },
    );
    if (![400, 401, 403, 404].includes(anonymousHead.status)) {
      throw new AttachmentReplicationError('OBJECT_ANONYMOUSLY_ACCESSIBLE', 'Anonymous object access was not denied after upload.');
    }
    return { size, sha256: actualSha256, etag: head.etag };
  }
}

class SupabaseAttachmentManifestAdapter {
  constructor({ supabaseUrl, serviceRoleKey, storageAdapter }) {
    this.supabaseUrl = trimSlash(supabaseUrl);
    this.serviceRoleKey = serviceRoleKey;
    this.storageAdapter = storageAdapter;
    if (!this.supabaseUrl || !serviceRoleKey || !storageAdapter) {
      throw new AttachmentReplicationError('MANIFEST_CONFIG_INCOMPLETE', 'Manifest adapter requires private storage and service-role configuration.');
    }
  }

  headers(extra = {}) {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async upsertRows(rows) {
    this.storageAdapter.assertPreflight();
    if (!Array.isArray(rows) || !rows.length || rows.length > 25) {
      throw new AttachmentReplicationError('INVALID_MANIFEST_BATCH', 'Manifest upsert batches must contain 1 to 25 rows.');
    }
    const response = await fetch(
      `${this.supabaseUrl}/rest/v1/rpc/crm_attachment_manifest_upsert`,
      {
        method: 'POST',
        headers: this.headers({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ rows }),
      },
    );
    if (!response.ok) {
      throw new AttachmentReplicationError('MANIFEST_UPSERT_FAILED', `Attachment manifest upsert failed with HTTP ${response.status}.`);
    }
    return rows.length;
  }

  async recordVerification(row, result) {
    this.storageAdapter.assertPreflight();
    const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/crm_attachment_mark_verified`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        p_source_org_id: row.source_org_id,
        p_attachment_id: row.attachment_id,
        p_uploaded_size_bytes: result.uploaded_size_bytes,
        p_content_sha256: result.content_sha256,
        p_storage_etag: result.storage_etag,
      }),
    });
    if (!response.ok) {
      throw new AttachmentReplicationError('VERIFICATION_UPDATE_FAILED', `Attachment verification update failed with HTTP ${response.status}.`);
    }
  }

  async recordFailure(row, errorCode) {
    this.storageAdapter.assertPreflight();
    const safeCode = String(errorCode || 'TRANSFER_FAILED').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
    const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/crm_attachment_mark_failure`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        p_source_org_id: row.source_org_id,
        p_attachment_id: row.attachment_id,
        p_error_code: safeCode,
      }),
    });
    if (!response.ok) {
      throw new AttachmentReplicationError('FAILURE_STATE_UPDATE_FAILED', `Attachment failure-state update failed with HTTP ${response.status}.`);
    }
  }

  async getTransferState(rows) {
    this.storageAdapter.assertPreflight();
    if (!Array.isArray(rows) || !rows.length || rows.length > 25) {
      throw new AttachmentReplicationError('INVALID_STATE_BATCH', 'Transfer-state reads must contain 1 to 25 rows.');
    }
    const encodedIds = rows.map(row => `"${String(row.attachment_id).replace(/"/g, '')}"`).join(',');
    const query = new URLSearchParams({
      select: 'attachment_id,replication_status,retry_count,next_attempt_at,verification_status,uploaded_size_bytes,content_sha256',
      source_org_id: `eq.${rows[0].source_org_id}`,
      attachment_id: `in.(${encodedIds})`,
    });
    const response = await fetch(`${this.supabaseUrl}/rest/v1/crm_attachment_manifest?${query}`, {
      method: 'GET',
      headers: this.headers(),
    });
    const body = await safeJson(response);
    if (!response.ok || !Array.isArray(body)) {
      throw new AttachmentReplicationError('TRANSFER_STATE_READ_FAILED', `Attachment transfer-state read failed with HTTP ${response.status}.`);
    }
    return body;
  }
}

function loadResumableAdapter(modulePath, context) {
  if (!modulePath) return null;
  const absolute = path.resolve(modulePath);
  const loaded = require(absolute);
  const factory = loaded.createResumableAttachmentUploader || loaded.createUploader;
  if (typeof factory !== 'function') {
    throw new AttachmentReplicationError('INVALID_RESUMABLE_ADAPTER', 'Resumable adapter module must export createResumableAttachmentUploader or createUploader.');
  }
  const adapter = factory(context);
  if (!adapter || typeof adapter.uploadResumable !== 'function') {
    throw new AttachmentReplicationError('INVALID_RESUMABLE_ADAPTER', 'Resumable adapter factory returned an invalid adapter.');
  }
  return adapter;
}

function writePrivateJsonLines(filePath, rows) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const temp = `${filePath}.tmp-${process.pid}`;
  const payload = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, filePath);
  fs.chmodSync(filePath, 0o600);
}

module.exports = {
  ZohoAttachmentSourceAdapter,
  SupabasePrivateStorageAdapter,
  SupabaseAttachmentManifestAdapter,
  loadResumableAdapter,
  writePrivateJsonLines,
};
