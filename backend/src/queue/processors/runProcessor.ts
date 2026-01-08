/**
 * Run Processor - handles run-related jobs
 */

import { Job } from 'bullmq';
import * as runModel from '../../models/run';

export interface CreateRunJobData {
  run_id: string;
  pipeline: string;
  input: any;
  started_at: string;
  status?: 'running' | 'success' | 'error';
}

export interface UpdateRunJobData {
  run_id: string;
  ended_at?: string;
  status?: 'running' | 'success' | 'error';
}

export async function processCreateRun(job: Job<CreateRunJobData>): Promise<void> {
  const { run_id, pipeline, input, started_at, status } = job.data;

  if (!run_id || !pipeline || !started_at) {
    throw new Error('Missing required fields: run_id, pipeline, started_at');
  }

  await runModel.createRun({
    run_id,
    pipeline,
    input,
    started_at,
    status: status || 'running',
  });
}

export async function processUpdateRun(job: Job<UpdateRunJobData>): Promise<void> {
  const { run_id, ended_at, status } = job.data;

  if (!run_id) {
    throw new Error('Missing required field: run_id');
  }

  await runModel.updateRun(run_id, { ended_at, status });
}

