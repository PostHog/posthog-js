import { PostHog, init_as_module } from '../src/posthog-core'
import 'regenerator-runtime/runtime'
import { waitFor } from '@testing-library/dom'

// configure an msw request server that persists requests to a store that we can
// inspect within tests
import { setupServer } from 'msw/node'
import { rest } from 'msw'
import { assert } from 'console'

// An MSW server that handles requests to https://app.posthog.com/e/ and stores
// the request bodies in a store that we can inspect within tests.
const capturedRequests: string[] = []
const server = setupServer(
    rest.post('http://localhost/e/', (req, res, ctx) => {
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
        capturedRequests.push(data)
        return res(ctx.status(200))
    })
)
server.listen()

// The library depends on having the module initialized before it can be used.
// It sets a global variable that is set and used to initialize subsequent libaries.
beforeAll(() => init_as_module())

test('identify sends a identify event', async () => {
    let posthog = new PostHog()
    posthog = await new Promise((resolve) =>
        posthog.init(
            'testtoken',
            { request_batching: false, api_host: 'http://localhost', loaded: (p) => resolve(p) },
            'test'
        )
    )

    const anonymousId = posthog.get_distinct_id()

    posthog.identify('test-id')

    await waitFor(() =>
        expect(capturedRequests).toContainEqual(
            expect.objectContaining({
                event: '$identify',
                properties: expect.objectContaining({ distinct_id: 'test-id', $anon_distinct_id: anonymousId }),
            })
        )
    )
})
