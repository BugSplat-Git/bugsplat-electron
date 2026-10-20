export function uncaughtException(str = 'uncaughtException') {
    generateStackFramesAndCrash(str);
}

export async function unhandledRejection(str = 'unhandledRejection') {
    return generateStackFramesAndCrash(str);
}

function generateStackFramesAndCrash(str: string) {
    sampleStackFrame0(str);
}

function sampleStackFrame0(str: string) {
    sampleStackFrame1(str);
}

function sampleStackFrame1(str: string) {
    sampleStackFrame2(str);
}

function sampleStackFrame2(str: string) {
    crash(str);
}

function crash(str: string) {
    if (str) {
        throw new Error(`BugSplat: ${str}`);
    } else {
        throw new Error('BugSplat!');
    }
}

/** Throws an Error whose `cause` is the SyntaxError from the bad JSON: a wrapped failure with a chain. */
export function loadUserSettings(): void {
    try {
        JSON.parse('{ not valid json');
    } catch (error) {
        throw new Error('Failed to load user settings', { cause: error });
    }
}
