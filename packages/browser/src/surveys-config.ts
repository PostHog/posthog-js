import type { SurveyManager } from './extensions/surveys'
import type { SurveyEventReceiver } from './utils/survey-event-receiver'

export interface SurveysConfig {
    disableSurveys: boolean
    cookielessMode: boolean
    advancedEnableSurveys: boolean
    requestTimeoutMs: number
}

export interface SurveysExtensionHost {
    generateSurveys?: (isSurveysEnabled: boolean) => SurveyManager
    loadExternalDependency?: (callback: (error?: unknown) => void) => void
}

export interface SurveysConfigSource {
    get(): Readonly<SurveysConfig>
    isOptedOut(): boolean
    getExtensions(): SurveysExtensionHost | undefined
    createEventReceiver(): SurveyEventReceiver
}
