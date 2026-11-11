-- ==============================================================================
-- SEO4WEB — Consolidated Migration for Missing Tables
-- Tables: public.semrush_domain_cache, public.subscriptions, public.agency_profiles
-- Safe for execution via Lovable Cloud Build Mode or Supabase SQL Editor
-- ==============================================================================

BEGIN;

-- 1. Table: semrush_domain_cache
CREATE TABLE IF NOT EXISTS public.semrush_domain_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL,
  database TEXT NOT NULL DEFAULT 'sk',
  snapshot_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_semrush_cache_domain_db
  ON public.semrush_domain_cache (lower(domain), lower(database));

CREATE INDEX IF NOT EXISTS idx_semrush_cache_expires_at
  ON public.semrush_domain_cache (expires_at);

ALTER TABLE public.semrush_domain_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on semrush_domain_cache" ON public.semrush_domain_cache;
CREATE POLICY "Allow authenticated read on semrush_domain_cache"
  ON public.semrush_domain_cache
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow service role write on semrush_domain_cache" ON public.semrush_domain_cache;
CREATE POLICY "Allow service role write on semrush_domain_cache"
  ON public.semrush_domain_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.semrush_domain_cache TO authenticated;
GRANT ALL ON public.semrush_domain_cache TO service_role;


-- 2. Table: subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'agency')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'incomplete')),
  company_name TEXT,
  ico TEXT,
  dic TEXT,
  ic_dph TEXT,
  billing_address JSONB,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON public.subscriptions (stripe_customer_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own subscription" ON public.subscriptions;
CREATE POLICY "Users view own subscription"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages subscriptions" ON public.subscriptions;
CREATE POLICY "Service role manages subscriptions"
  ON public.subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;


-- 3. Table: agency_profiles
CREATE TABLE IF NOT EXISTS public.agency_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#10b981',
  contact_email TEXT,
  report_footer_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agency_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own agency profile" ON public.agency_profiles;
CREATE POLICY "Users view own agency profile"
  ON public.agency_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own agency profile" ON public.agency_profiles;
CREATE POLICY "Users insert own agency profile"
  ON public.agency_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own agency profile" ON public.agency_profiles;
CREATE POLICY "Users update own agency profile"
  ON public.agency_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own agency profile" ON public.agency_profiles;
CREATE POLICY "Users delete own agency profile"
  ON public.agency_profiles
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages agency profiles" ON public.agency_profiles;
CREATE POLICY "Service role manages agency profiles"
  ON public.agency_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_agency_profiles_updated_at ON public.agency_profiles;
CREATE TRIGGER update_agency_profiles_updated_at
  BEFORE UPDATE ON public.agency_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_profiles TO authenticated;
GRANT ALL ON public.agency_profiles TO service_role;

COMMIT;
