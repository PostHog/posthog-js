/// <reference types="cypress" />
import { getBase64EncodedPayload } from '../support/compression'

function onPageLoad(options = {}) {
    cy.posthogInit(options)
    cy.wait('@decide')
    cy.wait('@surveys')
}

describe('Surveys', () => {
    const openTextQuestion = {
        type: 'open',
        question: 'What feedback do you have for us?',
        description: 'plain text description',
    }
    const linkQuestion = {
        type: 'link',
        question: 'Book an interview with us',
        link: 'https://posthog.com',
        description: '<h2>html description</h2>',
    }
    const npsRatingQuestion = { type: 'rating', display: 'number', scale: 10, question: 'Would you recommend surveys?' }
    const emojiRatingQuestion = {
        type: 'rating',
        display: 'emoji',
        scale: 5,
        question: 'How happy are you with your purchase?',
        optional: true,
    }
    const multipleChoiceQuestion = {
        type: 'multiple_choice',
        question: 'Which types of content would you like to see more of?',
        choices: ['Tutorials', 'Product Updates', 'Events', 'Other'],
    }
    const singleChoiceQuestion = {
        type: 'single_choice',
        question: 'What is your occupation?',
        choices: ['Product Manager', 'Engineer', 'Designer', 'Other'],
    }
    const appearanceWithThanks = {
        displayThankYouMessage: true,
        thankyouMessageHeader: 'Thanks!',
        thankyouMessageBody: 'We appreciate your feedback.',
    }

    beforeEach(() => {
        cy.intercept('POST', '**/decide/*', {
            config: { enable_collect_everything: false },
            editorParams: {},
            surveys: true,
            isAuthenticated: false,
        }).as('decide')
    })

    describe('Survey question types', () => {
        it('shows and submits a basic survey', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [openTextQuestion],
                        appearance: appearanceWithThanks,
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            const survey = cy.get('.PostHogSurvey123').shadow()
            survey.find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.survey-question')
                .should('have.text', 'What feedback do you have for us?')
            cy.get('.PostHogSurvey123').shadow().find('.description').should('have.text', 'plain text description')
            survey.find('textarea').type('This is great!')
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
            cy.phCaptures().should('include', 'survey sent')
        })

        it('multiple question surveys', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '12345',
                        name: 'multiple question survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [multipleChoiceQuestion, openTextQuestion, { ...npsRatingQuestion, optional: true }],
                        appearance: appearanceWithThanks,
                    },
                ],
            }).as('surveys')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey12345').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey12345').shadow().find('#surveyQuestion0Choice1').click()
            cy.get('.PostHogSurvey12345').shadow().find('#surveyQuestion0Choice2').click()
            cy.get('.PostHogSurvey12345').shadow().find('.form-submit').eq(0).click()
            cy.get('.PostHogSurvey12345')
                .shadow()
                .find('textarea')
                .first()
                .type('Because I want to learn more about PostHog')
            cy.get('.PostHogSurvey12345').shadow().find('.form-submit').click()
            cy.get('.PostHogSurvey12345').shadow().find('.form-submit').click()
            cy.get('.PostHogSurvey12345').shadow().find('.form-submit').click()
            cy.wait('@capture-assertion')
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getBase64EncodedPayload(request)
                expect(captures.map(({ event }) => event)).to.deep.equal(['survey shown', 'survey sent'])
                expect(captures[1].properties['$survey_response']).to.deep.equal(['Product Updates', 'Events'])
                expect(captures[1].properties).to.contain({
                    $survey_id: '12345',
                    $survey_response_1: 'Because I want to learn more about PostHog',
                    $survey_response_2: null,
                })
            })
            expect(cy.get('.PostHogSurvey12345').shadow().find('.thank-you-message').should('be.visible'))
        })

        it('multiple choice questions with open choice', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '12345',
                        name: 'multiple choice survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [{ ...multipleChoiceQuestion, hasOpenChoice: true }],
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            onPageLoad()
            cy.wait('@capture-assertion')
            cy.get('.PostHogSurvey12345').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey12345').shadow().find('#surveyQuestion0Choice3').click()
            cy.get('.PostHogSurvey12345').shadow().find('#surveyQuestion0Choice0').click()
            cy.get('.PostHogSurvey12345').shadow().find('input[type=text]').type('Newsletters')
            cy.get('.PostHogSurvey12345').shadow().find('.form-submit').click()
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getBase64EncodedPayload(request)
                expect(captures.map(({ event }) => event)).to.deep.equal(['survey shown', 'survey sent'])
                expect(captures[1].properties['$survey_response']).to.deep.equal(['Tutorials', 'Newsletters'])
            })
        })

        it('single choice question with open choice', () => {
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '12345',
                        name: 'single choice survey',
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [{ ...singleChoiceQuestion, hasOpenChoice: true }],
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            onPageLoad()
            cy.wait('@capture-assertion')
            cy.get('.PostHogSurvey12345').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogSurvey12345').shadow().find('#surveyQuestion0Choice3').click()
            cy.get('.PostHogSurvey12345').shadow().find('input[type=text]').type('Product engineer')
            cy.get('.PostHogSurvey12345').shadow().find('.form-submit').click()
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getBase64EncodedPayload(request)
                expect(captures.map(({ event }) => event)).to.deep.equal(['survey shown', 'survey sent'])
                expect(captures[1].properties['$survey_response']).to.equal('Product engineer')
            })
        })
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
            cy.get('.PostHogSurvey123').shadow().find('.description').should('have.text', 'plain text description')
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
                        questions: [linkQuestion],
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
            cy.get('.PostHogSurvey123').shadow().find('.description').should('have.html', '<h2>html description</h2>')
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
            cy.get('.PostHogSurvey123').shadow().find('.description').should('have.text', 'plain text description')
            cy.get('.PostHogSurvey123').shadow().find('textarea').type('This is great!')
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
            cy.get('.PostHogSurvey123')
                .shadow()
                .find('.thank-you-message-body')
                .should('have.html', '<h3>html thank you message!</h3>')
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
            cy.get('.PostHogWidget123').shadow().find('.description').should('have.text', 'tab feedback widget')
            cy.get('.PostHogWidget123').shadow().find('textarea').type("Why can't I use behavioral cohorts in flags?")
            cy.get('.PostHogWidget123').shadow().find('.form-submit').click()
            cy.phCaptures().should('include', 'survey sent')
        })

        it('wigetType is custom selector', () => {
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
            cy.get('.PostHogWidget123').shadow().find('.survey-form').should('be.visible')
            cy.get('.PostHogWidget123').shadow().find('.survey-question').should('have.text', 'Feedback for us?')
            cy.get('.PostHogWidget123').shadow().find('.description').should('have.text', 'custom selector widget')
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
            cy.get('.PostHogWidget12345').shadow().find('.form-submit').click()
            cy.get('.PostHogWidget12345').shadow().find('.thank-you-message').should('be.visible')
            cy.phCaptures().should('include', 'survey shown')
            cy.phCaptures().should('include', 'survey sent')
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
                        appearance: appearanceWithThanks,
                    },
                ],
            }).as('surveys')
            cy.visit('./playground/cypress')
            onPageLoad()
            cy.get('.PostHogSurvey1234').shadow().find('.ratings-emoji').should('be.visible')
            cy.get('.PostHogSurvey1234').shadow().find('.ratings-emoji').first().click()
            cy.get('.PostHogSurvey1234').shadow().find('.form-submit').click()
            expect(cy.get('.PostHogSurvey1234').shadow().find('.thank-you-message').should('be.visible'))
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
            cy.wait(5000)
            expect(cy.get('.PostHogSurvey1234').shadow().find('.thank-you-message').should('not.exist'))
        })
    })

    describe('Survey response capture', () => {
        it('captures survey shown and survey dismissed events', () => {
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
            // first capture is $pageview
            cy.wait('@capture-assertion')
            cy.get('.PostHogSurvey123').shadow().find('.cancel-btn-wrapper').click()
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getBase64EncodedPayload(request)
                expect(captures.map(({ event }) => event)).to.deep.equal([
                    'survey shown',
                    'survey dismissed',
                    '$pageleave',
                ])
            })
        })

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
                const captures = await getBase64EncodedPayload(request)
                expect(captures.map(({ event }) => event)).to.deep.equal(['survey shown', 'survey sent'])
                expect(captures[1].properties).to.contain({
                    $survey_id: '123',
                    $survey_response: 'experiments is awesome!',
                })
            })
        })
    })
})
