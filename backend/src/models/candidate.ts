/**
 * Candidate model - data access layer using TypeORM.
 */

import { Repository } from 'typeorm';
import { AppDataSource } from '../db/data-source';
import { Candidate } from '../entities';

export interface CandidateRecord {
  candidate_id: string;
  step_id: string;
  decision: 'accepted' | 'rejected';
  score?: number;
  reason?: string;
}

function getRepository(): Repository<Candidate> {
  return AppDataSource.getRepository(Candidate);
}

export async function createCandidate(candidate: CandidateRecord): Promise<void> {
  const repo = getRepository();
  await repo.save({
    candidate_id: candidate.candidate_id,
    step_id: candidate.step_id,
    decision: candidate.decision,
    score: candidate.score,
    reason: candidate.reason,
  });
}

export async function createCandidatesBulk(candidates: CandidateRecord[]): Promise<void> {
  if (candidates.length === 0) return;
  
  const repo = getRepository();
  await repo.save(
    candidates.map((c) => ({
      candidate_id: c.candidate_id,
      step_id: c.step_id,
      decision: c.decision,
      score: c.score,
      reason: c.reason,
    }))
  );
}

export async function getCandidatesByStep(stepId: string): Promise<CandidateRecord[]> {
  const repo = getRepository();
  const candidates = await repo.find({
    where: { step_id: stepId },
    order: { created_at: 'ASC' },
  });

  return candidates.map((c) => ({
    candidate_id: c.candidate_id,
    step_id: c.step_id,
    decision: c.decision,
    score: c.score ? parseFloat(c.score.toString()) : undefined,
    reason: c.reason,
  }));
}
