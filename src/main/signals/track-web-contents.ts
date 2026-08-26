import { app, webContents, type WebContents } from 'electron';

export interface WebContentsTrackerDeps {
    app: Pick<typeof app, 'on' | 'removeListener'>;
    existing: () => WebContents[];
}

export const defaultTrackerDeps = (): WebContentsTrackerDeps => ({
    app,
    existing: () => webContents.getAllWebContents(),
});

/** Run `track` for every existing and future webContents. Returns a disposer. */
export function trackWebContents(
    track: (contents: WebContents) => void,
    deps: WebContentsTrackerDeps = defaultTrackerDeps(),
): () => void {
    const onCreated = (_event: unknown, contents: WebContents): void => {
        try {
            track(contents);
        } catch {
            // never propagate from an app event listener
        }
    };
    deps.app.on('web-contents-created', onCreated);
    let existing: WebContents[];
    try {
        existing = deps.existing();
    } catch {
        existing = [];
    }
    for (const contents of existing) {
        onCreated(undefined, contents);
    }
    return () => {
        deps.app.removeListener('web-contents-created', onCreated);
    };
}

function safe<T>(fn: () => T): T | undefined {
    try {
        return fn();
    } catch {
        return undefined;
    }
}

/** `bugsplat.*` attributes describing a webContents. */
export function describeWebContents(
    contents: WebContents | undefined,
    isVisible: (contents: WebContents) => boolean | undefined,
): Record<string, string> {
    if (!contents) {
        return {};
    }
    const attributes: Record<string, string> = { 'bugsplat.webContentsId': String(contents.id) };
    const url = safe(() => contents.getURL());
    if (url) {
        attributes['bugsplat.url'] = url;
    }
    const title = safe(() => contents.getTitle());
    if (title) {
        attributes['bugsplat.title'] = title.slice(0, 512);
    }
    const type = safe(() => contents.getType());
    if (type) {
        attributes['bugsplat.webContentsType'] = type;
    }
    const visible = safe(() => isVisible(contents));
    if (visible !== undefined) {
        attributes['bugsplat.visible'] = String(visible);
    }
    return attributes;
}
