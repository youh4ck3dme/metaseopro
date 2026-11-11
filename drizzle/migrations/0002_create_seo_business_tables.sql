CREATE TABLE IF NOT EXISTS public.semrush_domain_cache (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain text NOT NULL, database text NOT NULL DEFAULT 'sk', snapshot_data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
GRANT SELECT ON public.semrush_domain_cache TO authenticated;
GRANT ALL ON public.semrush_domain_cache TO service_role;
ALTER TABLE public.semrush_domain_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated cache read" ON public.semrush_domain_cache FOR SELECT TO authenticated USING (true);
CREATE UNIQUE INDEX IF NOT EXISTS idx_semrush_cache_domain_db ON public.semrush_domain_cache (lower(domain), lower(database));
CREATE INDEX IF NOT EXISTS idx_semrush_cache_expires_at ON public.semrush_domain_cache (expires_at);
CREATE TABLE IF NOT EXISTS public.subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE, stripe_customer_id text, stripe_subscription_id text, plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','agency')), status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','canceled','trialing','incomplete')), company_name text, ico text, dic text, ic_dph text, billing_address jsonb, current_period_end timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own subscription" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON public.subscriptions (stripe_customer_id);
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TABLE IF NOT EXISTS public.agency_profiles (
 user_id uuid PRIMARY KEY, agency_name text NOT NULL, logo_url text, primary_color text NOT NULL DEFAULT '#10b981', contact_email text, report_footer_text text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_profiles TO authenticated;
GRANT ALL ON public.agency_profiles TO service_role;
ALTER TABLE public.agency_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own agency profile" ON public.agency_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own agency profile" ON public.agency_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own agency profile" ON public.agency_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own agency profile" ON public.agency_profiles FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_agency_profiles_updated_at BEFORE UPDATE ON public.agency_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();