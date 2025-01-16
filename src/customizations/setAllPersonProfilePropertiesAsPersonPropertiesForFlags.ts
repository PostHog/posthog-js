import { PostHog } from '../posthog-core'
import { CAMPAIGN_PARAMS, EVENT_TO_PERSON_PROPERTIES, Info } from '../utils/event-utils'
import { each, extend } from '../utils'
import { includes } from '../utils/string-utils'

export const setAllPersonProfilePropertiesAsPersonPropertiesForFlags = (posthog: PostHog): void => {
    const allProperties = extend(
        {},
        Info.properties({
            maskPersonalDataProperties: posthog.config.mask_personal_data_properties,
            customPersonalDataProperties: posthog.config.custom_personal_data_properties,
        }),
        Info.campaignParams({
            customTrackedParams: posthog.config.custom_campaign_params,
            maskPersonalDataProperties: posthog.config.mask_personal_data_properties,
            customPersonalDataProperties: posthog.config.custom_personal_data_properties,
        }),
        Info.referrerInfo()
    )
    const personProperties: Record<string, string> = {}
    each(allProperties, function (v, k: string) {
        if (includes(CAMPAIGN_PARAMS, k) || includes(EVENT_TO_PERSON_PROPERTIES, k)) {
            personProperties[k] = v
        }
    })

    posthog.setPersonPropertiesForFlags(personProperties)
}
