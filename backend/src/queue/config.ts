/**
 * BullMQ Queue Configuration
 */

import { Queue, QueueOptions } from 'bullmq';
import Redis, { RedisOptions } from 'ioredis';

// Redis connection configuration (compatible with both BullMQ and ioredis)
const redisConfig: RedisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required for BullMQ
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true; // Reconnect on READONLY error
    }
    return false;
  },
};

// Redis connection instance (for event handlers and direct access)
const redisConnection = new Redis(redisConfig);

// Handle Redis connection errors
redisConnection.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

redisConnection.on('connect', () => {
  console.log('✅ Redis connected');
});

redisConnection.on('ready', () => {
  console.log('✅ Redis ready');
});

// Queue options (BullMQ accepts the same connection options as ioredis)
const queueOptions: QueueOptions = {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000, // Keep max 1000 completed jobs
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
};

// Create queues for different job types
export const runQueue = new Queue('runs', queueOptions);
export const stepQueue = new Queue('steps', queueOptions);
export const candidateQueue = new Queue('candidates', queueOptions);

export { redisConnection, redisConfig };

