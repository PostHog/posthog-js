import { expect, test } from '../fixtures'
import { NetworkPage } from '../fixtures/network'
import { PosthogPage } from '../fixtures/posthog'

const openTextQuestion = {
    type: 'open',
    question: 'What feedback do you have for us?',
    description: 'plain text description',
    id: 'open_text_1',
}

const linkQuestionWithHTMLContentType = {
    type: 'link',
    question: 'Book an interview with us',
    link: 'https://posthog.com',
    description: '<h2>html description</h2>',
    descriptionContentType: 'html',
    id: 'link_html_1',
}

const linkQuestionWithNoContentType = {
    type: 'link',
    question: 'Book an interview with us',
    link: 'https://posthog.com',
    description: '<h2>html description</h2>',
    id: 'link_no_content_1',
}

const linkQuestionWithTextContentType = {
    type: 'link',
    question: 'Book an interview with us',
    link: 'https://posthog.com',
    description: '<h2>html description</h2>',
    descriptionContentType: 'text',
    id: 'link_text_1',
}

const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankyouMessageHeader: 'Thanks!',
    thankyouMessageBody: 'We appreciate your feedback.',
}

const black = 'rgb(0, 0, 0)'
const white = 'rgb(255, 255, 255)'

test.describe('surveys - customization', () => {
    test.use({
        flagsOverrides: {
            surveys: true,
        },
        url: './playground/cypress/index.html',
    })
    test('automatically sets text color based on background color', async ({ page, posthog, events, network }) => {
        await initSurveys(
            [
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
            posthog,
            network
        )

        await events.waitForEvent('survey shown')
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText(
            'What feedback do you have for us?'
        )
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description')).toHaveText(
            'plain text description'
        )

        await expect(page.locator('.PostHogSurvey-123').locator('.footer-branding')).toBeVisible()

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toHaveCSS('background-color', black)
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toHaveCSS('color', white)

        await page.locator('.PostHogSurvey-123').locator('textarea').fill('This is great!')

        await page.locator('.PostHogSurvey-123').locator('.form-submit').click()

        await events.waitForEvent('survey sent')
    })

    test('does not show posthog logo if whiteLabel exists', async ({ page, posthog, events, network }) => {
        await initSurveys(
            [
                {
                    id: '123',
                    name: 'Test survey',
                    type: 'popover',
                    start_date: '2021-01-01T00:00:00Z',
                    questions: [openTextQuestion],
                    appearance: { whiteLabel: true },
                },
            ],
            posthog,
            network
        )

        await events.waitForEvent('survey shown')
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.footer-branding')).not.toBeVisible()
    })

    test('allows html customization for question and thank you element description', async ({
        page,
        posthog,
        events,
        network,
    }) => {
        await initSurveys(
            [
                {
                    id: '123',
                    name: 'Test survey',
                    type: 'popover',
                    start_date: '2021-01-01T00:00:00Z',
                    questions: [linkQuestionWithHTMLContentType],
                },
            ],
            posthog,
            network
        )

        await events.waitForEvent('survey shown')
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText(
            'Book an interview with us'
        )
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description h2')).toHaveText(
            'html description'
        )
    })

    test('allows html customization for question missing the descriptionContentType field (backfilling against surveys made before we introduced this field)', async ({
        page,
        network,
        events,
        posthog,
    }) => {
        await initSurveys(
            [
                {
                    id: '123',
                    name: 'Test survey',
                    type: 'popover',
                    start_date: '2021-01-01T00:00:00Z',
                    questions: [linkQuestionWithNoContentType],
                },
            ],
            posthog,
            network
        )

        await events.waitForEvent('survey shown')
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText(
            'Book an interview with us'
        )
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description h2')).toHaveText(
            'html description'
        )
    })

    test('allows html customization for thank you message body', async ({ page, posthog, network, events }) => {
        await initSurveys(
            [
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
            posthog,
            network
        )

        await events.waitForEvent('survey shown')
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText(
            'What feedback do you have for us?'
        )
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description')).toHaveText(
            'plain text description'
        )
        await page.locator('.PostHogSurvey-123').locator('textarea').type('This is great!')
        await page.locator('.PostHogSurvey-123').locator('.form-submit').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.thank-you-message-body h3')).toHaveText(
            'html thank you message!'
        )
        await events.waitForEvent('survey sent')
    })

    test('does not render html customization for question descriptions if the question.survey-question-descriptionContentType does not permit it', async ({
        page,
        posthog,
        events,
        network,
    }) => {
        await initSurveys(
            [
                {
                    id: '123',
                    name: 'Test survey',
                    type: 'popover',
                    start_date: '2021-01-01T00:00:00Z',
                    questions: [linkQuestionWithTextContentType],
                },
            ],
            posthog,
            network
        )

        await events.waitForEvent('survey shown')
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText(
            'Book an interview with us'
        )
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description h2')).toHaveCount(0)
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description')).toHaveText(
            '<h2>html description</h2>'
        )
    })

    test('does not render html customization for thank you message body if the question.thankYouMessageDescriptionContentType does not permit it', async ({
        page,
        posthog,
        network,
        events,
    }) => {
        await initSurveys(
            [
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
            posthog,
            network
        )

        await events.waitForEvent('survey shown')
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText(
            'What feedback do you have for us?'
        )
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description')).toHaveText(
            'plain text description'
        )
        await page.locator('.PostHogSurvey-123').locator('textarea').type('This is great!')
        await page.locator('.PostHogSurvey-123').locator('.form-submit').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.thank-you-message-body h3')).toHaveCount(0)
        await expect(page.locator('.PostHogSurvey-123').locator('.thank-you-message-body')).toHaveText(
            '<h3>html thank you message!</h3>'
        )
        await events.waitForEvent('survey sent')
    })
})

async function initSurveys(surveys: any[], posthog: PosthogPage, network: NetworkPage) {
    await network.mockSurveys(surveys)
    await posthog.init()
    await network.waitForSurveys()
}
