/**
 * Step represents a single decision point in a pipeline.
 */

import { XRayClient } from './client';

export type StepType = 'filter' | 'rank' | 'generate' | 'select';

export interface StepMetadata {
  [key: string]: any;
}

export interface StepSummary {
  inputCount: number;
  outputCount: number;
  rejectionBreakdown?: Record<string, number>;
}

export interface CandidateRecord {
  candidateId: string;
  decision: 'accepted' | 'rejected';
  score?: number;
  reason?: string;
}

export class Step {
  private stepId: string;
  private runId: string;
  private name: string;
  private type: StepType;
  private metadata: StepMetadata;
  private client: XRayClient;
  private pipeline?: string;
  private ended: boolean = false;

  constructor(
    stepId: string,
    runId: string,
    name: string,
    type: StepType,
    metadata: StepMetadata,
    client: XRayClient,
    pipeline?: string
  ) {
    this.stepId = stepId;
    this.runId = runId;
    this.name = name;
    this.type = type;
    this.metadata = metadata;
    this.client = client;
    this.pipeline = pipeline;

    // Fire-and-forget: create step
    this.client.post('/steps', {
      step_id: this.stepId,
      run_id: this.runId,
      name: this.name,
      type: this.type,
      metadata: this.metadata,
      pipeline: this.pipeline, // Include pipeline for placeholder run creation
    });
  }

  /**
   * Record summary statistics for this step.
   * This is the minimal required instrumentation.
   */
  recordSummary(summary: StepSummary): void {
    if (this.ended) return;

    this.client.post(`/steps/${this.stepId}/summary`, {
      step_id: this.stepId,
      run_id: this.runId,
      input_count: summary.inputCount,
      output_count: summary.outputCount,
      rejection_breakdown: summary.rejectionBreakdown || {},
    });
  }

  /**
   * Record a candidate (optional, expensive).
   * Use sparingly - for sampling or debugging specific runs.
   */
  recordCandidate(candidateId: string, record: Omit<CandidateRecord, 'candidateId'>): void {
    if (this.ended) return;

    this.client.post(`/steps/${this.stepId}/candidates`, {
      candidate_id: candidateId,
      step_id: this.stepId,
      run_id: this.runId,
      decision: record.decision,
      score: record.score,
      reason: record.reason,
    });
  }

  /**
   * Record multiple candidates in a single API call.
   * This reduces HTTP overhead for large candidate sets.
   */
  recordCandidates(candidates: Array<Omit<CandidateRecord, 'candidateId'> & { candidateId: string }>): void {
    if (this.ended || candidates.length === 0) return;

    this.client.post(`/steps/${this.stepId}/candidates/bulk`, {
      step_id: this.stepId,
      run_id: this.runId,
      candidates: candidates.map((c) => ({
        candidate_id: c.candidateId,
        decision: c.decision,
        score: c.score,
        reason: c.reason,
      })),
    });
  }

  /**
   * Helper: record top-N candidates by score.
   * Expects pre-scored candidates.
   */
  recordTopCandidates(
    candidates: Array<{ id: string; score: number; reason?: string; decision?: 'accepted' | 'rejected' }>,
    n: number,
    defaultDecision: 'accepted' | 'rejected' = 'accepted'
  ): void {
    if (this.ended || candidates.length === 0 || n <= 0) return;

    const top = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map((c) => ({
        candidateId: c.id,
        decision: c.decision || defaultDecision,
        score: c.score,
        reason: c.reason,
      }));

    this.recordCandidates(top);
  }

  /**
   * Helper: record bottom-N candidates by score.
   * Expects pre-scored candidates.
   */
  recordBottomCandidates(
    candidates: Array<{ id: string; score: number; reason?: string; decision?: 'accepted' | 'rejected' }>,
    n: number,
    defaultDecision: 'accepted' | 'rejected' = 'rejected'
  ): void {
    if (this.ended || candidates.length === 0 || n <= 0) return;

    const bottom = [...candidates]
      .sort((a, b) => a.score - b.score)
      .slice(0, n)
      .map((c) => ({
        candidateId: c.id,
        decision: c.decision || defaultDecision,
        score: c.score,
        reason: c.reason,
      }));

    this.recordCandidates(bottom);
  }

  /**
   * Helper: record a random sample of candidates.
   */
  recordRandomSample(
    candidates: Array<{ id: string; score?: number; reason?: string; decision?: 'accepted' | 'rejected' }>,
    n: number,
    defaultDecision: 'accepted' | 'rejected' = 'accepted'
  ): void {
    if (this.ended || candidates.length === 0 || n <= 0) return;

    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const sample = shuffled.slice(0, n).map((c) => ({
      candidateId: c.id,
      decision: c.decision || defaultDecision,
      score: c.score,
      reason: c.reason,
    }));

    this.recordCandidates(sample);
  }

  /**
   * Mark step as ended.
   */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    // No explicit API call needed - step is implicitly ended when next step starts or run ends
  }

  getStepId(): string {
    return this.stepId;
  }
}

