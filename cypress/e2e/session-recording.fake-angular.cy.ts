/// <reference types="cypress" />

import { start } from '../support/setup'

/**
 * We have seen that when Angular "taints" prototypes and rrweb loads fresh copies from an iframe
 * That iOS and Safari were not providing a mutation observer, this created unplayable recordings
 * let's assert that we do get mutations
 */
describe('Session recording', () => {
    describe('with fake angular running', () => {
        beforeEach(() => {
            cy.window().then((win) => {
                ;(win as any).Zone = { my: 'fake zone' }
            })
        })

        it('captures session events despite getting untainted things from iframe', () => {
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

            cy.get('[data-cy-change-dom-button]')
                .click()
                .wait('@session-recording')
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        expect(captures.map((c) => c.event)).to.deep.equal(['$pageview', '$snapshot'])

                        expect(captures[1]['properties']['$snapshot_data']).to.have.length.above(9).and.below(20)
                        // a meta and then a full snapshot
                        expect(captures[1]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
                        expect(captures[1]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
                        expect(captures[1]['properties']['$snapshot_data'][2].type).to.equal(5) // custom event with options
                        expect(captures[1]['properties']['$snapshot_data'][3].type).to.equal(5) // custom event with posthog config
                        // Making a set from the rest should all be 3 - incremental snapshots
                        const incrementalSnapshots = captures[1]['properties']['$snapshot_data'].slice(4)
                        expect(Array.from(new Set(incrementalSnapshots.map((s) => s.type)))).to.deep.eq([3])

                        const mutations = incrementalSnapshots.filter((s) => !!s.data && s.data.source === 0)
                        expect(mutations).to.have.length(1)

                        const { attributes, removes, adds } = mutations[0].data
                        expect(attributes[0].attributes.style).to.eql({ 'background-color': 'blue' })
                        expect(removes).to.have.length(1)
                        expect(adds[0].node.textContent).to.eq('i r been changed')
                    })
                })
        })
    })
})
