import { SURVEYS_ACTIVATED } from '../constants'
import { Survey } from '../posthog-surveys-types'

import { ActionMatcher } from '../extensions/surveys/action-matcher'
import { PostHog } from '../posthog-core'
import { CaptureResult } from '../types'
import { SURVEY_LOGGER as logger } from './survey-utils'
import { isUndefined } from '@posthog/core'

const SURVEY_SHOWN_EVENT_NAME = 'survey shown'

export class SurveyEventReceiver {
    // eventToSurveys is a mapping of event name to all the surveys that are activated by it
    private readonly _eventToSurveys: Map<string, string[]>
    // actionToSurveys is a mapping of action name to all the surveys that are activated by it
    private readonly _actionToSurveys: Map<string, string[]>
    // actionMatcher can look at CaptureResult payloads and match an event to its corresponding action.
    private _actionMatcher?: ActionMatcher | null
    private readonly _instance?: PostHog

    constructor(instance: PostHog) {
        this._instance = instance
        this._eventToSurveys = new Map<string, string[]>()
        this._actionToSurveys = new Map<string, string[]>()
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

        if (eventBasedSurveys.length === 0) {
            return
        }

        // match any events to its corresponding survey.
        const matchEventToSurvey = (eventName: string, eventPayload?: CaptureResult) => {
            this.onEvent(eventName, eventPayload)
        }
        this._instance?._addCaptureHook(matchEventToSurvey)

        surveys.forEach((survey) => {
            // maintain a mapping of (Event1) => [Survey1, Survey2, Survey3]
            // where Surveys 1-3 are all activated by Event1
            survey.conditions?.events?.values?.forEach((event) => {
                if (event && event.name) {
                    const knownSurveys: string[] | undefined = this._eventToSurveys.get(event.name)
                    if (knownSurveys) {
                        knownSurveys.push(survey.id)
                    }
                    this._eventToSurveys.set(event.name, knownSurveys || [survey.id])
                }
            })
        })
    }

    onEvent(event: string, eventPayload?: CaptureResult): void {
        const existingActivatedSurveys: string[] = this._instance?.persistence?.props[SURVEYS_ACTIVATED] || []
        if (SURVEY_SHOWN_EVENT_NAME === event && eventPayload && existingActivatedSurveys.length > 0) {
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
        } else {
            if (this._eventToSurveys.has(event)) {
                logger.info('survey event matched, updating activated surveys', {
                    event,
                    surveys: this._eventToSurveys.get(event),
                })
                this._updateActivatedSurveys(existingActivatedSurveys.concat(this._eventToSurveys.get(event) || []))
            }
        }
    }

    onAction(actionName: string): void {
        const existingActivatedSurveys: string[] = this._instance?.persistence?.props[SURVEYS_ACTIVATED] || []
        if (this._actionToSurveys.has(actionName)) {
            this._updateActivatedSurveys(existingActivatedSurveys.concat(this._actionToSurveys.get(actionName) || []))
        }
    }

    private _updateActivatedSurveys(activatedSurveys: string[]) {
        // we use a new Set here to remove duplicates.
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
