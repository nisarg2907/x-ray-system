/**
 * Step Processor - handles step-related jobs
 */

import { Job } from 'bullmq';
import * as stepModel from '../../models/step';
import * as runModel from '../../models/run';

export interface CreateStepJobData {
  step_id: string;
  run_id: string;
  name: string;
  type: 'filter' | 'rank' | 'generate' | 'select';
  metadata?: any;
  pipeline?: string;
}

export interface UpdateStepSummaryJobData {
  step_id: string;
  input_count?: number;
  output_count?: number;
  rejection_breakdown?: Record<string, number>;
  run_id?: string;
}

export async function processCreateStep(job: Job<CreateStepJobData>): Promise<void> {
  const { step_id, run_id, name, type, metadata, pipeline } = job.data;

  if (!step_id || !run_id || !name || !type) {
    throw new Error('Missing required fields: step_id, run_id, name, type');
  }

  if (!['filter', 'rank', 'generate', 'select'].includes(type)) {
    throw new Error('Invalid step type');
  }

  // Ensure run exists (handles race condition where step arrives before run creation)
  await runModel.ensureRunExists(run_id, pipeline);

  await stepModel.createStep({
    step_id,
    run_id,
    name,
    type,
    metadata: metadata || {},
  });
}

export async function processUpdateStepSummary(job: Job<UpdateStepSummaryJobData>): Promise<void> {
  const { step_id, input_count, output_count, rejection_breakdown, run_id } = job.data;

  if (!step_id) {
    throw new Error('Missing required field: step_id');
  }

  // Ensure step exists (handles race condition where summary arrives before step creation)
  if (run_id) {
    await stepModel.ensureStepExists(step_id, run_id);
  }

  // Calculate rejected and accepted.
  // Prefer explicit rejection_breakdown if provided; fall back to counts.
  const accepted = output_count || 0;
  let rejected = 0;
  if (rejection_breakdown && typeof rejection_breakdown === 'object') {
    rejected = Object.values(rejection_breakdown).reduce(
      (sum: number, value: any) => sum + (typeof value === 'number' ? value : 0),
      0
    );
  } else {
    rejected = (input_count || 0) - accepted;
  }

  await stepModel.updateStepSummary(
    step_id,
    {
      step_id,
      rejected,
      accepted,
      rejection_breakdown: rejection_breakdown || {},
    },
    input_count,
    output_count
  );
}

