/// <reference types="cypress" />

describe('Session recording', () => {
    given('options', () => ({}))

    beforeEach(() => {
        cy.route({
            method: 'POST',
            url: '**/decide/*',
            response: {
                config: { enable_collect_everything: true },
                editorParams: {},
                featureFlags: ['session-recording-player'],
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                },
                supportedCompression: ['gzip', 'lz64'],
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
            .then(() => {
                const requests = cy.state('requests').filter(({ alias }) => alias === 'session-recording')
                expect(requests.length).to.be.above(1).and.to.be.below(8)
            })
    })
})
