/**
 * X-Ray SDK - Main entry point.
 * 
 * Lightweight, non-blocking SDK for instrumenting multi-step decision pipelines.
 */

import { XRayClient, ClientConfig } from './client';
import { Run } from './run';

export interface XRayConfig extends ClientConfig {}

/**
 * Initialize X-Ray SDK.
 * 
 * @param config - Configuration including API URL
 * @returns X-Ray instance
 */
export function initXRay(config: XRayConfig): XRay {
  const client = new XRayClient(config);
  return new XRay(client);
}

/**
 * Main X-Ray class.
 */
export class XRay {
  private client: XRayClient;

  constructor(client: XRayClient) {
    this.client = client;
  }

  /**
   * Start a new run.
   * 
   * @param pipeline - Name of the pipeline
   * @param input - Input data for this run
   * @returns Run instance
   */
  startRun(pipeline: string, input: any): Run {
    return new Run(pipeline, input, this.client);
  }

  /**
   * Flush any buffered requests (if buffering is enabled).
   */
  async flush(): Promise<void> {
    await this.client.flush();
  }
}

// Re-export types
export { Run } from './run';
export { Step, StepType, StepMetadata, StepSummary, CandidateRecord } from './step';

