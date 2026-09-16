import type { StylesheetPreparer } from '@posthog/browser-common/utils/stylesheet-loader'
export type {
    Survey,
    SurveyCallback,
    DisplaySurveyOptions,
    SurveyRenderReason,
} from '@posthog/browser-common/surveys-types'

export interface SurveysOptions {
    /** Automatically display matching surveys after remote configuration enables them. Defaults to true. */
    automaticDisplay?: boolean
    /** Survey-definition request timeout. Defaults to 10000 milliseconds. */
    requestTimeoutMs?: number
    /** Populate answers from matching URL query parameters. */
    prefillFromUrl?: boolean
    /** Override language selection for translated surveys. */
    overrideDisplayLanguage?: string
    /** Prepare each survey stylesheet, for example to apply a CSP nonce. */
    prepareStylesheet?: StylesheetPreparer
    /** Override the URL used by survey targeting. */
    getCurrentUrl?: (url: string) => string
}

export type SurveysConfiguration = false | SurveysOptions

export const snapshotSurveysOptions = (options: SurveysOptions = {}): SurveysOptions => ({ ...options })
