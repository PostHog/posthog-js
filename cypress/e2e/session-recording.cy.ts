/// <reference types="cypress" />

import { start } from '../support/setup'

function wrapFetchInCypress({
    originalFetch,
    badlyBehaved = false,
}: {
    originalFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    badlyBehaved?: boolean
}) {
    return async function (requestOrURL: URL | RequestInfo, init?: RequestInit | undefined) {
        // eslint-disable-next-line compat/compat
        const req = new Request(requestOrURL, init)

        const hasBody = typeof requestOrURL !== 'string' && 'body' in requestOrURL
        if (hasBody) {
            // we read the body to (maybe) exhaust it
            badlyBehaved ? await requestOrURL.text() : await requestOrURL.clone().text()
        }

        const res = badlyBehaved ? await originalFetch(requestOrURL, init) : await originalFetch(req)

        // we read the body to (maybe) exhaust it
        badlyBehaved ? await res.text() : await res.clone().text()

        return res
    }
}

describe('Session recording', () => {
    ;[true, false].forEach((isBadlyBehavedWrapper) => {
        describe(`network capture - when fetch wrapper ${
            isBadlyBehavedWrapper ? 'is' : 'is not'
        } badly behaved`, () => {
            let originalFetch: typeof fetch | null = null

            beforeEach(() => {
                // wrap fetch to log the body of the request
                // this simulates various libraries that require
                // being able to read the request
                // and possibly alter it
                // see: https://github.com/PostHog/posthog/issues/24471
                // for the catastrophic but hard to detect impact of
                // interfering with that with our wrapper
                // we wrap before PostHog and...
                cy.window().then((win) => {
                    originalFetch = win.fetch
                    win.fetch = wrapFetchInCypress({ originalFetch, badlyBehaved: isBadlyBehavedWrapper })
                })

                start({
                    decideResponseOverrides: {
                        isAuthenticated: false,
                        sessionRecording: {
                            endpoint: '/ses/',
                            networkPayloadCapture: { recordBody: true },
                        },
                        capturePerformance: true,
                        autocapture_opt_out: true,
                    },
                    url: './playground/cypress',
                    options: {
                        loaded: (ph) => {
                            ph.sessionRecording._forceAllowLocalhostNetworkCapture = true
                        },

                        session_recording: {},
                    },
                })

                cy.wait('@recorder-script')

                cy.intercept({ url: 'https://example.com', times: 1 }, (req) => {
                    req.reply({
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: {
                            message: 'This is a JSON response',
                        },
                    })
                }).as('example.com')

                // we wrap after PostHog
                cy.window().then((win) => {
                    originalFetch = win.fetch
                    win.fetch = wrapFetchInCypress({ originalFetch, badlyBehaved: isBadlyBehavedWrapper })
                })
            })

            afterEach(() => {
                if (originalFetch) {
                    cy.window().then((win) => {
                        win.fetch = originalFetch
                        originalFetch = null
                    })
                }
            })

            it('it sends network payloads', () => {
                cy.get('[data-cy-network-call-button]').click()
                cy.wait('@example.com')
                cy.wait('@session-recording')
                cy.phCaptures({ full: true }).then((captures) => {
                    const snapshots = captures.filter((c) => c.event === '$snapshot')

                    const capturedRequests: Record<string, any>[] = []
                    for (const snapshot of snapshots) {
                        for (const snapshotData of snapshot.properties['$snapshot_data']) {
                            if (snapshotData.type === 6) {
                                for (const req of snapshotData.data.payload.requests) {
                                    capturedRequests.push(req)
                                }
                            }
                        }
                    }

                    const expectedCaptureds: [RegExp, string][] = [
                        [/http:\/\/localhost:\d+\/playground\/cypress\//, 'navigation'],
                        [/http:\/\/localhost:\d+\/static\/array.js/, 'script'],
                        [
                            /http:\/\/localhost:\d+\/decide\/\?v=3&ip=1&_=\d+&ver=1\.\d\d\d\.\d+&compression=base64/,
                            'fetch',
                        ],
                        [/http:\/\/localhost:\d+\/static\/recorder.js\?v=1\.\d\d\d\.\d+/, 'script'],
                        [/https:\/\/example.com/, 'fetch'],
                    ]

                    // yay, includes expected network data
                    expect(capturedRequests.length).to.equal(expectedCaptureds.length)
                    expectedCaptureds.forEach(([url, initiatorType], index) => {
                        expect(capturedRequests[index].name).to.match(url)
                        expect(capturedRequests[index].initiatorType).to.equal(initiatorType)
                    })

                    // the HTML file that cypress is operating on (playground/cypress/index.html)
                    // when the button for this test is click makes a post to https://example.com
                    const capturedFetchRequest = capturedRequests.find((cr) => cr.name === 'https://example.com/')
                    expect(capturedFetchRequest).to.not.be.undefined

                    expect(capturedFetchRequest.fetchStart).to.be.greaterThan(0) // proxy for including network timing info

                    expect(capturedFetchRequest.initiatorType).to.eql('fetch')
                    expect(capturedFetchRequest.isInitial).to.be.undefined
                    expect(capturedFetchRequest.requestBody).to.eq('i am the fetch body')

                    expect(capturedFetchRequest.responseBody).to.eq(
                        JSON.stringify({
                            message: 'This is a JSON response',
                        })
                    )
                })
            })

            it('it captures XHR/fetch methods correctly', () => {
                cy.get('[data-cy-xhr-call-button]').click()
                cy.wait('@example.com')
                cy.wait('@session-recording')
                cy.phCaptures({ full: true }).then((captures) => {
                    const snapshots = captures.filter((c) => c.event === '$snapshot')

                    const capturedRequests: Record<string, any>[] = []
                    for (const snapshot of snapshots) {
                        for (const snapshotData of snapshot.properties['$snapshot_data']) {
                            if (snapshotData.type === 6) {
                                for (const req of snapshotData.data.payload.requests) {
                                    capturedRequests.push(req)
                                }
                            }
                        }
                    }

                    const expectedCaptureds: [RegExp, string][] = [
                        [/http:\/\/localhost:\d+\/playground\/cypress\//, 'navigation'],
                        [/http:\/\/localhost:\d+\/static\/array.js/, 'script'],
                        [
                            /http:\/\/localhost:\d+\/decide\/\?v=3&ip=1&_=\d+&ver=1\.\d\d\d\.\d+&compression=base64/,
                            'fetch',
                        ],
                        [/http:\/\/localhost:\d+\/static\/recorder.js\?v=1\.\d\d\d\.\d+/, 'script'],
                        [/https:\/\/example.com/, 'xmlhttprequest'],
                    ]

                    // yay, includes expected network data
                    expect(capturedRequests.length).to.equal(expectedCaptureds.length)
                    expectedCaptureds.forEach(([url, initiatorType], index) => {
                        const capturedRequest = capturedRequests[index]

                        expect(capturedRequest.name).to.match(url)
                        expect(capturedRequest.initiatorType).to.equal(initiatorType)
                    })

                    // the HTML file that cypress is operating on (playground/cypress/index.html)
                    // when the button for this test is click makes a post to https://example.com
                    const capturedFetchRequest = capturedRequests.find((cr) => cr.name === 'https://example.com/')
                    expect(capturedFetchRequest).to.not.be.undefined

                    expect(capturedFetchRequest.fetchStart).to.be.greaterThan(0) // proxy for including network timing info

                    expect(capturedFetchRequest.initiatorType).to.eql('xmlhttprequest')
                    expect(capturedFetchRequest.method).to.eql('POST')
                    expect(capturedFetchRequest.isInitial).to.be.undefined
                    expect(capturedFetchRequest.requestBody).to.eq('i am the xhr body')

                    expect(capturedFetchRequest.responseBody).to.eq(
                        JSON.stringify({
                            message: 'This is a JSON response',
                        })
                    )
                })
            })
        })
    })
})
