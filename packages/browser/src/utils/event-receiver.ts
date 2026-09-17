import { EventReceiver as SharedEventReceiver } from '@posthog/browser-common/survey-event-receiver-base'
import type { EventTriggerable } from '@posthog/browser-common/survey-event-receiver-base'
import type { PostHog } from '../posthog-core'
import { createSurveyEventHost } from './survey-event-host'
export type { EventTriggerable, ActivationOutcome } from '@posthog/browser-common/survey-event-receiver-base'

export abstract class EventReceiver<T extends EventTriggerable> extends SharedEventReceiver<T> {
    protected readonly _instance: PostHog
    constructor(instance: PostHog) {
        super(createSurveyEventHost(instance))
        this._instance = instance
        this._subscribeSession()
    }
}
