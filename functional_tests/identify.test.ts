import { PostHog, init_as_module } from '../src/posthog-core'
import 'regenerator-runtime/runtime'
import { waitFor } from '@testing-library/dom'
import { v4 } from 'uuid'

// configure an msw request server that persists requests to a store that we can
// inspect within tests
import { setupServer } from 'msw/node'
import { rest } from 'msw'
import { assert } from 'console'

test('identify sends a identify event', async () => {
    const posthog = await createPosthogInstance()

    const anonymousId = posthog.get_distinct_id()

    posthog.identify('test-id')

    await waitFor(() =>
        expect(capturedRequests['/e/']).toContainEqual(
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
})

test('identify sends an engage request if identify called twice with the same distinct id and with $set/$set_once', async () => {
    // The intention here is to reduce the number of unncecessary $identify
    // requests to process.
    const posthog = await createPosthogInstance()

    const anonymousId = posthog.get_distinct_id()

    // The first time we identify, it calls the /e/ endpoint with an $identify
    posthog.identify('test-id', { email: 'first@email.com' }, { location: 'first' })

    await waitFor(() =>
        expect(capturedRequests['/e/']).toContainEqual(
            expect.objectContaining({
                event: '$identify',
                $set: { email: 'first@email.com' },
                $set_once: { location: 'first' },
                properties: expect.objectContaining({
                    distinct_id: 'test-id',
                    $anon_distinct_id: anonymousId,
                    token: posthog.config.token,
                }),
            })
        )
    )

    // The second time we identify, it calls the /engage/ endpoint with the $set
    // / $set_once properties, in two separate requests.
    posthog.identify('test-id', { email: 'test@email.com' }, { location: 'second' })

    await waitFor(() =>
        expect(capturedRequests['/engage/']).toContainEqual(
            expect.objectContaining({
                $distinct_id: 'test-id',
                $set: {
                    $browser: 'Safari',
                    $browser_version: null,
                    $referrer: '$direct',
                    $referring_domain: '$direct',
                    email: 'test@email.com',
                },
                $token: posthog.config.token,
            })
        )
    )

    await waitFor(() =>
        expect(capturedRequests['/engage/']).toContainEqual(
            expect.objectContaining({
                $distinct_id: 'test-id',
                $set_once: { location: 'second' },
                $token: posthog.config.token,
            })
        )
    )
})

test('identify sends an engage request if identify called twice with a different distinct_id', async () => {
    // This is due to $identify only being called for anonymous users.
    const posthog = await createPosthogInstance()

    const anonymousId = posthog.get_distinct_id()

    // The first time we identify, it calls the /e/ endpoint with an $identify
    posthog.identify('test-id', { email: 'first@email.com' }, { location: 'first' })

    await waitFor(() =>
        expect(capturedRequests['/e/']).toContainEqual(
            expect.objectContaining({
                event: '$identify',
                $set: { email: 'first@email.com' },
                $set_once: { location: 'first' },
                properties: expect.objectContaining({
                    distinct_id: 'test-id',
                    $anon_distinct_id: anonymousId,
                    token: posthog.config.token,
                }),
            })
        )
    )

    // The second time we identify, it calls the /engage/ endpoint with the $set
    // / $set_once properties, in two separate requests.
    posthog.identify('another-test-id', { email: 'test@email.com' }, { location: 'second' })

    await waitFor(() =>
        expect(capturedRequests['/engage/']).toContainEqual(
            expect.objectContaining({
                $distinct_id: 'another-test-id',
                $set: {
                    $browser: 'Safari',
                    $browser_version: null,
                    $referrer: '$direct',
                    $referring_domain: '$direct',
                    email: 'test@email.com',
                },
                $token: posthog.config.token,
            })
        )
    )

    await waitFor(() =>
        expect(capturedRequests['/engage/']).toContainEqual(
            expect.objectContaining({
                $distinct_id: 'another-test-id',
                $set_once: { location: 'second' },
                $token: posthog.config.token,
            })
        )
    )
})

// An MSW server that handles requests to https://app.posthog.com/e/ and stores
// the request bodies in a store that we can inspect within tests.
const capturedRequests: { '/e/': any[]; '/engage/': any[] } = {
    '/e/': [],
    '/engage/': [],
}

const server = setupServer(
    rest.post('http://localhost/e/', (req: any, res: any, ctx: any) => {
        const body = req.body
        // type guard that body is a string
        if (typeof body !== 'string') {
            assert(false, 'body is not a string')
            return
        }
        // we assume the body is JSON and parse it we store the parsed body in
        // the store The request body is url encoded, so we need to decode it
        // first. We then need to get the data param from this and base64 decode
        // it.
        const data = JSON.parse(Buffer.from(decodeURIComponent(body.split('=')[1]), 'base64').toString())
        capturedRequests['/e/'] = [...(capturedRequests['/e/'] || []), data]
        return res(ctx.status(200))
    }),
    rest.post('http://localhost/engage/', (req: any, res: any, ctx: any) => {
        // NOTE: this is a slight duplication of the /e/ handler, but it's
        // possible that the details are slightly different so I'm leaving it
        // as is for now.
        const body = req.body
        // type guard that body is a string
        if (typeof body !== 'string') {
            assert(false, 'body is not a string')
            return
        }
        // we assume the body is JSON and parse it we store the parsed body in
        // the store The request body is url encoded, so we need to decode it
        // first. We then need to get the data param from this and base64 decode
        // it.
        const data = JSON.parse(Buffer.from(decodeURIComponent(body.split('=')[1]), 'base64').toString())
        capturedRequests['/engage/'] = [...(capturedRequests['/engage/'] || []), data]
        return res(ctx.status(200))
    })
)

// Start the server before all the tests run, and close it afterwards.
beforeAll(() => server.listen())
afterAll(() => server.close())

// The library depends on having the module initialized before it can be used.
// It sets a global variable that is set and used to initialize subsequent libaries.
beforeAll(() => init_as_module())

const createPosthogInstance = async () => {
    // We need to create a new instance of the library for each test, to ensure
    // that they are isolated from each other. The way the library is currently
    // written, we first create an instance, then call init on it which then
    // creates another instance.
    const posthog = new PostHog()
    return await new Promise<PostHog>((resolve) =>
        posthog.init(
            // Use a random UUID for the token, such that we don't have to worry
            // about collisions between test cases.
            v4(),
            { request_batching: false, api_host: 'http://localhost', loaded: (p) => resolve(p) },
            'test'
        )
    )
}
