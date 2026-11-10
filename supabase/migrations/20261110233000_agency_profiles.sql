-- Migration: agency_profiles
-- Purpose: Whitelabel agency branding profiles for executive client PDF reports.

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

-- Enable RLS
ALTER TABLE public.agency_profiles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view only their own agency profile
CREATE POLICY "Users view own agency profile"
  ON public.agency_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow authenticated users to insert their own agency profile
CREATE POLICY "Users insert own agency profile"
  ON public.agency_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to update their own agency profile
CREATE POLICY "Users update own agency profile"
  ON public.agency_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to delete their own agency profile
CREATE POLICY "Users delete own agency profile"
  ON public.agency_profiles
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow service role full management of agency profiles
CREATE POLICY "Service role manages agency profiles"
  ON public.agency_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Shared updated_at trigger
CREATE TRIGGER update_agency_profiles_updated_at
  BEFORE UPDATE ON public.agency_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_profiles TO authenticated;
GRANT ALL ON public.agency_profiles TO service_role;
