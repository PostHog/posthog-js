import 'regenerator-runtime/runtime'
import { waitFor } from '@testing-library/dom'
import { getRequests } from './mock-server'
import { createPosthogInstance } from '../src/__tests__/helpers/posthog-instance'
import { logger } from '../src/utils/logger'
import { uuidv7 } from '../src/uuidv7'
import { PostHog } from '../src/posthog-core'
jest.mock('../src/utils/logger')

describe('FunctionalTests / Identify', () => {
    let token: string
    let posthog: PostHog
    let anonymousId: string

    beforeEach(async () => {
        token = uuidv7()
        posthog = await createPosthogInstance(token)
        anonymousId = posthog.get_distinct_id()
    })

    test('identify sends a identify event', async () => {
        posthog.identify('test-id')

        await waitFor(() =>
            expect(getRequests(token)['/e/']).toContainEqual(
                expect.objectContaining({
                    event: '$identify',
                    properties: expect.objectContaining({
                        distinct_id: 'test-id',
                        $anon_distinct_id: anonymousId,
                        token: posthog.config.token,
                    }),
                })
            )
        )

        expect(jest.mocked(logger).error).toBeCalledTimes(0)
    })

    test('identify sends an engage request if identify called twice with the same distinct id and with $set/$set_once', async () => {
        // The intention here is to reduce the number of unncecessary $identify
        // requests to process.
        // The first time we identify, it calls the /e/ endpoint with an $identify
        posthog.identify('test-id', { email: 'first@email.com' }, { location: 'first' })

        await waitFor(() =>
            expect(getRequests(token)['/e/']).toContainEqual(
                expect.objectContaining({
                    event: '$identify',
                    $set: { email: 'first@email.com' },
                    $set_once: expect.objectContaining({
                        location: 'first',
                    }),
                    properties: expect.objectContaining({
                        distinct_id: 'test-id',
                        $anon_distinct_id: anonymousId,
                    }),
                })
            )
        )

        // The second time we identify, it instead sents an event of type "$set".
        posthog.identify('test-id', { email: 'test@email.com' }, { location: 'second' })

        await waitFor(() =>
            expect(getRequests(token)['/e/']).toContainEqual(
                expect.objectContaining({
                    event: '$set',
                    properties: expect.objectContaining({
                        $browser: 'Safari',
                        $browser_version: null,
                        $referrer: '$direct',
                        $referring_domain: '$direct',
                        $set: { email: 'test@email.com' },
                        $set_once: { location: 'second' },
                        distinct_id: 'test-id',
                        token: posthog.config.token,
                    }),
                })
            )
        )
    })

    test('identify sends an $set event if identify called twice with a different distinct_id', async () => {
        // This is due to $identify only being called for anonymous users.
        // The first time we identify, it calls the /e/ endpoint with an $identify
        posthog.identify('test-id', { email: 'first@email.com' }, { location: 'first' })

        await waitFor(() =>
            expect(getRequests(token)['/e/']).toContainEqual(
                expect.objectContaining({
                    event: '$identify',
                    $set: { email: 'first@email.com' },
                    $set_once: expect.objectContaining({
                        location: 'first',
                    }),
                    properties: expect.objectContaining({
                        distinct_id: 'test-id',
                        $anon_distinct_id: anonymousId,
                    }),
                })
            )
        )

        // The second time we identify, it sends a $set event instead, with no
        // reference to the anonymous id(?)
        posthog.identify('another-test-id', { email: 'test@email.com' }, { location: 'second' })

        await waitFor(() =>
            expect(getRequests(token)['/e/']).toContainEqual(
                expect.objectContaining({
                    event: '$set',
                    properties: expect.objectContaining({
                        $browser: 'Safari',
                        $browser_version: null,
                        $referrer: '$direct',
                        $referring_domain: '$direct',
                        $set: { email: 'test@email.com' },
                        $set_once: { location: 'second' },
                        distinct_id: 'another-test-id',
                    }),
                })
            )
        )
    })
})
