import { canSurveyActivateRepeatedly } from '@posthog/core/surveys'
import { isNumber } from '@posthog/core'
import { SURVEYS_ACTIVATED, SURVEYS_ACTIVATED_SESSION, SURVEYS_ACTIVATED_TIMESTAMPS } from '../constants'
import { Survey, SurveyEventName } from '../posthog-surveys-types'
import type { PostHog } from '../posthog-core'
import { SURVEY_LOGGER as logger } from './survey-utils'
import { ActivationOutcome, EventReceiver } from './event-receiver'
import { createLogger } from '@posthog/browser-common/utils/logger'

export class SurveyEventReceiver extends EventReceiver<Survey> {
    constructor(instance: PostHog) {
        super(instance)
    }

    protected _getActivatedKey(): string {
        return SURVEYS_ACTIVATED
    }

    protected _getActivatedSessionKey(): string {
        return SURVEYS_ACTIVATED_SESSION
    }

    protected _getActivationTimestampsKey(): string {
        return SURVEYS_ACTIVATED_TIMESTAMPS
    }

    protected _writeActivationTimestamps(timestamps: Record<string, number>): void {
        this._instance?.persistence?.register({ [SURVEYS_ACTIVATED_TIMESTAMPS]: timestamps })
    }

    protected _clearActivationTimestampsStore(): void {
        this._instance?.persistence?.unregister(SURVEYS_ACTIVATED_TIMESTAMPS)
    }

    /**
     * A survey with a popup delay must survive navigation so the delay resumes from the recorded
     * activation time on the next page instead of restarting from zero. Surveys without a delay
     * keep the in-memory arming, so an exit-intent trigger does not surface them on a later page.
     */
    protected _shouldPersistArmedActivation(itemId: string): boolean {
        let survey: Survey | undefined
        this._getItems((surveys) => {
            survey = surveys.find((s) => s.id === itemId)
        })
        const delaySeconds = survey?.appearance?.surveyPopupDelaySeconds
        return isNumber(delaySeconds) && delaySeconds > 0
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

    protected _setActivatedSession(sessionId: string): void {
        this._instance?.persistence?.register({ [SURVEYS_ACTIVATED_SESSION]: sessionId })
    }

    protected _clearActivatedSession(): void {
        this._instance?.persistence?.unregister(SURVEYS_ACTIVATED_SESSION)
    }

    protected _isItemPermanentlyIneligible(): boolean {
        // Surveys have complex eligibility rules checked at display time
        // For now, we don't filter at activation time
        return false
    }

    protected _activationOutcome(event: string, itemId: string): ActivationOutcome {
        let survey: Survey | undefined
        this._getItems((surveys) => {
            survey = surveys.find((s) => s.id === itemId)
        })

        // A repeatable survey (or one we can't resolve yet) shows once per trigger, so it's consumed
        // when shown. A non-repeatable survey is instead promoted to persistence on shown — so it
        // survives a reload — and only consumed once the user dismisses or answers it.
        const consumedOnShown = !survey || canSurveyActivateRepeatedly(survey)
        if (consumedOnShown) {
            return event === SurveyEventName.SHOWN ? 'consume' : 'ignore'
        }
        if (event === SurveyEventName.SHOWN) {
            return 'persist'
        }
        return event === SurveyEventName.DISMISSED || event === SurveyEventName.SENT ? 'consume' : 'ignore'
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
