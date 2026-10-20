import { describe, expect, it } from 'vitest';
import { KeyedRateLimiter, TokenBucket } from '../../src/main/rate-limit';

describe('rate limiting', () => {
    it('token bucket refills over time', () => {
        let now = 0;
        const bucket = new TokenBucket(2, 1, () => now);
        expect(bucket.take()).toBe(true);
        expect(bucket.take()).toBe(true);
        expect(bucket.take()).toBe(false);
        now = 1000;
        expect(bucket.take()).toBe(true);
        expect(bucket.take()).toBe(false);
    });

    it('keyed limiter isolates keys and applies the overall bucket', () => {
        let now = 0;
        const limiter = new KeyedRateLimiter(1, 1, new TokenBucket(2, 0, () => now), () => now);
        expect(limiter.take('a')).toBe(true);
        expect(limiter.take('a')).toBe(false);
        expect(limiter.take('b')).toBe(true);
        now = 5000;
        expect(limiter.take('a')).toBe(false);
    });
});
