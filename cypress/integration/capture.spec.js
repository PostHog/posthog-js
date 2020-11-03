/// <reference types="cypress" />

describe('Event capture', () => {
    given('options', () => ({}))
    given('sessionRecording', () => false)

    beforeEach(() => {
        cy.server()
    })

    // :TRICKY: Use a custom start command over beforeEach to deal with given2 not being ready yet.
    const start = ({ waitForDecide = true } = {}) => {
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
        if (waitForDecide) {
            cy.wait('@decide')
        }
    }

    it('captures pageviews, autocapture, custom events', () => {
        start()

        cy.get('[data-cy-custom-event-button]').click()
        cy.phCaptures('event').should('deep.equal', ['$pageview', '$autocapture', 'custom-event'])

        cy.reload()
        cy.phCaptures('event').should('deep.equal', ['$pageview', '$autocapture', 'custom-event', '$pageleave'])
    })

    it('captures $feature_flag_called', () => {
        start()

        cy.get('[data-cy-feature-flag-button]').click()

        cy.phCaptures('event').should('include', '$feature_flag_called')
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

                cy.wait(1000)

                cy.phCaptures('event').should('not.include', '$snapshot')
            })
        })
    })

    describe('opting out of autocapture', () => {
        given('options', () => ({ autocapture: false }))

        it('captures pageviews, custom events', () => {
            start({ waitForDecide: false })

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures('event').should('deep.equal', ['$pageview', 'custom-event'])
        })
    })

    describe('opting out of pageviews', () => {
        given('options', () => ({ capture_pageview: false }))

        it('captures autocapture, custom events', () => {
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.reload()

            cy.phCaptures('event').should('deep.equal', ['$autocapture', 'custom-event'])
        })
    })

    describe('user opts out after start', () => {
        it('does not send any autocapture/custom events after that', () => {
            start()

            cy.posthog().invoke('opt_out_capturing')

            cy.get('[data-cy-custom-event-button]').click()
            cy.get('[data-cy-feature-flag-button]').click()
            cy.reload()

            cy.phCaptures('event').should('deep.equal', ['$pageview'])
        })

        it('does not send session recording events', () => {
            given('sessionRecording', () => true)

            start()

            cy.posthog().invoke('opt_out_capturing')
            cy.resetPhCaptures()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures('event').should('deep.equal', [])
        })
    })
})
