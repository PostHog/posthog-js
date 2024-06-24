import { Survey } from '../posthog-surveys-types'
import { SURVEYS_ACTIVATED } from '../constants'
import { ActionMatcher } from '../extensions/surveys/action-matcher'
import { PostHog } from '../posthog-core'
import { CaptureResult } from '../types'

export class SurveyEventReceiver {
    private readonly eventRegistry: Map<string, string[]>
    private readonly actionRegistry: Map<string, number[]>
    private actionMatcher?: ActionMatcher | null
    private readonly instance?: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
        this.eventRegistry = new Map<string, string[]>()
        this.actionRegistry = new Map<string, number[]>()
    }

    register(surveys: Survey[]): void {
        surveys.forEach((survey) => {
            if (
                survey.conditions?.events &&
                survey.conditions?.events?.values &&
                survey.conditions?.events.values.length > 0
            ) {
                this.eventRegistry.set(
                    survey.id,
                    survey.conditions?.events.values.map((e) => e.name)
                )
            }
        })

        const actionBasedSurveys = surveys.filter(
            (survey: Survey) => survey.conditions?.actions && survey.conditions?.actions?.length > 0
        )

        if (actionBasedSurveys.length > 0) {
            if (this.actionMatcher == null) {
                this.actionMatcher = new ActionMatcher(this.instance)
                this.actionMatcher.init()
                const withAction = (actionId: number) => {
                    this.onAction(actionId)
                }

                this.actionMatcher._addActionHook(withAction)
            }

            actionBasedSurveys.forEach((survey) => {
                if (survey.conditions && survey.conditions?.actions && survey.conditions.actions.length > 0) {
                    this.actionMatcher?.register(survey.conditions.actions)
                    this.actionRegistry.set(
                        survey.id,
                        survey.conditions?.actions.map((e) => e.id)
                    )
                }
            })
        }
    }

    onEvent(event: string, eventPayload?: CaptureResult): void {
        const activatedSurveys: string[] = []

        this.eventRegistry.forEach((events, surveyID) => {
            if (events.includes(event)) {
                activatedSurveys.push(surveyID)
            }
        })

        this._updateActivatedSurveys(activatedSurveys)
        this.actionMatcher?.on(event, eventPayload)
    }

    onAction(actionID: any): void {
        const activatedSurveys: string[] = []

        this.actionRegistry.forEach((actions, surveyID) => {
            if (actions.includes(actionID)) {
                activatedSurveys.push(surveyID)
            }
        })
        this._updateActivatedSurveys(activatedSurveys)
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

    getEventRegistry(): Map<string, string[]> {
        return this.eventRegistry
    }
}
