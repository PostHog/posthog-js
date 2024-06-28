import { Survey } from '../posthog-surveys-types'
import { PostHogPersistence } from '../posthog-persistence'
import { SURVEY_EVENTS_OBSERVED } from '../constants'

export class SurveyEventReceiver {
    private eventToSurveys: Map<string, string[]>
    private readonly persistence?: PostHogPersistence

    constructor(persistence?: PostHogPersistence) {
        this.persistence = persistence
        this.eventToSurveys = new Map<string, string[]>()
    }

    register(surveys: Survey[]): void {
        this.eventToSurveys = new Map<string, string[]>()

        surveys.forEach((survey) => {
            if (
                survey.conditions?.events &&
                survey.conditions?.events?.values &&
                survey.conditions?.events.values.length > 0
            ) {
                survey.conditions?.events.values.forEach((event) => {
                    const knownSurveys = this.eventToSurveys.get(event.name) || []
                    knownSurveys.push(survey.id)
                    this.eventToSurveys.set(event.name, knownSurveys)
                })
            }
        })
    }

    on(event: string): void {
        const observedEvents = this.persistence?.props[SURVEY_EVENTS_OBSERVED] || []
        observedEvents.push(event)
        this._saveEventsToStorage(observedEvents)
    }

    getSurveys(): string[] {
        const observedEvents = this.persistence?.props[SURVEY_EVENTS_OBSERVED]
        const activatedSurveys: string[] = []
        observedEvents?.forEach((event: string) => {
            activatedSurveys.push(...(this.eventToSurveys?.get(event) || []))
        })

        // we use a set here to dedupe the surveys since multiple events
        // can activate the same survey.
        return Array.from(new Set(activatedSurveys))
    }

    getEventToSurveys(): Map<string, string[]> {
        return this.eventToSurveys
    }

    private _saveEventsToStorage(surveys: string[]): void {
        // we use a new Set here to remove duplicates.
        this.persistence?.register({
            [SURVEY_EVENTS_OBSERVED]: [...new Set(surveys)],
        })
    }
}
