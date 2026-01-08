/**
 * Candidate model - data access layer.
 */

import { pool } from '../db/connection';

export interface CandidateRecord {
  candidate_id: string;
  step_id: string;
  decision: 'accepted' | 'rejected';
  score?: number;
  reason?: string;
}

export async function createCandidate(candidate: CandidateRecord): Promise<void> {
  await pool.query(
    `INSERT INTO candidates (candidate_id, step_id, decision, score, reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (candidate_id, step_id) DO UPDATE SET
       decision = EXCLUDED.decision,
       score = EXCLUDED.score,
       reason = EXCLUDED.reason`,
    [
      candidate.candidate_id,
      candidate.step_id,
      candidate.decision,
      candidate.score,
      candidate.reason,
    ]
  );
}

export async function createCandidatesBulk(candidates: CandidateRecord[]): Promise<void> {
  if (candidates.length === 0) return;

  // Use a transaction for bulk insert
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const candidate of candidates) {
      await client.query(
        `INSERT INTO candidates (candidate_id, step_id, decision, score, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (candidate_id, step_id) DO UPDATE SET
           decision = EXCLUDED.decision,
           score = EXCLUDED.score,
           reason = EXCLUDED.reason`,
        [
          candidate.candidate_id,
          candidate.step_id,
          candidate.decision,
          candidate.score,
          candidate.reason,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getCandidatesByStep(stepId: string): Promise<CandidateRecord[]> {
  const result = await pool.query(
    `SELECT candidate_id, step_id, decision, score, reason
     FROM candidates WHERE step_id = $1
     ORDER BY created_at ASC`,
    [stepId]
  );

  return result.rows.map((row) => ({
    candidate_id: row.candidate_id,
    step_id: row.step_id,
    decision: row.decision,
    score: row.score,
    reason: row.reason,
  }));
}
