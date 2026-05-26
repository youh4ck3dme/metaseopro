CREATE POLICY "Users insert own usage"
  ON public.content_plan_usage
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own usage"
  ON public.content_plan_usage
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);