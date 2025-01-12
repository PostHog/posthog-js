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

    describe('Survey customization', () => {
        it('automatically sets text color based on background color', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                        appearance: {
                            backgroundColor: '#000000',
                            submitButtonColor: '#ffffff',
                        },
                    },
                ],
            }).as('surveys')
            const black = 'rgb(0, 0, 0)'
            const white = 'rgb(255, 255, 255)'
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question')
                .should('have.text', 'What feedback do you have for us?')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question-description')
                .should('have.text', 'plain text description')
            // text should be white on a dark background
            cy.get('.PostHogSurvey123').shadow().find('.survey-question').should('have.css', 'background-color', black)
            cy.get('.PostHogSurvey123').shadow().find('.survey-question').should('have.css', 'color', white)
            // text should be black on a light background
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').should('have.css', 'background-color', white)
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').should('have.css', 'color', black)
            cy.get('.PostHogSurvey123').shadow().find('textarea').type('This is great!')
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
            cy.phCaptures().should('include', 'survey sent')
        })

        it('does not show posthog logo if whiteLabel exists', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                        appearance: { whiteLabel: true },
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.footer-branding').should('not.exist')
        })

        it('allows html customization for question and thank you element description', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [linkQuestionWithHTMLContentType],
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question')
                .should('have.text', 'Book an interview with us')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question-description')
                .should('have.html', '<h2>html description</h2>')
        })

        it('allows html customization for question missing the descriptionContentType field (backfilling against surveys made before we introduced this field)', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [linkQuestionWithNoContentType],
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question')
                .should('have.text', 'Book an interview with us')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question-description')
                .should('have.html', '<h2>html description</h2>')
        })

        it('allows html customization for thank you message body', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                        appearance: {
                            ...appearanceWithThanks,
                            thankYouMessageDescription: '<h3>html thank you message!</h3>',
                            thankYouMessageDescriptionContentType: 'html',
                        },
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question')
                .should('have.text', 'What feedback do you have for us?')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question-description')
                .should('have.text', 'plain text description')
            cy.get('.PostHogSurvey123').shadow().find('textarea').type('This is great!')
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.thank-you-message-body')
                .should('have.html', '<h3>html thank you message!</h3>')
            cy.phCaptures().should('include', 'survey sent')
        })

        it('does not render html customization for question descriptions if the question.survey-question-descriptionContentType does not permit it', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [linkQuestionWithTextContentType],
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question')
                .should('have.text', 'Book an interview with us')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question-description')
                .should('have.html', '&lt;h2&gt;html description&lt;/h2&gt;')
        })

        it('does not render html customization for thank you message body if the appearance.thankYouMessageDescriptionContentType does not permit it', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                        appearance: {
                            ...appearanceWithThanks,
                            thankYouMessageDescription: '<h3>html thank you message!</h3>',
                            thankYouMessageDescriptionContentType: 'text',
                        },
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question')
                .should('have.text', 'What feedback do you have for us?')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question-description')
                .should('have.text', 'plain text description')
            cy.get('.PostHogSurvey123').shadow().find('textarea').type('This is great!')
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.thank-you-message-body')
                .should('have.html', '&lt;h3&gt;html thank you message!&lt;/h3&gt;')
            cy.phCaptures().should('include', 'survey sent')
        })
    })

    describe('Feedback widget', () => {
        it('displays feedback tab and submits responses ', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Feedback tab survey',
                        type: 'widget',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [{ type: 'open', question: 'Feedback for us?', description: 'tab feedback widget' }],
                        appearance: {
                            widgetLabel: 'Feedback',
                            widgetType: 'tab',
                            displayThankYouMessage: true,
                            thankyouMessageHeader: 'Thanks!',
                            thankyouMessageBody: 'We appreciate your feedback.',
                        },
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogWidget123').shadow().find('.survey-form').should('not.exist')
            cy.get('.PostHogWidget123').shadow().find('.ph-survey-widget-tab').click()
            cy.get('.PostHogWidget123').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogWidget123').shadow().find('.survey-question').should('have.text', 'Feedback for us?')
            cy.get('.PostHogWidget123')
                .shadow()
                .find('.survey-question-description')
                .should('have.text', 'tab feedback widget')
            cy.get('.PostHogWidget123').shadow().find('textarea').type("Why can't I use behavioral cohorts in flags?")
            cy.get('.PostHogWidget123').shadow().find('.form-submit').click()
            cy.phCaptures().should('include', 'survey sent')
        })

        it('widgetType is custom selector', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Custom selector widget survey',
                        type: 'widget',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [
                            { type: 'open', question: 'Feedback for us?', description: 'custom selector widget' },
                        ],
                        appearance: {
                            widgetType: 'selector',
                            widgetSelector: '.test-surveys',
                            displayThankYouMessage: true,
                            thankyouMessageHeader: 'Thanks!',
                            thankyouMessageBody: 'We appreciate your feedback.',
                        },
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogWidget123').shadow().find('.ph-survey-widget-tab').should('not.exist')
            cy.get('.test-surveys').click()
            cy.wait(5000)
            cy.get('.PostHogWidget123').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogWidget123').shadow().find('.survey-question').should('have.text', 'Feedback for us?')
            cy.get('.PostHogWidget123')
                .shadow()
                .find('.survey-question-description')
                .should('have.text', 'custom selector widget')
            cy.get('.PostHogWidget123').shadow().find('textarea').type('PostHog is awesome!')
            cy.get('.PostHogWidget123').shadow().find('.form-submit').click()
            cy.phCaptures().should('include', 'survey sent')
        })

        it('displays multiple question surveys and thank you confirmation if enabled', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '12345',
                        name: 'multiple question survey',
                        type: 'widget',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [multipleChoiceQuestion, openTextQuestion, { ...npsRatingQuestion, optional: true }],
                        appearance: { ...appearanceWithThanks, widgetType: 'tab', widgetLabel: 'Feedback :)' },
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogWidget12345').shadow().find('.ph-survey-widget-tab').click()
            cy.get('.PostHogWidget12345').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogWidget12345').shadow().find('#surveyQuestion0Choice1').click()
            cy.get('.PostHogWidget12345').shadow().find('.form-submit').eq(0).click()
            cy.get('.PostHogWidget12345')
                .shadow()
                .find('textarea')
                .first()
                .type('Because I want to learn more about PostHog')
            cy.get('.PostHogWidget12345').shadow().find('.form-submit').click()
            cy.get('.PostHogWidget12345').shadow().find('.form-submit').click()
            cy.get('.PostHogWidget12345').shadow().find('.thank-you-message').should('be.visible')
            cy.phCaptures().should('include', 'survey shown')
            cy.phCaptures().should('include', 'survey sent')
        })

        it('auto contrasts text color for feedback tab', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Feedback tab survey',
                        type: 'widget',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                        appearance: {
                            widgetLabel: 'Feedback',
                            widgetType: 'tab',
                            widgetColor: 'white',
                        },
                    },
                ],
            }).as('surveys')
            const black = 'rgb(0, 0, 0)'
            const white = 'rgb(255, 255, 255)'
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogWidget123')
                .shadow()
                .find('.ph-survey-widget-tab')
                .should('have.css', 'background-color', white)
            cy.get('.PostHogWidget123').shadow().find('.ph-survey-widget-tab').should('have.css', 'color', black)
        })
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
