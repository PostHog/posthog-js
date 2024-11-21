import { PostHog } from '../posthog-core'
import { CAMPAIGN_PARAMS, EVENT_TO_PERSON_PROPERTIES, Info } from '../utils/event-utils'
import { each, extend, includes } from '../utils'

export const setAllPersonProfilePropertiesAsPersonPropertiesForFlags = (posthog: PostHog): void => {
    const allProperties = extend({}, Info.properties(), Info.campaignParams(), Info.referrerInfo())
    const personProperties: Record<string, string> = {}
    each(allProperties, function (v, k: string) {
        if (includes(CAMPAIGN_PARAMS, k) || includes(EVENT_TO_PERSON_PROPERTIES, k)) {
            personProperties[k] = v
        }
    })

    posthog.setPersonPropertiesForFlags(personProperties)
}
