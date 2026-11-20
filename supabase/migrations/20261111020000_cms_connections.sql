-- Migration: cms_connections
-- Purpose: 1-Click CMS connectors (WordPress REST API and custom webhooks) for publishing meta tags and blog articles.

CREATE TABLE IF NOT EXISTS public.cms_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_url TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'wordpress' CHECK (platform IN ('wordpress', 'webflow', 'custom_webhook')),
  api_endpoint TEXT NOT NULL,
  credentials_encrypted TEXT NOT NULL,
  seo_plugin TEXT NOT NULL DEFAULT 'yoast' CHECK (seo_plugin IN ('yoast', 'rank_math', 'core')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cms_connections_user_id ON public.cms_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_cms_connections_user_site ON public.cms_connections (user_id, lower(site_url));

-- Enable RLS
ALTER TABLE public.cms_connections ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view only their own CMS connections
DROP POLICY IF EXISTS "Users view own cms connections" ON public.cms_connections;
CREATE POLICY "Users view own cms connections"
  ON public.cms_connections
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow authenticated users to insert their own CMS connections
DROP POLICY IF EXISTS "Users insert own cms connections" ON public.cms_connections;
CREATE POLICY "Users insert own cms connections"
  ON public.cms_connections
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to update their own CMS connections
DROP POLICY IF EXISTS "Users update own cms connections" ON public.cms_connections;
CREATE POLICY "Users update own cms connections"
  ON public.cms_connections
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to delete their own CMS connections
DROP POLICY IF EXISTS "Users delete own cms connections" ON public.cms_connections;
CREATE POLICY "Users delete own cms connections"
  ON public.cms_connections
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Allow service role full management
DROP POLICY IF EXISTS "Service role manages cms connections" ON public.cms_connections;
CREATE POLICY "Service role manages cms connections"
  ON public.cms_connections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Shared updated_at trigger (if update_updated_at_column exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS update_cms_connections_updated_at ON public.cms_connections;
    CREATE TRIGGER update_cms_connections_updated_at
      BEFORE UPDATE ON public.cms_connections
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cms_connections TO authenticated;
GRANT ALL ON public.cms_connections TO service_role;
