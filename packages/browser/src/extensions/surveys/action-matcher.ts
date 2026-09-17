import { ActionMatcher as SharedActionMatcher } from '@posthog/browser-common/survey-action-matcher'
import type { PostHog } from '../../posthog-core'
import { createSurveyEventHost } from '../../utils/survey-event-host'

export class ActionMatcher extends SharedActionMatcher {
    constructor(instance?: PostHog) {
        super(createSurveyEventHost(instance))
    }
}
