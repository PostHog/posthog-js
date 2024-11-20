/// <reference types="cypress" />

import { start } from '../support/setup'
import { isArray } from '../../src/utils/type-utils'

describe('before_send', () => {
    it('can sample and edit with before_send', () => {
        start({})

        cy.posthog().then((posthog) => {
            let counter = 0
            const og = posthog.config.before_send
            // cypress tests rely on existing before_send function to capture events
            // so we have to add it back in here
            posthog.config.before_send = [
                (cr) => {
                    if (cr.event === 'custom-event') {
                        counter++
                        if (counter === 2) {
                            return null
                        }
                    }
                    if (cr.event === '$autocapture') {
                        return {
                            ...cr,
                            event: 'redacted',
                        }
                    }
                    return cr
                },
                ...(isArray(og) ? og : [og]),
            ]
        })

        cy.get('[data-cy-custom-event-button]').click()
        cy.get('[data-cy-custom-event-button]').click()

        cy.phCaptures().should('deep.equal', [
            // before adding the new before sendfn
            '$pageview',
            'redacted',
            'custom-event',
            // second button click only has the redacted autocapture event
            'redacted',
            // because the second custom-event is rejected
        ])
    })
})
