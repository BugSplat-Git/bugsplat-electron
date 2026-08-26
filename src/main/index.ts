export { init, getClient, SDK_VERSION } from './init';
export { BugSplatElectron, type MainPostOptions } from './client';
export { preloadPath } from './preload-path';
export {
    JS_CALL_STACKS_FEATURE,
    DOCUMENT_POLICY_HEADER,
    DOCUMENT_POLICY_HEADER_NAME,
    DOCUMENT_POLICY_HEADER_VALUE,
    withJsCallStackPolicy,
} from './features';
export { buildSubmitUrl, ELECTRON_ENDPOINT_PATH } from './native';
export type {
    BugSplatElectronOptions,
    NativeOptions,
    PreloadOptions,
    MainProcessOptions,
    RendererCaptureOptions,
    ProcessGoneOptions,
    UnresponsiveOptions,
    GoneReason,
    TransportOption,
    PendingReport,
    BeforePostHook,
    TrustSender,
} from './options';
export type { Capabilities } from './capabilities';
export type { IdentitySnapshot, IdentityPatch } from '../shared/identity';
export type { Logger } from '../shared/logger';
export type { ReportOrigin } from '../shared/protocol';
export type { BugSplatOptions, BugSplatResponse, BugSplatAttachment } from 'bugsplat';
