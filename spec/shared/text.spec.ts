import { describe, expect, it } from 'vitest';
import { describeValue, truncateUtf8, utf8ByteLength } from '../../src/shared/text';

describe('text', () => {
    it('measures UTF-8 byte length', () => {
        expect(utf8ByteLength('abc')).toBe(3);
        expect(utf8ByteLength('é')).toBe(2);
        expect(utf8ByteLength('日本')).toBe(6);
    });

    it('truncates on a code point boundary', () => {
        expect(truncateUtf8('abcdef', 3)).toBe('abc');
        expect(truncateUtf8('日本語', 4)).toBe('日');
        expect(truncateUtf8('日本語', 6)).toBe('日本');
        expect(
            utf8ByteLength(truncateUtf8('a'.repeat(10) + '日'.repeat(10), 20)),
        ).toBeLessThanOrEqual(20);
        expect(truncateUtf8('short', 100)).toBe('short');
        expect(truncateUtf8('x', 0)).toBe('');
    });

    it('describes values', () => {
        expect(describeValue('str')).toBe('str');
        expect(describeValue(undefined)).toBe('undefined');
        expect(describeValue(null)).toBe('null');
        expect(describeValue(42)).toBe('42');
        expect(describeValue({ a: 1 })).toBe('{"a":1}');
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(describeValue(circular)).toBe('[object Object]');
        expect(utf8ByteLength(describeValue('x'.repeat(5000), 1024))).toBe(1024);
    });
});
