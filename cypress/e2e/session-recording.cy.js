/// <reference types="cypress" />

import { _isNull } from '../../src/utils/type-utils'

describe('Session recording', () => {
    given('options', () => ({}))

    describe('array.full.js', () => {
        beforeEach(() => {
            cy.route({
                method: 'POST',
                url: '**/decide/*',
                response: {
                    config: { enable_collect_everything: false },
                    editorParams: {},
                    featureFlags: ['session-recording-player'],
                    isAuthenticated: false,
                    sessionRecording: {
                        endpoint: '/ses/',
                    },
                    capture_performance: true,
                },
            }).as('decide')

            cy.visit('./playground/cypress-full')
            cy.posthogInit(given.options)
            cy.wait('@decide')
        })

        it('captures session events', () => {
            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait(500)
            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .wait('@session-recording')
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        // should be a pageview and a $snapshot
                        expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$snapshot'])
                        // the amount of captured data should be deterministic
                        // but of course that would be too easy
                        expect(captures[1]['properties']['$snapshot_data']).to.have.length.above(33).and.below(38)
                        // a meta and then a full snapshot
                        expect(captures[1]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                        expect(captures[1]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
                        // Making a set from the rest should all be 3 - incremental snapshots
                        const incrementalSnapshots = captures[1]['properties']['$snapshot_data'].slice(2)
                        expect(new Set(incrementalSnapshots.map((s) => s.type))).to.deep.equal(new Set([3]))
                    })
                })
        })
    })

    describe('array.js', () => {
        beforeEach(() => {
            cy.route({
                method: 'POST',
                url: '**/decide/*',
                response: {
                    config: { enable_collect_everything: false },
                    editorParams: {},
                    featureFlags: ['session-recording-player'],
                    isAuthenticated: false,
                    sessionRecording: {
                        endpoint: '/ses/',
                    },
                    supportedCompression: ['gzip', 'lz64'],
                    capture_performance: true,
                },
            }).as('decide')

            cy.visit('./playground/cypress')
            cy.posthogInit(given.options)
            cy.wait('@decide')
            cy.wait('@recorder')
        })

        it('captures session events', () => {
            cy.get('[data-cy-input]').type('hello world! ')
            cy.wait(500)
            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .wait('@session-recording')
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        // should be a pageview and a $snapshot
                        expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$snapshot'])
                        // the amount of captured data should be deterministic
                        // but of course that would be too easy
                        expect(captures[1]['properties']['$snapshot_data']).to.have.length.above(33).and.below(38)
                        // a meta and then a full snapshot
                        expect(captures[1]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                        expect(captures[1]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
                        // Making a set from the rest should all be 3 - incremental snapshots
                        expect(
                            new Set(captures[1]['properties']['$snapshot_data'].slice(2).map((s) => s.type))
                        ).to.deep.equal(new Set([3]))
                    })
                })
        })

        it('captures snapshots when the mouse moves', () => {
            let sessionId = null

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
            cy.resetPhCaptures().then(() => {
                cy.get('body')
                    .trigger('mousemove', 50, 10)
                    .trigger('mousemove', 52, 10)
                    .trigger('mousemove', 54, 10)
                    .trigger('mousemove', 56, 10)
                cy.wait('@session-recording').then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        // should be a $snapshot for the current session
                        expect(captures.map((c) => c.event)).to.deep.equal(['$snapshot'])
                        expect(captures[0].properties['$session_id']).to.equal(sessionId)

                        // the amount of captured data should be deterministic
                        // but of course that would be too easy
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
                            expect(captures[0]['properties']['$snapshot_data'][i].data.source).to.equal(6)
                            xPositions.push(captures[0]['properties']['$snapshot_data'][i].data.positions[0].x)
                        }

                        expect(xPositions).to.eql([58, 64])
                    })
                })
            })
        })
    })
})
