/// <reference types="cypress" />

import { _isNull } from '../../src/utils/type-utils'
import { start } from '../support/setup'

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

function ensureActivitySendsSnapshots() {
    cy.resetPhCaptures()

    cy.get('[data-cy-input]')
        .type('hello posthog!')
        .wait('@session-recording')
        .then(() => {
            cy.phCaptures({ full: true }).then((captures) => {
                expect(captures.map((c) => c.event)).to.deep.equal(['$snapshot'])
                expect(captures[0]['properties']['$snapshot_data']).to.have.length.above(14).and.below(39)
                // a meta and then a full snapshot
                expect(captures[0]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                expect(captures[0]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
                expect(captures[0]['properties']['$snapshot_data'][2].type).to.equal(5) // custom event with options
                expect(captures[0]['properties']['$snapshot_data'][3].type).to.equal(5) // custom event with posthog config
                // Making a set from the rest should all be 3 - incremental snapshots
                expect(new Set(captures[0]['properties']['$snapshot_data'].slice(4).map((s) => s.type))).to.deep.equal(
                    new Set([3])
                )
            })
        })
}

describe('Session recording', () => {
    describe('array.full.js', () => {
        it('captures session events', () => {
            start({
                decideResponseOverrides: {
                    config: { enable_collect_everything: false },
                    isAuthenticated: false,
                    sessionRecording: {
                        endpoint: '/ses/',
                    },
                    capturePerformance: true,
                },
            })

            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait(500)
            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .wait('@session-recording')
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        // should be a pageview and a $snapshot
                        expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$snapshot'])

                        expect(captures[1]['properties']['$snapshot_data']).to.have.length.above(33).and.below(39)
                        // a meta and then a full snapshot
                        expect(captures[1]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                        expect(captures[1]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
                        expect(captures[1]['properties']['$snapshot_data'][2].type).to.equal(5) // custom event with options
                        expect(captures[1]['properties']['$snapshot_data'][3].type).to.equal(5) // custom event with posthog config
                        // Making a set from the rest should all be 3 - incremental snapshots
                        const incrementalSnapshots = captures[1]['properties']['$snapshot_data'].slice(4)
                        expect(new Set(incrementalSnapshots.map((s) => s.type))).to.deep.equal(new Set([3]))
                    })
                })
        })
    })

    describe('array.js', () => {
        beforeEach(() => {
            start({
                decideResponseOverrides: {
                    config: { enable_collect_everything: false },
                    isAuthenticated: false,
                    sessionRecording: {
                        endpoint: '/ses/',
                    },
                    capturePerformance: true,
                },
                url: './playground/cypress',
            })
            cy.wait('@recorder')
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
            cy.resetPhCaptures()
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
                        if (_isNull(sessionId)) {
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

            // cypress time handling can confuse when to run full snapshot, let's force that to happen...
            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait('@session-recording').then(() => {
                cy.phCaptures({ full: true }).then((captures) => {
                    captures.forEach((c) => {
                        if (_isNull(sessionId)) {
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
            cy.posthogInit({})
            cy.wait('@decide')
            cy.wait('@recorder')

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
                    expect(captures[1].properties['$session_id']).to.equal(sessionId)

                    expect(captures[1]['properties']['$snapshot_data']).to.have.length.above(0)

                    /**
                     * the snapshots will look a little like:
                     * [
                     *  {"type":3,"data":{"source":6,"positions":[{"x":58,"y":18,"id":15,"timeOffset":0}]},"timestamp":1699814887222},
                     *  {"type":3,"data":{"source":6,"positions":[{"x":58,"y":18,"id":15,"timeOffset":-430}]},"timestamp":1699814887722}
                     *  ]
                     */

                    // page reloaded so we will start with a full snapshot
                    // a meta and then a full snapshot
                    expect(captures[1]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                    expect(captures[1]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
                    expect(captures[1]['properties']['$snapshot_data'][2].type).to.equal(5) // custom event with options
                    expect(captures[1]['properties']['$snapshot_data'][3].type).to.equal(5) // custom event with posthog config
                    const xPositions = []
                    for (let i = 4; i < captures[1]['properties']['$snapshot_data'].length; i++) {
                        expect(captures[1]['properties']['$snapshot_data'][i].type).to.equal(3)
                        expect(captures[1]['properties']['$snapshot_data'][i].data.source).to.equal(
                            6,
                            JSON.stringify(captures[1]['properties']['$snapshot_data'][i])
                        )
                        xPositions.push(captures[1]['properties']['$snapshot_data'][i].data.positions[0].x)
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
                    cy.phCaptures({ full: true }).then((captures) => {
                        // should be a pageview and a $snapshot
                        expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$snapshot'])
                        expect(captures[1]['properties']['$session_id']).to.be.a('string')
                        firstSessionId = captures[1]['properties']['$session_id']
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
                    cy.phCaptures({ full: true }).then((captures) => {
                        // should be a pageview and a $snapshot
                        expect(captures[0].event).to.equal('$snapshot')

                        expect(captures[0]['properties']['$session_id']).to.be.a('string')
                        expect(captures[0]['properties']['$session_id']).not.to.eq(firstSessionId)

                        expect(captures[0]['properties']['$snapshot_data']).to.have.length.above(0)
                        expect(captures[0]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                        expect(captures[0]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
                    })
                })
        })
    })
})
