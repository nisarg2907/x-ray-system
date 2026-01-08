/**
 * Steps API routes.
 */

import { Router, Request, Response } from 'express';
import { stepQueue, candidateQueue } from '../queue/config';
import type { CreateStepJobData, UpdateStepSummaryJobData } from '../queue/processors/stepProcessor';
import type { CreateCandidateJobData, CreateCandidatesBulkJobData } from '../queue/processors/candidateProcessor';

const router = Router();

// Helper to handle database errors
function handleDatabaseError(error: any, res: Response): boolean {
  const errorMessage = error?.message || error?.toString() || 'Unknown error';
  
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('connect')) {
    res.status(503).json({ 
      error: 'Database unavailable', 
      message: 'PostgreSQL is not running. Please start PostgreSQL and ensure the database exists.' 
    });
    return true;
  }
  return false;
}

// POST /steps - Create a new step (enqueues job)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { step_id, run_id, name, type, metadata, pipeline } = req.body;

    if (!step_id || !run_id || !name || !type) {
      return res.status(400).json({ error: 'Missing required fields: step_id, run_id, name, type' });
    }

    if (!['filter', 'rank', 'generate', 'select'].includes(type)) {
      return res.status(400).json({ error: 'Invalid step type' });
    }

    // Enqueue job instead of executing directly
    await stepQueue.add('create-step', {
      step_id,
      run_id,
      name,
      type,
      metadata: metadata || {},
      pipeline,
    } as CreateStepJobData);

    res.status(201).json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error enqueueing create step job:', errorMessage);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /steps/:id/summary - Update step summary (enqueues job)
router.post('/:id/summary', async (req: Request, res: Response) => {
  try {
    const stepId = req.params.id;
    const { input_count, output_count, rejection_breakdown, run_id } = req.body;

    // Enqueue job instead of executing directly
    await stepQueue.add('update-step-summary', {
      step_id: stepId,
      input_count,
      output_count,
      rejection_breakdown,
      run_id,
    } as UpdateStepSummaryJobData);

    res.json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error enqueueing update step summary job:', errorMessage);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /steps/:id/candidates - Add candidate record (enqueues job)
router.post('/:id/candidates', async (req: Request, res: Response) => {
  try {
    const stepId = req.params.id;
    const { candidate_id, decision, score, reason, run_id } = req.body;

    if (!candidate_id || !decision) {
      return res.status(400).json({ error: 'Missing required fields: candidate_id, decision' });
    }

    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision' });
    }

    // Enqueue job instead of executing directly
    await candidateQueue.add('create-candidate', {
      candidate_id,
      step_id: stepId,
      decision,
      score,
      reason,
      run_id,
    } as CreateCandidateJobData);

    res.status(201).json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error enqueueing create candidate job:', errorMessage);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /steps/:id/candidates/bulk - Add multiple candidate records in one call (enqueues job)
router.post('/:id/candidates/bulk', async (req: Request, res: Response) => {
  try {
    const stepId = req.params.id;
    const { candidates, run_id } = req.body as {
      candidates: { candidate_id: string; decision: 'accepted' | 'rejected'; score?: number; reason?: string }[];
      run_id?: string;
    };

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: 'Missing candidates array' });
    }

    // Enqueue job instead of executing directly
    await candidateQueue.add('create-candidates-bulk', {
      step_id: stepId,
      candidates,
      run_id,
    } as CreateCandidatesBulkJobData);

    res.status(201).json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error enqueueing create candidates bulk job:', errorMessage);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /steps - List steps (read-only, no queue needed)
router.get('/', async (req: Request, res: Response) => {
  try {
    const run_id = req.query.run_id as string | undefined;
    const type = req.query.type as string | undefined;
    const name = req.query.name as string | undefined;

    // Import here to avoid circular dependency issues
    const stepModel = await import('../models/step');
    const steps = await stepModel.listSteps({ run_id, type: type as any, name });
    res.json(steps);
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error listing steps:', errorMessage);
    
    if (handleDatabaseError(error, res)) return;
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /steps/:id - Get a specific step with summary and candidates (read-only, no queue needed)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    // Import here to avoid circular dependency issues
    const stepModel = await import('../models/step');
    const candidateModel = await import('../models/candidate');
    
    const step = await stepModel.getStep(req.params.id);

    if (!step) {
      return res.status(404).json({ error: 'Step not found' });
    }

    // Get summary
    const summary = await stepModel.getStepSummary(step.step_id);

    // Get candidates
    const candidates = await candidateModel.getCandidatesByStep(step.step_id);

    res.json({
      ...step,
      summary,
      candidates,
    });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error getting step:', errorMessage);
    
    if (handleDatabaseError(error, res)) return;
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /steps/query/high-rejection - Query for steps with high rejection rates (read-only, no queue needed)
router.get('/query/high-rejection', async (req: Request, res: Response) => {
  try {
    const threshold = req.query.threshold ? parseFloat(req.query.threshold as string) : 0.9;

    // Import here to avoid circular dependency issues
    const stepModel = await import('../models/step');
    const steps = await stepModel.findFilteringStepsWithHighRejectionRate(threshold);
    res.json(steps);
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error querying high rejection steps:', errorMessage);
    
    if (handleDatabaseError(error, res)) return;
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

