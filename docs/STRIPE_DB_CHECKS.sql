-- SEO4WEB: read-only database preflight and postmigration inspection.
-- Target ref supplied by owner: pwftbssvdbjoblmhdeax.
-- FIRST verify that ref and the repository in authorized Lovable project metadata.
-- current_database() is usually "postgres" and does NOT establish project identity.
-- Run as the authorized database inspection role; do not request/export credentials.
-- Execute before and after the reviewed migration; save sanitized result tables.
-- Requires the existing subscriptions baseline. Missing billing objects are expected BEFORE,
-- but are a release blocker AFTER migration. This file applies no schema/data changes.
-- No statement calls a billing RPC. Catalog markers are not a substitute for behavioral tests.
BEGIN READ ONLY;

SELECT current_database() AS database_name_not_project_identity,
       current_user AS inspection_role, current_setting('transaction_read_only') AS read_only,
       current_setting('server_version') AS postgres_version, now() AS inspected_at;

-- Existence first. Stop if subscriptions is absent; do not run data queries against another DB.
SELECT name AS expected_relation, to_regclass('public.' || name) IS NOT NULL AS present
FROM (VALUES ('subscriptions'), ('billing_customers'), ('billing_checkout_operations'),
             ('billing_checkout_requests'), ('billing_webhook_events'),
             ('billing_invoice_references')) AS expected(name);

-- Locate histories without assuming either Supabase or Drizzle owns the deployed schema.
SELECT n.nspname AS schema_name, c.relname AS history_relation, a.attname AS column_name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind IN ('r','p') AND c.relname ILIKE '%migration%'
  AND n.nspname IN ('supabase_migrations','drizzle','public')
ORDER BY 1,2,a.attnum;
SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS has_supabase_history;
-- OPTIONAL: only uncomment after the catalog above confirms the relation AND version column.
-- SELECT version FROM supabase_migrations.schema_migrations
-- WHERE version >= '20261110000000' ORDER BY version;
-- Do not export statements/SQL bodies from migration history; they may contain sensitive data.

-- Aggregate only: no customer IDs, user IDs, emails or invoice links leave the database.
WITH ids AS (
  SELECT 'customer' AS kind, stripe_customer_id AS id FROM public.subscriptions
  WHERE stripe_customer_id IS NOT NULL
  UNION ALL SELECT 'subscription', stripe_subscription_id FROM public.subscriptions
  WHERE stripe_subscription_id IS NOT NULL
), duplicates AS (
  SELECT kind, count(*) AS affected_rows FROM ids GROUP BY kind,id HAVING count(*) > 1
)
SELECT kinds.kind, count(d.kind) AS duplicate_groups,
       coalesce(sum(d.affected_rows),0) AS rows_in_duplicate_groups
FROM (VALUES ('customer'),('subscription')) AS kinds(kind)
LEFT JOIN duplicates d USING (kind) GROUP BY kinds.kind ORDER BY kinds.kind;

SELECT count(*) AS subscription_rows,
  count(*) FILTER (WHERE plan IN ('pro','agency') AND current_period_end IS NULL) AS paid_plan_missing_period,
  count(*) FILTER (WHERE plan IN ('pro','agency') AND current_period_end <= now()) AS paid_plan_expired_period,
  count(*) FILTER (WHERE plan IN ('pro','agency') AND status IN ('active','trialing')
    AND (current_period_end IS NULL OR current_period_end <= now())) AS active_paid_without_future_period,
  count(*) FILTER (WHERE stripe_customer_id = '' OR stripe_subscription_id = '') AS blank_stripe_ids,
  count(*) FILTER (WHERE stripe_customer_id IS NOT NULL
    AND (to_jsonb(s)->>'stripe_livemode') IS NULL) AS customer_mapping_without_recorded_mode,
  count(*) FILTER (WHERE stripe_subscription_id IS NOT NULL AND stripe_customer_id IS NULL) AS subscription_without_customer,
  count(*) FILTER (WHERE status NOT IN ('active','trialing','past_due','canceled','incomplete',
    'incomplete_expired','unpaid','paused')) AS unsupported_status_rows
FROM public.subscriptions s;
-- Missing stripe_livemode before migration is counted via to_jsonb, not an undefined column.
-- An expired canceled row can be legitimate. Never infer mode from cus_, delete duplicates,
-- or backfill ownership/mode without verifying each historical Customer in the correct Stripe account.

-- Table RLS and owners; all five new billing tables require ENABLE + FORCE RLS.
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner_role,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  AND (c.relname = 'subscriptions' OR c.relname IN ('billing_customers','billing_checkout_operations',
    'billing_checkout_requests','billing_webhook_events','billing_invoice_references')) ORDER BY 1;

-- Ownership UUIDs must stay NOT NULL; billing_customers.user_id and request composite PK stay intact.
SELECT c.relname, a.attname, format_type(a.atttypid,a.atttypmod) AS data_type,
       a.attnotnull AS not_null, EXISTS (SELECT 1 FROM pg_constraint p
         WHERE p.conrelid=c.oid AND p.contype='p' AND a.attnum=ANY(p.conkey)) AS primary_key_member
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE n.nspname='public' AND c.relname IN ('billing_customers','billing_checkout_operations',
  'billing_checkout_requests','billing_webhook_events','billing_invoice_references')
ORDER BY c.relname,a.attnum;

-- Verify CHECK/UNIQUE/PK/FK definitions, including pre-existing subscriptions constraints.
-- No NEW billing table FK may target auth.users; the four inter-billing FKs must remain.
SELECT c.relname, k.conname, k.contype, pg_get_constraintdef(k.oid,true) AS definition,
       CASE WHEN k.contype='f' THEN k.confrelid::regclass::text END AS foreign_table,
       CASE WHEN k.contype='f' THEN k.confrelid=to_regclass('auth.users') ELSE false END AS targets_auth_users
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND (c.relname='subscriptions' OR c.relname IN ('billing_customers',
  'billing_checkout_operations','billing_checkout_requests','billing_webhook_events','billing_invoice_references'))
ORDER BY c.relname,k.conname;
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
  AND (tablename='subscriptions' OR tablename IN ('billing_customers','billing_checkout_operations',
    'billing_checkout_requests','billing_webhook_events','billing_invoice_references')) ORDER BY 1,2;

-- Raw ACLs include PUBLIC (OID 0), which information_schema role grants can omit.
-- Column grants survive a table-level REVOKE and must be inspected separately.
WITH targets AS (
  SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND (c.relname='subscriptions' OR c.relname IN ('billing_customers',
    'billing_checkout_operations','billing_checkout_requests','billing_webhook_events','billing_invoice_references'))
), entries AS (
  SELECT c.relname,NULL::text AS column_name,x.* FROM targets c
  CROSS JOIN LATERAL aclexplode(nullif(coalesce(c.relacl,acldefault('r',c.relowner)),'{}'::aclitem[])) x
  UNION ALL SELECT c.relname,a.attname::text,x.* FROM targets c
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
  CROSS JOIN LATERAL aclexplode(nullif(a.attacl,'{}'::aclitem[])) x
)
SELECT relname,column_name,CASE WHEN grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee) END AS grantee,
       privilege_type,is_grantable FROM entries ORDER BY 1,2,3,4;

-- Effective table privileges include inherited roles/PUBLIC, not just explicit ACL entries.
SELECT c.relname,r.rolname,
  has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
  has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
  has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
  has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,
  has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate,
  r.rolsuper AS superuser,r.rolbypassrls AS bypass_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN pg_roles r WHERE n.nspname='public'
  AND r.rolname IN ('anon','authenticated','service_role')
  AND (c.relname='subscriptions' OR c.relname IN ('billing_customers','billing_checkout_operations',
    'billing_checkout_requests','billing_webhook_events','billing_invoice_references')) ORDER BY 1,2;
-- Expected on NEW tables: anon has none; authenticated has only invoice-reference SELECT.
-- Service-role privileges alone do not establish row access: also inspect BYPASSRLS and policies.

SELECT a.attname AS subscription_column,r.rolname,
       has_column_privilege(r.oid,a.attrelid,a.attnum,'INSERT') AS can_insert_column,
       has_column_privilege(r.oid,a.attrelid,a.attnum,'UPDATE') AS can_update_column
FROM pg_attribute a CROSS JOIN pg_roles r
WHERE a.attrelid=to_regclass('public.subscriptions') AND a.attnum>0 AND NOT a.attisdropped
  AND r.rolname IN ('anon','authenticated','service_role') ORDER BY 1,2;
-- Any anon/authenticated ability to change billing state requires review with RLS and RPC paths.

SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND (tablename='subscriptions' OR tablename IN ('billing_customers',
  'billing_checkout_operations','billing_checkout_requests','billing_webhook_events','billing_invoice_references'))
ORDER BY 1,2;
-- New internal ledgers: no public policies. Invoice references: SELECT TO authenticated,
-- ownership predicate auth.uid()=user_id; no authenticated INSERT/UPDATE/DELETE policies.

-- Every expected RPC must exist, stay SECURITY INVOKER, and have a fixed search_path.
-- Inspect effective EXECUTE for real roles; PUBLIC is a pseudo-role, read it from the ACL.
WITH expected(signature) AS (VALUES
  ('public.billing_link_customer(uuid,text,boolean)'),
  ('public.billing_claim_checkout(uuid,text,boolean,uuid,text)'),
  ('public.billing_finalize_checkout(uuid,text,boolean,uuid,bigint,uuid,text)'),
  ('public.billing_fail_checkout(uuid,text,boolean,uuid,bigint,uuid)'),
  ('public.billing_claim_event(text,text,text,boolean)'),
  ('public.billing_finalize_event(uuid,text,boolean,uuid,bigint,text,jsonb,jsonb,jsonb)'),
  ('public.billing_fail_event(uuid,text,boolean,uuid,bigint,text,text)')
)
SELECT e.signature,p.oid IS NOT NULL AS present,p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  coalesce((SELECT bool_or(x.privilege_type='EXECUTE') FROM
    aclexplode(nullif(coalesce(p.proacl,acldefault('f',p.proowner)),'{}'::aclitem[])) x WHERE x.grantee=0),false) AS public_execute,
  has_function_privilege((SELECT oid FROM pg_roles WHERE rolname='anon'),p.oid,'EXECUTE') AS anon_execute,
  has_function_privilege((SELECT oid FROM pg_roles WHERE rolname='authenticated'),p.oid,'EXECUTE') AS authenticated_execute,
  has_function_privilege((SELECT oid FROM pg_roles WHERE rolname='service_role'),p.oid,'EXECUTE') AS service_execute
FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) ORDER BY e.signature;
-- Expected after migration: present=true, security_definer=false, search_path=pg_catalog,public,
-- PUBLIC/anon/authenticated EXECUTE=false and service_role EXECUTE=true.

-- Source-definition markers only; this does not call the functions or prove runtime atomicity.
WITH definitions AS (
  SELECT p.proname,pg_get_functiondef(p.oid) AS body FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  AND p.proname IN ('billing_claim_checkout','billing_claim_event','billing_finalize_checkout',
    'billing_finalize_event','billing_fail_checkout','billing_fail_event')
)
SELECT proname,substring(body FROM $$interval '180 seconds'$$) AS lease_interval,
  substring(body FROM $$interval '23 hours'$$) AS checkout_retry_stop,
  body LIKE '%lease_token%' AS checks_lease_token,body LIKE '%lease_generation%' AS uses_generation,
  body LIKE '%FOR UPDATE%' AS has_row_lock,md5(body) AS definition_fingerprint
FROM definitions ORDER BY proname;
-- Compare these definitions to the reviewed migration and run SQL behavior tests separately.
-- Do not mark ledgers completed, test writes, delete rows, or call billing_* mutators here.
ROLLBACK;
