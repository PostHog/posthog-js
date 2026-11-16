import { DEVICE_ID, DISTINCT_ID, SESSION_ID, USER_STATE, USER_STATE_ANONYMOUS } from '../constants'
import { PostHog } from '../posthog-core'
import { localStore } from '../storage'
import { createPosthogInstance } from './helpers/posthog-instance'

describe('identity after a bfcache restore', () => {
    let posthog: PostHog

    afterEach(async () => {
        await posthog?.shutdown()
        vi.restoreAllMocks()
    })

    it.each([250, 0])('uses the persisted identity and session with save debounce %i ms', async (debounce) => {
        const beforeSend = vi.fn((event) => event)
        posthog = await createPosthogInstance(undefined, {
            persistence: 'localStorage+cookie',
            cookieWinsOnConflict: false,
            persistence_save_debounce_ms: debounce,
            capture_pageview: false,
            capture_pageleave: false,
            advanced_disable_flags: true,
            before_send: beforeSend,
        })
        const oldDistinctId = posthog.get_distinct_id()
        const persistenceName = `ph_${posthog.config.token}_posthog`
        posthog.capture('before restore')
        posthog.sessionPersistence?.register({ previous_person_session_property: 'stale' })
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))

        const newDistinctId = 'identity-from-sibling-tab'
        const newSessionId = 'session-from-sibling-tab'
        localStore._set(persistenceName, {
            ...localStore._parse(persistenceName),
            [DISTINCT_ID]: newDistinctId,
            [DEVICE_ID]: newDistinctId,
            [USER_STATE]: USER_STATE_ANONYMOUS,
            [SESSION_ID]: [Date.now(), newSessionId, Date.now()],
        })

        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
        posthog.capture('after restore')

        expect(oldDistinctId).not.toBe(newDistinctId)
        expect(posthog.get_distinct_id()).toBe(newDistinctId)
        expect(posthog.get_property(DEVICE_ID)).toBe(newDistinctId)
        expect(posthog.sessionPersistence?.get_property('previous_person_session_property')).toBeUndefined()
        expect(beforeSend.mock.lastCall?.[0]).toMatchObject({
            properties: { distinct_id: newDistinctId, $session_id: newSessionId },
        })
    })

    it('keeps session properties when the persisted identity has not changed', async () => {
        posthog = await createPosthogInstance(undefined, {
            persistence: 'localStorage+cookie',
            persistence_save_debounce_ms: 250,
            capture_pageview: false,
            advanced_disable_flags: true,
        })
        const distinctId = posthog.get_distinct_id()
        posthog.sessionPersistence?.register({ current_person_session_property: 'keep' })

        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))

        expect(posthog.get_distinct_id()).toBe(distinctId)
        expect(posthog.sessionPersistence?.get_property('current_person_session_property')).toBe('keep')
    })
})
