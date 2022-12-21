/// <reference types="cypress" />

import { getLZStringEncodedPayload } from '../support/compression'

describe('Session recording', () => {
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
        cy.wait('@performance')
    })

    it('captures some performance events', () => {
        cy.wait(500)
        cy.get('@performance').should(async ({ requestBody }) => {
            const perfEvents = await getLZStringEncodedPayload({ body: requestBody })

            expect(perfEvents.length).to.be.greaterThan(0)

            const navigationEvent = perfEvents.find((e) => e.properties[0] === 'navigation')

            expect(navigationEvent).to.exist
            expect(navigationEvent.event).to.equal('$performance_event')

            expect(Object.keys(navigationEvent.properties)).to.deep.equal([
                '0',
                '1',
                '2',
                '3',
                '4',
                '5',
                '6',
                '7',
                '8',
                '9',
                '10',
                '11',
                '12',
                '13',
                '14',
                '15',
                '16',
                '17',
                '18',
                '19',
                '20',
                '22',
                '29',
                '31',
                '32',
                '33',
                '34',
                '36',
                '37',
                '39',
                '40',
                'token',
                '$session_id',
                '$window_id',
                'distinct_id',
                '$current_url',
            ])
        })
    })
})
