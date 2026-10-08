-- Apply to an existing MAGPPIE CRM database outside a transaction.
-- CREATE INDEX CONCURRENTLY keeps the replicated CRM readable and writable.
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_records_analytics_cover_idx
  ON public.crm_records USING btree (module)
  INCLUDE (id, status, created_time, modified_time, due_date, ts2)
  WHERE module IN ('Leads', 'Contacts', 'Deals', 'Tasks', 'Calls', 'Events');

ANALYZE public.crm_records;
