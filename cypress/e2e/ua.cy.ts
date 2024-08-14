/// <reference types="cypress" />
import { start } from '../support/setup'
import '@cypress/skip-test/support'
import '@cypress/skip-test'

describe('User Agent Blocking', () => {
    it('should pick up that our automated cypress tests are indeed bot traffic', async () => {
        // @ts-expect-error skipOn types don't work
        cy.skipOn('windows')
        start({})

        // @ts-expect-error awaiting a cypress chainable
        const isLikelyBot = await cy.window().then((win) => {
            return win.eval('window.posthog._is_likely_bot()')
        })

        expect(isLikelyBot).to.eql(true)
    })
})
