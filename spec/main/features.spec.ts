import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
    JS_CALL_STACKS_FEATURE,
    enableChromiumFeature,
    enableJsCallStacks,
    withJsCallStackPolicy,
} from '../../src/main/features';
import type { Logger } from '../../src/shared/logger';

function commandLine(initial = '') {
    let value = initial;
    return {
        getSwitchValue: vi.fn(() => value),
        appendSwitch: vi.fn((_name: string, next?: string) => {
            value = next ?? '';
        }),
    };
}

describe('enableChromiumFeature', () => {
    it('appends when no switch exists', () => {
        const cl = commandLine();
        enableChromiumFeature('Foo', cl);
        expect(cl.appendSwitch).toHaveBeenCalledWith('enable-features', 'Foo');
    });

    it('merges with existing features and avoids duplicates', () => {
        const cl = commandLine('A,B');
        enableChromiumFeature('Foo', cl);
        expect(cl.appendSwitch).toHaveBeenCalledWith('enable-features', 'A,B,Foo');
        enableChromiumFeature('Foo', cl);
        expect(cl.appendSwitch).toHaveBeenCalledTimes(1);
    });
});

describe('enableJsCallStacks', () => {
    const logger = (): Logger => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

    it('enables before ready and verifies at ready', () => {
        const cl = commandLine('X');
        const app = Object.assign(new EventEmitter(), { isReady: () => false, commandLine: cl });
        const log = logger();
        expect(enableJsCallStacks(log, app)).toBe(true);
        expect(cl.appendSwitch).toHaveBeenCalledWith(
            'enable-features',
            `X,${JS_CALL_STACKS_FEATURE}`,
        );
        cl.appendSwitch('enable-features', 'Overwritten');
        app.emit('ready');
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('overwritten'));
    });

    it('warns and does nothing after ready', () => {
        const cl = commandLine();
        const app = Object.assign(new EventEmitter(), { isReady: () => true, commandLine: cl });
        const log = logger();
        expect(enableJsCallStacks(log, app)).toBe(false);
        expect(cl.appendSwitch).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
    });
});

describe('withJsCallStackPolicy', () => {
    it('adds the header when missing and keeps existing values', () => {
        expect(withJsCallStackPolicy({ 'content-type': 'text/html' })).toEqual({
            'content-type': 'text/html',
            'Document-Policy': 'include-js-call-stacks-in-crash-reports',
        });
        expect(withJsCallStackPolicy({ 'document-policy': 'js-profiling' })).toEqual({
            'document-policy': 'js-profiling, include-js-call-stacks-in-crash-reports',
        });
        expect(withJsCallStackPolicy({ 'Document-Policy': ['js-profiling'] })).toEqual({
            'Document-Policy': ['js-profiling', 'include-js-call-stacks-in-crash-reports'],
        });
        const already = { 'Document-Policy': 'include-js-call-stacks-in-crash-reports' };
        expect(withJsCallStackPolicy(already)).toEqual(already);
    });
});
