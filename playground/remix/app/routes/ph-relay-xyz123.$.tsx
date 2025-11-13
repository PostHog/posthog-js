import type { ActionFunction, LoaderFunction } from '@remix-run/node'

const API_HOST = 'eu.i.posthog.com'
const ASSET_HOST = 'eu-assets.i.posthog.com'

const posthogProxy = async (request: Request) => {
    const url = new URL(request.url)
    const hostname = url.pathname.startsWith('/ph-relay-xyz123/static/') ? ASSET_HOST : API_HOST

    const newUrl = new URL(url)
    newUrl.protocol = 'https'
    newUrl.hostname = hostname
    newUrl.port = '443'
    newUrl.pathname = newUrl.pathname.replace(/^\/ph-relay-xyz123/, '')

    const headers = new Headers(request.headers)
    headers.set('host', hostname)

    const response = await fetch(newUrl, {
        method: request.method,
        headers,
        body: request.body,
        // This is required when passing a streaming body (like request.body) to fetch.
        duplex: 'half',
    })

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    })
}

export const loader: LoaderFunction = async ({ request }) => posthogProxy(request)

export const action: ActionFunction = async ({ request }) => posthogProxy(request)
