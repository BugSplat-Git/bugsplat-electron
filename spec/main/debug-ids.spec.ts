import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeDebugIds, RendererDebugIds } from '../../src/main/debug-ids';
import { clearDebugIds, ID_A, ID_B, ID_C, registerDebugId } from '../helpers/debug-ids';

function fakeContents(destroyed = false) {
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed });
    return contents as typeof contents & WebContents;
}

describe('RendererDebugIds', () => {
    it('keeps the last set of debug IDs each webContents registered', () => {
        const store = new RendererDebugIds();
        const first = fakeContents();
        const second = fakeContents();
        expect(store.get(first)).toBeUndefined();
        store.set(first, { 'a.js': ID_A });
        store.set(second, { 'b.js': ID_B });
        store.set(first, { 'a.js': ID_A, 'lazy.js': ID_C });
        expect(store.get(first)).toEqual({ 'a.js': ID_A, 'lazy.js': ID_C });
        expect(store.get(second)).toEqual({ 'b.js': ID_B });
    });

    it('forgets a webContents when it is destroyed', () => {
        const store = new RendererDebugIds();
        const contents = fakeContents();
        store.set(contents, { 'a.js': ID_A });
        store.set(contents, { 'a.js': ID_B });
        expect(contents.listenerCount('destroyed')).toBe(1);
        contents.emit('destroyed');
        expect(store.get(contents)).toBeUndefined();
        expect(contents.listenerCount('destroyed')).toBe(0);
        expect(contents.listenerCount('did-navigate')).toBe(0);
    });

    it('forgets the IDs when a new document commits, but not on a same-document navigation', () => {
        const store = new RendererDebugIds();
        const contents = fakeContents();
        store.set(contents, { 'a.js': ID_A });
        contents.emit('did-navigate-in-page');
        expect(store.get(contents)).toEqual({ 'a.js': ID_A });
        contents.emit('did-navigate');
        expect(store.get(contents)).toBeUndefined();
    });

    it('keeps one navigation listener across documents', () => {
        const store = new RendererDebugIds();
        const contents = fakeContents();
        store.set(contents, { 'a.js': ID_A });
        contents.emit('did-navigate');
        store.set(contents, { 'b.js': ID_B });
        expect(store.get(contents)).toEqual({ 'b.js': ID_B });
        expect(contents.listenerCount('did-navigate')).toBe(1);
        expect(contents.listenerCount('destroyed')).toBe(1);
    });

    it('ignores a webContents that is already destroyed', () => {
        const store = new RendererDebugIds();
        const contents = fakeContents(true);
        store.set(contents, { 'a.js': ID_A });
        expect(store.get(contents)).toBeUndefined();
        expect(contents.listenerCount('destroyed')).toBe(0);
        expect(contents.listenerCount('did-navigate')).toBe(0);
    });
});

describe('mergeDebugIds', () => {
    afterEach(clearDebugIds);

    it("returns the caller's explicit IDs untouched when no renderer supplied any", () => {
        const explicit = { 'a.js': ID_A };
        expect(mergeDebugIds(undefined, explicit)).toBe(explicit);
        expect(mergeDebugIds({}, explicit)).toBe(explicit);
        expect(mergeDebugIds(undefined, undefined)).toBeUndefined();
    });

    it("passes a renderer's IDs through", () => {
        expect(mergeDebugIds({ 'app://./index.js': ID_A }, undefined)).toEqual({
            'app://./index.js': ID_A,
        });
    });

    it("leaves out a renderer's entry for a file the main process registered", () => {
        registerDebugId('/app/main.js', ID_A);
        expect(
            mergeDebugIds({ '/app/main.js': ID_B, 'app://./index.js': ID_C }, undefined),
        ).toEqual({ 'app://./index.js': ID_C });
    });

    it("lets the caller's explicit IDs win over a renderer's", () => {
        expect(mergeDebugIds({ 'a.js': ID_A, 'b.js': ID_B }, { 'a.js': ID_C })).toEqual({
            'a.js': ID_C,
            'b.js': ID_B,
        });
    });
});
