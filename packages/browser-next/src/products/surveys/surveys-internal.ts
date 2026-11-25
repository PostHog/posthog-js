import type { Disposable } from '@posthog/browser-common'
import type { BrowserExtension } from '../../core/context/browser-client'
import type { SurveyCallback, DisplaySurveyOptions, SurveyRenderReason } from './surveys-options'

export interface SurveysExtension extends BrowserExtension {
    getElementSelectors(): Set<string>
    getSurveys(callback: SurveyCallback, forceReload?: boolean): void
    getActiveMatchingSurveys(callback: SurveyCallback, forceReload?: boolean): void
    displaySurvey(id: string, options?: DisplaySurveyOptions): void
    canRenderSurvey(id: string, forceReload?: boolean): Promise<SurveyRenderReason>
    onSurveysLoaded(callback: SurveyCallback): Disposable
    /**
     * Observe the set of active matching surveys. Delivers the current set once loaded, then changes after
     * event and action triggers, captured pageviews, survey display and responses, feature-flag updates,
     * definition refreshes and reset. Unchanged results are not delivered again.
     */
    onActiveMatchingSurveysChanged(callback: SurveyCallback): Disposable
    cancelPendingSurvey(id: string): void
    reset(): void
}
