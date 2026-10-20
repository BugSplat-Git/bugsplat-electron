import { BugSplat, type BugSplatOptions, type BugSplatResponse } from 'bugsplat';
import type { IdentitySnapshot } from '../shared/identity';
import type { Logger } from '../shared/logger';
import type { ReportOrigin } from '../shared/protocol';
import { toError } from '../shared/serialize-error';
import type { Capabilities } from './capabilities';
import type { IdentityStore } from './identity-store';
import type { FetchLike, PendingReport, ResolvedOptions } from './options';
import { mergeReportOptions, runBeforePost } from './report';
import { injectFetch, readFileAttachments } from './transport';

export interface MainPostOptions extends BugSplatOptions {
    /** Files to attach to this report (in addition to the defaults). */
    additionalFilePaths?: string[];
}

/** @internal */
export interface ReportInput {
    kind: 'crash' | 'feedback';
    origin: ReportOrigin;
    error?: Error;
    title?: string;
    options?: MainPostOptions;
    /** Context attributes (`bugsplat.*`), merged between identity attributes and per-call attributes. */
    contextAttributes?: Record<string, string>;
    /** Skip default `additionalFilePaths` (renderer reports never attach main-process files). */
    skipDefaultFiles?: boolean;
}

export interface ClientDeps {
    options: ResolvedOptions;
    store: IdentityStore;
    logger: Logger;
    capabilities: Capabilities;
    sdkVersion: string;
    fetchImpl: FetchLike;
    crash?: () => void;
}

/**
 * Main-process client. Extends `bugsplat`'s `BugSplat` so it stays type-compatible with the
 * other BugSplat packages, but every identity setter and post is routed through the shared
 * identity store so native crash keys, main-process reports and renderers agree.
 */
export class BugSplatElectron extends BugSplat {
    /** `false` when no database was configured; posts then resolve `{ error }`. */
    readonly enabled: boolean;
    readonly capabilities: Capabilities;
    /** Whether `crashReporter.start()` succeeded. */
    nativeStarted = false;
    private additionalFilePaths: string[];
    private readonly deps: ClientDeps;

    constructor(deps: ClientDeps) {
        super(deps.options.database, deps.options.application, deps.options.version);
        this.deps = deps;
        this.enabled = deps.options.database.length > 0;
        this.capabilities = deps.capabilities;
        this.additionalFilePaths = [...deps.options.additionalFilePaths];
        injectFetch(this, deps.fetchImpl);
    }

    get logger(): Logger {
        return this.deps.logger;
    }

    get sdkVersion(): string {
        return this.deps.sdkVersion;
    }

    /** @internal */
    get resolvedOptions(): ResolvedOptions {
        return this.deps.options;
    }

    /** @internal */
    get store(): IdentityStore {
        return this.deps.store;
    }

    // ---- identity -------------------------------------------------------------------------

    setAppKey(appKey: string): void {
        this.deps.store.apply({ appKey });
    }

    setUser(user: string): void {
        this.deps.store.apply({ user });
    }

    setEmail(email: string): void {
        this.deps.store.apply({ email });
    }

    setDescription(description: string): void {
        this.deps.store.apply({ description });
    }

    setNotes(notes: string): void {
        this.deps.store.apply({ notes });
    }

    setAttribute(key: string, value: string): void {
        this.deps.store.apply({ attributes: { [key]: value } });
    }

    /** Merge attributes into the current set. */
    setAttributes(attributes: Record<string, string>): void {
        this.deps.store.apply({ attributes });
    }

    removeAttribute(key: string): void {
        this.deps.store.apply({ attributes: { [key]: null } });
    }

    getIdentity(): Readonly<IdentitySnapshot> {
        return this.deps.store.get();
    }

    setAdditionalFilePaths(paths: string[]): void {
        this.additionalFilePaths = [...paths];
    }

    override setDefaultAppKey(appKey: string): void {
        this.setAppKey(appKey);
    }

    override setDefaultUser(user: string): void {
        this.setUser(user);
    }

    override setDefaultEmail(email: string): void {
        this.setEmail(email);
    }

    override setDefaultDescription(description: string): void {
        this.setDescription(description);
    }

    /** Replaces the attribute set (bugsplat semantics). */
    override setDefaultAttributes(attributes: Record<string, string>): void {
        this.deps.store.apply({ attributes, replaceAttributes: true });
    }

    // ---- posting --------------------------------------------------------------------------

    /** Post an error. Never rejects: network failures resolve `{ error }`. */
    override post(error: Error | string, options?: MainPostOptions): Promise<BugSplatResponse> {
        return this.report({
            kind: 'crash',
            origin: 'main.manual',
            error: toError(error, 'post (electron main)'),
            options,
        });
    }

    override postFeedback(title: string, options?: MainPostOptions): Promise<BugSplatResponse> {
        return this.report({ kind: 'feedback', origin: 'main.feedback', title, options });
    }

    /** @internal Shared implementation for every report that leaves the main process. */
    async report(input: ReportInput): Promise<BugSplatResponse> {
        const original: Error | string = input.error ?? input.title ?? '';
        if (!this.enabled) {
            return this.failure(
                'BugSplat Error: reporting is disabled (no database configured)',
                original,
            );
        }
        try {
            const { additionalFilePaths, ...options } = input.options ?? {};
            const filePaths =
                additionalFilePaths ?? (input.skipDefaultFiles ? [] : this.additionalFilePaths);
            const fileAttachments = filePaths.length
                ? await readFileAttachments(filePaths, this.deps.logger)
                : [];
            const contextAttributes: Record<string, string> = {
                'bugsplat.origin': input.origin,
                'bugsplat.processType': 'browser',
                ...(input.contextAttributes ?? {}),
            };
            const pending: PendingReport = {
                kind: input.kind,
                origin: input.origin,
                error: input.error,
                title: input.title,
                options: mergeReportOptions(
                    this.deps.store.get(),
                    this.deps.sdkVersion,
                    contextAttributes,
                    options,
                    fileAttachments,
                ),
            };
            const report = await runBeforePost(
                this.deps.options.beforePost,
                pending,
                this.deps.logger,
            );
            if (!report) {
                return this.failure('BugSplat Error: report dropped by beforePost', original);
            }
            if (report.kind === 'feedback') {
                return await super.postFeedback(report.title ?? '', report.options);
            }
            return await super.post(report.error ?? toError(original), report.options);
        } catch (error) {
            this.deps.logger.error('failed to post report', error);
            return this.failure(
                `BugSplat Error: ${error instanceof Error ? error.message : String(error)}`,
                original,
            );
        }
    }

    /** Crash the main process natively (test helper). */
    crash(): void {
        (this.deps.crash ?? (() => process.crash()))();
    }

    private failure(message: string, original: Error | string): BugSplatResponse {
        return { error: new Error(message), response: null, original };
    }
}
