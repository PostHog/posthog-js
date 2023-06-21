/// <reference types="cypress" />
import { version } from '../../package.json'

import { getBase64EncodedPayload, getGzipEncodedPayload } from '../support/compression'

const urlWithVersion = new RegExp(`&ver=${version}`)

describe('Event capture', () => {
    given('options', () => ({}))
    given('sessionRecording', () => false)
    given('supportedCompression', () => ['gzip-js'])

    // :TRICKY: Use a custom start command over beforeEach to deal with given2 not being ready yet.
    const start = ({ waitForDecide = true } = {}) => {
        cy.route({
            method: 'POST',
            url: '**/decide/*',
            response: {
                config: {
                    enable_collect_everything: true,
                },
                editorParams: {},
                featureFlags: ['session-recording-player'],
                isAuthenticated: false,
                sessionRecording: given.sessionRecording,
                supportedCompression: given.supportedCompression,
                excludedDomains: [],
                autocaptureExceptions: true,
            },
        }).as('decide')

        cy.visit('./playground/cypress-full', {
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

    it('captures exceptions', () => {
        start()

        cy.get('[data-cy-exception-button]').click()
        cy.phCaptures().should('have.length', 3)
        cy.phCaptures().should('include', '$exception')
    })

    describe('autocapture config', () => {
        it('dont capture click when configured not to', () => {
            given('options', () => ({
                autocapture: {
                    dom_event_allowlist: ['change'],
                },
            }))
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('capture clicks when configured to', () => {
            given('options', () => ({
                autocapture: {
                    dom_event_allowlist: ['click'],
                },
            }))
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 3)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('collect on url', () => {
            given('options', () => ({
                autocapture: {
                    url_allowlist: ['.*playground/cypress'],
                },
            }))
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 3)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('dont collect on url', () => {
            given('options', () => ({
                autocapture: {
                    url_allowlist: ['.*dontcollect'],
                },
            }))
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('collect button elements', () => {
            given('options', () => ({
                autocapture: {
                    element_allowlist: ['button'],
                },
            }))
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 3)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('dont collect on button elements', () => {
            given('options', () => ({
                autocapture: {
                    element_allowlist: ['a'],
                },
            }))
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('collect with data attribute', () => {
            given('options', () => ({
                autocapture: {
                    css_attribute_allowlist: ['[data-cy-custom-event-button]'],
                },
            }))
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 3)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('dont collect with data attribute', () => {
            given('options', () => ({
                autocapture: {
                    css_selector_allowlist: ['[nope]'],
                },
            }))
            start()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })
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

    describe('group analytics', () => {
        given('options', () => ({
            loaded: (posthog) => {
                posthog.group('company', 'id:5')
            },
        }))

        it('includes group information in all event payloads', () => {
            start()

            cy.get('[data-cy-custom-event-button]').click()

            cy.phCaptures({ full: true })
                .should('have.length', 3)
                .should('satisfy', (payloads) => payloads.every(({ properties }) => !!properties.$groups))
        })
    })

    it('doesnt capture rage clicks when autocapture is disabled', () => {
        given('options', () => ({ rageclick: true, autocapture: false }))

        start()

        cy.get('body').click(100, 100).click(98, 102).click(101, 103)

        cy.phCaptures().should('not.include', '$rageclick')
    })

    it('makes a single decide request', () => {
        start()

        cy.wait(200)
        cy.shouldBeCalled('decide', 1)

        cy.phCaptures().should('include', '$pageview')
        cy.get('@decide').should(({ request }) => {
            const payload = getBase64EncodedPayload(request)
            expect(payload.token).to.equal('test_token')
            expect(payload.groups).to.deep.equal({})
        })
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

            cy.wait('@capture')
            cy.get('@capture').should(({ request }) => {
                const captures = getBase64EncodedPayload(request)

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
        describe('gzip-js supported', () => {
            it('contains the correct payload after an event', () => {
                start()
                // Pageview will be sent immediately
                cy.wait('@capture').should(({ request, url }) => {
                    expect(request.headers).to.eql({
                        'Content-Type': 'application/x-www-form-urlencoded',
                    })

                    expect(url).to.match(urlWithVersion)
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
                    const captures = await getGzipEncodedPayload(requestBody)

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

    describe('subsequent decide calls', () => {
        given('options', () => ({
            loaded: (posthog) => {
                posthog.identify('new-id')
                posthog.group('company', 'id:5', { id: 5, company_name: 'Awesome Inc' })
                posthog.group('playlist', 'id:77', { length: 8 })
            },
        }))

        it('makes a single decide request on start', () => {
            start()

            cy.wait(200)
            cy.shouldBeCalled('decide', 1)

            cy.get('@decide').should(({ request }) => {
                const payload = getBase64EncodedPayload(request)
                expect(payload).to.deep.equal({
                    token: 'test_token',
                    distinct_id: 'new-id',
                    groups: {
                        company: 'id:5',
                        playlist: 'id:77',
                    },
                    group_properties: {
                        company: { id: 5, company_name: 'Awesome Inc' },
                        playlist: { length: 8 },
                    },
                })
            })
        })

        it('does a single decide call on following changes', () => {
            start()

            cy.wait(200)
            cy.shouldBeCalled('decide', 1)

            cy.posthog().invoke('group', 'company', 'id:6')
            cy.posthog().invoke('group', 'playlist', 'id:77')
            cy.posthog().invoke('group', 'anothergroup', 'id:99')

            cy.wait('@decide')
            cy.shouldBeCalled('decide', 2)
        })
    })
})
