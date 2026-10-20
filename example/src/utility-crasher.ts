// Forked via utilityProcess.fork(); crashes natively so Crashpad records a utility-process minidump.
setTimeout(() => {
    const proc = process as NodeJS.Process & { crash?: () => void };
    if (typeof proc.crash === 'function') {
        proc.crash();
    } else {
        process.abort();
    }
}, 200);
