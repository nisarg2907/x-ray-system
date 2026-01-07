import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create runs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id UUID PRIMARY KEY,
        pipeline VARCHAR(255) NOT NULL,
        input JSONB,
        started_at TIMESTAMP NOT NULL,
        ended_at TIMESTAMP,
        status VARCHAR(50) NOT NULL DEFAULT 'running',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Create steps table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS steps (
        step_id UUID PRIMARY KEY,
        run_id UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('filter', 'rank', 'generate', 'select')),
        input_count INTEGER,
        output_count INTEGER,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Create step_summaries table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS step_summaries (
        step_id UUID PRIMARY KEY REFERENCES steps(step_id) ON DELETE CASCADE,
        rejected INTEGER DEFAULT 0,
        accepted INTEGER DEFAULT 0,
        rejection_breakdown JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Create candidates table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS candidates (
        candidate_id VARCHAR(255) NOT NULL,
        step_id UUID NOT NULL REFERENCES steps(step_id) ON DELETE CASCADE,
        decision VARCHAR(50) NOT NULL CHECK (decision IN ('accepted', 'rejected')),
        score NUMERIC,
        reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (candidate_id, step_id)
      )
    `);

    // Create indexes for queryability
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_runs_pipeline ON runs(pipeline)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_steps_run_id ON steps(run_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_steps_type ON steps(type)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_steps_name ON steps(name)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_candidates_step_id ON candidates(step_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_candidates_decision ON candidates(decision)
    `);

    // Index for cross-pipeline queries (e.g., filtering steps dropping >90%)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_step_summaries_rejection_rate 
      ON step_summaries((rejected::float / NULLIF(rejected + accepted, 0)))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_step_summaries_rejection_rate`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_candidates_decision`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_candidates_step_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_steps_name`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_steps_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_steps_run_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_runs_started_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_runs_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_runs_pipeline`);

    // Drop tables (order matters due to foreign keys)
    await queryRunner.query(`DROP TABLE IF EXISTS candidates`);
    await queryRunner.query(`DROP TABLE IF EXISTS step_summaries`);
    await queryRunner.query(`DROP TABLE IF EXISTS steps`);
    await queryRunner.query(`DROP TABLE IF EXISTS runs`);
  }
}

