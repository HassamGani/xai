-- Experiments: backtesting resolved markets with archival data or simulated timelines

CREATE TABLE IF NOT EXISTS public.experiment_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  normalized_question text,
  outcomes jsonb NOT NULL DEFAULT '[]',
  resolution_outcome text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.experiment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiment_markets(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  notes text,
  post_count integer DEFAULT 0,
  error text
);

CREATE TABLE IF NOT EXISTS public.experiment_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiment_markets(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL,
  probabilities jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_experiment_runs_experiment_id ON experiment_runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_snapshots_experiment_id ON experiment_snapshots(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_snapshots_ts ON experiment_snapshots(experiment_id, timestamp);

