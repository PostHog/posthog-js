import { SURVEYS_ACTIVATED } from '../constants'
import { Survey, SurveyEventName } from '../posthog-surveys-types'
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

    protected _isItemPermanentlyIneligible(): boolean {
        // Surveys have complex eligibility rules checked at display time
        // For now, we don't filter at activation time
        return false
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
