REVOKE INSERT, UPDATE, DELETE ON public.content_plan_usage FROM authenticated, anon;
DROP POLICY IF EXISTS "Users update own usage" ON public.content_plan_usage;
DROP POLICY IF EXISTS "Users insert own usage" ON public.content_plan_usage;

CREATE OR REPLACE FUNCTION public.has_agency_plan(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id AND plan = 'agency' AND status IN ('active','trialing')
      AND (current_period_end IS NULL OR current_period_end > now()))
$$;
REVOKE EXECUTE ON FUNCTION public.has_agency_plan(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_agency_plan(uuid) TO authenticated;

DROP POLICY IF EXISTS "Users insert own agency profile" ON public.agency_profiles;
DROP POLICY IF EXISTS "Users update own agency profile" ON public.agency_profiles;
CREATE POLICY "Users insert own agency profile" ON public.agency_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.has_agency_plan(auth.uid()));
CREATE POLICY "Users update own agency profile" ON public.agency_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.has_agency_plan(auth.uid()))
  WITH CHECK (auth.uid() = user_id AND public.has_agency_plan(auth.uid()));