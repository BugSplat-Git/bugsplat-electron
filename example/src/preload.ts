/**
 * The example's own preload. It does NOT contain any BugSplat code: the @bugsplat/electron
 * preload is injected into every session by init() in the main process.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('demo', {
    run: (name: string) => ipcRenderer.invoke('demo:run', name),
    crashRenderer: () => process.crash(),
    hangRenderer: () => process.hang(),
    onScenario: (callback: (name: string) => void) => {
        ipcRenderer.on('demo:scenario', (_event, name: string) => callback(name));
    },
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
    },
});
