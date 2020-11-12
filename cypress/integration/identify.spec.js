/// <reference types="cypress" />

describe('identify()', () => {
    beforeEach(() => {
        cy.visit('./playground/cypress')
        cy.posthogInit({})

        cy.wait('@decide')
    })

    it('opt_out_capturing() does not fail after identify()', () => {
        cy.posthog().invoke('identify', 'some-id')
        cy.posthog().invoke('opt_out_capturing')
    })
})
