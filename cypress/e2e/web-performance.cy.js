/// <reference types="cypress" />

import { getLZStringEncodedPayload } from '../support/compression'

describe('Web Performance', () => {
    given('options', () => ({}))

    beforeEach(() => {
        cy.route({
            method: 'POST',
            url: '**/decide/*',
            response: {
                config: { enable_collect_everything: false },
                editorParams: {},
                featureFlags: [],
                isAuthenticated: false,
                capturePerformance: true,
                supportedCompression: ['gzip', 'lz64'],
            },
        }).as('decide')

        cy.visit('./playground/cypress')
        cy.posthogInit(given.options)
        cy.wait('@decide')
        cy.wait('@capture')
    })

    it('captures some performance events', () => {
        cy.wait(500)
        cy.get('@capture').should(async ({ requestBody }) => {
            const perfEvents = await getLZStringEncodedPayload({ body: requestBody })

            expect(perfEvents.length).to.be.greaterThan(0)

            const navigationEvent = perfEvents.find((e) => e.properties[0] === 'navigation')

            expect(navigationEvent).to.exist
            expect(navigationEvent.event).to.equal('$performance_event')

            // We can't check every property type as they are a bit flakey, so we just check the guaranteed ones
            expect(Object.keys(navigationEvent.properties)).to.include.members([
                '0',
                '1',
                '2',
                'token',
                '$session_id',
                '$window_id',
                'distinct_id',
                '$current_url',
            ])
        })
    })
})
