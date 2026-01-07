/**
 * Run model - data access layer using TypeORM.
 */

import { Repository } from 'typeorm';
import { AppDataSource } from '../db/data-source';
import { Run, RunStatus } from '../entities';

export interface RunRecord {
  run_id: string;
  pipeline: string;
  input: any;
  started_at: string;
  ended_at?: string;
  status: RunStatus;
}

function getRepository(): Repository<Run> {
  return AppDataSource.getRepository(Run);
}

export async function createRun(run: RunRecord): Promise<void> {
  const repo = getRepository();
  await repo.save({
    run_id: run.run_id,
    pipeline: run.pipeline,
    input: run.input,
    started_at: new Date(run.started_at),
    ended_at: run.ended_at ? new Date(run.ended_at) : undefined,
    status: run.status,
  });
}

/**
 * Ensure run exists. Creates a placeholder run if it doesn't exist.
 * Used to handle race conditions where step arrives before run creation.
 */
export async function ensureRunExists(runId: string, pipeline?: string): Promise<void> {
  try {
    const existing = await getRun(runId);
    if (existing) return;

    const repo = getRepository();
    await repo.save({
      run_id: runId,
      pipeline: pipeline || 'unknown',
      input: { auto_created: true },
      started_at: new Date(),
      status: 'running' as RunStatus,
    });
  } catch (error: any) {
    // Log but don't throw - the actual run creation will handle it
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.warn(`Warning: Could not ensure run exists: ${errorMessage}`);
  }
}

export async function updateRun(runId: string, updates: { ended_at?: string; status?: string }): Promise<void> {
  const repo = getRepository();
  const updateData: Partial<Run> = {};
  
  if (updates.ended_at) {
    updateData.ended_at = new Date(updates.ended_at);
  }
  if (updates.status) {
    updateData.status = updates.status as RunStatus;
  }

  if (Object.keys(updateData).length > 0) {
    await repo.update({ run_id: runId }, updateData);
  }
}

export async function getRun(runId: string): Promise<RunRecord | null> {
  const repo = getRepository();
  const run = await repo.findOne({ where: { run_id: runId } });

  if (!run) return null;

  return {
    run_id: run.run_id,
    pipeline: run.pipeline,
    input: run.input,
    started_at: run.started_at.toISOString(),
    ended_at: run.ended_at?.toISOString(),
    status: run.status,
  };
}

export async function listRuns(filters?: { pipeline?: string; status?: string; limit?: number }): Promise<RunRecord[]> {
  const repo = getRepository();
  const queryBuilder = repo.createQueryBuilder('run');

  if (filters?.pipeline) {
    queryBuilder.andWhere('run.pipeline = :pipeline', { pipeline: filters.pipeline });
  }

  if (filters?.status) {
    queryBuilder.andWhere('run.status = :status', { status: filters.status });
  }

  queryBuilder.orderBy('run.started_at', 'DESC');

  if (filters?.limit) {
    queryBuilder.limit(filters.limit);
  }

  const runs = await queryBuilder.getMany();

  return runs.map((run) => ({
    run_id: run.run_id,
    pipeline: run.pipeline,
    input: run.input,
    started_at: run.started_at.toISOString(),
    ended_at: run.ended_at?.toISOString(),
    status: run.status,
  }));
}
