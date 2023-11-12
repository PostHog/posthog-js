/// <reference types="cypress" />

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
                    supportedCompression: ['None'],
                    capture_performance: true,
                },
            }).as('decide')

            cy.visit('./playground/cypress-full')
            cy.posthogInit(given.options)
            cy.wait('@decide')
        })

        it('captures pageviews, autocapture, custom events', () => {
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

        it('captures pageviews, autocapture, custom events', () => {
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
    })
})
