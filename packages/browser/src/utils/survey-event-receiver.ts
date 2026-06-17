import { SURVEYS_ACTIVATED } from '../constants'
import { Survey, SurveyEventName, SurveySchedule } from '../posthog-surveys-types'
import { PostHog } from '../posthog-core'
import { SURVEY_LOGGER as logger } from './survey-utils'
import { EventReceiver } from './event-receiver'
import { createLogger } from './logger'

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

        // `_getItems` is expected to call back synchronously (surveys are cached by the time one is
        // shown). If the survey still can't be resolved, fall back to consuming on shown rather than
        // promoting an unknown survey into persistence, where it could re-display on later loads.
        if (!survey) {
            return event === SurveyEventName.SHOWN
        }

        // A survey is repeatable when it shows on every captured trigger ("Show every time the event
        // is captured", or an "always" schedule). Repeatable surveys are consumed when shown, so each
        // trigger shows them once. Non-repeatable surveys stay activated until dismissed or answered,
        // so they survive a page reload and re-display until the user actually interacts with them.
        const hasEvents = (survey.conditions?.events?.values?.length ?? 0) > 0
        const repeatable =
            survey.schedule === SurveySchedule.Always ||
            !!(survey.conditions?.events?.repeatedActivation && hasEvents)

        return repeatable
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
