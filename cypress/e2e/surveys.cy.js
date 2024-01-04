/// <reference types="cypress" />

function onPageLoad() {
    cy.posthogInit(given.options)
    cy.wait('@decide')
    cy.wait('@surveys')
}

describe('Surveys', () => {
    given('options', () => ({}))
    let mockSurveys = [
        {
            id: '123',
            name: 'Test survey',
            active: true,
            type: 'popover',
            start_date: '2021-01-01T00:00:00Z',
            questions: [{ type: 'open', question: 'What is your role?' }],
        },
    ]
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
                    questions: [{ type: 'open', question: 'What is your role?' }],
                },
            ],
        }).as('surveys')
        cy.visit('./playground/cypress')
        onPageLoad()
        cy.wait(500)
        const survey = cy.get('.PostHogSurvey123').shadow()
        survey.find('.survey-123-form').should('be.visible')
        survey.find('.question-textarea-wrapper').type('product engineer')
        cy.get('.PostHogSurvey123').shadow().find('.form-submit').click()
        cy.phCaptures().should('include', 'survey sent')
    })

    it('shows confirmation message after submitting', () => {
        mockSurveys = [
            {
                id: '1234',
                name: 'Test survey 2',
                active: true,
                type: 'popover',
                start_date: '2021-01-01T00:00:00Z',
                questions: [{ type: 'rating', display: 'number', scale: 10, question: 'Would you recommend surveys?' }],
                appearance: {
                    displayThankYouMessage: true,
                    thankyouMessageHeader: 'Thanks!',
                    thankyouMessageBody: 'We appreciate your feedback.',
                },
            },
        ]
        cy.intercept('GET', '**/surveys/*', {
            surveys: mockSurveys,
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
                        { type: 'open', question: 'Why?', optional: true },
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
        cy.visit('./playground/cypress')
        onPageLoad()
        cy.wait(500)
        cy.get('.PostHogSurvey12345').shadow().find('.survey-12345-form').should('be.visible')
        cy.get('.PostHogSurvey12345').shadow().find('#surveyQuestion0Choice1').click()
        cy.get('.PostHogSurvey12345').shadow().find('#surveyQuestion0Choice2').click()
        cy.get('.PostHogSurvey12345').shadow().find('.form-submit').eq(0).click()
        cy.get('.PostHogSurvey12345').shadow().find('.form-submit').eq(1).click()
        cy.get('.PostHogSurvey12345').shadow().find('.form-submit').eq(2).click()
        cy.get('.PostHogSurvey12345').shadow().find('.form-submit').eq(3).click()
        expect(cy.get('.PostHogSurvey12345').shadow().find('.thank-you-message').should('be.visible'))
    })
})
