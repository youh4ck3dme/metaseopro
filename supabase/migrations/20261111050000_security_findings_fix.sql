-- Migration: 20261111050000_security_findings_fix.sql
-- Security Hardening P0: Fix 4 audit findings (content_plan_usage abuse & semrush_domain_cache exposure)

-- 1. content_plan_usage: Zruš priamy zápis/úpravu pre authenticated používateľov
DROP POLICY IF EXISTS "Users update own usage" ON public.content_plan_usage;
DROP POLICY IF EXISTS "Users insert own usage" ON public.content_plan_usage;
REVOKE INSERT, UPDATE, DELETE ON public.content_plan_usage FROM authenticated, anon, public;

-- Ponechaj iba striktné SELECT právo na vlastný riadok (pre zobrazenie zostávajúceho času v UI)
DROP POLICY IF EXISTS "Users view own usage" ON public.content_plan_usage;
CREATE POLICY "Users view own usage" ON public.content_plan_usage
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.content_plan_usage TO authenticated;
GRANT ALL ON public.content_plan_usage TO service_role;

-- 2. semrush_domain_cache: Úplne odober prístup bežným používateľom
DROP POLICY IF EXISTS "Allow authenticated read on semrush_domain_cache" ON public.semrush_domain_cache;
DROP POLICY IF EXISTS "Authenticated cache read" ON public.semrush_domain_cache;
REVOKE ALL ON TABLE public.semrush_domain_cache FROM authenticated, anon, public;

-- Prístup má výhradne service_role
DROP POLICY IF EXISTS "Allow service role all on semrush_domain_cache" ON public.semrush_domain_cache;
DROP POLICY IF EXISTS "Allow service role write on semrush_domain_cache" ON public.semrush_domain_cache;
CREATE POLICY "Allow service role all on semrush_domain_cache"
  ON public.semrush_domain_cache
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON public.semrush_domain_cache TO service_role;
