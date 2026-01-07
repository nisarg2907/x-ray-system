/**
 * PostgreSQL schema for X-Ray system.
 * 
 * Run → Step → Candidate hierarchy.
 */

export const CREATE_SCHEMA = `
-- Runs table
CREATE TABLE IF NOT EXISTS runs (
  run_id UUID PRIMARY KEY,
  pipeline VARCHAR(255) NOT NULL,
  input JSONB,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Steps table
CREATE TABLE IF NOT EXISTS steps (
  step_id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('filter', 'rank', 'generate', 'select')),
  input_count INTEGER,
  output_count INTEGER,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Step summaries (aggregation-first)
CREATE TABLE IF NOT EXISTS step_summaries (
  step_id UUID PRIMARY KEY REFERENCES steps(step_id) ON DELETE CASCADE,
  rejected INTEGER DEFAULT 0,
  accepted INTEGER DEFAULT 0,
  rejection_breakdown JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Candidates (optional, sampled)
CREATE TABLE IF NOT EXISTS candidates (
  candidate_id VARCHAR(255) NOT NULL,
  step_id UUID NOT NULL REFERENCES steps(step_id) ON DELETE CASCADE,
  decision VARCHAR(50) NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  score NUMERIC,
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (candidate_id, step_id)
);

-- Indexes for queryability
CREATE INDEX IF NOT EXISTS idx_runs_pipeline ON runs(pipeline);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_steps_run_id ON steps(run_id);
CREATE INDEX IF NOT EXISTS idx_steps_type ON steps(type);
CREATE INDEX IF NOT EXISTS idx_steps_name ON steps(name);
CREATE INDEX IF NOT EXISTS idx_candidates_step_id ON candidates(step_id);
CREATE INDEX IF NOT EXISTS idx_candidates_decision ON candidates(decision);

-- Index for cross-pipeline queries (e.g., filtering steps dropping >90%)
CREATE INDEX IF NOT EXISTS idx_step_summaries_rejection_rate ON step_summaries((rejected::float / NULLIF(rejected + accepted, 0)));
`;

