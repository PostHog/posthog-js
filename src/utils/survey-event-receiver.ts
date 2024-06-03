import { Survey } from '../posthog-surveys-types'

export class SurveyEventReceiver {
    public events: string[]
    private eventRegistry: Map<string, string[]>
    private surveysActivatedKey = 'surveysActivated'

    constructor() {
        this.events = []
        this.eventRegistry = new Map<string, string[]>()
    }

    register(surveys: Survey[]): void {
        // let eventRegistry: Map<string, string[]>
        surveys.forEach((survey) => {
            if (survey.events && survey.events.length > 0) {
                this.eventRegistry.set(survey.id, survey.events)
            }
        })
    }

    deRegister(survey: Survey): void {
        if (this.eventRegistry.has(survey.id)) {
            this.eventRegistry.delete(survey.id)
            this.removeSurvey(survey.id)
        }
    }

    on(event: string): void {
        this.events.push(event)
        const activatedSurveys: string[] = []
        this.eventRegistry.forEach((events, surveyID) => {
            if (events.includes(event)) {
                activatedSurveys.push(surveyID)
            }
        })

        let surveys: string[] = []
        if (sessionStorage.getItem(this.surveysActivatedKey)) {
            surveys = JSON.parse(<string>sessionStorage.getItem(this.surveysActivatedKey)) as unknown as string[]
        }
        surveys.concat(activatedSurveys)
        sessionStorage.setItem(this.surveysActivatedKey, JSON.stringify(surveys))
    }

    getSurveys(): string[] {
        let surveys: string[] = []
        if (sessionStorage.getItem(this.surveysActivatedKey)) {
            surveys = JSON.parse(<string>sessionStorage.getItem(this.surveysActivatedKey)) as unknown as string[]
        }
        return surveys.concat(this.events)
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
