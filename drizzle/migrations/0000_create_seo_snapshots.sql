CREATE TABLE public.seo_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  site_url text NOT NULL,
  type text NOT NULL CHECK (type IN ('decay','audit','gsc_overview')),
  metrics_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.seo_snapshots TO authenticated;
GRANT ALL ON public.seo_snapshots TO service_role;
ALTER TABLE public.seo_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own snapshots" ON public.seo_snapshots FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own snapshots" ON public.seo_snapshots FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own snapshots" ON public.seo_snapshots FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX seo_snapshots_user_site_idx ON public.seo_snapshots (user_id, site_url, type, created_at DESC);