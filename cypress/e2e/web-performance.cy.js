/// <reference types="cypress" />

import { getLZStringEncodedPayload, getBase64EncodedPayload } from '../support/compression'

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

        cy.visit('./playground/cypress-full')
        cy.posthogInit(given.options)
        cy.wait('@decide')
        cy.wait('@capture')
    })

    it('captures some performance events', () => {
        cy.wait(100)

        cy.phCaptures({ full: true }).then((events) => {
            const performanceEvents = events.filter((e) => e.event === '$performance_event')

            expect(performanceEvents.length).to.be.greaterThan(0)

            expect(performanceEvents.filter((pe) => pe.properties[0] === 'navigation').length).to.eq(1)

            performanceEvents.forEach((perfEvent) => {
                expect(Object.keys(perfEvent.properties)).to.include.members([
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
})
