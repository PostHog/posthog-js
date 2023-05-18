// An MSW server that handles requests to https://app.posthog.com/e/ and stores

import { rest } from 'msw'
import { setupServer } from 'msw/lib/node'
import assert from 'assert'

// the request bodies in a store that we can inspect within tests.
const capturedRequests: { '/e/': any[]; '/engage/': any[]; '/decide/': any[] } = {
    '/e/': [],
    '/engage/': [],
    '/decide/': [],
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
    }),
    rest.post('http://localhost/decide/', (req: any, res: any, ctx: any) => {
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
        capturedRequests['/decide/'] = [...(capturedRequests['/decide/'] || []), data]
        return res(ctx.status(200))
    })
)

// Start the server before all the tests run, and close it afterwards.
beforeAll(() =>
    server.listen({
        onUnhandledRequest: 'error',
    })
)
afterAll(() => server.close())

export const getRequests = (token: string) => {
    // Filter the captured requests by the given token.
    return {
        '/e/': capturedRequests['/e/'].filter((request) => request.properties.token === token),
        '/engage/': capturedRequests['/engage/'].filter((request) => request.properties.token === token),
        '/decide/': capturedRequests['/decide/'].filter((request) => request.token === token),
    }
}
