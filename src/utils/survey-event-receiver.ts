import { Survey } from '../posthog-surveys-types'

export class SurveyEventReceiver {
    private eventRegistry: Map<string, string[]>
    private surveysActivatedKey = 'surveysActivated'

    constructor() {
        this.eventRegistry = new Map<string, string[]>()
    }

    register(surveys: Survey[]): void {
        surveys.forEach((survey) => {
            if (survey.events && survey.events.length > 0) {
                this.eventRegistry.set(survey.id, survey.events)
            }
        })
    }

    deRegister(survey: Survey): void {
        if (this.eventRegistry.has(survey.id)) {
            this.eventRegistry.delete(survey.id)
        }
    }

    on(event: string): void {
        const activatedSurveys: string[] = []

        this.eventRegistry.forEach((events, surveyID) => {
            if (events.includes(event)) {
                activatedSurveys.push(surveyID)
            }
        })

        const existingActivatedSurveys = sessionStorage.getItem(this.surveysActivatedKey)
        const existingSurveys: string[] = existingActivatedSurveys ? JSON.parse(existingActivatedSurveys) : []

        const updatedSurveys = existingSurveys.concat(activatedSurveys)
        sessionStorage.setItem(this.surveysActivatedKey, JSON.stringify(updatedSurveys))
    }

    getSurveys(): string[] {
        let surveys: string[] = []
        if (sessionStorage.getItem(this.surveysActivatedKey)) {
            surveys = JSON.parse(<string>sessionStorage.getItem(this.surveysActivatedKey)) as unknown as string[]
        }
        return surveys
    }

    removeSurvey(surveyID: string): void {
        let surveys: string[] = []
        if (sessionStorage.getItem(this.surveysActivatedKey)) {
            surveys = JSON.parse(<string>sessionStorage.getItem(this.surveysActivatedKey)) as unknown as string[]
        }

        if (surveys.indexOf(surveyID) >= 0) {
            surveys.splice(surveys.indexOf(surveyID), 1)
            sessionStorage.setItem(this.surveysActivatedKey, JSON.stringify(surveys))
        }
    }
}
