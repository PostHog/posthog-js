import { SURVEYS_ACTIVATED } from '../constants'
import { Survey, SurveyEventName, SurveySchedule } from '../posthog-surveys-types'
import { PostHog } from '../posthog-core'
import { SURVEY_LOGGER as logger } from './survey-utils'
import { EventReceiver } from './event-receiver'
import { createLogger } from './logger'

/**
 * A survey is "repeatable" when it is configured to display on every captured trigger
 * (the "Show every time the event is captured" toggle, or an "always" schedule).
 *
 * This intentionally mirrors only the *config-based* part of `canActivateRepeatedly` from
 * surveys-extension-utils — it deliberately omits the in-progress check, and it must stay
 * config-only so this core-bundle module doesn't import the lazy-loaded surveys extension.
 */
function isSurveyRepeatable(survey: Survey): boolean {
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

    protected _shouldDeactivateOnShown(itemId: string): boolean {
        // Repeatable surveys are consumed on display, so each captured trigger shows them once.
        // Non-repeatable surveys stay activated until the user dismisses or responds — keeping the
        // activation in persistence means an event-triggered survey survives a page reload and
        // re-displays until it's actually interacted with.
        let survey: Survey | undefined
        this._getItems((surveys) => {
            survey = surveys.find((s) => s.id === itemId)
        })
        return survey ? isSurveyRepeatable(survey) : true
    }

    protected _getInteractionEventNames(): string[] {
        return [SurveyEventName.DISMISSED, SurveyEventName.SENT]
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
