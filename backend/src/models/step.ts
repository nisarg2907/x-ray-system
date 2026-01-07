/**
 * Step model - data access layer using TypeORM.
 */

import { Repository } from 'typeorm';
import { AppDataSource } from '../db/data-source';
import { Step, StepType, StepSummary } from '../entities';

export type { StepType } from '../entities';

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

function getStepRepository(): Repository<Step> {
  return AppDataSource.getRepository(Step);
}

function getStepSummaryRepository(): Repository<StepSummary> {
  return AppDataSource.getRepository(StepSummary);
}

export async function createStep(step: StepRecord): Promise<void> {
  const repo = getStepRepository();
  await repo.save({
    step_id: step.step_id,
    run_id: step.run_id,
    name: step.name,
    type: step.type,
    input_count: step.input_count,
    output_count: step.output_count,
    metadata: step.metadata,
  });
}

/**
 * Ensure step exists. Creates a placeholder step if it doesn't exist.
 * Used to handle race conditions where summary/candidate arrives before step creation.
 */
export async function ensureStepExists(stepId: string, runId: string): Promise<void> {
  try {
    const existing = await getStep(stepId);
    if (existing) return;

    const repo = getStepRepository();
    await repo.save({
      step_id: stepId,
      run_id: runId,
      name: 'auto-created',
      type: 'generate',
      metadata: { auto_created: true },
    });
  } catch (error: any) {
    // If run doesn't exist or other error, log but don't throw
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
  const summaryRepo = getStepSummaryRepository();
  
  // Upsert step summary
  await summaryRepo.save({
    step_id: stepId,
    rejected: summary.rejected,
    accepted: summary.accepted,
    rejection_breakdown: summary.rejection_breakdown,
  });

  // Update step's input_count and output_count if provided
  if (inputCount !== undefined || outputCount !== undefined) {
    const stepRepo = getStepRepository();
    const updateData: Partial<Step> = {};
    if (inputCount !== undefined) {
      updateData.input_count = inputCount;
    }
    if (outputCount !== undefined) {
      updateData.output_count = outputCount;
    }
    await stepRepo.update({ step_id: stepId }, updateData);
  }
}

export async function getStep(stepId: string): Promise<StepRecord | null> {
  const repo = getStepRepository();
  const step = await repo.findOne({ where: { step_id: stepId } });

  if (!step) return null;

  return {
    step_id: step.step_id,
    run_id: step.run_id,
    name: step.name,
    type: step.type,
    input_count: step.input_count,
    output_count: step.output_count,
    metadata: step.metadata,
  };
}

export async function listSteps(filters?: { run_id?: string; type?: StepType; name?: string }): Promise<StepRecord[]> {
  const repo = getStepRepository();
  const queryBuilder = repo.createQueryBuilder('step');

  if (filters?.run_id) {
    queryBuilder.andWhere('step.run_id = :run_id', { run_id: filters.run_id });
  }

  if (filters?.type) {
    queryBuilder.andWhere('step.type = :type', { type: filters.type });
  }

  if (filters?.name) {
    queryBuilder.andWhere('step.name = :name', { name: filters.name });
  }

  queryBuilder.orderBy('step.created_at', 'ASC');

  const steps = await queryBuilder.getMany();

  return steps.map((step) => ({
    step_id: step.step_id,
    run_id: step.run_id,
    name: step.name,
    type: step.type,
    input_count: step.input_count,
    output_count: step.output_count,
    metadata: step.metadata,
  }));
}

/**
 * Query for filtering steps that dropped more than X% of candidates.
 * This is a cross-pipeline query example.
 */
export async function getStepSummary(stepId: string): Promise<StepSummaryRecord | null> {
  const repo = getStepSummaryRepository();
  const summary = await repo.findOne({ where: { step_id: stepId } });

  if (!summary) return null;

  return {
    step_id: summary.step_id,
    rejected: summary.rejected,
    accepted: summary.accepted,
    rejection_breakdown: summary.rejection_breakdown || {},
  };
}

export async function findFilteringStepsWithHighRejectionRate(threshold: number = 0.9): Promise<any[]> {
  const stepRepo = getStepRepository();
  const summaryRepo = getStepSummaryRepository();

  const results = await stepRepo
    .createQueryBuilder('step')
    .innerJoin('step_summaries', 'summary', 'summary.step_id = step.step_id')
    .where('step.type = :type', { type: 'filter' })
    .andWhere(
      '(summary.rejected::float / NULLIF(summary.rejected + summary.accepted, 0)) > :threshold',
      { threshold }
    )
    .select([
      'step.step_id',
      'step.run_id',
      'step.name',
      'step.type',
      'step.metadata',
      'summary.rejected',
      'summary.accepted',
      '(summary.rejected::float / NULLIF(summary.rejected + summary.accepted, 0)) as rejection_rate',
    ])
    .orderBy('rejection_rate', 'DESC')
    .getRawMany();

  return results.map((row) => ({
    step_id: row.step_step_id,
    run_id: row.step_run_id,
    name: row.step_name,
    type: row.step_type,
    metadata: row.step_metadata,
    rejected: row.summary_rejected,
    accepted: row.summary_accepted,
    rejection_rate: parseFloat(row.rejection_rate),
  }));
}
