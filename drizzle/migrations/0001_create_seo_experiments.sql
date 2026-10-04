CREATE TABLE public.seo_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_url text NOT NULL CHECK (char_length(site_url) <= 2048),
  page_url text NOT NULL CHECK (char_length(page_url) <= 2048),
  implemented_at date NOT NULL DEFAULT current_date,
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_queries text[] NOT NULL DEFAULT '{}',
  changes text NOT NULL DEFAULT '' CHECK (char_length(changes) <= 5000),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('generated','review','approved','wp_draft','published')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_experiments TO authenticated;
GRANT ALL ON public.seo_experiments TO service_role;
ALTER TABLE public.seo_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own experiments select" ON public.seo_experiments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own experiments insert" ON public.seo_experiments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own experiments update" ON public.seo_experiments FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own experiments delete" ON public.seo_experiments FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX seo_experiments_user_idx ON public.seo_experiments (user_id, site_url, created_at DESC);