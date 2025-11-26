import { SURVEYS_ACTIVATED } from '../constants'
import { Survey, SurveyEventName, SurveyEventType, SurveyEventWithFilters } from '../posthog-surveys-types'

import { ActionMatcher } from '../extensions/surveys/action-matcher'
import { PostHog } from '../posthog-core'
import { CaptureResult } from '../types'
import { SURVEY_LOGGER as logger } from './survey-utils'
import { propertyComparisons } from './property-utils'
import { isNull, isUndefined } from '@posthog/core'

export class SurveyEventReceiver {
    // eventToSurveys is a mapping of event name to all the surveys that are activated by it
    private _eventToSurveys: Map<string, string[]>
    // cancelEventToSurveys is a mapping of event name to all the surveys that should be cancelled by it
    private _cancelEventToSurveys: Map<string, string[]>
    // actionToSurveys is a mapping of action name to all the surveys that are activated by it
    private readonly _actionToSurveys: Map<string, string[]>
    // actionMatcher can look at CaptureResult payloads and match an event to its corresponding action.
    private _actionMatcher?: ActionMatcher | null
    private readonly _instance?: PostHog

    constructor(instance: PostHog) {
        this._instance = instance
        this._eventToSurveys = new Map<string, string[]>()
        this._cancelEventToSurveys = new Map<string, string[]>()
        this._actionToSurveys = new Map<string, string[]>()
    }

    private _doesEventMatchFilter(
        eventConfig: SurveyEventWithFilters | undefined,
        eventPayload?: CaptureResult
    ): boolean {
        if (!eventConfig) {
            return false
        }

        // if there are no property filters, it means we're only matching on event name
        if (!eventConfig.propertyFilters) {
            return true
        }

        return Object.entries(eventConfig.propertyFilters).every(([propertyName, filter]) => {
            const eventPropertyValue = eventPayload?.properties?.[propertyName]
            if (isUndefined(eventPropertyValue) || isNull(eventPropertyValue)) {
                return false
            }

            // convert event property to string for comparison
            const eventValues = [String(eventPropertyValue)]

            const comparisonFunction = propertyComparisons[filter.operator]
            if (!comparisonFunction) {
                logger.warn(`Unknown property comparison operator: ${filter.operator}`)
                return false
            }

            return comparisonFunction(filter.values, eventValues)
        })
    }

    private _buildEventToSurveyMap(surveys: Survey[], conditionField: SurveyEventType): Map<string, string[]> {
        const map = new Map<string, string[]>()
        surveys.forEach((survey) => {
            survey.conditions?.[conditionField]?.values?.forEach((event) => {
                if (event?.name) {
                    const existing = map.get(event.name) || []
                    existing.push(survey.id)
                    map.set(event.name, existing)
                }
            })
        })
        return map
    }

    /**
     * build a map of (Event1) => [Survey1, Survey2, Survey3]
     * used for surveys that should be [activated|cancelled] by Event1
     */
    private _getMatchingSurveys(
        eventName: string,
        eventPayload: CaptureResult | undefined,
        conditionField: SurveyEventType
    ): Survey[] {
        const surveyIdMap =
            conditionField === SurveyEventType.Activation ? this._eventToSurveys : this._cancelEventToSurveys
        const surveyIds = surveyIdMap.get(eventName)

        let surveys: Survey[] = []
        this._instance?.getSurveys((allSurveys) => {
            surveys = allSurveys.filter((survey) => surveyIds?.includes(survey.id))
        })

        return surveys.filter((survey) => {
            const eventConfig = survey.conditions?.[conditionField]?.values?.find((e) => e.name === eventName)
            return this._doesEventMatchFilter(eventConfig, eventPayload)
        })
    }

    register(surveys: Survey[]): void {
        if (isUndefined(this._instance?._addCaptureHook)) {
            return
        }

        this._setupEventBasedSurveys(surveys)
        this._setupActionBasedSurveys(surveys)
    }

    private _setupActionBasedSurveys(surveys: Survey[]) {
        const actionBasedSurveys = surveys.filter(
            (survey: Survey) => survey.conditions?.actions && survey.conditions?.actions?.values?.length > 0
        )

        if (actionBasedSurveys.length === 0) {
            return
        }

        if (this._actionMatcher == null) {
            this._actionMatcher = new ActionMatcher(this._instance)
            this._actionMatcher.init()
            // match any actions to its corresponding survey.
            const matchActionToSurvey = (actionName: string) => {
                this.onAction(actionName)
            }

            this._actionMatcher._addActionHook(matchActionToSurvey)
        }

        actionBasedSurveys.forEach((survey) => {
            if (
                survey.conditions &&
                survey.conditions?.actions &&
                survey.conditions?.actions?.values &&
                survey.conditions?.actions?.values?.length > 0
            ) {
                // register the known set of actions with
                // the action-matcher so it can match
                // events to actions
                this._actionMatcher?.register(survey.conditions.actions.values)

                // maintain a mapping of (Action1) => [Survey1, Survey2, Survey3]
                // where Surveys 1-3 are all activated by Action1
                survey.conditions?.actions?.values?.forEach((action) => {
                    if (action && action.name) {
                        const knownSurveys: string[] | undefined = this._actionToSurveys.get(action.name)
                        if (knownSurveys) {
                            knownSurveys.push(survey.id)
                        }
                        this._actionToSurveys.set(action.name, knownSurveys || [survey.id])
                    }
                })
            }
        })
    }

    private _setupEventBasedSurveys(surveys: Survey[]) {
        const eventBasedSurveys = surveys.filter(
            (survey: Survey) => survey.conditions?.events && survey.conditions?.events?.values?.length > 0
        )

        const surveysWithCancelEvents = surveys.filter(
            (survey: Survey) => survey.conditions?.cancelEvents && survey.conditions?.cancelEvents?.values?.length > 0
        )

        if (eventBasedSurveys.length === 0 && surveysWithCancelEvents.length === 0) {
            return
        }

        // match any events to its corresponding survey.
        const matchEventToSurvey = (eventName: string, eventPayload?: CaptureResult) => {
            this.onEvent(eventName, eventPayload)
        }
        this._instance?._addCaptureHook(matchEventToSurvey)

        this._eventToSurveys = this._buildEventToSurveyMap(surveys, SurveyEventType.Activation)
        this._cancelEventToSurveys = this._buildEventToSurveyMap(surveys, SurveyEventType.Cancellation)
    }

    onEvent(event: string, eventPayload?: CaptureResult): void {
        const existingActivatedSurveys: string[] = this._instance?.persistence?.props[SURVEYS_ACTIVATED] || []
        if (SurveyEventName.SHOWN === event && eventPayload && existingActivatedSurveys.length > 0) {
            // remove survey that from activatedSurveys here.
            logger.info('survey event matched, removing survey from activated surveys', {
                event,
                eventPayload,
                existingActivatedSurveys,
            })
            const surveyId = eventPayload?.properties?.$survey_id
            if (surveyId) {
                const index = existingActivatedSurveys.indexOf(surveyId)
                if (index >= 0) {
                    existingActivatedSurveys.splice(index, 1)
                    this._updateActivatedSurveys(existingActivatedSurveys)
                }
            }

            return
        }

        // check if this event should cancel any pending surveys
        if (this._cancelEventToSurveys.has(event)) {
            const surveysToCancel = this._getMatchingSurveys(event, eventPayload, SurveyEventType.Cancellation)

            if (surveysToCancel.length > 0) {
                logger.info('cancel event matched, cancelling surveys', {
                    event,
                    surveysToCancel: surveysToCancel.map((s) => s.id),
                })

                surveysToCancel.forEach((survey) => {
                    // remove from activated surveys
                    const index = existingActivatedSurveys.indexOf(survey.id)
                    if (index >= 0) {
                        existingActivatedSurveys.splice(index, 1)
                    }
                    // cancel any pending timeout for this survey
                    this._instance?.cancelPendingSurvey(survey.id)
                })

                this._updateActivatedSurveys(existingActivatedSurveys)
            }
        }

        // if the event is not in the eventToSurveys map, nothing else to do
        if (!this._eventToSurveys.has(event)) {
            return
        }

        logger.info('survey event name matched', {
            event,
            eventPayload,
            surveys: this._eventToSurveys.get(event),
        })

        const matchedSurveys = this._getMatchingSurveys(event, eventPayload, SurveyEventType.Activation)

        this._updateActivatedSurveys(existingActivatedSurveys.concat(matchedSurveys.map((survey) => survey.id) || []))
    }

    onAction(actionName: string): void {
        const existingActivatedSurveys: string[] = this._instance?.persistence?.props[SURVEYS_ACTIVATED] || []
        if (this._actionToSurveys.has(actionName)) {
            this._updateActivatedSurveys(existingActivatedSurveys.concat(this._actionToSurveys.get(actionName) || []))
        }
    }

    private _updateActivatedSurveys(activatedSurveys: string[]) {
        // we use a new Set here to remove duplicates.
        logger.info('updating activated surveys', {
            activatedSurveys,
        })

        this._instance?.persistence?.register({
            [SURVEYS_ACTIVATED]: [...new Set(activatedSurveys)],
        })
    }

    getSurveys(): string[] {
        const existingActivatedSurveys = this._instance?.persistence?.props[SURVEYS_ACTIVATED]
        return existingActivatedSurveys ? existingActivatedSurveys : []
    }

    getEventToSurveys(): Map<string, string[]> {
        return this._eventToSurveys
    }

    _getActionMatcher(): ActionMatcher | null | undefined {
        return this._actionMatcher
    }
}
