import type { Disposable, Extension } from '@posthog/browser-common'
import type { FlagsExtension } from './flags-internal'
import type { StorageLike } from './types'
import type { SurveyCallback, DisplaySurveyOptions, SurveyRenderReason } from './surveys-options'

export interface SurveysHost {
    getFlagsContext?(): ReturnType<FlagsExtension['getSurveyContext']> | undefined
    storage: StorageLike | undefined
    key: string
    onSession(listener: (sessionId: string) => void): Disposable
}

export interface SurveysExtension extends Extension {
    getElementSelectors(): Set<string>
    initialize(host: SurveysHost): void
    getSurveys(callback: SurveyCallback, forceReload?: boolean): void
    getActiveMatchingSurveys(callback: SurveyCallback, forceReload?: boolean): void
    displaySurvey(id: string, options?: DisplaySurveyOptions): void
    canRenderSurvey(id: string, forceReload?: boolean): Promise<SurveyRenderReason>
    onSurveysLoaded(callback: SurveyCallback): Disposable
    cancelPendingSurvey(id: string): void
    reset(): void
}
