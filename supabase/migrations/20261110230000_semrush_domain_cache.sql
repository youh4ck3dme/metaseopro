-- Migration: semrush_domain_cache
-- Purpose: Cache Semrush domain snapshots to prevent API rate limits (429/ERROR 134) and reduce operational costs.

CREATE TABLE IF NOT EXISTS public.semrush_domain_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL,
  database TEXT NOT NULL DEFAULT 'sk',
  snapshot_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

-- Unique index for upserts on (domain, database)
CREATE UNIQUE INDEX IF NOT EXISTS idx_semrush_cache_domain_db
  ON public.semrush_domain_cache (lower(domain), lower(database));

-- Index for TTL queries & expiration pruning
CREATE INDEX IF NOT EXISTS idx_semrush_cache_expires_at
  ON public.semrush_domain_cache (expires_at);

-- Enable Row Level Security (RLS)
ALTER TABLE public.semrush_domain_cache ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read cached domain snapshots
DROP POLICY IF EXISTS "Allow authenticated read on semrush_domain_cache" ON public.semrush_domain_cache;
CREATE POLICY "Allow authenticated read on semrush_domain_cache"
  ON public.semrush_domain_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role full access (writes and updates)
DROP POLICY IF EXISTS "Allow service role write on semrush_domain_cache" ON public.semrush_domain_cache;
CREATE POLICY "Allow service role write on semrush_domain_cache"
  ON public.semrush_domain_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Grants
GRANT SELECT ON public.semrush_domain_cache TO authenticated;
GRANT ALL ON public.semrush_domain_cache TO service_role;
