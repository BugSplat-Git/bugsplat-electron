const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8ByteLength(value: string): number {
    return encoder.encode(value).length;
}

/**
 * Truncate a string so that its UTF-8 encoding is at most `maxBytes` bytes,
 * never splitting a code point.
 */
export function truncateUtf8(value: string, maxBytes: number): string {
    if (maxBytes <= 0) {
        return '';
    }
    const bytes = encoder.encode(value);
    if (bytes.length <= maxBytes) {
        return value;
    }
    let end = maxBytes;
    // Back up over UTF-8 continuation bytes (10xxxxxx) so we cut on a boundary.
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
        end--;
    }
    return decoder.decode(bytes.subarray(0, end));
}

/** Human readable rendering of an arbitrary value, capped at `maxBytes`. */
export function describeValue(value: unknown, maxBytes: number = 1024): string {
    let text: string;
    if (typeof value === 'string') {
        text = value;
    } else if (value === undefined) {
        text = 'undefined';
    } else if (value === null) {
        text = 'null';
    } else if (typeof value === 'object') {
        try {
            text = JSON.stringify(value) ?? Object.prototype.toString.call(value);
        } catch {
            text = Object.prototype.toString.call(value);
        }
    } else {
        text = String(value);
    }
    return truncateUtf8(text, maxBytes);
}
