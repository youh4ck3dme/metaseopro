-- Append-only migration. Not applied by this PR: apply it on deploy.
-- Fixes Lovable finding "Any signed-in user can check another user's plan status".
--
-- Root cause: public.has_agency_plan(_user_id uuid) is SECURITY DEFINER (bypasses the
-- "Users view own subscription" RLS on public.subscriptions) and EXECUTE is granted to
-- `authenticated` (drizzle/migrations/0003_harden_usage_and_agency.sql:5-12, body re-created
-- in supabase/migrations/20261116031733_stripe_billing_reconciliation.sql:433-444).
-- Any signed-in user can therefore call
--   POST /rest/v1/rpc/has_agency_plan {"_user_id":"<victim uuid>"}
-- and learn whether any other user has an active agency subscription.
--
-- Fix: the helper answers only for the caller's own id (auth.uid()). For any other id,
-- NULL, or no session it returns false (never NULL), the same answer as "no agency plan",
-- so it leaks nothing. Signature and SECURITY DEFINER are preserved. search_path is now
-- empty and every object is schema-qualified. No table or policy changes.
--
-- BEHAVIOUR CHANGE for backend callers: auth.uid() is NULL without a user JWT, so
-- service_role, cron jobs, webhooks and direct postgres connections ALWAYS get false.
-- Do NOT use has_agency_plan() from server-side/service_role code. There, read
-- public.subscriptions directly (service_role bypasses RLS). No application code calls
-- this function today (verified: no .rpc("has_agency_plan") in src).
--
-- If public.has_agency_plan(uuid) does not exist in this database, this migration changes
-- nothing and only emits a NOTICE (it must not create a function that was never there).
-- After applying, verify read-only:
--   SELECT pg_get_functiondef('public.has_agency_plan(uuid)'::regprocedure);
BEGIN;
DO $migration$
BEGIN
  IF to_regprocedure('public.has_agency_plan(uuid)') IS NOT NULL THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.has_agency_plan(_user_id uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $body$
        SELECT COALESCE(_user_id = (SELECT auth.uid()), false)
          AND EXISTS (SELECT 1 FROM public.subscriptions
            WHERE user_id=_user_id AND plan='agency' AND status IN ('active','trialing')
              AND current_period_end>pg_catalog.now())
      $body$
    $definition$;
    REVOKE EXECUTE ON FUNCTION public.has_agency_plan(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.has_agency_plan(uuid) TO authenticated, service_role;
  ELSE
    RAISE NOTICE 'public.has_agency_plan(uuid) does not exist; migration 20261117180000 skipped (nothing changed)';
  END IF;
END
$migration$;
COMMIT;
