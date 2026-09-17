import type { Properties, FeatureFlagOptions, IsFeatureEnabledOptions } from '@posthog/types'
import type { Survey, SurveyCallback } from './types/surveys'
import type { SurveysEventReceiver } from './surveys-config'

export interface SurveyStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/** Capabilities consumed by the survey renderer, independent of either SDK's public facade. */
export interface SurveysRuntimeHost {
    readonly canCapture: boolean
    readonly prefillFromUrl: boolean
    readonly automaticDisplay: boolean
    readonly hasLoadedFlags: boolean
    readonly featureFlagEvaluation: boolean
    readonly overrideLanguage: string | null | undefined
    readonly storedPersonProperties: Properties | undefined
    readonly eventReceiver: SurveysEventReceiver | null | undefined
    getCachedSurveys(): Survey[] | undefined
    readonly storage: SurveyStorage
    capture(event: string, properties?: Properties, options?: { transport?: 'sendBeacon' }): void
    getSurveys(callback: SurveyCallback, forceReload?: boolean): void
    onFlags(callback: () => void): () => void
    getFlag(key: string, options?: FeatureFlagOptions): string | boolean | undefined
    isFlagEnabled(key: string, options?: IsFeatureEnabledOptions): boolean | undefined
    reloadFlags(): void
    getReplayUrl(): string | undefined
    getTargetingUrl(): string | undefined
    prepareStylesheet: ((stylesheet: HTMLStyleElement) => HTMLStyleElement | null) | undefined
    createSubmissionId(): string
}
