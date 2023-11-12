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
                        // the snapshot should have a meta and a full snapshot (and nothing else?)
                        expect(captures[1]['properties']['$snapshot_data']).to.have.length(37)
                        expect(
                            JSON.stringify(captures[1]['properties']['$snapshot_data'].map((c) => c.type))
                        ).to.deep.equal(['wat'])
                        expect(captures[1]['properties']['$snapshot_data']).to.have.length(2)
                    })
                    // const requests = cy.state('requests').filter(({ alias }) => alias === 'session-recording')
                    // const request = requests[0]
                    // expect(JSON.stringify(Object.keys(request))).to.eq([])
                    // const requestBody = JSON.parse(request.text().substring(5))
                    // expect(requestBody).to.eql([{}])
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
                    const requests = cy.state('requests').filter(({ alias }) => alias === 'session-recording')
                    expect(requests.length).to.be.above(0).and.to.be.below(2)
                })
        })
    })
})
