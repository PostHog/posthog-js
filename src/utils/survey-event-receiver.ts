import { Survey } from '../posthog-surveys-types'
import { SURVEYS_ACTIVATED } from '../constants'

import { CaptureResult } from '../types'
import { ActionMatcher } from '../extensions/surveys/action-matcher'
import { PostHog } from '../posthog-core'
import { isUndefined } from './type-utils'

export class SurveyEventReceiver {
    // eventToSurveys is a mapping of event name to all the surveys that are activated by it
    private readonly eventToSurveys: Map<string, string[]>
    // actionToSurveys is a mapping of action name to all the surveys that are activated by it
    private readonly actionToSurveys: Map<string, string[]>
    // actionMatcher can look at CaptureResult payloads and match an event to its corresponding action.
    private actionMatcher?: ActionMatcher | null
    private readonly instance?: PostHog
    private static SURVEY_SHOWN_EVENT_NAME = 'survey shown'

    constructor(instance: PostHog) {
        this.instance = instance
        this.eventToSurveys = new Map<string, string[]>()
        this.actionToSurveys = new Map<string, string[]>()
    }

    register(surveys: Survey[]): void {
        if (isUndefined(this.instance?._addCaptureHook)) {
            return
        }

        this.setupEventBasedSurveys(surveys)
        this.setupActionBasedSurveys(surveys)
    }

    private setupActionBasedSurveys(surveys: Survey[]) {
        const actionBasedSurveys = surveys.filter(
            (survey: Survey) => survey.conditions?.actions && survey.conditions?.actions?.values?.length > 0
        )

        if (actionBasedSurveys.length === 0) {
            return
        }

        if (this.actionMatcher == null) {
            this.actionMatcher = new ActionMatcher(this.instance)
            this.actionMatcher.init()
            // match any actions to its corresponding survey.
            const matchActionToSurvey = (actionName: string) => {
                this.onAction(actionName)
            }

            this.actionMatcher._addActionHook(matchActionToSurvey)
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
                this.actionMatcher?.register(survey.conditions.actions.values)

                // maintain a mapping of (Action1) => [Survey1, Survey2, Survey3]
                // where Surveys 1-3 are all activated by Action1
                survey.conditions?.actions?.values?.forEach((action) => {
                    if (action && action.name) {
                        const knownSurveys: string[] | undefined = this.actionToSurveys.get(action.name)
                        if (knownSurveys) {
                            knownSurveys.push(survey.id)
                        }
                        this.actionToSurveys.set(action.name, knownSurveys || [survey.id])
                    }
                })
            }
        })
    }

    private setupEventBasedSurveys(surveys: Survey[]) {
        const eventBasedSurveys = surveys.filter(
            (survey: Survey) => survey.conditions?.events && survey.conditions?.events?.values?.length > 0
        )

        if (eventBasedSurveys.length === 0) {
            return
        }

        // match any events to its corresponding survey.
        const matchEventToSurvey = (eventName: string) => {
            this.onEvent(eventName)
        }
        this.instance?._addCaptureHook(matchEventToSurvey)

        surveys.forEach((survey) => {
            // maintain a mapping of (Event1) => [Survey1, Survey2, Survey3]
            // where Surveys 1-3 are all activated by Event1
            survey.conditions?.events?.values?.forEach((event) => {
                if (event && event.name) {
                    const knownSurveys: string[] | undefined = this.eventToSurveys.get(event.name)
                    if (knownSurveys) {
                        knownSurveys.push(survey.id)
                    }
                    this.eventToSurveys.set(event.name, knownSurveys || [survey.id])
                }
            })
        })
    }

    onEvent(event: string, eventPayload?: CaptureResult): void {
        const existingActivatedSurveys: string[] = this.instance?.persistence?.props[SURVEYS_ACTIVATED] || []
        if (
            SurveyEventReceiver.SURVEY_SHOWN_EVENT_NAME == event &&
            eventPayload &&
            existingActivatedSurveys.length > 0
        ) {
            // remove survey that from activatedSurveys here.
            const surveyId = eventPayload?.properties?.$survey_id
            if (surveyId) {
                const index = existingActivatedSurveys.indexOf(surveyId)
                if (index >= 0) {
                    existingActivatedSurveys.splice(index, 1)
                    this._updateActivatedSurveys(existingActivatedSurveys)
                }
            }
        } else {
            if (this.eventToSurveys.has(event)) {
                this._updateActivatedSurveys(existingActivatedSurveys.concat(this.eventToSurveys.get(event) || []))
            }
        }
    }

    onAction(actionName: string): void {
        const existingActivatedSurveys: string[] = this.instance?.persistence?.props[SURVEYS_ACTIVATED] || []
        if (this.actionToSurveys.has(actionName)) {
            this._updateActivatedSurveys(existingActivatedSurveys.concat(this.actionToSurveys.get(actionName) || []))
        }
    }

    private _updateActivatedSurveys(activatedSurveys: string[]) {
        // we use a new Set here to remove duplicates.
        this.instance?.persistence?.register({
            [SURVEYS_ACTIVATED]: [...new Set(activatedSurveys)],
        })
    }

    getSurveys(): string[] {
        const existingActivatedSurveys = this.instance?.persistence?.props[SURVEYS_ACTIVATED]
        return existingActivatedSurveys ? existingActivatedSurveys : []
    }

    getEventToSurveys(): Map<string, string[]> {
        return this.eventToSurveys
    }

    _getActionMatcher(): ActionMatcher | null | undefined {
        return this.actionMatcher
    }
}
