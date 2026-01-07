/**
 * Run represents one execution of a pipeline.
 */

import { v4 as uuidv4 } from 'uuid';
import { XRayClient } from './client';
import { Step, StepType, StepMetadata } from './step';

export class Run {
  private runId: string;
  private pipeline: string;
  private input: any;
  private client: XRayClient;
  private ended: boolean = false;

  constructor(pipeline: string, input: any, client: XRayClient) {
    this.runId = uuidv4();
    this.pipeline = pipeline;
    this.input = input;
    this.client = client;

    // Fire-and-forget: create run
    this.client.post('/runs', {
      run_id: this.runId,
      pipeline: this.pipeline,
      input: this.input,
      started_at: new Date().toISOString(),
      status: 'running',
    });
  }

  /**
   * Create a new step in this run.
   */
  step(name: string, options: { type: StepType; metadata?: StepMetadata }): Step {
    const stepId = uuidv4();
    return new Step(
      stepId,
      this.runId,
      name,
      options.type,
      options.metadata || {},
      this.client,
      this.pipeline // Pass pipeline name for placeholder run creation
    );
  }

  /**
   * End the run.
   */
  end(status: 'success' | 'error' = 'success'): void {
    if (this.ended) return;
    this.ended = true;

    this.client.post(`/runs/${this.runId}`, {
      ended_at: new Date().toISOString(),
      status: status,
    });
  }

  getRunId(): string {
    return this.runId;
  }
}

