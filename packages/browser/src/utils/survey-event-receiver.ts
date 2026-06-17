import { SURVEYS_ACTIVATED } from '../constants'
import { Survey, SurveyEventName, SurveySchedule } from '../posthog-surveys-types'
import { PostHog } from '../posthog-core'
import { SURVEY_LOGGER as logger } from './survey-utils'
import { EventReceiver } from './event-receiver'
import { createLogger } from './logger'

// A survey is "repeatable" when it shows on every captured trigger: an "always" schedule, or the
// "Show every time the event is captured" option. Config-only (no dependency on the lazy-loaded
// surveys extension) so it stays out of the core bundle.
function isRepeatableSurvey(survey: Survey): boolean {
    const hasEvents = (survey.conditions?.events?.values?.length ?? 0) > 0
    return survey.schedule === SurveySchedule.Always || !!(survey.conditions?.events?.repeatedActivation && hasEvents)
}

export class SurveyEventReceiver extends EventReceiver<Survey> {
    constructor(instance: PostHog) {
        super(instance)
    }

    protected _getActivatedKey(): string {
        return SURVEYS_ACTIVATED
    }

    protected _getShownEventName(): string {
        return SurveyEventName.SHOWN
    }

    protected _getItems(callback: (items: Survey[]) => void): void {
        this._instance?.getSurveys(callback)
    }

    protected _cancelPendingItem(itemId: string): void {
        this._instance?.cancelPendingSurvey(itemId)
    }

    protected _getLogger(): ReturnType<typeof createLogger> {
        return logger
    }

    protected _setActivatedItems(eligibleItems: string[]): void {
        this._instance?.persistence?.register({ [SURVEYS_ACTIVATED]: eligibleItems })
    }

    protected _isItemPermanentlyIneligible(): boolean {
        // Surveys have complex eligibility rules checked at display time
        // For now, we don't filter at activation time
        return false
    }

    protected _shouldConsumeActivation(event: string, itemId: string): boolean {
        let survey: Survey | undefined
        this._getItems((surveys) => {
            survey = surveys.find((s) => s.id === itemId)
        })

        // Repeatable surveys are consumed when shown (one display per captured trigger). Non-repeatable
        // surveys instead stay activated — and get promoted to persistence — until the user dismisses or
        // answers them, so they survive a reload. An unresolvable survey (not loaded yet) is treated as
        // repeatable: consume it on shown rather than persist an unknown that could re-display later.
        const consumedOnShown = !survey || isRepeatableSurvey(survey)
        return consumedOnShown
            ? event === SurveyEventName.SHOWN
            : event === SurveyEventName.DISMISSED || event === SurveyEventName.SENT
    }

    // Backward compatibility - keep getSurveys() as alias for getActivatedIds()
    getSurveys(): string[] {
        return this.getActivatedIds()
    }

    // Backward compatibility - keep getEventToSurveys() as alias
    getEventToSurveys(): Map<string, string[]> {
        return this.getEventToItemsMap()
    }
}
