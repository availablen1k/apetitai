-- Python jobs against the nature model (rebuild, saved query runs, nutrient experiments).
-- Run one at a time; request_id makes a repeated submit return the original job.
CREATE TABLE nature_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('rebuild','save_query','nutrient_inputs','nutrient_losses')),
  params_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','interrupted')),
  phase TEXT,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  exit_code INTEGER,
  result_json TEXT,
  stdout_tail TEXT,
  stderr_tail TEXT,
  error TEXT
);
CREATE INDEX idx_nature_jobs_status ON nature_jobs(status, created_at);
