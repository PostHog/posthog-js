/// <reference types="cypress" />
import { getBase64EncodedPayload } from '../support/compression'

function onPageLoad() {
    cy.posthogInit(given.options)
    cy.wait('@decide')
    cy.wait('@surveys')
}

describe('Surveys', () => {
    given('options', () => ({}))
    beforeEach(() => {
        cy.intercept('POST', '**/decide/*', {
            config: { enable_collect_everything: false },
            editorParams: {},
            featureFlags: ['session-recording-player'],
            surveys: true,
            isAuthenticated: false,
        }).as('decide')
    })
    it('shows and submits a basic survey', () => {
        cy.intercept('GET', '**/surveys/*', {
            surveys: [
                {
                    id: '123',
                    name: 'Test survey',
                    active: true,
                    type: 'popover',
                    start_date: '2021-01-01T00:00:00Z',
                    questions: [{ type: 'open', question: 'What is your role?', description: 'test description' }],
                },
            ],
        }).as('surveys')
        cy.visit('./playground/cypress')
        onPageLoad()
        cy.wait(500)
        const survey = cy.get('.PostHogSurvey123').shadow()
        survey.find('.survey-123-form').should('be.visible')
        cy.get('.PostHogSurvey123').shadow().find('.survey-question').should('have.text', 'What is your role?')
        cy.get('.PostHogSurvey123').shadow().find('.description').should('have.text', 'test description')
        survey.find('.question-textarea-wrapper').type('product engineer')
        cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
        cy.phCaptures().should('include', 'survey sent')
    })

    it('shows confirmation message after submitting', () => {
        cy.intercept('GET', '**/surveys/*', {
            surveys: [
                {
                    id: '1234',
                    name: 'Test survey 2',
                    active: true,
                    type: 'popover',
                    start_date: '2021-01-01T00:00:00Z',
                    questions: [
                        { type: 'rating', display: 'number', scale: 10, question: 'Would you recommend surveys?' },
                    ],
                    appearance: {
                        displayThankYouMessage: true,
                        thankyouMessageHeader: 'Thanks!',
                        thankyouMessageBody: 'We appreciate your feedback.',
                    },
                },
            ],
        }).as('surveys')
        cy.visit('./playground/cypress')
        onPageLoad()
        cy.get('.PostHogSurvey1234').shadow().find('.ratings-number').should('be.visible')
        cy.get('.PostHogSurvey1234').shadow().find('.ratings-number').first().click()
        cy.get('.PostHogSurvey1234').shadow().find('.form-submit').click()
        expect(cy.get('.PostHogSurvey1234').shadow().find('.thank-you-message').should('be.visible'))
    })

    it('multiple question surveys', () => {
        cy.intercept('GET', '**/surveys/*', {
            surveys: [
                {
                    id: '12345',
                    name: 'multiple question survey',
                    active: true,
                    type: 'popover',
                    start_date: '2021-01-01T00:00:00Z',
                    questions: [
                        {
                            question: 'Which types of content would you like to see more of?',
                            description: 'This is a question description',
                            type: 'multiple_choice',
                            choices: ['Tutorials', 'Product Updates', 'Events', 'Other'],
                        },
                        { type: 'open', question: 'Why?' },
                        {
                            type: 'rating',
                            display: 'emoji',
                            scale: 5,
                            question: 'How does this survey make you feel?',
                            optional: true,
                        },
                        {
                            type: 'link',
                            question: 'Would you like to participate in a user study?',
                            link: 'https://posthog.com',
                            buttonText: 'Yes',
                        },
                    ],
                    appearance: {
                        displayThankYouMessage: true,
                        thankyouMessageHeader: 'Thanks!',
                        thankyouMessageBody: 'We appreciate your feedback.',
                    },
                },
            ],
        }).as('surveys')
        cy.intercept('POST', '**/e/*').as('capture-assertion')
        cy.visit('./playground/cypress')
        onPageLoad()
        cy.wait(500)
        cy.get('.PostHogSurvey12345').shadow().find('.survey-12345-form').should('be.visible')
        cy.get('.PostHogSurvey12345').shadow().find('#surveyQuestion0Choice1').click()
        cy.get('.PostHogSurvey12345').shadow().find('#surveyQuestion0Choice2').click()
        cy.get('.PostHogSurvey12345').shadow().find('.form-submit').eq(0).click()
        cy.get('.PostHogSurvey12345')
            .shadow()
            .find('.question-textarea-wrapper')
            .first()
            .type('Because I want to learn more about PostHog')
        cy.get('.PostHogSurvey12345').shadow().find('.form-submit').eq(1).click()
        cy.get('.PostHogSurvey12345').shadow().find('.form-submit').eq(2).click()
        cy.get('.PostHogSurvey12345').shadow().find('.form-submit').eq(3).click()
        cy.wait('@capture-assertion')
        cy.wait('@capture-assertion').then(async ({ request }) => {
            const captures = await getBase64EncodedPayload(request)
            expect(captures.map(({ event }) => event)).to.deep.equal(['survey shown', 'survey sent'])
            expect(captures[1].properties['$survey_response']).to.deep.equal(['Product Updates', 'Events'])
            expect(captures[1].properties).to.contain({
                $survey_id: '12345',
                $survey_response_1: 'Because I want to learn more about PostHog',
                $survey_response_2: null,
                $survey_response_3: 'link clicked',
            })
        })
        expect(cy.get('.PostHogSurvey12345').shadow().find('.thank-you-message').should('be.visible'))
    })

    describe('survey response capture', () => {
        it('captures survey shown and survey dismissed events', () => {
            cy.visit('./playground/cypress')
            cy.intercept('GET', '**/surveys/*', {
                surveys: [
                    {
                        id: '123',
                        name: 'Test survey',
                        description: 'description',
                        active: true,
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [{ type: 'open', question: 'What is a survey event capture test?' }],
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
                expect(captures.map(({ event }) => event)).to.deep.equal(['survey shown', 'survey dismissed'])
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
                        active: true,
                        type: 'popover',
                        start_date: '2021-01-01T00:00:00Z',
                        questions: [{ type: 'open', question: 'What is a survey event capture test?' }],
                    },
                ],
            }).as('surveys')
            cy.intercept('POST', '**/e/*').as('capture-assertion')
            onPageLoad()
            cy.get('.PostHogSurvey123').shadow().find('.question-textarea-wrapper').type('product engineer')
            cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
            cy.wait('@capture-assertion')
            cy.wait('@capture-assertion').then(async ({ request }) => {
                const captures = await getBase64EncodedPayload(request)
                expect(captures.map(({ event }) => event)).to.deep.equal(['survey shown', 'survey sent'])
                expect(captures[1].properties).to.contain({ $survey_id: '123', $survey_response: 'product engineer' })
            })
        })
    })
})
