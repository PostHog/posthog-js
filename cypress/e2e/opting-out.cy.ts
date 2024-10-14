import { assertWhetherPostHogRequestsWereCalled, pollPhCaptures } from '../support/assertions'
import { start } from '../support/setup'

function assertThatRecordingStarted() {
    cy.phCaptures({ full: true }).then((captures) => {
        expect(captures.map((c) => c.event)).to.deep.equal(['$snapshot'])

        expect(captures[0]['properties']['$snapshot_data']).to.have.length.above(2)
        // a meta and then a full snapshot
        expect(captures[0]['properties']['$snapshot_data'][0].type).to.equal(4) // meta
        expect(captures[0]['properties']['$snapshot_data'][1].type).to.equal(2) // full_snapshot
    })
}

describe('opting out', () => {
    describe('session recording', () => {
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

        it('does not capture recordings when config disables session recording', () => {
            cy.posthogInit({ disable_session_recording: true })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures().then((captures) => {
                        expect(captures || []).to.deep.equal(['$pageview'])
                    })
                })
        })

        it('can start recording after starting opted out', () => {
            cy.posthogInit({ opt_out_capturing_by_default: true })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.posthog().invoke('opt_in_capturing')
            // TODO: should we require this call?
            cy.posthog().invoke('startSessionRecording')

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$opt_in', '$pageview'])
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': true,
                '@decide': true,
                // no call to session-recording yet
            })

            cy.resetPhCaptures()

            cy.get('[data-cy-input]').type('hello posthog!')

            pollPhCaptures('$snapshot').then(assertThatRecordingStarted)
        })

        it('can start recording when starting disabled', () => {
            cy.posthogInit({ disable_session_recording: true })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures().then((captures) => {
                        expect(captures || []).to.deep.equal(['$pageview'])
                    })
                })

            cy.resetPhCaptures()
            cy.posthog().invoke('startSessionRecording')

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': true,
                '@decide': true,
                // no call to session-recording yet
            })

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    pollPhCaptures('$snapshot').then(assertThatRecordingStarted)
                })
        })

        it('can override sampling when starting session recording', () => {
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

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.posthog().invoke('opt_in_capturing')

            cy.posthog().invoke('startSessionRecording', { sampling: true })

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$opt_in', '$pageview'])
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': true,
                '@decide': true,
                // no call to session-recording yet
            })

            cy.resetPhCaptures()

            cy.get('[data-cy-input]').type('hello posthog!')

            pollPhCaptures('$snapshot').then(assertThatRecordingStarted)
        })

        it('can override linked_flags when starting session recording', () => {
            cy.intercept('POST', '/decide/*', {
                autocapture_opt_out: true,
                editorParams: {},
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                    // a flag that doesn't exist, can never be recorded
                    linkedFlag: 'i am a flag that does not exist',
                },
            }).as('decide')

            cy.posthogInit({
                opt_out_capturing_by_default: true,
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.posthog().invoke('opt_in_capturing')

            cy.posthog().invoke('startSessionRecording')

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$opt_in', '$pageview'])
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': true,
                '@decide': true,
                // no call to session-recording yet
            })

            cy.resetPhCaptures()

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures().then((captures) => {
                        // no session recording events yet
                        expect(captures || []).to.deep.equal([])
                    })
                })

            cy.posthog().invoke('startSessionRecording', { linked_flag: true })

            cy.get('[data-cy-input]').type('hello posthog!')

            pollPhCaptures('$snapshot').then(assertThatRecordingStarted)
        })

        it('respects sampling when overriding linked_flags when starting session recording', () => {
            cy.intercept('POST', '/decide/*', {
                autocapture_opt_out: true,
                editorParams: {},
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                    // a flag that doesn't exist, can never be recorded
                    linkedFlag: 'i am a flag that does not exist',
                    // will never record a session with rate of 0
                    sampleRate: '0',
                },
            }).as('decide')

            cy.posthogInit({
                opt_out_capturing_by_default: true,
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.posthog().invoke('opt_in_capturing')

            cy.posthog().invoke('startSessionRecording')

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$opt_in', '$pageview'])
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': true,
                '@decide': true,
                // no call to session-recording yet
            })

            cy.resetPhCaptures()

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures().then((captures) => {
                        // no session recording events yet
                        expect(captures || []).to.deep.equal([])
                    })
                })

            cy.posthog().invoke('startSessionRecording', { linked_flag: true })

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures().then((captures) => {
                        // no session recording events yet
                        expect((captures || []).length).to.equal(0)
                    })
                })
        })

        it('can override all ingestion controls when starting session recording', () => {
            cy.intercept('POST', '/decide/*', {
                autocapture_opt_out: true,
                editorParams: {},
                isAuthenticated: false,
                sessionRecording: {
                    endpoint: '/ses/',
                    // a flag that doesn't exist, can never be recorded
                    linkedFlag: 'i am a flag that does not exist',
                    // will never record a session with rate of 0
                    sampleRate: '0',
                },
            }).as('decide')

            cy.posthogInit({
                opt_out_capturing_by_default: true,
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': false,
                '@decide': true,
                '@session-recording': false,
            })

            cy.posthog().invoke('opt_in_capturing')

            cy.posthog().invoke('startSessionRecording')

            cy.phCaptures({ full: true }).then((captures) => {
                expect((captures || []).map((c) => c.event)).to.deep.equal(['$opt_in', '$pageview'])
            })

            assertWhetherPostHogRequestsWereCalled({
                '@recorder-script': true,
                '@decide': true,
                // no call to session-recording yet
            })

            cy.resetPhCaptures()

            cy.get('[data-cy-input]')
                .type('hello posthog!')
                .then(() => {
                    cy.phCaptures().then((captures) => {
                        // no session recording events yet
                        expect(captures || []).to.deep.equal([])
                    })
                })

            cy.posthog().invoke('startSessionRecording', true)

            cy.get('[data-cy-input]').type('hello posthog!')

            pollPhCaptures('$snapshot').then(assertThatRecordingStarted)
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
