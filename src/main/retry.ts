import { config } from './config';
import { logEvent, logError } from './log';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

export class RetryError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(message: string, attempts: number, lastError: Error) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

function isRetryableError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  const retryablePatterns = [
    'rate limit',
    'too many requests',
    '429',
    '503',
    '502',
    'service unavailable',
    'timeout',
    'econnreset',
    'econnrefused',
    'socket hang up',
    'network',
    'overloaded',
  ];
  return retryablePatterns.some((pattern) => message.includes(pattern));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? config.retry.maxAttempts;
  const baseDelayMs = options.baseDelayMs ?? config.retry.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? config.retry.maxDelayMs;
  const shouldRetry = options.shouldRetry ?? ((err) => isRetryableError(err));

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts || !shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      const delayMs = calculateBackoff(attempt, baseDelayMs, maxDelayMs);
      
      logEvent('retry_attempt', {
        attempt,
        maxAttempts,
        delayMs,
        error: lastError.message,
      });

      options.onRetry?.(lastError, attempt, delayMs);

      await sleep(delayMs);
    }
  }

  throw new RetryError(
    `Failed after ${maxAttempts} attempts`,
    maxAttempts,
    lastError!
  );
}

export function isRateLimitError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  return message.includes('rate limit') || 
         message.includes('429') || 
         message.includes('too many requests');
}

export function isOverloadedError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  return message.includes('overloaded') || 
         message.includes('503') || 
         message.includes('service unavailable');
}
