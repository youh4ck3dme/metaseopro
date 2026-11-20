-- ==============================================================================
-- SEO4WEB — Security Hardening Migration
-- Addresses Lovable & Supabase Security Findings:
-- 1. Access control & authorization (Strict RLS on all user data)
-- 2. Exposed personal & sensitive data (Revoke anon/public access)
-- 3. Unsafe input & injection (Cascade deletes, verified user_id constraints)
-- 4. Unauthenticated & abusable endpoints
-- ==============================================================================

BEGIN;

-- 1. Ensure seo_snapshots table exists with strict constraints
CREATE TABLE IF NOT EXISTS public.seo_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'decay',
  metrics_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_snapshots_user_site ON public.seo_snapshots (user_id, lower(site_url));
CREATE INDEX IF NOT EXISTS idx_seo_snapshots_created_at ON public.seo_snapshots (created_at DESC);

-- 2. Ensure seo_experiments table exists with strict constraints
CREATE TABLE IF NOT EXISTS public.seo_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  page_url TEXT NOT NULL,
  baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_queries TEXT[] NOT NULL DEFAULT '{}',
  changes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'approved',
  implemented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_experiments_user_site ON public.seo_experiments (user_id, lower(site_url));

-- 3. REVOKE ALL privileges from public and anon roles on all sensitive tables
REVOKE ALL ON TABLE public.profiles FROM anon, public;
REVOKE ALL ON TABLE public.subscriptions FROM anon, public;
REVOKE ALL ON TABLE public.agency_profiles FROM anon, public;
REVOKE ALL ON TABLE public.cms_connections FROM anon, public;
REVOKE ALL ON TABLE public.content_plan_usage FROM anon, public;
REVOKE ALL ON TABLE public.generated_outputs FROM anon, public;
REVOKE ALL ON TABLE public.seo_experiments FROM anon, public;
REVOKE ALL ON TABLE public.seo_snapshots FROM anon, public;
REVOKE ALL ON TABLE public.semrush_domain_cache FROM anon, public;

-- 4. ENABLE & FORCE Row Level Security on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.agency_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.cms_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_connections FORCE ROW LEVEL SECURITY;

ALTER TABLE public.content_plan_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_plan_usage FORCE ROW LEVEL SECURITY;

ALTER TABLE public.generated_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_outputs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.seo_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_experiments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.seo_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_snapshots FORCE ROW LEVEL SECURITY;

ALTER TABLE public.semrush_domain_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semrush_domain_cache FORCE ROW LEVEL SECURITY;

-- 5. Harden RLS policies on profiles (Stop ID tampering and leakage)
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 6. Harden RLS on seo_snapshots
DROP POLICY IF EXISTS "Users view own seo snapshots" ON public.seo_snapshots;
CREATE POLICY "Users view own seo snapshots" ON public.seo_snapshots
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own seo snapshots" ON public.seo_snapshots;
CREATE POLICY "Users insert own seo snapshots" ON public.seo_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own seo snapshots" ON public.seo_snapshots;
CREATE POLICY "Users update own seo snapshots" ON public.seo_snapshots
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own seo snapshots" ON public.seo_snapshots;
CREATE POLICY "Users delete own seo snapshots" ON public.seo_snapshots
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 7. Harden RLS on seo_experiments
DROP POLICY IF EXISTS "Users view own seo experiments" ON public.seo_experiments;
CREATE POLICY "Users view own seo experiments" ON public.seo_experiments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own seo experiments" ON public.seo_experiments;
CREATE POLICY "Users insert own seo experiments" ON public.seo_experiments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own seo experiments" ON public.seo_experiments;
CREATE POLICY "Users update own seo experiments" ON public.seo_experiments
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own seo experiments" ON public.seo_experiments;
CREATE POLICY "Users delete own seo experiments" ON public.seo_experiments
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 8. Explicit Permissions for Authenticated and Service Role
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_experiments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_outputs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.content_plan_usage TO authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT ON public.semrush_domain_cache TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

COMMIT;
