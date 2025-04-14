import { PostHog } from '../posthog-core'
import {
    CAMPAIGN_PARAMS,
    getCampaignParams,
    EVENT_TO_PERSON_PROPERTIES,
    getEventProperties,
    getReferrerInfo,
} from '../utils/event-utils'
import { each, extend } from '../utils'
import { includes } from '../utils/string-utils'

export const setAllPersonProfilePropertiesAsPersonPropertiesForFlags = (posthog: PostHog): void => {
    const allProperties = extend(
        {},
        getEventProperties(
            posthog.config.mask_personal_data_properties,
            posthog.config.custom_personal_data_properties
        ),
        getCampaignParams(
            posthog.config.custom_campaign_params,
            posthog.config.mask_personal_data_properties,
            posthog.config.custom_personal_data_properties
        ),
        getReferrerInfo()
    )
    const personProperties: Record<string, string> = {}
    each(allProperties, function (v, k: string) {
        if (includes(CAMPAIGN_PARAMS, k) || includes(EVENT_TO_PERSON_PROPERTIES, k)) {
            personProperties[k] = v
        }
    })

    posthog.setPersonPropertiesForFlags(personProperties)
}
