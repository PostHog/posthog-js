/// <reference types="cypress" />
import { getPayload } from '../support/compression'
import 'cypress-localstorage-commands'

function onPageLoad(options = {}) {
    cy.posthog().then((ph) => {
        ph.persistence?.properties().clear()
    })

    cy.posthogInit(options)
    cy.wait('@decide')
    cy.wait('@surveys')
}

describe('Surveys', () => {


    beforeEach(() => {
        cy.intercept('POST', '**/decide/*', {
            editorParams: {},
            surveys: true,
            isAuthenticated: false,
            autocapture_opt_out: true,
        }).as('decide')
    })

    describe('Thank you message', () => {
        it('shows confirmation message after submitting', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '1234',
                        name: 'Test survey 2',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [emojiRatingQuestion],
                        appearance: { ...appearanceWithThanks, backgroundColor: 'black' },
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey1234').shadow().find('.ratings-emoji').should('be.visible')
            cy.get('.PostHogSurvey1234').shadow().find('.ratings-emoji').first().click()
            cy.get('.PostHogSurvey1234').shadow().find('.form-submit').click()
            cy.get('.PostHogSurvey1234').shadow().find('.thank-you-message').should('be.visible')
        })

        it('counts down with auto disappear after 5 seconds', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '1234',
                        name: 'Test survey 2',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [emojiRatingQuestion],
                        appearance: { ...appearanceWithThanks, autoDisappear: true },
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey1234').shadow().find('.ratings-emoji').should('be.visible')
            cy.get('.PostHogSurvey1234').shadow().find('.ratings-emoji').first().click()
            cy.get('.PostHogSurvey1234').shadow().find('.form-submit').click()
            expect(cy.get('.PostHogSurvey1234').shadow().find('.thank-you-message').should('be.visible'))
            cy.wait(5000) // mimic the 5 second timeout
            expect(cy.get('.PostHogSurvey1234').shadow().find('.thank-you-message').should('not.exist'))
        })
    })

    describe('Survey response capture', () => {
        it('captures survey sent event', () => {
            cy.visit('./playground/cypress')
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        description: 'description',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                    },
                ],
            }).as('surveys')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('textarea').type('experiments is awesome!')
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
            cy.wait('@capture-assertion')
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getPayload(request)
                expect(captures.map(({ event }) => event)).to.deep.equal(['survey shown', 'survey sent'])
                expect(captures[1].properties).to.contain({
                    $survey_id: '123',
                    $survey_response: 'experiments is awesome!',
                })
            })
        })

        it('captures survey sent event with iteration', () => {
            cy.visit('./playground/cypress')
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        description: 'description',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                        current_iteration: 2,
                        current_iteration_start_date: '12-12-2004',
                    },
                ],
            }).as('surveys')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('textarea').type('experiments is awesome!')
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
            cy.wait('@capture-assertion')
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getPayload(request)
                expect(captures.map(({ event }) => event)).to.deep.equal(['survey shown', 'survey sent'])
                expect(captures[1].properties).to.contain({
                    $survey_id: '123',
                    $survey_response: 'experiments is awesome!',
                    $survey_iteration: 2,
                    $survey_iteration_start_date: '12-12-2004',
                })
            })
        })

        it('captures survey shown event', () => {
            cy.visit('./playground/cypress')
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        description: 'description',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                    },
                ],
            }).as('surveys')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            onPageLoad()
            cy.wait('@capture-assertion')
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getPayload(request)
                expect(captures[0].event).to.equal('survey shown')
            })
        })

        it('captures survey shown event with iteration', () => {
            cy.visit('./playground/cypress')
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        description: 'description',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                        current_iteration: 2,
                        current_iteration_start_date: '12-12-2004',
                    },
                ],
            }).as('surveys')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            onPageLoad()
            cy.wait('@capture-assertion')
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getPayload(request)
                expect(captures[0].event).to.equal('survey shown')
                expect(captures[0].properties).to.contain({
                    $survey_id: '123',
                    $survey_iteration: 2,
                    $survey_iteration_start_date: '12-12-2004',
                })
            })
        })

        it('captures survey dismissed event', () => {
            cy.visit('./playground/cypress')
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        description: 'description',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                    },
                ],
            }).as('surveys')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.cancel-btn-wrapper').click()
            cy.wait('@capture-assertion')
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getPayload(request)
                expect(captures.map(({ event }) => event)).to.contain('survey dismissed')
            })
        })

        it('captures survey dismissed event with iteration', () => {
            cy.visit('./playground/cypress')
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        description: 'description',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                        current_iteration: 2,
                        current_iteration_start_date: '12-12-2004',
                    },
                ],
            }).as('surveys')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.cancel-btn-wrapper').click()
            cy.wait('@capture-assertion')
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getPayload(request)
                const dismissedEvent = captures.filter(({ event }) => event == 'survey dismissed')[0]
                expect(dismissedEvent).to.not.be.null
                expect(dismissedEvent.properties).to.contain({
                    $survey_id: '123',
                    $survey_iteration: 2,
                    $survey_iteration_start_date: '12-12-2004',
                })
            })
        })
    })
})
