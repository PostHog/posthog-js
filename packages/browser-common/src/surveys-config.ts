import type { Properties } from '@posthog/types'
import type { Survey, SurveyCallback, DisplaySurveyPopoverOptions } from './types/surveys'

export const SURVEYS = '$surveys'
export const SURVEYS_LOADED_AT = '$surveys_loaded_at'
// How long the cached `$surveys` definitions are considered fresh. After this, the next
// `getSurveys` call serves the cache immediately but kicks off a background refresh so
// server-side changes (e.g. a survey switched from popover to API) propagate to a
// long-lived tab without needing a page reload.
export const SURVEYS_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
// After a failed background refresh we back off for the same window as the cache TTL before
// trying again. Aliased to make the shared duration intentional rather than coincidental.
export const SURVEYS_REFRESH_BACKOFF_MS = SURVEYS_CACHE_TTL_MS
export const LOAD_EXT_NOT_FOUND = 'PostHog loadExternalDependency extension not found.'

export interface SurveysConfig {
    disableSurveys: boolean
    cookielessMode: boolean
    advancedEnableSurveys: boolean
    requestTimeoutMs: number
}

/** Rendering and eligibility operations used by the surveys lifecycle. */
export interface SurveysManager {
    clearInMemoryInProgressSurveyState?(): void
    getActiveMatchingSurveys(callback: SurveyCallback, forceReload?: boolean): void
    checkSurveyEligibility(survey: Survey): { eligible: boolean; reason?: string }
    checkSurveyRenderability(survey: Survey): { eligible: boolean; reason?: string }
    renderSurvey(survey: Survey, element: Element, properties?: Properties): void
    handlePopoverSurvey(survey: Survey, options?: DisplaySurveyPopoverOptions): void
    cancelSurvey(surveyId: string): void
    handlePageUnload?(): void
    dispose?(): void
}

/** Trigger state owned by the host's event/action receiver. */
export interface SurveysEventReceiver {
    register(surveys: Survey[]): void
    reset(): void
    dispose(): void
    getSurveys(): string[]
    getActivationTimestamp(surveyId: string): number | undefined
}

export interface SurveysExtensionHost {
    generateSurveys?: ((isSurveysEnabled: boolean) => SurveysManager) | undefined
    loadExternalDependency?: ((callback: (error?: unknown) => void) => void) | undefined
}

export interface SurveysConfigSource {
    get(): Readonly<SurveysConfig>
    isOptedOut(): boolean
    isCapturing(): boolean
    getExtensions(): SurveysExtensionHost | undefined
    createEventReceiver(): SurveysEventReceiver
}
