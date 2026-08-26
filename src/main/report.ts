import type { BugSplatAttachment, BugSplatOptions } from 'bugsplat';
import type { IdentitySnapshot } from '../shared/identity';
import type { Logger } from '../shared/logger';
import type { BeforePostHook, PendingReport } from './options';

/**
 * Merge identity, SDK context and per-call options into the options handed to `bugsplat`.
 * Scalar fields: per-call value wins, then identity. Attributes: identity < context < per-call.
 */
export function mergeReportOptions(
    identity: IdentitySnapshot,
    sdkVersion: string,
    contextAttributes: Record<string, string>,
    options: BugSplatOptions | undefined,
    extraAttachments: BugSplatAttachment[] = [],
): BugSplatOptions {
    const attributes: Record<string, string> = {
        ...identity.attributes,
        ...(identity.notes ? { notes: identity.notes } : {}),
        'bugsplat.sdk': `@bugsplat/electron/${sdkVersion}`,
        ...contextAttributes,
        ...(options?.attributes ?? {}),
    };
    return {
        appKey: options?.appKey || identity.appKey,
        user: options?.user || identity.user,
        email: options?.email || identity.email,
        description: options?.description || identity.description,
        attributes,
        attachments: [...(options?.attachments ?? []), ...extraAttachments],
    };
}

/** Run the user's `beforePost` hook defensively. `null` means "drop the report". */
export async function runBeforePost(
    hook: BeforePostHook | undefined,
    report: PendingReport,
    logger: Logger,
): Promise<PendingReport | null> {
    if (!hook) {
        return report;
    }
    try {
        const result = await hook(report);
        if (result === null) {
            return null;
        }
        return result ?? report;
    } catch (error) {
        logger.error('beforePost hook threw; posting the original report', error);
        return report;
    }
}
