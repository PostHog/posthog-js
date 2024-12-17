/// <reference types="cypress" />

import { isNull } from '../../src/utils/type-utils'
import { start } from '../support/setup'
import { assertWhetherPostHogRequestsWereCalled, pollPhCaptures } from '../support/assertions'

interface RRWebCustomEvent {
    type: number
    data: { payload: Record<string, any>; tag: string }
}

function ensureRecordingIsStopped() {
    cy.resetPhCaptures()

    cy.get('[data-cy-input]')
        .type('hello posthog!')
        .wait(250)
        .then(() => {
            cy.phCaptures({ full: true }).then((captures) => {
                // should be no captured data
                expect(captures.map((c) => c.event)).to.deep.equal([])
            })
        })
}

function expectPageViewCustomEvent(snapshot: RRWebCustomEvent) {
    expect(snapshot.type).to.equal(5)
    expect(snapshot.data.tag).to.equal('$pageview')
}

function expectSessionIdChangedCustomEvent(snapshot: RRWebCustomEvent) {
    expect(snapshot.type).to.equal(5)
    expect(snapshot.data.tag).to.equal('$session_id_change')
    expect(snapshot.data.payload.changeReason).to.deep.equal({
        noSessionId: true,
        activityTimeout: true,
        sessionPastMaximumLength: false,
    })
}

function expectPostHogConfigCustomEvent(snapshot: RRWebCustomEvent) {
    expect(snapshot.type).to.equal(5)
    expect(snapshot.data.tag).to.equal('$posthog_config')
}

function expectSessionOptionsCustomEvent(snapshot: RRWebCustomEvent) {
    expect(snapshot.type).to.equal(5)
    expect(snapshot.data.tag).to.equal('$session_options')
}

function sortByTag(snapshots: RRWebCustomEvent[]) {
    return snapshots.sort((a, b) => a.data.tag?.localeCompare(b.data.tag))
}

function ensureActivitySendsSnapshots(initial = true) {
    cy.resetPhCaptures()

    cy.get('[data-cy-input]')
        .type('hello posthog!')
        .wait('@session-recording')
        .then(() => {
            cy.phCaptures({ full: true }).then((captures) => {
                const capturedSnapshot = captures.find((e) => e.event === '$snapshot')
                expect(capturedSnapshot).not.to.be.undefined

                expect(capturedSnapshot['properties']['$snapshot_data']).to.have.length.above(14).and.below(40)
                // a meta and then a full snapshot
                expect(capturedSnapshot['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                expect(capturedSnapshot['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot

                if (initial) {
                    expectSessionOptionsCustomEvent(capturedSnapshot['properties']['$snapshot_data'][2])
                    expectPostHogConfigCustomEvent(capturedSnapshot['properties']['$snapshot_data'][3])
                } else {
                    expectSessionOptionsCustomEvent(capturedSnapshot['properties']['$snapshot_data'][2])
                    expectPostHogConfigCustomEvent(capturedSnapshot['properties']['$snapshot_data'][3])
                    expectSessionIdChangedCustomEvent(capturedSnapshot['properties']['$snapshot_data'][4])
                }

                // Making a set from the rest should all be 3 - incremental snapshots
                const remainder = capturedSnapshot['properties']['$snapshot_data'].slice(initial ? 4 : 5)
                expect(Array.from(new Set(remainder.map((s) => s.type)))).to.deep.equal([3])
            })
        })
}

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
    describe('array.full.js', () => {
        it('captures session events', () => {
            start({
                options: {
                    session_recording: {},
                },
                decideResponseOverrides: {
                    isAuthenticated: false,
                    sessionRecording: {
                        endpoint: '/ses/',
                    },
                    capturePerformance: true,
                    autocapture_opt_out: true,
                },
            })

            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait(500)
            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .wait('@session-recording')
                .then(() => {
                    cy.posthog().invoke('capture', 'test_registered_property')
                    cy.phCaptures({ full: true }).then((captures) => {
                        expect(captures.map((c) => c.event)).to.deep.equal([
                            '$pageview',
                            '$snapshot',
                            'test_registered_property',
                        ])

                        expect(captures[1]['properties']['$snapshot_data']).to.have.length.above(33).and.below(40)
                        // a meta and then a full snapshot
                        expect(captures[1]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                        expect(captures[1]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
                        expect(captures[1]['properties']['$snapshot_data'][2].type).to.equal(5) // custom event with options
                        expect(captures[1]['properties']['$snapshot_data'][3].type).to.equal(5) // custom event with posthog config
                        // Making a set from the rest should all be 3 - incremental snapshots
                        const incrementalSnapshots = captures[1]['properties']['$snapshot_data'].slice(4)
                        expect(Array.from(new Set(incrementalSnapshots.map((s) => s.type)))).to.deep.eq([3])

                        expect(captures[2]['properties']['$session_recording_start_reason']).to.equal(
                            'recording_initialized'
                        )
                    })
                })
        })
    })
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

                    // yay, includes expected type 6 network data
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

            it('it captures XHR method correctly', () => {
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

                    // yay, includes expected type 6 network data
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

    describe('array.js', () => {
        beforeEach(() => {
            start({
                options: {
                    session_recording: {},
                },
                decideResponseOverrides: {
                    isAuthenticated: false,
                    sessionRecording: {
                        endpoint: '/ses/',
                    },
                    capturePerformance: true,
                    autocapture_opt_out: true,
                },
                url: './playground/cypress',
            })
            cy.wait('@recorder-script')
        })

        it('captures session events', () => {
            cy.phCaptures({ full: true }).then((captures) => {
                // should be a pageview at the beginning
                expect(captures.map((c) => c.event)).to.deep.equal(['$pageview'])
            })
            cy.resetPhCaptures()

            let startingSessionId: string | null = null
            cy.posthog().then((ph) => {
                startingSessionId = ph.get_session_id()
            })

            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait(500)
            ensureActivitySendsSnapshots()
            cy.posthog().then((ph) => {
                ph.stopSessionRecording()
            })

            ensureRecordingIsStopped()

            // restarting recording
            cy.posthog().then((ph) => {
                ph.startSessionRecording()
            })
            ensureActivitySendsSnapshots()

            // the session id is not rotated by stopping and starting the recording
            cy.posthog().then((ph) => {
                const secondSessionId = ph.get_session_id()
                expect(startingSessionId).not.to.be.null
                expect(secondSessionId).not.to.be.null
                expect(secondSessionId).to.equal(startingSessionId)
            })
        })

        it('captures snapshots when the mouse moves', () => {
            let sessionId: string | null = null

            // cypress time handling can confuse when to run full snapshot, let's force that to happen...
            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait('@session-recording').then(() => {
                cy.phCaptures({ full: true }).then((captures) => {
                    captures.forEach((c) => {
                        if (isNull(sessionId)) {
                            sessionId = c.properties['$session_id']
                        }
                        // all captures should be from one session
                        expect(c.properties['$session_id']).to.equal(sessionId)
                    })
                    expect(sessionId).not.to.be.null
                })
            })
            // and then reset
            cy.resetPhCaptures()

            cy.get('body')
                .trigger('mousemove', { clientX: 200, clientY: 300 })
                .trigger('mousemove', { clientX: 210, clientY: 300 })
                .trigger('mousemove', { clientX: 220, clientY: 300 })
                .trigger('mousemove', { clientX: 240, clientY: 300 })

            cy.wait('@session-recording').then(() => {
                cy.phCaptures({ full: true }).then((captures) => {
                    // should be a $snapshot for the current session
                    expect(captures.map((c) => c.event)).to.deep.equal(['$snapshot'])
                    expect(captures[0].properties['$session_id']).to.equal(sessionId)

                    expect(captures[0]['properties']['$snapshot_data']).to.have.length.above(0)

                    /**
                     * the snapshots will look a little like:
                     * [
                     *  {"type":3,"data":{"source":6,"positions":[{"x":58,"y":18,"id":15,"timeOffset":0}]},"timestamp":1699814887222},
                     *  {"type":3,"data":{"source":6,"positions":[{"x":58,"y":18,"id":15,"timeOffset":-430}]},"timestamp":1699814887722}
                     *  ]
                     */

                    const xPositions = []
                    for (let i = 0; i < captures[0]['properties']['$snapshot_data'].length; i++) {
                        expect(captures[0]['properties']['$snapshot_data'][i].type).to.equal(3)
                        expect(captures[0]['properties']['$snapshot_data'][i].data.source).to.equal(
                            6,
                            JSON.stringify(captures[0]['properties']['$snapshot_data'][i])
                        )
                        xPositions.push(captures[0]['properties']['$snapshot_data'][i].data.positions[0].x)
                    }

                    // even though we trigger 4 events, only 2 snapshots should be captured
                    // This is because rrweb doesn't try to capture _every_ mouse move
                    expect(xPositions).to.have.length(2)
                    expect(xPositions[0]).to.equal(200)
                    // smoothing varies if this value picks up 220 or 240
                    // all we _really_ care about is that it's greater than the previous value
                    expect(xPositions[1]).to.be.above(xPositions[0])
                })
            })
        })

        it('continues capturing to the same session when the page reloads', () => {
            let sessionId: string | null = null

            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait('@session-recording').then(() => {
                cy.phCaptures({ full: true }).then((captures) => {
                    expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$snapshot'])

                    captures.forEach((c) => {
                        if (isNull(sessionId)) {
                            sessionId = c.properties['$session_id']
                        }
                        // all captures should be from one session
                        expect(c.properties['$session_id']).to.equal(sessionId)
                    })
                    expect(sessionId).not.to.be.null
                })
            })
            // and then reset
            cy.resetPhCaptures()
            // and refresh the page
            cy.reload()
            cy.posthogInit({
                session_recording: {},
            })
            cy.wait('@decide')
            cy.wait('@recorder-script')

            cy.get('body')
                .trigger('mousemove', { clientX: 200, clientY: 300 })
                .trigger('mousemove', { clientX: 210, clientY: 300 })
                .trigger('mousemove', { clientX: 220, clientY: 300 })
                .trigger('mousemove', { clientX: 240, clientY: 300 })

            cy.wait('@session-recording').then(() => {
                cy.phCaptures({ full: true }).then((captures) => {
                    // should be a $snapshot for the current session
                    expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$snapshot'])

                    expect(captures[0].properties['$session_id']).to.equal(sessionId)

                    const capturedSnapshot = captures[1]
                    expect(capturedSnapshot.properties['$session_id']).to.equal(sessionId)

                    expect(capturedSnapshot['properties']['$snapshot_data']).to.have.length.above(0)

                    /**
                     * the snapshots will look a little like:
                     * [
                     *  {"type":3,"data":{"source":6,"positions":[{"x":58,"y":18,"id":15,"timeOffset":0}]},"timestamp":1699814887222},
                     *  {"type":3,"data":{"source":6,"positions":[{"x":58,"y":18,"id":15,"timeOffset":-430}]},"timestamp":1699814887722}
                     *  ]
                     */

                    // page reloaded so we will start with a full snapshot
                    // a meta and then a full snapshot
                    expect(capturedSnapshot['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                    expect(capturedSnapshot['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot

                    // these custom events should always be in the same order, but computers
                    // we don't care if they are present and in a changing order
                    const customEvents = sortByTag([
                        capturedSnapshot['properties']['$snapshot_data'][2],
                        capturedSnapshot['properties']['$snapshot_data'][3],
                        capturedSnapshot['properties']['$snapshot_data'][4],
                    ])

                    expectPageViewCustomEvent(customEvents[0])
                    expectPostHogConfigCustomEvent(customEvents[1])
                    expectSessionOptionsCustomEvent(customEvents[2])

                    const xPositions = []
                    for (let i = 5; i < capturedSnapshot['properties']['$snapshot_data'].length; i++) {
                        expect(capturedSnapshot['properties']['$snapshot_data'][i].type).to.equal(3)
                        expect(capturedSnapshot['properties']['$snapshot_data'][i].data.source).to.equal(
                            6,
                            JSON.stringify(capturedSnapshot['properties']['$snapshot_data'][i])
                        )
                        xPositions.push(capturedSnapshot['properties']['$snapshot_data'][i].data.positions[0].x)
                    }

                    // even though we trigger 4 events, only 2 snapshots should be captured
                    // This is because rrweb doesn't try to capture _every_ mouse move
                    expect(xPositions).to.have.length(2)
                    expect(xPositions[0]).to.equal(200)
                    // smoothing varies if this value picks up 220 or 240
                    // all we _really_ care about is that it's greater than the previous value
                    expect(xPositions[1]).to.be.above(xPositions[0])
                })
            })
        })

        it('rotates sessions after 24 hours', () => {
            let firstSessionId: string | null = null

            // first we start a session and give it some activity
            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait(500)
            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .wait('@session-recording')
                .then(() => {
                    cy.posthog().invoke('capture', 'test_registered_property')
                    cy.phCaptures({ full: true }).then((captures) => {
                        expect(captures.map((c) => c.event)).to.deep.equal([
                            '$pageview',
                            '$snapshot',
                            'test_registered_property',
                        ])

                        expect(captures[1]['properties']['$session_id']).to.be.a('string')
                        firstSessionId = captures[1]['properties']['$session_id']

                        expect(captures[2]['properties']['$session_recording_start_reason']).to.equal(
                            'recording_initialized'
                        )
                    })
                })

            // then we reset the captures and move the session back in time
            cy.resetPhCaptures()

            cy.posthog().then((ph) => {
                const activityTs = ph.sessionManager['_sessionActivityTimestamp']
                const startTs = ph.sessionManager['_sessionStartTimestamp']
                const timeout = ph.sessionManager['_sessionTimeoutMs']

                // move the session values back,
                // so that the next event appears to be greater than timeout since those values
                ph.sessionManager['_sessionActivityTimestamp'] = activityTs - timeout - 1000
                ph.sessionManager['_sessionStartTimestamp'] = startTs - timeout - 1000
            })

            // then we expect that user activity will rotate the session
            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .wait('@session-recording', { timeout: 10000 })
                .then(() => {
                    cy.posthog().invoke('capture', 'test_registered_property')
                    cy.phCaptures({ full: true }).then((captures) => {
                        const capturedSnapshot = captures[0]
                        expect(capturedSnapshot.event).to.equal('$snapshot')

                        expect(capturedSnapshot['properties']['$session_id']).to.be.a('string')
                        expect(capturedSnapshot['properties']['$session_id']).not.to.eq(firstSessionId)

                        expect(capturedSnapshot['properties']['$snapshot_data']).to.have.length.above(0)
                        expect(capturedSnapshot['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                        expect(capturedSnapshot['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot

                        expect(captures[1].event).to.equal('test_registered_property')
                        expect(captures[1]['properties']['$session_recording_start_reason']).to.equal(
                            'session_id_changed'
                        )
                    })
                })
        })

        it('starts a new recording after calling reset', () => {
            cy.phCaptures({ full: true }).then((captures) => {
                expect(captures[0].event).to.eq('$pageview')
            })
            cy.resetPhCaptures()

            let startingSessionId: string | null = null
            cy.posthog().then((ph) => {
                startingSessionId = ph.get_session_id()
            })

            ensureActivitySendsSnapshots()

            cy.posthog().then((ph) => {
                cy.log('resetting posthog')
                ph.reset()
            })

            ensureActivitySendsSnapshots(false)

            // the session id is rotated after reset is called
            cy.posthog().then((ph) => {
                const secondSessionId = ph.get_session_id()
                expect(startingSessionId).not.to.be.null
                expect(secondSessionId).not.to.be.null
                expect(secondSessionId).not.to.equal(startingSessionId)
            })
        })
    })

    describe('with sampling', () => {
        beforeEach(() => {
            start({
                options: {
                    session_recording: {},
                },
                decideResponseOverrides: {
                    isAuthenticated: false,
                    sessionRecording: {
                        endpoint: '/ses/',
                        sampleRate: '0',
                    },
                    capturePerformance: true,
                    autocapture_opt_out: true,
                },
                url: './playground/cypress',
            })
            cy.wait('@recorder-script')
        })

        it('does not capture when sampling is set to 0', () => {
            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait(500)
            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .wait(200) // can't wait on call to session recording, it's not going to happen
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        expect(captures.map((c) => c.event)).to.deep.equal(['$pageview'])
                    })
                })
        })

        it('can override sampling when starting session recording', () => {
            cy.intercept('POST', '/decide/*', {
                autocapture_opt_out: true,
                editorParams: {},
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                    // will never record a session with rate of 0
                    sampleRate: '0',
                },
            }).as('decide')

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': true,
                '@decide': true,
                '@session-recording': false,
            })

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$pageview'])
            })

            cy.posthog().invoke('startSessionRecording', { sampling: true })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': true,
                '@decide': true,
                // no call to session-recording yet
            })

            cy.posthog().invoke('capture', 'test_registered_property')
            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$pageview', 'test_registered_property'])
                expect(captures[1]['properties']['$session_recording_start_reason']).to.equal('sampling_overridden')
            })

            cy.resetPhCaptures()

            cy.get('[data-cy-input]').type('hello posthog!')

            pollPhCaptures('$snapshot').then(() => {
                cy.phCaptures({ full: true }).then((captures) => {
                    expect(captures.map((c) => c.event)).to.deep.equal(['$snapshot'])
                })
            })

            // sampling override survives a page refresh
            cy.log('refreshing page')
            cy.resetPhCaptures()
            cy.reload(true).then(() => {
                start({
                    decideResponseOverrides: {
                        isAuthenticated: false,
                        sessionRecording: {
                            endpoint: '/ses/',
                            sampleRate: '0',
                        },
                        capturePerformance: true,
                        autocapture_opt_out: true,
                    },
                    url: './playground/cypress',
                })
                cy.wait('@recorder-script')

                cy.get('[data-cy-input]').type('hello posthog!')

                pollPhCaptures('$snapshot').then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        expect((captures || []).map((c) => c.event)).to.deep.equal(['$pageview', '$snapshot'])
                    })
                })
            })
        })
    })
})
