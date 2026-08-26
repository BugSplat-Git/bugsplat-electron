// Global test setup. `electron` is aliased to __mocks__/electron.ts in vitest.config.ts.
import { beforeEach, vi } from 'vitest';

// bugsplat logs every post unconditionally; keep test output readable.
beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
