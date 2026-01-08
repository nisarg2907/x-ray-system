/**
 * Candidate Processor - handles candidate-related jobs
 */

import { Job } from 'bullmq';
import * as candidateModel from '../../models/candidate';
import * as stepModel from '../../models/step';

export interface CreateCandidateJobData {
  candidate_id: string;
  step_id: string;
  decision: 'accepted' | 'rejected';
  score?: number;
  reason?: string;
  run_id?: string;
}

export interface CreateCandidatesBulkJobData {
  step_id: string;
  candidates: {
    candidate_id: string;
    decision: 'accepted' | 'rejected';
    score?: number;
    reason?: string;
  }[];
  run_id?: string;
}

export async function processCreateCandidate(job: Job<CreateCandidateJobData>): Promise<void> {
  const { candidate_id, step_id, decision, score, reason, run_id } = job.data;

  if (!candidate_id || !decision) {
    throw new Error('Missing required fields: candidate_id, decision');
  }

  if (!['accepted', 'rejected'].includes(decision)) {
    throw new Error('Invalid decision');
  }

  // Ensure step exists (handles race condition where candidate arrives before step creation)
  if (run_id) {
    await stepModel.ensureStepExists(step_id, run_id);
  }

  await candidateModel.createCandidate({
    candidate_id,
    step_id,
    decision,
    score,
    reason,
  });
}

export async function processCreateCandidatesBulk(job: Job<CreateCandidatesBulkJobData>): Promise<void> {
  const { step_id, candidates, run_id } = job.data;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Missing candidates array');
  }

  // Ensure step exists (handles race condition where candidates arrive before step creation)
  if (run_id) {
    await stepModel.ensureStepExists(step_id, run_id);
  }

  // Validate and prepare candidates
  const validCandidates = candidates
    .filter((c) => c.candidate_id && c.decision && ['accepted', 'rejected'].includes(c.decision))
    .map((c) => ({
      candidate_id: c.candidate_id,
      step_id,
      decision: c.decision,
      score: c.score,
      reason: c.reason,
    }));

  if (validCandidates.length > 0) {
    await candidateModel.createCandidatesBulk(validCandidates);
  }
}

