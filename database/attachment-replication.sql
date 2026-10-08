-- Attachment replication schema for the MAGPPIE local replica.
-- Apply only through an authorized Supabase SQL session after reviewing the runbook.
-- This migration contains no source attachment metadata, object URLs, file bytes, or credentials.

BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_attachment_manifest (
  source_org_id text NOT NULL,
  attachment_id text NOT NULL,
  parent_module text,
  parent_record_id text,
  file_name text,
  declared_size_bytes bigint,
  source_created_at timestamptz,
  source_modified_at timestamptz,
  private_object_path text NOT NULL,
  replication_status text NOT NULL DEFAULT 'metadata_only',
  retry_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text,
  content_sha256 text,
  uploaded_size_bytes bigint,
  storage_etag text,
  verification_status text NOT NULL DEFAULT 'not_started',
  verified_at timestamptz,
  quarantine_reasons text[] NOT NULL DEFAULT '{}',
  source_seen_at timestamptz NOT NULL,
  tombstone_review_status text NOT NULL DEFAULT 'not_candidate',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_org_id, attachment_id),
  CONSTRAINT crm_attachment_locked_org CHECK (source_org_id = 'org60046349006'),
  CONSTRAINT crm_attachment_size_nonnegative CHECK (declared_size_bytes IS NULL OR declared_size_bytes >= 0),
  CONSTRAINT crm_attachment_uploaded_size_nonnegative CHECK (uploaded_size_bytes IS NULL OR uploaded_size_bytes >= 0),
  CONSTRAINT crm_attachment_retry_nonnegative CHECK (retry_count >= 0),
  CONSTRAINT crm_attachment_private_path CHECK (
    private_object_path LIKE 'zoho-crm/%'
    AND private_object_path NOT LIKE 'http://%'
    AND private_object_path NOT LIKE 'https://%'
  ),
  CONSTRAINT crm_attachment_status CHECK (replication_status IN (
    'metadata_only', 'quarantined', 'queued', 'transferring', 'failed', 'uploaded', 'verified'
  )),
  CONSTRAINT crm_attachment_verification CHECK (verification_status IN (
    'not_started', 'pending_private_head', 'failed', 'sha256_and_size_verified'
  )),
  CONSTRAINT crm_attachment_hash_format CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT crm_attachment_tombstone_status CHECK (tombstone_review_status IN (
    'not_candidate', 'review_required', 'approved_keep', 'approved_remove_local'
  )),
  CONSTRAINT crm_attachment_quarantine_consistency CHECK (
    replication_status <> 'quarantined' OR cardinality(quarantine_reasons) > 0
  ),
  CONSTRAINT crm_attachment_verified_consistency CHECK (
    replication_status <> 'verified'
    OR (
      verification_status = 'sha256_and_size_verified'
      AND content_sha256 IS NOT NULL
      AND uploaded_size_bytes = declared_size_bytes
      AND verified_at IS NOT NULL
    )
  ),
  UNIQUE (private_object_path)
);

CREATE INDEX IF NOT EXISTS crm_attachment_parent_idx
  ON public.crm_attachment_manifest (parent_module, parent_record_id);
CREATE INDEX IF NOT EXISTS crm_attachment_status_idx
  ON public.crm_attachment_manifest (replication_status, next_attempt_at, retry_count);
CREATE INDEX IF NOT EXISTS crm_attachment_seen_idx
  ON public.crm_attachment_manifest (source_seen_at);
CREATE INDEX IF NOT EXISTS crm_attachment_tombstone_idx
  ON public.crm_attachment_manifest (tombstone_review_status)
  WHERE tombstone_review_status <> 'not_candidate';

CREATE TABLE IF NOT EXISTS public.crm_attachment_scan_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_org_id text NOT NULL CHECK (source_org_id = 'org60046349006'),
  mode text NOT NULL CHECK (mode IN ('metadata_dry_run', 'metadata_apply', 'bounded_transfer')),
  status text NOT NULL CHECK (status IN ('running', 'complete', 'failed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  source_unique_count bigint,
  declared_bytes bigint,
  quarantined_count bigint,
  transferred_count bigint NOT NULL DEFAULT 0,
  failed_count bigint NOT NULL DEFAULT 0,
  token_restart_count integer NOT NULL DEFAULT 0,
  error_code text
);

CREATE TABLE IF NOT EXISTS public.crm_attachment_scan_checkpoints (
  source_org_id text NOT NULL CHECK (source_org_id = 'org60046349006'),
  source_module text NOT NULL DEFAULT 'Attachments' CHECK (source_module = 'Attachments'),
  status text NOT NULL CHECK (status IN ('running', 'token_expired_restart', 'complete', 'failed')),
  next_page_token text,
  unique_rows_seen bigint NOT NULL DEFAULT 0,
  token_restart_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_org_id, source_module),
  CONSTRAINT crm_attachment_checkpoint_complete CHECK (status <> 'complete' OR next_page_token IS NULL)
);

CREATE TABLE IF NOT EXISTS public.crm_attachment_tombstone_reviews (
  source_org_id text NOT NULL,
  attachment_id text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  reason_code text NOT NULL,
  review_status text NOT NULL DEFAULT 'review_required' CHECK (review_status IN (
    'review_required', 'approved_keep', 'approved_remove_local', 'rejected'
  )),
  reviewed_at timestamptz,
  reviewed_by text,
  evidence jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (source_org_id, attachment_id),
  FOREIGN KEY (source_org_id, attachment_id)
    REFERENCES public.crm_attachment_manifest (source_org_id, attachment_id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.crm_attachment_block_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'attachment manifest deletion is disabled; use tombstone review and a separately approved recovery-safe procedure';
END
$function$;

DROP TRIGGER IF EXISTS crm_attachment_no_delete ON public.crm_attachment_manifest;
CREATE TRIGGER crm_attachment_no_delete
BEFORE DELETE ON public.crm_attachment_manifest
FOR EACH ROW EXECUTE FUNCTION public.crm_attachment_block_delete();

CREATE OR REPLACE FUNCTION public.crm_attachment_manifest_upsert(rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  affected integer;
BEGIN
  IF jsonb_typeof(rows) <> 'array' OR jsonb_array_length(rows) < 1 OR jsonb_array_length(rows) > 25 THEN
    RAISE EXCEPTION 'attachment metadata batch must contain 1 to 25 rows';
  END IF;

  INSERT INTO crm_attachment_manifest (
    source_org_id, attachment_id, parent_module, parent_record_id, file_name,
    declared_size_bytes, source_created_at, source_modified_at, private_object_path,
    replication_status, quarantine_reasons, source_seen_at, tombstone_review_status
  )
  SELECT
    item->>'source_org_id',
    item->>'attachment_id',
    nullif(item->>'parent_module', ''),
    nullif(item->>'parent_record_id', ''),
    nullif(item->>'file_name', ''),
    nullif(item->>'declared_size_bytes', '')::bigint,
    nullif(item->>'source_created_at', '')::timestamptz,
    nullif(item->>'source_modified_at', '')::timestamptz,
    item->>'private_object_path',
    CASE WHEN jsonb_array_length(coalesce(item->'quarantine_reasons', '[]'::jsonb)) > 0
      THEN 'quarantined' ELSE 'metadata_only' END,
    ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'quarantine_reasons', '[]'::jsonb))),
    nullif(item->>'source_seen_at', '')::timestamptz,
    'not_candidate'
  FROM jsonb_array_elements(rows) AS item
  ON CONFLICT (source_org_id, attachment_id) DO UPDATE SET
    parent_module = excluded.parent_module,
    parent_record_id = excluded.parent_record_id,
    file_name = excluded.file_name,
    declared_size_bytes = excluded.declared_size_bytes,
    source_created_at = excluded.source_created_at,
    source_modified_at = excluded.source_modified_at,
    private_object_path = excluded.private_object_path,
    quarantine_reasons = excluded.quarantine_reasons,
    source_seen_at = excluded.source_seen_at,
    tombstone_review_status = 'not_candidate',
    replication_status = CASE
      WHEN cardinality(excluded.quarantine_reasons) > 0 THEN 'quarantined'
      WHEN crm_attachment_manifest.replication_status = 'quarantined' THEN 'metadata_only'
      ELSE crm_attachment_manifest.replication_status
    END,
    updated_at = now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_attachment_mark_verified(
  p_source_org_id text,
  p_attachment_id text,
  p_uploaded_size_bytes bigint,
  p_content_sha256 text,
  p_storage_etag text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_content_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid SHA-256';
  END IF;
  UPDATE crm_attachment_manifest SET
    replication_status = 'verified',
    uploaded_size_bytes = p_uploaded_size_bytes,
    content_sha256 = p_content_sha256,
    storage_etag = p_storage_etag,
    verification_status = 'sha256_and_size_verified',
    verified_at = now(),
    last_attempt_at = now(),
    last_error_code = NULL,
    next_attempt_at = NULL,
    updated_at = now()
  WHERE source_org_id = p_source_org_id
    AND attachment_id = p_attachment_id
    AND replication_status <> 'quarantined'
    AND declared_size_bytes = p_uploaded_size_bytes;
  IF NOT FOUND THEN RAISE EXCEPTION 'attachment verification state rejected'; END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_attachment_mark_failure(
  p_source_org_id text,
  p_attachment_id text,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'invalid attachment error code';
  END IF;
  UPDATE crm_attachment_manifest SET
    replication_status = 'failed',
    verification_status = 'failed',
    retry_count = retry_count + 1,
    last_attempt_at = now(),
    next_attempt_at = now() + least(interval '24 hours', interval '5 minutes' * power(2, least(retry_count, 8))),
    last_error_code = p_error_code,
    updated_at = now()
  WHERE source_org_id = p_source_org_id
    AND attachment_id = p_attachment_id
    AND replication_status NOT IN ('verified', 'quarantined');
END
$function$;

ALTER TABLE public.crm_attachment_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_attachment_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_attachment_scan_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_attachment_tombstone_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.crm_attachment_manifest FROM anon, authenticated;
REVOKE ALL ON public.crm_attachment_scan_runs FROM anon, authenticated;
REVOKE ALL ON public.crm_attachment_scan_checkpoints FROM anon, authenticated;
REVOKE ALL ON public.crm_attachment_tombstone_reviews FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_attachment_manifest_upsert(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_attachment_mark_verified(text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_attachment_mark_failure(text, text, text) FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.crm_attachment_manifest TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_attachment_scan_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.crm_attachment_scan_runs_id_seq TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_attachment_scan_checkpoints TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_attachment_tombstone_reviews TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_attachment_manifest_upsert(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_attachment_mark_verified(text, text, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_attachment_mark_failure(text, text, text) TO service_role;

COMMIT;
