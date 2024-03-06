/// <reference types="cypress" />
// @ts-expect-error - you totally can import the package JSON
import { version } from '../../package.json'

import { getBase64EncodedPayload, getGzipEncodedPayload, getPayload } from '../support/compression'
import { start } from '../support/setup'

const urlWithVersion = new RegExp(`&ver=${version}`)

describe('Event capture', () => {
    it('captures pageviews, autocapture, custom events', () => {
        start({})

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

    describe('autocapture config', () => {
        it('dont capture click when configured not to', () => {
            start({
                options: {
                    autocapture: {
                        dom_event_allowlist: ['change'],
                    },
                },
            })

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('capture clicks when configured to', () => {
            start({
                options: {
                    autocapture: {
                        dom_event_allowlist: ['click'],
                    },
                },
            })

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 3)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('collect on url', () => {
            start({
                options: {
                    autocapture: {
                        url_allowlist: ['.*playground/cypress'],
                    },
                },
            })

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 3)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('dont collect on url', () => {
            start({
                options: {
                    autocapture: {
                        url_allowlist: ['.*dontcollect'],
                    },
                },
            })

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('collect button elements', () => {
            start({
                options: {
                    autocapture: {
                        element_allowlist: ['button'],
                    },
                },
            })

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 3)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('dont collect on button elements', () => {
            start({
                options: {
                    autocapture: {
                        element_allowlist: ['a'],
                    },
                },
            })

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('collect with data attribute', () => {
            start({
                options: {
                    autocapture: {
                        css_selector_allowlist: ['[data-cy-custom-event-button]'],
                    },
                },
            })

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 3)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('dont collect with data attribute', () => {
            start({
                options: {
                    autocapture: {
                        css_selector_allowlist: ['[nope]'],
                    },
                },
            })

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })
    })

    it('captures $feature_flag_called', () => {
        start({})

        cy.get('[data-cy-feature-flag-button]').click()

        cy.phCaptures().should('include', '$feature_flag_called')
    })

    it('captures rage clicks', () => {
        start({ options: { rageclick: true } })

        cy.get('body').click(100, 100).click(98, 102).click(101, 103)

        cy.phCaptures().should('include', '$rageclick')
    })

    describe('group analytics', () => {
        it('includes group information in all event payloads', () => {
            start({
                options: {
                    loaded: (posthog) => {
                        posthog.group('company', 'id:5')
                    },
                },
            })

            cy.get('[data-cy-custom-event-button]').click()

            cy.phCaptures({ full: true })
                .should('have.length', 3)
                .should('satisfy', (payloads) => payloads.every(({ properties }) => !!properties.$groups))
        })
    })

    it('doesnt capture rage clicks when autocapture is disabled', () => {
        start({ options: { rageclick: true, autocapture: false } })

        cy.get('body').click(100, 100).click(98, 102).click(101, 103)

        cy.phCaptures().should('not.include', '$rageclick')
    })

    it('makes a single decide request', () => {
        start({})

        cy.get('@decide.all').then((calls) => {
            expect(calls.length).to.equal(1)
        })

        cy.phCaptures().should('include', '$pageview')
        // @ts-expect-error - TS is wrong that get returns HTMLElement here
        cy.get('@decide').should(({ request }) => {
            const payload = getBase64EncodedPayload(request)
            expect(payload.token).to.equal('test_token')
            expect(payload.groups).to.deep.equal({})
        })
    })

    describe('opting out of autocapture', () => {
        it('captures pageviews, custom events', () => {
            start({ options: { autocapture: false }, waitForDecide: false })

            cy.wait(50)
            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')

            cy.wait('@capture')
            // @ts-expect-error - TS is wrong that get returns HTMLElement here
            cy.get('@capture').should(async ({ request }) => {
                const captures = await getPayload(request)
                expect(captures['event']).to.equal('$pageview')
            })
        })
    })

    describe('opting out of pageviews', () => {
        it('captures autocapture, custom events', () => {
            start({ options: { capture_pageview: false } })

            cy.get('[data-cy-custom-event-button]').click()
            cy.reload()

            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$autocapture')
            cy.phCaptures().should('include', 'custom-event')
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

        it('does not send session recording events', () => {
            start({
                decideResponseOverrides: {
                    sessionRecording: {
                        endpoint: '/ses/',
                    },
                },
            })

            cy.posthog().invoke('opt_out_capturing')
            cy.resetPhCaptures()

            cy.get('[data-cy-custom-event-button]').click()
            cy.phCaptures().should('deep.equal', [])
        })
    })

    describe('decoding the payload', () => {
        describe('gzip-js supported', () => {
            it('contains the correct payload after an event', async () => {
                start({})

                // Pageview will be sent immediately

                cy.wait('@capture').should(async ({ request }) => {
                    expect(request.url).to.match(urlWithVersion)

                    const data = await getPayload(request)
                    expect(data['event']).to.equal('$pageview')
                })

                // the code below is going to trigger an event capture
                // we want to assert on the request
                cy.intercept('POST', '**/e/*', async (request) => {
                    expect(request.headers['content-type']).to.eq('text/plain')
                    const captures = await getGzipEncodedPayload(request)
                    expect(captures.map(({ event }) => event)).to.deep.equal(['$autocapture', 'custom-event'])
                }).as('capture-assertion')

                cy.get('[data-cy-custom-event-button]').click()
                cy.phCaptures().should('have.length', 3)
                cy.phCaptures().should('include', '$pageview')
                cy.phCaptures().should('include', '$autocapture')
                cy.phCaptures().should('include', 'custom-event')

                cy.wait('@capture-assertion')
            })
        })
    })

    describe('advanced_disable_decide config', () => {
        it('does not autocapture anything when /decide is disabled', () => {
            start({ options: { advanced_disable_decide: true }, waitForDecide: false })

            cy.get('body').click(100, 100).click(98, 102).click(101, 103)
            cy.get('[data-cy-custom-event-button]').click()

            // No autocapture events, still captures custom events
            cy.phCaptures().should('have.length', 2)
            cy.phCaptures().should('include', '$pageview')
            cy.phCaptures().should('include', 'custom-event')
        })

        it('does not capture session recordings', () => {
            start({ options: { advanced_disable_decide: true }, waitForDecide: false })

            cy.get('[data-cy-custom-event-button]').click()
            cy.wait('@capture')

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.get('@session-recording.all').then((calls) => {
                        expect(calls.length).to.equal(0)
                    })
                })

            cy.phCaptures().should('not.include', '$snapshot')
        })
    })

    describe('subsequent decide calls', () => {
        it('makes a single decide request on start', () => {
            start({
                options: {
                    loaded: (posthog) => {
                        posthog.identify('new-id')
                        posthog.group('company', 'id:5', { id: 5, company_name: 'Awesome Inc' })
                        posthog.group('playlist', 'id:77', { length: 8 })
                    },
                },
            })

            cy.get('@decide.all').then((calls) => {
                expect(calls.length).to.equal(1)
            })

            // @ts-expect-error - TS is wrong that get returns HTMLElement here
            cy.get('@decide').should(({ request }) => {
                const payload = getBase64EncodedPayload(request)
                expect(payload).to.deep.equal({
                    token: 'test_token',
                    distinct_id: 'new-id',
                    person_properties: {},
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
            start({
                options: {
                    loaded: (posthog) => {
                        posthog.identify('new-id')
                        posthog.group('company', 'id:5', { id: 5, company_name: 'Awesome Inc' })
                        posthog.group('playlist', 'id:77', { length: 8 })
                    },
                },
            })

            cy.wait(200)
            cy.get('@decide.all').then((calls) => {
                expect(calls.length).to.equal(1)
            })

            cy.posthog().invoke('group', 'company', 'id:6')
            cy.posthog().invoke('group', 'playlist', 'id:77')
            cy.posthog().invoke('group', 'anothergroup', 'id:99')

            cy.wait('@decide')

            cy.get('@decide.all').then((calls) => {
                expect(calls.length).to.equal(2)
            })
        })
    })
})
