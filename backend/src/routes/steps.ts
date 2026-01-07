/**
 * Steps API routes.
 */

import { Router, Request, Response } from 'express';
import * as stepModel from '../models/step';
import * as candidateModel from '../models/candidate';
import * as runModel from '../models/run';

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

// POST /steps - Create a new step
router.post('/', async (req: Request, res: Response) => {
  try {
    const { step_id, run_id, name, type, metadata, pipeline } = req.body;

    if (!step_id || !run_id || !name || !type) {
      return res.status(400).json({ error: 'Missing required fields: step_id, run_id, name, type' });
    }

    if (!['filter', 'rank', 'generate', 'select'].includes(type)) {
      return res.status(400).json({ error: 'Invalid step type' });
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

    res.status(201).json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error creating step:', errorMessage);
    
    if (handleDatabaseError(error, res)) return;
    
    // Handle foreign key constraint violation
    if (errorMessage.includes('foreign key constraint') || errorMessage.includes('23503')) {
      return res.status(400).json({ 
        error: 'Run not found', 
        message: 'Run must be created before step can be created. Ensure run creation completes first.' 
      });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /steps/:id/summary - Update step summary
router.post('/:id/summary', async (req: Request, res: Response) => {
  try {
    const stepId = req.params.id;
    const { input_count, output_count, rejection_breakdown, run_id } = req.body;

    // Ensure step exists (handles race condition where summary arrives before step creation)
    if (run_id) {
      await stepModel.ensureStepExists(stepId, run_id);
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
      stepId,
      {
        step_id: stepId,
        rejected,
        accepted,
        rejection_breakdown: rejection_breakdown || {},
      },
      input_count,
      output_count
    );

    res.json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error updating step summary:', errorMessage);
    
    if (handleDatabaseError(error, res)) return;
    
    // Handle foreign key constraint violation
    if (errorMessage.includes('foreign key constraint') || errorMessage.includes('23503')) {
      return res.status(400).json({ 
        error: 'Step not found', 
        message: 'Step must be created before summary can be recorded. Ensure step creation completes first.' 
      });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /steps/:id/candidates - Add candidate record
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

    // Ensure step exists (handles race condition where candidate arrives before step creation)
    if (run_id) {
      await stepModel.ensureStepExists(stepId, run_id);
    }

    await candidateModel.createCandidate({
      candidate_id,
      step_id: stepId,
      decision,
      score,
      reason,
    });

    res.status(201).json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error creating candidate:', errorMessage);
    
    if (handleDatabaseError(error, res)) return;
    
    // Handle foreign key constraint violation
    if (errorMessage.includes('foreign key constraint') || errorMessage.includes('23503')) {
      return res.status(400).json({ 
        error: 'Step not found', 
        message: 'Step must be created before candidate can be recorded. Ensure step creation completes first.' 
      });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /steps/:id/candidates/bulk - Add multiple candidate records in one call
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

    // Ensure step exists (handles race condition where candidates arrive before step creation)
    if (run_id) {
      await stepModel.ensureStepExists(stepId, run_id);
    }

    // Validate and prepare candidates
    const validCandidates = candidates
      .filter((c) => c.candidate_id && c.decision && ['accepted', 'rejected'].includes(c.decision))
      .map((c) => ({
        candidate_id: c.candidate_id,
        step_id: stepId,
        decision: c.decision,
        score: c.score,
        reason: c.reason,
      }));

    if (validCandidates.length > 0) {
      await candidateModel.createCandidatesBulk(validCandidates);
    }

    res.status(201).json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error creating candidates (bulk):', errorMessage);

    if (handleDatabaseError(error, res)) return;

    // Handle foreign key constraint violation
    if (errorMessage.includes('foreign key constraint') || errorMessage.includes('23503')) {
      return res.status(400).json({
        error: 'Step not found',
        message: 'Step must be created before candidates can be recorded. Ensure step creation completes first.',
      });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /steps - List steps
router.get('/', async (req: Request, res: Response) => {
  try {
    const run_id = req.query.run_id as string | undefined;
    const type = req.query.type as stepModel.StepType | undefined;
    const name = req.query.name as string | undefined;

    const steps = await stepModel.listSteps({ run_id, type, name });
    res.json(steps);
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error listing steps:', errorMessage);
    
    if (handleDatabaseError(error, res)) return;
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /steps/:id - Get a specific step with summary and candidates
router.get('/:id', async (req: Request, res: Response) => {
  try {
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

// GET /steps/query/high-rejection - Query for steps with high rejection rates
router.get('/query/high-rejection', async (req: Request, res: Response) => {
  try {
    const threshold = req.query.threshold ? parseFloat(req.query.threshold as string) : 0.9;

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

