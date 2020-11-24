/// <reference types="cypress" />

describe('Session recording', () => {
    given('options', () => ({
        capture_pageview: false,
    }))

    beforeEach(() => {
        cy.route({
            method: 'POST',
            url: '**/decide/*',
            response: {
                config: { enable_collect_everything: false },
                editorParams: {},
                featureFlags: [],
                isAuthenticated: false,
                sessionRecording: false,
                supportedCompression: ['base64'],
            },
        }).as('decide')

        cy.visit('./playground/cypress')
        cy.posthogInit(given.options)
        cy.wait('@decide')
    })

    it('captures pageviews, autocapture, custom events', () => {
        cy.posthog().invoke('capture_links', '#nav', 'Clicked Nav Link')

        cy.get('[data-cy-nav-link]').click()

        cy.phCaptures('event').should('deep.equal', ['Clicked Nav Link'])
        cy.url().should('include', '#foo')
    })
})
