import { Survey } from '../posthog-surveys-types'
import { SURVEYS_ACTIVATED } from '../constants'
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

                this.actionToSurveys.set(
                    survey.id,
                    survey.conditions?.actions?.values?.map((e) => e.name!)
                )
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

    onEvent(event: string): void {
        if (this.eventToSurveys.has(event)) {
            this._updateActivatedSurveys(this.eventToSurveys.get(event) || [])
        }
    }

    onAction(actionName: string): void {
        if (this.actionToSurveys.has(actionName)) {
            this._updateActivatedSurveys(this.actionToSurveys.get(actionName) || [])
        }
    }

    private _updateActivatedSurveys(activatedSurveys: string[]) {
        const existingActivatedSurveys = this.instance?.persistence?.props[SURVEYS_ACTIVATED]
        const existingSurveys: string[] = existingActivatedSurveys ? existingActivatedSurveys : []
        const updatedSurveys = existingSurveys.concat(activatedSurveys)
        // we use a new Set here to remove duplicates.
        this.instance?.persistence?.register({
            [SURVEYS_ACTIVATED]: [...new Set(updatedSurveys)],
        })
    }

    getSurveys(): string[] {
        const existingActivatedSurveys = this.instance?.persistence?.props[SURVEYS_ACTIVATED]
        return existingActivatedSurveys ? existingActivatedSurveys : []
    }

    geteventToSurveys(): Map<string, string[]> {
        return this.eventToSurveys
    }

    _getActionMatcher(): ActionMatcher | null | undefined {
        return this.actionMatcher
    }
}
