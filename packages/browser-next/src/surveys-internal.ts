import type { Disposable, Extension } from '@posthog/browser-common'
import type { SurveyCallback, DisplaySurveyOptions, SurveyRenderReason } from './surveys-options'

export interface SurveysExtension extends Extension {
    getSurveys(callback: SurveyCallback, forceReload?: boolean): void
    getActiveMatchingSurveys(callback: SurveyCallback, forceReload?: boolean): void
    displaySurvey(id: string, options?: DisplaySurveyOptions): void
    canRenderSurvey(id: string, forceReload?: boolean): Promise<SurveyRenderReason>
    onSurveysLoaded(callback: SurveyCallback): Disposable
    cancelPendingSurvey(id: string): void
    reset(): void
}
