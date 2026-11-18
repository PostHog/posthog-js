import { createPostHog } from '@posthog/browser/core'
import { group, groupIdentify, resetGroups } from '@posthog/browser/groups'
import {
    alias,
    createPersonProfile,
    setInternalOrTestUser,
    setPersonProperties,
    unsetPersonProperties,
} from '@posthog/browser/person'

void createPostHog({ projectToken: 'ph_test' }).then(async (posthog) => {
    posthog.capture('test_event')
    group(posthog, 'company', 'acme')
    groupIdentify(posthog, 'company', 'acme', {})
    resetGroups(posthog)
    alias(posthog, 'alias')
    createPersonProfile(posthog)
    setPersonProperties(posthog, { plan: 'pro' })
    unsetPersonProperties(posthog, 'plan')
    setInternalOrTestUser(posthog)
    await posthog.flush()
})
