import { Survey } from '../posthog-surveys-types'
import { PostHogPersistence } from '../posthog-persistence'
import { SURVEYS_ACTIVATED } from '../constants'

export class SurveyEventReceiver {
    private readonly eventRegistry: Map<string, string[]>
    private readonly persistence?: PostHogPersistence

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

    on(event: string): void {
        const activatedSurveys: string[] = []

        this.eventRegistry.forEach((events, surveyID) => {
            if (events.includes(event)) {
                activatedSurveys.push(surveyID)
            }
        })

        const existingActivatedSurveys = this.persistence?.props[SURVEYS_ACTIVATED]
        const existingSurveys: string[] = existingActivatedSurveys ? existingActivatedSurveys : []
        const updatedSurveys = existingSurveys.concat(activatedSurveys)
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
