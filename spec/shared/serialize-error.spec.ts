import { describe, expect, it } from 'vitest';
import {
    deserializeError,
    serializeError,
    serializeErrorEvent,
    toError,
} from '../../src/shared/serialize-error';

describe('serializeError', () => {
    it('serializes Error objects with name, message, stack and cause', () => {
        const cause = new RangeError('inner');
        const error = new TypeError('outer', { cause });
        const serialized = serializeError(error);
        expect(serialized.name).toBe('TypeError');
        expect(serialized.message).toBe('outer');
        expect(serialized.stack).toContain('TypeError: outer');
        expect(serialized.cause?.name).toBe('RangeError');
    });

    it('limits cause depth', () => {
        let error: Error = new Error('root');
        for (let i = 0; i < 10; i++) {
            error = new Error(`level ${i}`, { cause: error });
        }
        let depth = 0;
        let cursor = serializeError(error).cause;
        while (cursor) {
            depth++;
            cursor = cursor.cause;
        }
        expect(depth).toBe(3);
    });

    it('synthesizes a stack for non-Error values', () => {
        expect(serializeError('boom', 'https://app/index.html')).toEqual({
            name: 'Error',
            message: 'boom',
            stack: 'Error: boom\n    at https://app/index.html',
        });
        expect(serializeError({ code: 1 }).message).toBe('{"code":1}');
        expect(serializeError(undefined).message).toBe('undefined');
    });

    it('serializes error events without an error object using file:line:col', () => {
        const serialized = serializeErrorEvent(
            { message: 'Script error.', filename: 'app.js', lineno: 10, colno: 5, error: null },
            'https://app/',
        );
        expect(serialized.stack).toBe('Error: Script error.\n    at <anonymous> (app.js:10:5)');
    });

    it('prefers the error object of an error event when present', () => {
        const serialized = serializeErrorEvent({ message: 'x', error: new Error('real') });
        expect(serialized.message).toBe('real');
    });

    it('round-trips through deserializeError', () => {
        const error = deserializeError({
            name: 'CustomError',
            message: 'm',
            stack: 'CustomError: m\n    at a (b.js:1:1)',
            cause: { name: 'Error', message: 'c', stack: 'Error: c' },
        });
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('CustomError');
        expect(error.stack).toBe('CustomError: m\n    at a (b.js:1:1)');
        expect((error as Error & { cause?: Error }).cause?.message).toBe('c');
    });

    it('toError keeps Error instances and coerces everything else', () => {
        const error = new Error('e');
        expect(toError(error)).toBe(error);
        const coerced = toError('text', 'somewhere');
        expect(coerced).toBeInstanceOf(Error);
        expect(coerced.stack).toBe('Error: text\n    at somewhere');
    });
});
