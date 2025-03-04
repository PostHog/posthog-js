import '../src/__tests__/helpers/mock-logger'

import { createPosthogInstance } from '../src/__tests__/helpers/posthog-instance'
import { waitFor } from '@testing-library/dom'
import { getRequests, resetRequests } from './mock-server'
import { uuidv7 } from '../src/uuidv7'

async function shortWait() {
    // no need to worry about ie11 compat in tests
    // eslint-disable-next-line compat/compat
    await new Promise<void>((resolve: () => void) => setTimeout(resolve, 500))
}

describe('FunctionalTests / Feature Flags', () => {
    let token: string

    beforeEach(() => {
        token = uuidv7()
    })

    test('person properties set in identify() with new distinct_id are sent to decide', async () => {
        const posthog = await createPosthogInstance(token, { advanced_disable_decide: false })

        const anonymousId = posthog.get_distinct_id()

        await waitFor(() => {
            expect(getRequests(token)['/decide/']).toEqual([
                // This is the initial call to the decide endpoint on PostHog init.
                {
                    distinct_id: anonymousId,
                    person_properties: {},
                    groups: {},
                    token,
                },
            ])
        })

        resetRequests(token)

        // wait for decide callback
        await shortWait()

        // Person properties set here should also be sent to the decide endpoint.
        posthog.identify('test-id', {
            email: 'test@email.com',
        })

        await shortWait()

        await waitFor(() => {
            expect(getRequests(token)['/decide/']).toEqual([
                // Then we have another decide call triggered by the call to
                // `identify()`.
                {
                    $anon_distinct_id: anonymousId,
                    distinct_id: 'test-id',
                    person_properties: {
                        $initial__kx: null,
                        $initial_current_url: 'http://localhost/',
                        $initial_dclid: null,
                        $initial_fbclid: null,
                        $initial_gad_source: null,
                        $initial_gbraid: null,
                        $initial_gclid: null,
                        $initial_gclsrc: null,
                        $initial_host: 'localhost',
                        $initial_igshid: null,
                        $initial_irclid: null,
                        $initial_li_fat_id: null,
                        $initial_mc_cid: null,
                        $initial_msclkid: null,
                        $initial_pathname: '/',
                        $initial_rdt_cid: null,
                        $initial_referrer: '$direct',
                        $initial_referring_domain: '$direct',
                        $initial_ttclid: null,
                        $initial_twclid: null,
                        $initial_utm_campaign: null,
                        $initial_utm_content: null,
                        $initial_utm_medium: null,
                        $initial_utm_source: null,
                        $initial_utm_term: null,
                        $initial_wbraid: null,
                        email: 'test@email.com',
                    },
                    groups: {},
                    token,
                },
            ])
        })
    })

    test('person properties set in identify() with the same distinct_id are sent to decide', async () => {
        const posthog = await createPosthogInstance(token, { advanced_disable_decide: false })

        const anonymousId = posthog.get_distinct_id()

        await waitFor(() => {
            expect(getRequests(token)['/decide/']).toEqual([
                // This is the initial call to the decide endpoint on PostHog init.
                {
                    distinct_id: anonymousId,
                    person_properties: {},
                    groups: {},
                    token,
                },
            ])
        })

        resetRequests(token)

        // wait for decide callback
        await shortWait()

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
                    person_properties: {
                        $initial__kx: null,
                        $initial_current_url: 'http://localhost/',
                        $initial_dclid: null,
                        $initial_fbclid: null,
                        $initial_gad_source: null,
                        $initial_gbraid: null,
                        $initial_gclid: null,
                        $initial_gclsrc: null,
                        $initial_host: 'localhost',
                        $initial_igshid: null,
                        $initial_irclid: null,
                        $initial_li_fat_id: null,
                        $initial_mc_cid: null,
                        $initial_msclkid: null,
                        $initial_pathname: '/',
                        $initial_rdt_cid: null,
                        $initial_referrer: '$direct',
                        $initial_referring_domain: '$direct',
                        $initial_ttclid: null,
                        $initial_twclid: null,
                        $initial_utm_campaign: null,
                        $initial_utm_content: null,
                        $initial_utm_medium: null,
                        $initial_utm_source: null,
                        $initial_utm_term: null,
                        $initial_wbraid: null,
                    },
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
                    person_properties: {
                        $initial__kx: null,
                        $initial_current_url: 'http://localhost/',
                        $initial_dclid: null,
                        $initial_fbclid: null,
                        $initial_gad_source: null,
                        $initial_gbraid: null,
                        $initial_gclid: null,
                        $initial_gclsrc: null,
                        $initial_host: 'localhost',
                        $initial_igshid: null,
                        $initial_irclid: null,
                        $initial_li_fat_id: null,
                        $initial_mc_cid: null,
                        $initial_msclkid: null,
                        $initial_pathname: '/',
                        $initial_rdt_cid: null,
                        $initial_referrer: '$direct',
                        $initial_referring_domain: '$direct',
                        $initial_ttclid: null,
                        $initial_twclid: null,
                        $initial_utm_campaign: null,
                        $initial_utm_content: null,
                        $initial_utm_medium: null,
                        $initial_utm_source: null,
                        $initial_utm_term: null,
                        $initial_wbraid: null,
                        email: 'test@email.com',
                    },
                    token,
                },
            ])
        })
    })

    test('identify() triggers new request in queue after first request', async () => {
        const posthog = await createPosthogInstance(token, { advanced_disable_decide: false })

        const anonymousId = posthog.get_distinct_id()

        await waitFor(() => {
            expect(getRequests(token)['/decide/']).toEqual([
                // This is the initial call to the decide endpoint on PostHog init.
                {
                    distinct_id: anonymousId,
                    person_properties: {},
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
        await shortWait()

        // now second call should've fired
        await waitFor(() => {
            expect(getRequests(token)['/decide/']).toEqual([
                {
                    $anon_distinct_id: anonymousId,
                    distinct_id: 'test-id',
                    groups: {},
                    person_properties: {
                        $initial__kx: null,
                        $initial_current_url: 'http://localhost/',
                        $initial_dclid: null,
                        $initial_fbclid: null,
                        $initial_gad_source: null,
                        $initial_gbraid: null,
                        $initial_gclid: null,
                        $initial_gclsrc: null,
                        $initial_host: 'localhost',
                        $initial_igshid: null,
                        $initial_irclid: null,
                        $initial_li_fat_id: null,
                        $initial_mc_cid: null,
                        $initial_msclkid: null,
                        $initial_pathname: '/',
                        $initial_rdt_cid: null,
                        $initial_referrer: '$direct',
                        $initial_referring_domain: '$direct',
                        $initial_ttclid: null,
                        $initial_twclid: null,
                        $initial_utm_campaign: null,
                        $initial_utm_content: null,
                        $initial_utm_medium: null,
                        $initial_utm_source: null,
                        $initial_utm_term: null,
                        $initial_wbraid: null,
                        email: 'test2@email.com',
                    },
                    token,
                },
            ])
        })
    })

    test('identify() does not trigger new request in queue after first request for loaded callback', async () => {
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
                    $anon_distinct_id: 'anon-id',
                    distinct_id: 'test-id',
                    groups: { playlist: 'id:77' },
                    person_properties: {
                        $initial__kx: null,
                        $initial_current_url: 'http://localhost/',
                        $initial_dclid: null,
                        $initial_fbclid: null,
                        $initial_gad_source: null,
                        $initial_gbraid: null,
                        $initial_gclid: null,
                        $initial_gclsrc: null,
                        $initial_host: 'localhost',
                        $initial_igshid: null,
                        $initial_irclid: null,
                        $initial_li_fat_id: null,
                        $initial_mc_cid: null,
                        $initial_msclkid: null,
                        $initial_pathname: '/',
                        $initial_rdt_cid: null,
                        $initial_referrer: '$direct',
                        $initial_referring_domain: '$direct',
                        $initial_ttclid: null,
                        $initial_twclid: null,
                        $initial_utm_campaign: null,
                        $initial_utm_content: null,
                        $initial_utm_medium: null,
                        $initial_utm_source: null,
                        $initial_utm_term: null,
                        $initial_wbraid: null,
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
})
