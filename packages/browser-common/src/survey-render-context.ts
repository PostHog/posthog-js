import type { Client } from './client'
import type { SurveysConfig, SurveysEventReceiver } from './surveys-config'
import type { SurveyCallback } from './types/surveys'

/** Shared renderer dependencies. The surveys extension remains the lifecycle owner. */
export interface SurveyRenderContext {
    readonly client?: Client | undefined
    readonly config: Readonly<SurveysConfig>
    readonly surveys?:
        | {
              readonly _surveyEventReceiver: SurveysEventReceiver | null | undefined
              getSurveys(callback: SurveyCallback, forceReload?: boolean): void
          }
        | undefined
}

export function getSurveyReplayUrl({ client, config }: SurveyRenderContext): string | undefined {
    if (!client || !config.uiHost) return
    const sessionId = client.session?.sessionId
    if (!sessionId) return
    return `${config.uiHost}/project/${client.projectToken}/replay/${sessionId}`
}
