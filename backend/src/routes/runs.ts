/**
 * Runs API routes.
 */

import { Router, Request, Response } from 'express';
import { runQueue } from '../queue/config';
import type { CreateRunJobData, UpdateRunJobData } from '../queue/processors/runProcessor';

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

// POST /runs - Create a new run (enqueues job)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { run_id, pipeline, input, started_at, status } = req.body;

    if (!run_id || !pipeline || !started_at) {
      return res.status(400).json({ error: 'Missing required fields: run_id, pipeline, started_at' });
    }

    // Enqueue job instead of executing directly
    await runQueue.add('create-run', {
      run_id,
      pipeline,
      input,
      started_at,
      status: status || 'running',
    } as CreateRunJobData);

    res.status(201).json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error enqueueing create run job:', errorMessage);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /runs - List runs (read-only, no queue needed)
router.get('/', async (req: Request, res: Response) => {
  try {
    const pipeline = req.query.pipeline as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    // Import here to avoid circular dependency issues
    const runModel = await import('../models/run');
    const runs = await runModel.listRuns({ pipeline, status, limit });
    res.json(runs);
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error listing runs:', errorMessage);
    
    if (handleDatabaseError(error, res)) return;
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /runs/:id - Get a specific run (read-only, no queue needed)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    // Import here to avoid circular dependency issues
    const runModel = await import('../models/run');
    const run = await runModel.getRun(req.params.id);

    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.json(run);
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error getting run:', errorMessage);
    
    if (handleDatabaseError(error, res)) return;
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /runs/:id - Update run (for ending runs - SDK uses POST) (enqueues job)
router.post('/:id', async (req: Request, res: Response) => {
  try {
    const { ended_at, status } = req.body;

    // Enqueue job instead of executing directly
    await runQueue.add('update-run', {
      run_id: req.params.id,
      ended_at,
      status,
    } as UpdateRunJobData);

    res.json({ success: true });
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Error enqueueing update run job:', errorMessage);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

