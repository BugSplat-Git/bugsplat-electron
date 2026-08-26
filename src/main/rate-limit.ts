/** Token bucket: `capacity` tokens, refilled at `perSecond`. */
export class TokenBucket {
    private tokens: number;
    private last: number;

    constructor(
        private readonly capacity: number,
        private readonly perSecond: number,
        private readonly now: () => number = () => Date.now(),
    ) {
        this.tokens = capacity;
        this.last = now();
    }

    take(): boolean {
        const current = this.now();
        const elapsed = Math.max(0, current - this.last) / 1000;
        this.last = current;
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perSecond);
        if (this.tokens < 1) {
            return false;
        }
        this.tokens -= 1;
        return true;
    }
}

/** Per-key buckets plus an optional overall bucket. */
export class KeyedRateLimiter {
    private readonly buckets = new Map<string, TokenBucket>();

    constructor(
        private readonly capacity: number,
        private readonly perSecond: number,
        private readonly overall?: TokenBucket,
        private readonly now: () => number = () => Date.now(),
    ) {}

    take(key: string): boolean {
        let bucket = this.buckets.get(key);
        if (!bucket) {
            bucket = new TokenBucket(this.capacity, this.perSecond, this.now);
            this.buckets.set(key, bucket);
        }
        if (!bucket.take()) {
            return false;
        }
        if (this.overall && !this.overall.take()) {
            return false;
        }
        return true;
    }
}
