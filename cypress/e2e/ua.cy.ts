/// <reference types="cypress" />
import { start } from '../support/setup'

describe('User Agent Blocking', () => {
    it('should pick up that our automated cypress tests are indeed bot traffic', async () => {
        cy.skipOn('windows')
        start({})

        cy.window().then((win) => {
            const isLikelyBot = win.eval('window.posthog._is_bot()')
            expect(isLikelyBot).to.eql(true)
        })
    })
})
