import { describe, expect, it } from 'vitest';
import { debugIdsInStacks, sanitizeDebugIds } from '../../src/shared/debug-ids';
import { LIMITS } from '../../src/shared/protocol';
import { ID_A, ID_B, ID_C } from '../helpers/debug-ids';

describe('sanitizeDebugIds', () => {
    it('keeps file to debug ID entries as the build wrote them', () => {
        const upper = ID_B.toUpperCase();
        const bare = ID_C.replace(/-/g, '');
        expect(
            sanitizeDebugIds({ 'app://./a.js': ID_A, 'file:///b.js': upper, '/c.js': bare }, 10),
        ).toEqual({ 'app://./a.js': ID_A, 'file:///b.js': upper, '/c.js': bare });
    });

    it('gives an empty object for anything that is not a plain object', () => {
        class Registry {
            'a.js' = ID_A;
        }
        for (const value of [
            undefined,
            null,
            'a.js',
            42,
            true,
            [ID_A],
            [['a.js', ID_A]],
            new Map([['a.js', ID_A]]),
            new Date(),
            new Registry(),
            () => ID_A,
        ]) {
            expect(sanitizeDebugIds(value, 10)).toEqual({});
        }
        expect(sanitizeDebugIds(Object.assign(Object.create(null), { 'a.js': ID_A }), 10)).toEqual({
            'a.js': ID_A,
        });
    });

    it('drops entries whose value is not a debug ID and keeps the rest', () => {
        expect(
            sanitizeDebugIds(
                {
                    'number.js': 1,
                    'null.js': null,
                    'object.js': { id: ID_A },
                    'array.js': [ID_A],
                    'placeholder.js': 'abc',
                    'short.js': ID_A.slice(1),
                    'not-hex.js': ID_A.replace('9', 'g'),
                    'padded.js': `${ID_A}${'-'.repeat(LIMITS.debugIdLength)}`,
                    'good.js': ID_A,
                },
                10,
            ),
        ).toEqual({ 'good.js': ID_A });
    });

    it('drops empty and oversize file names', () => {
        const longest = 'a'.repeat(LIMITS.debugIdFileLength);
        expect(sanitizeDebugIds({ '': ID_A, [`${longest}a`]: ID_B, [longest]: ID_C }, 10)).toEqual({
            [longest]: ID_C,
        });
    });

    it('stops at the entry cap and at the summed file name cap', () => {
        const many: Record<string, string> = {};
        for (let i = 0; i < 300; i++) {
            many[`chunk-${i}.js`] = ID_A;
        }
        const capped = sanitizeDebugIds({ 'bad.js': 'abc', ...many }, LIMITS.debugIdsPerReport);
        expect(Object.keys(capped)).toHaveLength(LIMITS.debugIdsPerReport);
        expect(Object.keys(capped)[0]).toBe('chunk-0.js');

        const long: Record<string, string> = {};
        for (let i = 0; i < 200; i++) {
            long[`${i}`.padStart(LIMITS.debugIdFileLength, 'a')] = ID_A;
        }
        const fitting = Object.keys(sanitizeDebugIds(long, LIMITS.debugIdsPerPage));
        expect(fitting).toHaveLength(LIMITS.debugIdFilesLength / LIMITS.debugIdFileLength);
    });

    it('cannot be used to change a prototype', () => {
        const hostile = JSON.parse(
            `{"__proto__":"${ID_A}","constructor":"${ID_B}","prototype":{"polluted":true},"a.js":"${ID_C}"}`,
        ) as unknown;
        const debugIds = sanitizeDebugIds(hostile, 10);
        expect(Object.getPrototypeOf(debugIds)).toBe(Object.prototype);
        expect(Object.keys(debugIds)).toEqual(['constructor', 'a.js']);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect({}.constructor).toBe(Object);

        const nested = JSON.parse('{"__proto__":{"polluted":true},"a.js":"x"}') as unknown;
        expect(sanitizeDebugIds(nested, 10)).toEqual({});
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('never throws and keeps what it read before a getter threw', () => {
        const value = {
            'a.js': ID_A,
            get 'b.js'(): string {
                throw new Error('getter');
            },
            'c.js': ID_C,
        };
        expect(sanitizeDebugIds(value, 10)).toEqual({ 'a.js': ID_A });
    });
});

describe('debugIdsInStacks', () => {
    const debugIds = {
        'app://./assets/index.js': ID_A,
        'app://./assets/vendor.js': ID_B,
        'app://./assets/unused.js': ID_C,
    };

    it('keeps the files named by a frame of the error or of one of its causes', () => {
        expect(
            debugIdsInStacks(
                {
                    name: 'Error',
                    message: 'outer',
                    stack: 'Error: outer\n    at render (app://./assets/index.js:1:2345)',
                    cause: {
                        name: 'TypeError',
                        message: 'inner',
                        stack: 'TypeError: inner\n    at app://./assets/vendor.js:9:1',
                    },
                },
                debugIds,
            ),
        ).toEqual({ 'app://./assets/index.js': ID_A, 'app://./assets/vendor.js': ID_B });
    });

    it('needs the file to be followed by a line number', () => {
        expect(
            debugIdsInStacks(
                {
                    name: 'Error',
                    message: 'failed to load app://./assets/index.js',
                    stack: 'Error: failed to load app://./assets/index.js\n    at <anonymous>',
                },
                debugIds,
            ),
        ).toEqual({});
    });
});
