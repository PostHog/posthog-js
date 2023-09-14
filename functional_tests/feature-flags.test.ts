import { v4 } from 'uuid'
import { createPosthogInstance } from './posthog-instance'
import { waitFor } from '@testing-library/dom'
import { getRequests, resetRequests } from './mock-server'

test('person properties set in identify() with new distinct_id are sent to decide', async () => {
    const token = v4()
    const posthog = await createPosthogInstance(token, { advanced_disable_decide: false })

    const anonymousId = posthog.get_distinct_id()

    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([
            // This is the initial call to the decide endpoint on PostHog init.
            {
                distinct_id: anonymousId,
                groups: {},
                token,
            },
        ])
    })

    resetRequests(token)

    // wait for decide callback
    // eslint-disable-next-line compat/compat
    await new Promise((res) => setTimeout(res, 500))

    // Person properties set here should also be sent to the decide endpoint.
    posthog.identify('test-id', {
        email: 'test@email.com',
    })

    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([
            // Then we have another decide call triggered by the call to
            // `identify()`.
            {
                $anon_distinct_id: anonymousId,
                distinct_id: 'test-id',
                person_properties: {
                    email: 'test@email.com',
                },
                groups: {},
                token,
            },
        ])
    })
})

test('person properties set in identify() with the same distinct_id are sent to decide', async () => {
    const token = v4()
    const posthog = await createPosthogInstance(token, { advanced_disable_decide: false })

    const anonymousId = posthog.get_distinct_id()

    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([
            // This is the initial call to the decide endpoint on PostHog init.
            {
                distinct_id: anonymousId,
                groups: {},
                token,
            },
        ])
    })

    resetRequests(token)

    // wait for decide callback
    // eslint-disable-next-line compat/compat
    await new Promise((res) => setTimeout(res, 500))

    // First we identify with a new distinct_id but with no properties set
    posthog.identify('test-id')

    // By this point we should have already called `/decide/` twice.
    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([
            // Then we have another decide call triggered by the first call to
            // `identify()`.
            {
                $anon_distinct_id: anonymousId,
                distinct_id: 'test-id',
                groups: {},
                person_properties: {},
                token,
            },
        ])
    })

    resetRequests(token)

    // Then we identify again, but with the same distinct_id and with some
    // properties set.
    posthog.identify('test-id', { email: 'test@email.com' })

    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([
            {
                distinct_id: 'test-id',
                groups: {},
                person_properties: { email: 'test@email.com' },
                token,
            },
        ])
    })
})

test('identify() triggers new request in queue after first request', async () => {
    const token = v4()
    const posthog = await createPosthogInstance(token, { advanced_disable_decide: false })

    const anonymousId = posthog.get_distinct_id()

    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([
            // This is the initial call to the decide endpoint on PostHog init.
            {
                distinct_id: anonymousId,
                groups: {},
                token,
            },
        ])
    })

    resetRequests(token)

    // don't wait for decide callback
    posthog.identify('test-id', {
        email: 'test2@email.com',
    })

    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([])
    })

    // wait for decide callback
    // eslint-disable-next-line compat/compat
    await new Promise((res) => setTimeout(res, 500))

    // now second call should've fired
    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([
            {
                $anon_distinct_id: anonymousId,
                distinct_id: 'test-id',
                groups: {},
                person_properties: { email: 'test2@email.com' },
                token,
            },
        ])
    })
})

test('identify() does not trigger new request in queue after first request for loaded callback', async () => {
    const token = v4()
    await createPosthogInstance(token, {
        advanced_disable_decide: false,
        bootstrap: { distinctID: 'anon-id' },
        loaded: (ph) => {
            ph.identify('test-id', { email: 'test3@email.com' })
            ph.group('playlist', 'id:77', { length: 8 })
        },
    })

    await waitFor(() => {
        expect(getRequests(token)['/decide/']).toEqual([
            // This is the initial call to the decide endpoint on PostHog init, with all info added from `loaded`.
            {
                // $anon_distinct_id: 'anon-id', // no anonymous ID is sent because this was overridden on load
                distinct_id: 'test-id',
                groups: { playlist: 'id:77' },
                person_properties: {
                    email: 'test3@email.com',
                },
                group_properties: {
                    playlist: {
                        length: 8,
                    },
                },
                token,
            },
        ])
    })
})
