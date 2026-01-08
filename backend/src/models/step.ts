/**
 * Step model - data access layer.
 */

import { pool } from '../db/connection';

export type StepType = 'filter' | 'rank' | 'generate' | 'select';

export interface StepRecord {
  step_id: string;
  run_id: string;
  name: string;
  type: StepType;
  input_count?: number;
  output_count?: number;
  metadata: any;
}

export interface StepSummaryRecord {
  step_id: string;
  rejected: number;
  accepted: number;
  rejection_breakdown: Record<string, number>;
}

export async function createStep(step: StepRecord): Promise<void> {
  await pool.query(
    `INSERT INTO steps (step_id, run_id, name, type, input_count, output_count, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (step_id) DO UPDATE SET
       run_id = EXCLUDED.run_id,
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       input_count = COALESCE(EXCLUDED.input_count, steps.input_count),
       output_count = COALESCE(EXCLUDED.output_count, steps.output_count),
       metadata = EXCLUDED.metadata`,
    [
      step.step_id,
      step.run_id,
      step.name,
      step.type,
      step.input_count,
      step.output_count,
      JSON.stringify(step.metadata),
    ]
  );
}

/**
 * Ensure step exists. Creates a placeholder step if it doesn't exist.
 * Used to handle race conditions where summary/candidate arrives before step creation.
 */
export async function ensureStepExists(stepId: string, runId: string): Promise<void> {
  try {
    const existing = await getStep(stepId);
    if (existing) return;

    // Create a placeholder step - the actual step creation might be in flight
    // We'll use minimal info and let the real step creation update it
    // If run doesn't exist, this will fail silently (run should exist by this point)
    await pool.query(
      `INSERT INTO steps (step_id, run_id, name, type, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (step_id) DO NOTHING`,
      [
        stepId,
        runId,
        'auto-created', // Placeholder name
        'generate', // Default type (least restrictive)
        JSON.stringify({ auto_created: true }),
      ]
    );
  } catch (error: any) {
    // If run doesn't exist or other error, log but don't throw
    // The actual step creation will handle it
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    if (!errorMessage.includes('foreign key constraint') && !errorMessage.includes('23503')) {
      console.warn(`Warning: Could not ensure step exists: ${errorMessage}`);
    }
  }
}

export async function updateStepSummary(
  stepId: string,
  summary: StepSummaryRecord,
  inputCount?: number,
  outputCount?: number
): Promise<void> {
  // Update step_summaries table
  await pool.query(
    `INSERT INTO step_summaries (step_id, rejected, accepted, rejection_breakdown, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (step_id) DO UPDATE SET
       rejected = EXCLUDED.rejected,
       accepted = EXCLUDED.accepted,
       rejection_breakdown = EXCLUDED.rejection_breakdown,
       updated_at = NOW()`,
    [
      stepId,
      summary.rejected,
      summary.accepted,
      JSON.stringify(summary.rejection_breakdown),
    ]
  );

  // Also update input_count and output_count in steps table if provided
  if (inputCount !== undefined || outputCount !== undefined) {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (inputCount !== undefined) {
      updates.push(`input_count = $${paramCount++}`);
      values.push(inputCount);
    }
    if (outputCount !== undefined) {
      updates.push(`output_count = $${paramCount++}`);
      values.push(outputCount);
    }

    values.push(stepId);
    await pool.query(
      `UPDATE steps SET ${updates.join(', ')} WHERE step_id = $${paramCount}`,
      values
    );
  }
}

export async function getStep(stepId: string): Promise<StepRecord | null> {
  const result = await pool.query(
    `SELECT step_id, run_id, name, type, input_count, output_count, metadata
     FROM steps WHERE step_id = $1`,
    [stepId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    step_id: row.step_id,
    run_id: row.run_id,
    name: row.name,
    type: row.type,
    input_count: row.input_count,
    output_count: row.output_count,
    metadata: row.metadata,
  };
}

export async function listSteps(filters?: { run_id?: string; type?: StepType; name?: string }): Promise<StepRecord[]> {
  let query = `SELECT step_id, run_id, name, type, input_count, output_count, metadata FROM steps WHERE 1=1`;
  const values: any[] = [];
  let paramCount = 1;

  if (filters?.run_id) {
    query += ` AND run_id = $${paramCount++}`;
    values.push(filters.run_id);
  }

  if (filters?.type) {
    query += ` AND type = $${paramCount++}`;
    values.push(filters.type);
  }

  if (filters?.name) {
    query += ` AND name = $${paramCount++}`;
    values.push(filters.name);
  }

  query += ` ORDER BY created_at ASC`;

  const result = await pool.query(query, values);
  return result.rows.map((row) => ({
    step_id: row.step_id,
    run_id: row.run_id,
    name: row.name,
    type: row.type,
    input_count: row.input_count,
    output_count: row.output_count,
    metadata: row.metadata,
  }));
}

/**
 * Query for filtering steps that dropped more than X% of candidates.
 * This is a cross-pipeline query example.
 */
export async function getStepSummary(stepId: string): Promise<StepSummaryRecord | null> {
  const result = await pool.query(
    `SELECT step_id, rejected, accepted, rejection_breakdown
     FROM step_summaries WHERE step_id = $1`,
    [stepId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    step_id: row.step_id,
    rejected: row.rejected,
    accepted: row.accepted,
    rejection_breakdown: row.rejection_breakdown || {},
  };
}

export async function findFilteringStepsWithHighRejectionRate(threshold: number = 0.9): Promise<any[]> {
  const result = await pool.query(
    `SELECT 
       s.step_id,
       s.run_id,
       s.name,
       s.type,
       s.metadata,
       ss.rejected,
       ss.accepted,
       (ss.rejected::float / NULLIF(ss.rejected + ss.accepted, 0)) as rejection_rate
     FROM steps s
     JOIN step_summaries ss ON s.step_id = ss.step_id
     WHERE s.type = 'filter'
       AND (ss.rejected::float / NULLIF(ss.rejected + ss.accepted, 0)) > $1
     ORDER BY rejection_rate DESC`,
    [threshold]
  );

  return result.rows;
}
