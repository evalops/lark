import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, RetryError, isRateLimitError, isOverloadedError } from './retry';

vi.mock('./config', () => ({
  config: {
    retry: {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    },
  },
}));

vi.mock('./log', () => ({
  logEvent: vi.fn(),
  logError: vi.fn(),
}));

describe('retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('rate limit exceeded'))
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn);
      
      await vi.advanceTimersByTimeAsync(200);
      
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should throw after max attempts', async () => {
      vi.useRealTimers();
      
      const error = new Error('rate limit exceeded');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(
        withRetry(fn, { 
          maxAttempts: 2, 
          baseDelayMs: 10,
          maxDelayMs: 20 
        })
      ).rejects.toThrow('rate limit exceeded');
      
      expect(fn).toHaveBeenCalledTimes(2);
      
      vi.useFakeTimers();
    });

    it('should not retry non-retryable errors by default', async () => {
      const error = new Error('invalid input');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn)).rejects.toThrow('invalid input');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should use custom shouldRetry function', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('custom error'))
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn, {
        shouldRetry: (err) => err.message === 'custom error',
      });

      await vi.advanceTimersByTimeAsync(200);
      
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn, { onRetry });

      await vi.advanceTimersByTimeAsync(200);
      
      await promise;

      expect(onRetry).toHaveBeenCalledWith(
        expect.any(Error),
        1,
        expect.any(Number)
      );
    });

    it('should use exponential backoff', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce('success');

      const onRetry = vi.fn();
      const promise = withRetry(fn, {
        baseDelayMs: 100,
        maxDelayMs: 10000,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);
      
      await promise;

      const firstDelay = onRetry.mock.calls[0][2];
      const secondDelay = onRetry.mock.calls[1][2];
      
      expect(secondDelay).toBeGreaterThan(firstDelay);
    });

    it('should respect maxDelayMs', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce('success');

      const onRetry = vi.fn();
      const promise = withRetry(fn, {
        baseDelayMs: 10000,
        maxDelayMs: 100,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(200);
      
      await promise;

      const delay = onRetry.mock.calls[0][2];
      expect(delay).toBeLessThanOrEqual(100);
    });
  });

  describe('isRateLimitError', () => {
    it('should detect rate limit errors', () => {
      expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
      expect(isRateLimitError(new Error('429 Too Many Requests'))).toBe(true);
      expect(isRateLimitError(new Error('too many requests'))).toBe(true);
    });

    it('should not detect non-rate-limit errors', () => {
      expect(isRateLimitError(new Error('invalid input'))).toBe(false);
      expect(isRateLimitError(new Error('network error'))).toBe(false);
    });
  });

  describe('isOverloadedError', () => {
    it('should detect overloaded errors', () => {
      expect(isOverloadedError(new Error('server overloaded'))).toBe(true);
      expect(isOverloadedError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isOverloadedError(new Error('service unavailable'))).toBe(true);
    });

    it('should not detect non-overloaded errors', () => {
      expect(isOverloadedError(new Error('invalid input'))).toBe(false);
      expect(isOverloadedError(new Error('rate limit'))).toBe(false);
    });
  });

  describe('RetryError', () => {
    it('should contain attempt count and last error', () => {
      const lastError = new Error('final error');
      const retryError = new RetryError('Failed after 3 attempts', 3, lastError);

      expect(retryError.attempts).toBe(3);
      expect(retryError.lastError).toBe(lastError);
      expect(retryError.message).toBe('Failed after 3 attempts');
      expect(retryError.name).toBe('RetryError');
    });
  });
});
