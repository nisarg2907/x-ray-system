/**
 * Fire-and-forget HTTP client for X-Ray SDK.
 * Never throws, always returns void.
 */

import fetch from 'node-fetch';

export interface ClientConfig {
  apiUrl: string;
  timeout?: number; // milliseconds
  bufferSize?: number; // in-memory buffer size (0 = disabled)
}

export class XRayClient {
  private config: Required<ClientConfig>;
  private buffer: Array<{ url: string; body: any }> = [];

  constructor(config: ClientConfig) {
    this.config = {
      apiUrl: config.apiUrl.replace(/\/$/, ''), // remove trailing slash
      timeout: config.timeout ?? 5000,
      bufferSize: config.bufferSize ?? 0,
    };
  }

  /**
   * Fire-and-forget POST request.
   * Never throws, silently fails if backend is down.
   */
  async post(path: string, body: any): Promise<void> {
    const url = `${this.config.apiUrl}${path}`;
    const payload = { url, body };

    // If buffering is enabled and buffer is not full, add to buffer
    if (this.config.bufferSize > 0 && this.buffer.length < this.config.bufferSize) {
      this.buffer.push(payload);
    }

    // Attempt to send immediately
    this.sendWithTimeout(url, body).catch(() => {
      // Silently fail - pipeline continues normally
    });
  }

  /**
   * Flush buffered requests (if buffering is enabled).
   */
  async flush(): Promise<void> {
    if (this.config.bufferSize === 0 || this.buffer.length === 0) {
      return;
    }

    const toFlush = [...this.buffer];
    this.buffer = [];

    await Promise.allSettled(
      toFlush.map(({ url, body }) => this.sendWithTimeout(url, body))
    );
  }

  private async sendWithTimeout(url: string, body: any): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Don't throw on non-2xx - just log if needed
      if (!response.ok) {
        // Could add optional logging here, but keeping it silent
      }
    } catch (error) {
      // Silently fail - never throw
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

