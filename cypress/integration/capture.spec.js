/// <reference types="cypress" />

import * as fflate from 'fflate'
import { LZString } from '../../src/lz-string'

describe('Event capture', () => {
    given('options', () => ({}))
    given('sessionRecording', () => false)
    given('supportedCompression', () => ['gzip', 'lz64'])

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
                supportedCompression: given.supportedCompression,
            },
        }).as('decide')

        cy.visit('./playground/cypress', {
            onBeforeLoad(win) {
                cy.stub(win.console, 'error').as('consoleError')
            },
        })
        cy.posthogInit(given.options)
        if (waitForDecide) {
            cy.wait('@decide')
        }
    }

    it('captures pageviews, autocapture, custom events', () => {
        start()

        cy.get('[data-cy-custom-event-button]').click()
        cy.phCaptures().should('have.length', 3)
        cy.phCaptures().should('include', '$pageview')
        cy.phCaptures().should('include', '$autocapture')
        cy.phCaptures().should('include', 'custom-event')

        cy.reload()
        cy.phCaptures().should('have.length', 4)
        cy.phCaptures().should('include', '$pageview')
        cy.phCaptures().should('include', '$pageleave')
        cy.phCaptures().should('include', '$autocapture')
        cy.phCaptures().should('include', 'custom-event')
    })

    it('captures $feature_flag_called', () => {
        start()

        cy.get('[data-cy-feature-flag-button]').click()

        cy.phCaptures().should('include', '$feature_flag_called')
    })

    it('captures rage clicks', () => {
        given('options', () => ({ rageclick: true }))

        start()

        cy.get('body').click(100, 100).click(98, 102).click(101, 103)

        cy.phCaptures().should('include', '$rageclick')
    })

    it('doesnt capture rage clicks when autocapture is disabled', () => {
        given('options', () => ({ rageclick: true, autocapture: false }))

        start()

        cy.get('body').click(100, 100).click(98, 102).click(101, 103)

        cy.phCaptures().should('not.include', '$rageclick')
    })

    describe('session recording enabled from API', () => {
        given('sessionRecording', () => ({
            endpoint: '/ses/',
        }))

        it('captures $snapshot events', () => {
            start()

            cy.phCaptures().should('include', '$snapshot')
        })

        describe('but disabled from config', () => {
            given('options', () => ({ disable_session_recording: true }))

            it('does not capture $snapshot events', () => {
                start()

                cy.wait(1000)

                cy.phCaptures().should('not.include', '$snapshot')
            })
        })
    })

    describe('opting out of autocapture', () => {
        given('options', () => ({ autocapture: false }))

        it('captures pageviews, custom events', () => {
            start({ waitForDecide: false })

            cy.wait(50)
            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
            cy.get('@capture').should(({ request }) => {
                const data = decodeURIComponent(request.body.match(/data=(.*)/)[1])
                const captures = JSON.parse(Buffer.from(data, 'base64'))

                expect(captures['event']).to.equal('$pageview')
            })
        })
    })

    describe('opting out of pageviews', () => {
        given('options', () => ({ capture_pageview: false }))

        it('captures autocapture, custom events', () => {
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.reload()

            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
        })
    })

    describe('user opts out after start', () => {
        it('does not send any autocapture/custom events after that', () => {
            start()

            cy.posthog().invoke('opt_out_capturing')

            cy.get('[data-cy-custom-event-button]').click()
            cy.get('[data-cy-feature-flag-button]').click()
            cy.reload()

            cy.phCaptures().should('deep.equal', ['$pageview'])
        })

        it('does not send session recording events', () => {
            given('sessionRecording', () => true)

            start()

            cy.posthog().invoke('opt_out_capturing')
            cy.resetPhCaptures()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('deep.equal', [])
        })
    })

    describe('decoding the payload', () => {
        it('contains the correct headers and payload after an event', () => {
            start()

            // Pageview will be sent immediately
            cy.wait('@capture').its('request.headers').should('deep.equal', {
                'Content-Type': 'application/x-www-form-urlencoded',
            })
            cy.get('@capture').should(({ request }) => {
                const data = decodeURIComponent(request.body.match(/data=(.*)/)[1])
                const captures = JSON.parse(Buffer.from(data, 'base64'))

                expect(captures['event']).to.equal('$pageview')
            })

            cy.get('[data-cy-custom-event-button]').click()
            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 5)
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')

            cy.wait('@capture').its('request.headers').should('deep.equal', {
                'Content-Type': 'application/x-www-form-urlencoded',
            })
            cy.get('@capture').should(({ request }) => {
                const data = decodeURIComponent(request.body.match(/data=(.*)&compression=lz64/)[1])
                const captures = JSON.parse(LZString.decompressFromBase64(data))

                expect(captures.map(({ event }) => event)).to.deep.equal([
                    '$autocapture',
                    'custom-event',
                    '$autocapture',
                    'custom-event',
                ])
            })
        })

        describe('gzip-js supported', () => {
            given('supportedCompression', () => ['gzip-js'])

            it('contains the correct payload after an event', () => {
                start()
                // Pageview will be sent immediately
                cy.wait('@capture').its('request.headers').should('deep.equal', {
                    'Content-Type': 'application/x-www-form-urlencoded',
                })
                cy.get('@capture').should(({ request }) => {
                    console.log(request.body)
                    const data = decodeURIComponent(request.body.match(/data=(.*)/)[1])
                    const captures = JSON.parse(Buffer.from(data, 'base64'))

                    expect(captures['event']).to.equal('$pageview')
                })

                cy.get('[data-cy-custom-event-button]').click()
                cy.phCaptures().should('have.length', 3)
                cy.phCaptures().should('include', '$pageview')
                cy.phCaptures().should('include', '$autocapture')
                cy.phCaptures().should('include', 'custom-event')

                cy.wait('@capture').its('requestBody.type').should('deep.equal', 'text/plain')

                cy.get('@capture').should(async ({ requestBody }) => {
                    const data = new Uint8Array(await requestBody.arrayBuffer())
                    const decoded = fflate.strFromU8(fflate.decompressSync(data))
                    const captures = JSON.parse(decoded)

                    expect(captures.map(({ event }) => event)).to.deep.equal(['$autocapture', 'custom-event'])
                })
            })
        })
    })

    describe('advanced_disable_decide config', () => {
        given('options', () => ({ advanced_disable_decide: true }))
        it('does not autocapture anything when /decide is disabled', () => {
            start({ waitForDecide: false })

            cy.get('body').click(100, 100).click(98, 102).click(101, 103)
            cy.get('[data-cy-custom-event-button]').click()

            // No autocapture events, still captures custom events
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('does not capture session recordings', () => {
            start({ waitForDecide: false })

            cy.get('[data-cy-custom-event-button]').click()
            cy.wait('@capture')

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    const requests = cy
                        .state('requests')
                        .filter(({ alias }) => alias === 'session-recording' || alias === 'recorder')
                    expect(requests.length).to.be.equal(0)
                })
        })
    })
})
