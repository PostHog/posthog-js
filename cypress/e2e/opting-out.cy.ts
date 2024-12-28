import { assertWhetherPostHogRequestsWereCalled } from '../support/assertions'
import { start } from '../support/setup'

describe('opting out', () => {
    describe('when starting disabled in some way', () => {
        beforeEach(() => {
            cy.intercept('POST', '/decide/*', {
                editorParams: {},
                featureFlags: ['session-recording-player'],
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                },
                capture_performance: true,
                autocapture_opt_out: true,
            }).as('decide')

            cy.visit('./playground/cypress')
        })

        it('does not capture events without init', () => {
            cy.get('[data-cy-input]').type('hello world! ')

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': false,
                '@decide': false,
                '@session-recording': false,
            })

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        expect(captures || []).to.deep.equal([])
                    })
                })
        })

        it('does not capture events when config opts out by default', () => {
            cy.posthogInit({ opt_out_capturing_by_default: true })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures({ full: true }).then((captures) => {
                        expect(captures || []).to.deep.equal([])
                    })
                })
        })

        it('sends a $pageview event when opting in', () => {
            cy.intercept('POST', '/decide/*', {
                autocapture_opt_out: true,
                editorParams: {},
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                    // will never record a session with rate of 0
                    sampleRate: '0',
                },
            }).as('decide')

            cy.posthogInit({
                opt_out_capturing_by_default: true,
            })
            // Wait for the pageview timeout
            cy.wait(100)
            cy.phCaptures({ full: true }).then((captures) => {
                expect(captures || []).to.have.length(0)
            })

            cy.posthog().invoke('opt_in_capturing')

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$opt_in', '$pageview'])
            })
        })

        it('does not send a duplicate $pageview event when opting in', () => {
            cy.intercept('POST', '/decide/*', {
                autocapture_opt_out: true,
                editorParams: {},
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                    // will never record a session with rate of 0
                    sampleRate: '0',
                },
            }).as('decide')

            cy.posthogInit({})
            // Wait for the pageview timeout
            cy.wait(100)
            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$pageview'])
            })

            cy.posthog().invoke('opt_in_capturing')

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$pageview', '$opt_in'])
            })
        })
    })

    describe('user opts out after start', () => {
        it('does not send any autocapture/custom events after that', () => {
            start({})

            cy.posthog().invoke('opt_out_capturing')

            cy.get('[data-cy-custom-event-button]').click()
            cy.get('[data-cy-feature-flag-button]').click()
            cy.reload()

            cy.phCaptures().should('deep.equal', ['$pageview'])
        })
    })
})
