/**
 * BullMQ Worker - processes jobs from queues
 */

import { Worker, WorkerOptions } from 'bullmq';
import {  redisConnection, redisConfig } from './queue/config';
import {
  processCreateRun,
  processUpdateRun,
  type CreateRunJobData,
  type UpdateRunJobData,
} from './queue/processors/runProcessor';
import {
  processCreateStep,
  processUpdateStepSummary,
  type CreateStepJobData,
  type UpdateStepSummaryJobData,
} from './queue/processors/stepProcessor';
import {
  processCreateCandidate,
  processCreateCandidatesBulk,
  type CreateCandidateJobData,
  type CreateCandidatesBulkJobData,
} from './queue/processors/candidateProcessor';

// Worker options
const workerOptions: WorkerOptions = {
  connection: redisConfig,
  concurrency: 10, // Process up to 10 jobs concurrently
  limiter: {
    max: 100, // Max 100 jobs
    duration: 1000, // Per second
  },
};

// Run Worker
const runWorker = new Worker<CreateRunJobData | UpdateRunJobData>(
  'runs',
  async (job) => {
    console.log(`[Run Worker] Processing job ${job.id} of type ${job.name}`);
    
    try {
      if (job.name === 'create-run') {
        await processCreateRun(job as any);
      } else if (job.name === 'update-run') {
        await processUpdateRun(job as any);
      } else {
        throw new Error(`Unknown job type: ${job.name}`);
      }
      
      console.log(`[Run Worker] Successfully processed job ${job.id}`);
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      console.error(`[Run Worker] Error processing job ${job.id}:`, errorMessage);
      throw error; // Re-throw to mark job as failed
    }
  },
  workerOptions
);

// Step Worker
const stepWorker = new Worker<CreateStepJobData | UpdateStepSummaryJobData>(
  'steps',
  async (job) => {
    console.log(`[Step Worker] Processing job ${job.id} of type ${job.name}`);
    
    try {
      if (job.name === 'create-step') {
        await processCreateStep(job as any);
      } else if (job.name === 'update-step-summary') {
        await processUpdateStepSummary(job as any);
      } else {
        throw new Error(`Unknown job type: ${job.name}`);
      }
      
      console.log(`[Step Worker] Successfully processed job ${job.id}`);
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      console.error(`[Step Worker] Error processing job ${job.id}:`, errorMessage);
      throw error; // Re-throw to mark job as failed
    }
  },
  workerOptions
);

// Candidate Worker
const candidateWorker = new Worker<CreateCandidateJobData | CreateCandidatesBulkJobData>(
  'candidates',
  async (job) => {
    console.log(`[Candidate Worker] Processing job ${job.id} of type ${job.name}`);
    
    try {
      if (job.name === 'create-candidate') {
        await processCreateCandidate(job as any);
      } else if (job.name === 'create-candidates-bulk') {
        await processCreateCandidatesBulk(job as any);
      } else {
        throw new Error(`Unknown job type: ${job.name}`);
      }
      
      console.log(`[Candidate Worker] Successfully processed job ${job.id}`);
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      console.error(`[Candidate Worker] Error processing job ${job.id}:`, errorMessage);
      throw error; // Re-throw to mark job as failed
    }
  },
  workerOptions
);

// Event handlers for monitoring
runWorker.on('completed', (job) => {
  console.log(`[Run Worker] Job ${job.id} completed`);
});

runWorker.on('failed', (job, err) => {
  console.error(`[Run Worker] Job ${job?.id} failed:`, err.message);
});

stepWorker.on('completed', (job) => {
  console.log(`[Step Worker] Job ${job.id} completed`);
});

stepWorker.on('failed', (job, err) => {
  console.error(`[Step Worker] Job ${job?.id} failed:`, err.message);
});

candidateWorker.on('completed', (job) => {
  console.log(`[Candidate Worker] Job ${job.id} completed`);
});

candidateWorker.on('failed', (job, err) => {
  console.error(`[Candidate Worker] Job ${job?.id} failed:`, err.message);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n🛑 Shutting down workers...');
  
  await Promise.all([
    runWorker.close(),
    stepWorker.close(),
    candidateWorker.close(),
  ]);
  
  await redisConnection.quit();
  console.log('✅ Workers shut down gracefully');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('🚀 X-Ray Workers started');
console.log('   - Run Worker: processing run creation/updates');
console.log('   - Step Worker: processing step creation/summaries');
console.log('   - Candidate Worker: processing candidate records');
console.log('\nPress Ctrl+C to stop workers\n');

