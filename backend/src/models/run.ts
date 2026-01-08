/**
 * Run model - data access layer.
 */

import { pool } from '../db/connection';

export interface RunRecord {
  run_id: string;
  pipeline: string;
  input: any;
  started_at: string;
  ended_at?: string;
  status: 'running' | 'success' | 'error';
}

export async function createRun(run: RunRecord): Promise<void> {
  await pool.query(
    `INSERT INTO runs (run_id, pipeline, input, started_at, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (run_id) DO UPDATE SET
       ended_at = EXCLUDED.ended_at,
       status = EXCLUDED.status`,
    [run.run_id, run.pipeline, JSON.stringify(run.input), run.started_at, run.status]
  );
}

/**
 * Ensure run exists. Creates a placeholder run if it doesn't exist.
 * Used to handle race conditions where step arrives before run creation.
 */
export async function ensureRunExists(runId: string, pipeline?: string): Promise<void> {
  try {
    const existing = await getRun(runId);
    if (existing) return;

    // Create a placeholder run - the actual run creation might be in flight
    await pool.query(
      `INSERT INTO runs (run_id, pipeline, input, started_at, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (run_id) DO NOTHING`,
      [
        runId,
        pipeline || 'unknown',
        JSON.stringify({ auto_created: true }),
        new Date().toISOString(),
        'running',
      ]
    );
  } catch (error: any) {
    // Log but don't throw - the actual run creation will handle it
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.warn(`Warning: Could not ensure run exists: ${errorMessage}`);
  }
}

export async function updateRun(runId: string, updates: { ended_at?: string; status?: string }): Promise<void> {
  const updatesList: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (updates.ended_at) {
    updatesList.push(`ended_at = $${paramCount++}`);
    values.push(updates.ended_at);
  }
  if (updates.status) {
    updatesList.push(`status = $${paramCount++}`);
    values.push(updates.status);
  }

  if (updatesList.length === 0) return;

  values.push(runId);
  await pool.query(
    `UPDATE runs SET ${updatesList.join(', ')} WHERE run_id = $${paramCount}`,
    values
  );
}

export async function getRun(runId: string): Promise<RunRecord | null> {
  const result = await pool.query(
    `SELECT run_id, pipeline, input, started_at, ended_at, status
     FROM runs WHERE run_id = $1`,
    [runId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    run_id: row.run_id,
    pipeline: row.pipeline,
    input: row.input,
    started_at: row.started_at,
    ended_at: row.ended_at,
    status: row.status,
  };
}

export async function listRuns(filters?: { pipeline?: string; status?: string; limit?: number }): Promise<RunRecord[]> {
  let query = `SELECT run_id, pipeline, input, started_at, ended_at, status FROM runs WHERE 1=1`;
  const values: any[] = [];
  let paramCount = 1;

  if (filters?.pipeline) {
    query += ` AND pipeline = $${paramCount++}`;
    values.push(filters.pipeline);
  }

  if (filters?.status) {
    query += ` AND status = $${paramCount++}`;
    values.push(filters.status);
  }

  query += ` ORDER BY started_at DESC`;

  if (filters?.limit) {
    query += ` LIMIT $${paramCount++}`;
    values.push(filters.limit);
  }

  const result = await pool.query(query, values);
  return result.rows.map((row) => ({
    run_id: row.run_id,
    pipeline: row.pipeline,
    input: row.input,
    started_at: row.started_at,
    ended_at: row.ended_at,
    status: row.status,
  }));
}
