import { Survey } from '../posthog-surveys-types'
import { PostHogPersistence } from '../posthog-persistence'
import { SURVEYS_ACTIVATED } from '../constants'
import { CaptureResult } from '../types'

export class SurveyEventReceiver {
    private readonly eventRegistry: Map<string, string[]>
    private readonly persistence?: PostHogPersistence
    private static SURVEY_SHOWN_EVENT_NAME = 'survey shown'

    constructor(persistence?: PostHogPersistence) {
        this.persistence = persistence
        this.eventRegistry = new Map<string, string[]>()
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
    }

    on(event: string, eventPayload?: CaptureResult): void {
        const activatedSurveys: string[] = []
        const existingActivatedSurveys: string[] = this.persistence?.props[SURVEYS_ACTIVATED] || []

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
                }
            }
        } else {
            this.eventRegistry.forEach((events, surveyID) => {
                if (events.includes(event)) {
                    activatedSurveys.push(surveyID)
                }
            })
        }

        const updatedSurveys = existingActivatedSurveys.concat(activatedSurveys)
        this._saveSurveysToStorage(updatedSurveys)
    }

    getSurveys(): string[] {
        const existingActivatedSurveys = this.persistence?.props[SURVEYS_ACTIVATED]
        return existingActivatedSurveys ? existingActivatedSurveys : []
    }

    getEventRegistry(): Map<string, string[]> {
        return this.eventRegistry
    }

    private _saveSurveysToStorage(surveys: string[]): void {
        // we use a new Set here to remove duplicates.
        this.persistence?.register({
            [SURVEYS_ACTIVATED]: [...new Set(surveys)],
        })
    }
}
