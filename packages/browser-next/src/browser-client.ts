import type { Client, DeepReadonly, Extension, ExtensionToken, Listener } from '@posthog/browser-common'
import type { IAnalytics } from './analytics-api'
import type { IAnalyticsExtension } from './analytics-internal'
import type { FeatureFlags } from './flags-token'
import type { FlagsExtension } from './flags-internal'
import type { LogsExtension } from './logs-internal'
import type { SurveysExtension } from './surveys-internal'
import type { ConsentState } from './state'

export interface IdentifyInfo {
    readonly distinctId: string
    readonly previousDistinctId: string
    readonly wasIdentified: boolean
    readonly set: DeepReadonly<Record<string, unknown>> | undefined
    readonly setOnce: DeepReadonly<Record<string, unknown>> | undefined
    readonly unset?: readonly string[]
}

export interface ChangePropertiesInfo {
    readonly set?: DeepReadonly<Record<string, unknown>> | undefined
    readonly setOnce?: DeepReadonly<Record<string, unknown>> | undefined
    readonly unset?: readonly string[]
}

export interface GroupInfo {
    readonly type: string
    readonly key: string
    readonly changed: boolean
    readonly properties: DeepReadonly<Record<string, unknown>> | undefined
}

export interface ConsentChangeInfo {
    readonly current: ConsentState
    readonly previous: ConsentState
}

export type BrowserExtension = Extension<IPostHogInternal>

export interface BrowserProducts {
    analytics: IAnalytics
    featureFlags: FeatureFlags
    logs: LogsExtension
    surveys: SurveysExtension
    autocapture: BrowserExtension & { setElementSelectors(selectors: Set<string>): void }
}

export interface InternalBrowserProducts extends BrowserProducts {
    analytics: IAnalyticsExtension
    featureFlags: FlagsExtension
}

export type BrowserExtensionAccess<Products extends BrowserProducts = BrowserProducts> = Readonly<Partial<Products>> & {
    resolveExtension<T extends BrowserExtension>(token: ExtensionToken<T>): Promise<T | undefined>
    resolveExtension<Name extends keyof Products>(name: Name): Promise<Products[Name] | undefined>
    resolveExtension<T extends BrowserExtension = BrowserExtension>(name: string): Promise<T | undefined>
}

/** Shared Core capabilities, without application administration or product controls. */
export interface ICoreCapabilities extends Omit<
    Client,
    'getExtension' | 'capture' | 'registerDynamicEventProperties' | 'isRateLimited' | 'onEvent'
> {
    /** Fires when consent changes, including changes observed from another tab. Does not replay. */
    readonly onConsentChange: Listener<ConsentChangeInfo>
    /** Fires after identification, independently of capture consent. Does not replay. */
    readonly onIdentify: Listener<IdentifyInfo>
    /** Fires after group membership or property updates, independently of capture consent. Does not replay. */
    readonly onGroup: Listener<GroupInfo>
    /** Fires after local identity and persisted extension state are reset. Does not replay. */
    readonly onReset: Listener<void>
}

/** SDK-internal scoped view; shared implementations receive a separate Client adapter. */
export interface IPostHogInternal extends ICoreCapabilities, BrowserExtensionAccess<InternalBrowserProducts> {
    readonly sharedClient: Client
    /** Local person-property changes, independently of capture consent. Does not replay. */
    readonly onChangeProperties: Listener<ChangePropertiesInfo>
    readonly onEvent: Client['onEvent']
}
