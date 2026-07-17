import type { PostHogConfig, PostHogInterface } from '../types'
import '../config'

import {
    CAMPAIGN_PARAMS,
    getCampaignParams,
    EVENT_TO_PERSON_PROPERTIES,
    getEventProperties,
    getReferrerInfo,
} from '@posthog/browser-common/utils/event-utils'
import { each, extend } from '@posthog/browser-common/utils/general-utils'
import { includes } from '@posthog/core'

// only the members the function reads — typed structurally (not as the PostHog
// class) so it accepts both the singleton and the instance handed to the `loaded`
// callback, where the docs recommend calling it. Picking scalar config keys keeps
// nominal class types (config.__extensionClasses) out of the signature, which
// would otherwise be incompatible across the lib/ and dist/ declaration copies.
type PostHogWithFlags = Pick<PostHogInterface, 'setPersonPropertiesForFlags'> & {
    config: Pick<
        PostHogConfig,
        | 'mask_personal_data_properties'
        | 'custom_personal_data_properties'
        | 'detect_google_search_app'
        | 'disable_capture_url_hashes'
        | 'custom_campaign_params'
    >
}

export const setAllPersonProfilePropertiesAsPersonPropertiesForFlags = (posthog: PostHogWithFlags): void => {
    const allProperties = extend(
        {},
        getEventProperties(
            posthog.config.mask_personal_data_properties,
            posthog.config.custom_personal_data_properties,
            posthog.config.detect_google_search_app,
            posthog.config.disable_capture_url_hashes
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
