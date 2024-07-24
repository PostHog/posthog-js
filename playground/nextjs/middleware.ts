import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
    console.log('running middleware')

    const nonce = 'a-randomly-generated-nonce'
    const cspHeader = `
    default-src 'self';
    script-src 'self';
    style-src 'self';
    img-src 'self' blob: data:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
`
    // Replace newline characters and spaces
    const contentSecurityPolicyHeaderValue = cspHeader.replace(/\s{2,}/g, ' ').trim()

    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-nonce', nonce)

    // requestHeaders.set('Content-Security-Policy', contentSecurityPolicyHeaderValue)

    const response = NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    })
    response.headers.set('Content-Security-Policy', contentSecurityPolicyHeaderValue)

    return response
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
}
