
CREATE TABLE public.generated_outputs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('article','audit','plan','brief')),
  title TEXT,
  input JSONB,
  output_markdown TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_generated_outputs_user_created
  ON public.generated_outputs (user_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.generated_outputs TO authenticated;
GRANT ALL ON public.generated_outputs TO service_role;

ALTER TABLE public.generated_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own outputs"
  ON public.generated_outputs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own outputs"
  ON public.generated_outputs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own outputs"
  ON public.generated_outputs FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
