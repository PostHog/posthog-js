import type { Properties } from '@posthog/types'

export interface SurveyCapturedEvent {
    event: string
    properties: Properties
}

/** Event observation and selector registration used by survey and tour triggers. */
export interface SurveyActionHost {
    subscribeCapture?: ((listener: (event: string, payload?: SurveyCapturedEvent) => void) => () => void) | undefined
    setElementSelectors?: ((selectors: Set<string>) => void) | undefined
}

export interface SurveyEventHost extends SurveyActionHost {
    subscribeSession?: ((listener: (sessionId: string) => void) => () => void) | undefined
    getSessionId(): string | undefined
    getProperty<T = unknown>(key: string): T | undefined
}
