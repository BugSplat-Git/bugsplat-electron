import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installPreloadErrorCapture } from '../../src/main/signals/preload-error';
import { createTestClient } from '../helpers/client';

describe('installPreloadErrorCapture', () => {
    it('reports preload errors with the preload file name and page url', () => {
        const { client } = createTestClient();
        const report = vi
            .spyOn(client, 'report')
            .mockResolvedValue({ error: null, response: null, original: '' } as never);
        const app = new EventEmitter();
        const contents = Object.assign(new EventEmitter(), { getURL: () => 'app://x' });
        installPreloadErrorCapture(client, client.logger, {
            app: app as never,
            existing: () => [],
        });
        app.emit('web-contents-created', {}, contents);
        contents.emit('preload-error', {}, '/app/dist/preload.js', new Error('preload broke'));
        expect(report).toHaveBeenCalledTimes(1);
        const input = report.mock.calls[0][0];
        expect(input.origin).toBe('preload-error');
        expect(input.error?.message).toBe('preload broke');
        expect(input.contextAttributes).toEqual({
            'bugsplat.processType': 'renderer',
            'bugsplat.preloadPath': 'preload.js',
            'bugsplat.url': 'app://x',
        });
    });
});
