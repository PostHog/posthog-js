import type { DeepReadonly, Extension } from '@posthog/browser-common'
import type { IPostHog } from '../types'
import type { FeatureFlags } from '../../products/flags/flags-token'
import type { LogsExtension } from '../../products/logs/logs-internal'
import type { SurveysExtension } from '../../products/surveys/surveys-internal'
import type { ErrorTrackingExtension } from '../../products/error-tracking/error-tracking-internal'
import type { ConsentState } from '../state/state'

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

/** The shared extension contract, hosted by the browser client itself. */
export type BrowserExtension = Extension<IPostHog>

export interface BrowserProducts {
    featureFlags: FeatureFlags
    logs: LogsExtension
    surveys: SurveysExtension
    autocapture: BrowserExtension & { setElementSelectors(selectors: Set<string>): void }
    webVitals: BrowserExtension
    errorTracking: ErrorTrackingExtension
}
