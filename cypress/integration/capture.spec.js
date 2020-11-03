/// <reference types="cypress" />

describe('Event capture', () => {
    given('options', () => ({}))
    given('sessionRecording', () => false)

    beforeEach(() => {
        cy.server()
    })

    // :TRICKY: Use a custom start command over beforeEach to deal with given2 not being ready yet.
    const start = () => {
        cy.route({
            method: 'POST',
            url: '**/decide/*',
            response: {
                config: { enable_collect_everything: true },
                editorParams: {},
                featureFlags: ['session-recording-player'],
                isAuthenticated: false,
                sessionRecording: given.sessionRecording,
                supportedCompression: ['gzip', 'lz64'],
            },
        }).as('decide')
        cy.route('POST', '**/e/*').as('capture')

        cy.visit('./playground/cypress')
        cy.setupPosthog(given.options)
    }

    it('captures pageviews, custom events', () => {
        start()

        cy.phCaptures('event').should('deep.equal', ['$pageview'])
        cy.get('[data-cy-custom-event-buttom]').click()

        cy.reload()
        cy.phCaptures('event').should('deep.equal', ['$pageview', '$autocapture', 'custom-event', '$pageleave'])
    })

    describe('session recording enabled from API', () => {
        given('sessionRecording', () => true)

        it('captures $snapshot events', () => {
            start()

            cy.phCaptures('event').should('include', '$snapshot')
        })

        describe('but disabled from config', () => {
            given('options', () => ({ disable_session_recording: true }))

            it('does not capture $snapshot events', () => {
                start()

                cy.wait(2000)

                cy.phCaptures('event').should('not.include', '$snapshot')
            })
        })
    })
})
