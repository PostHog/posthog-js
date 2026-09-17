import { SurveyEventReceiver as SharedSurveyEventReceiver } from '@posthog/browser-common/survey-event-receiver'
import type { PostHog } from '../posthog-core'
import type { KeyValueStore } from '@posthog/browser-common'
import { createSurveyEventHost } from './survey-event-host'
import { SURVEYS_ACTIVATED, SURVEYS_ACTIVATED_SESSION, SURVEYS_ACTIVATED_TIMESTAMPS } from '../constants'

export class SurveyEventReceiver extends SharedSurveyEventReceiver {
    constructor(instance: PostHog) {
        super({
            ...createSurveyEventHost(instance),
            kv: {
                initialize() {},
                get: ((key: string) => instance?.persistence?.props[key]) as KeyValueStore['get'],
                set: ((values: Record<string, unknown>) => {
                    if (SURVEYS_ACTIVATED in values)
                        instance?.persistence?.register({ [SURVEYS_ACTIVATED]: values[SURVEYS_ACTIVATED] })
                    if (SURVEYS_ACTIVATED_SESSION in values)
                        instance?.persistence?.register({
                            [SURVEYS_ACTIVATED_SESSION]: values[SURVEYS_ACTIVATED_SESSION],
                        })
                    if (SURVEYS_ACTIVATED_TIMESTAMPS in values)
                        instance?.persistence?.register({
                            [SURVEYS_ACTIVATED_TIMESTAMPS]: values[SURVEYS_ACTIVATED_TIMESTAMPS],
                        })
                }) as KeyValueStore['set'],
                remove: (key) => {
                    for (const name of typeof key === 'string' ? [key] : key) {
                        if (name === SURVEYS_ACTIVATED) instance?.persistence?.unregister(SURVEYS_ACTIVATED)
                        if (name === SURVEYS_ACTIVATED_SESSION)
                            instance?.persistence?.unregister(SURVEYS_ACTIVATED_SESSION)
                        if (name === SURVEYS_ACTIVATED_TIMESTAMPS)
                            instance?.persistence?.unregister(SURVEYS_ACTIVATED_TIMESTAMPS)
                    }
                },
            },
            getSurveys: (callback) => instance?.getSurveys(callback),
            cancelSurvey: (id) => instance?.cancelPendingSurvey(id),
        })
    }
}
