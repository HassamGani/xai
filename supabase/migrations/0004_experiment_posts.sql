-- Experiment posts and scored data for backtesting

CREATE TABLE IF NOT EXISTS public.experiment_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiment_markets(id) ON DELETE CASCADE,
  x_post_id text,
  text text,
  author_id text,
  author_username text,
  author_followers int,
  post_created_at timestamptz,
  metrics jsonb,
  scores jsonb,
  display_labels jsonb,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiment_posts_experiment_id ON public.experiment_posts(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_posts_created_at ON public.experiment_posts(experiment_id, post_created_at);

