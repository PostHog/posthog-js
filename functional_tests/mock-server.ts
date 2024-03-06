// An MSW server that handles requests to https://app.posthog.com/e/ and stores

import { ResponseComposition, rest } from 'msw'
import { setupServer } from 'msw/lib/node'
import assert from 'assert'
import { RestContext } from 'msw'
import { RestRequest } from 'msw'

// the request bodies in a store that we can inspect within tests.
const capturedRequests: { '/e/': any[]; '/engage/': any[]; '/decide/': any[] } = {
    '/e/': [],
    '/engage/': [],
    '/decide/': [],
}

const handleRequest = (group: string) => (req: RestRequest, res: ResponseComposition, ctx: RestContext) => {
    const body = req.body
    // type guard that body is a string
    if (typeof body !== 'string') {
        assert(false, 'body is not a string')
    }

    let data

    try {
        const b64Encoded = req.url.href.includes('compression=base64')
        if (b64Encoded) {
            data = JSON.parse(Buffer.from(decodeURIComponent(body.split('=')[1]), 'base64').toString())
        } else {
            data = JSON.parse(decodeURIComponent(body.split('=')[1]))
        }
    } catch (e) {
        return res(ctx.status(500))
    }

    capturedRequests[group] = [...(capturedRequests[group] || []), data]

    return res(ctx.json({}))
}

const server = setupServer(
    rest.post('http://localhost/e/', (req, res, ctx) => {
        return handleRequest('/e/')(req, res, ctx)
    }),
    rest.post('http://localhost/engage/', (req, res, ctx) => {
        return handleRequest('/engage/')(req, res, ctx)
    }),
    rest.post('http://localhost/decide/', (req, res, ctx) => {
        return handleRequest('/decide/')(req, res, ctx)
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

export const resetRequests = (token: string) => {
    Object.assign(capturedRequests, {
        '/e/': (capturedRequests['/e/'] = capturedRequests['/e/'].filter(
            (request) => request.properties.token !== token
        )),
        '/engage/': (capturedRequests['/engage/'] = capturedRequests['/engage/'].filter(
            (request) => request.properties.token !== token
        )),
        '/decide/': (capturedRequests['/decide/'] = capturedRequests['/decide/'].filter(
            (request) => request.token !== token
        )),
    })
}
