import { expect, test } from '../utils/posthog-playwright-test-base'
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

// These exercise the real reload + localStorage path that the unit tests can only simulate:
// an event-armed survey is session-scoped until shown, and only persists once it has displayed.
test.describe('surveys - event trigger reload persistence', () => {
    test('an armed-but-unshown survey does not survive a reload', async ({ page, context }) => {
        // A display delay keeps the survey armed-but-not-yet-shown long enough to reload mid-flight.
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'armed-survey',
                            name: 'Armed survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            appearance: { surveyPopupDelaySeconds: 3 },
                            conditions: { events: { values: [{ name: 'trigger_event' }] } },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        const survey = page.locator('.PostHogSurvey-armed-survey').locator('.survey-form')

        // Arm it, then reload before the delay elapses (so it never shows / is never persisted)
        await page.evaluate(() => {
            ;(window as any).posthog.capture('trigger_event')
        })
        await page.reload()
        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall

        // Wait past the original display delay: a persisted arming would have re-displayed by now
        await page.waitForTimeout(5000)
        await expect(survey).not.toBeVisible()

        // Sanity check the survey itself is still displayable when the event fires in-session
        await page.evaluate(() => {
            ;(window as any).posthog.capture('trigger_event')
        })
        await expect(survey).toBeVisible({ timeout: 10000 })
    })

    test('a shown non-repeatable survey survives a reload until interacted with', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'persist-survey',
                            name: 'Persist survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: { events: { values: [{ name: 'trigger_event' }] } },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        const survey = page.locator('.PostHogSurvey-persist-survey').locator('.survey-form')

        await page.evaluate(() => {
            ;(window as any).posthog.capture('trigger_event')
        })
        await expect(survey).toBeVisible()

        // Shown but not interacted: it was promoted to persistence, so a reload re-displays it
        await page.reload()
        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall
        await expect(survey).toBeVisible()

        // Once dismissed it is consumed and does not come back
        await page.locator('.PostHogSurvey-persist-survey').locator('.form-cancel').click()
        await expect(survey).not.toBeInViewport()

        await page.reload()
        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall
        await expect(survey).not.toBeInViewport()
    })

    test('a repeatable survey is consumed on shown and does not survive a reload', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'repeatable-survey',
                            name: 'Repeatable survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: { values: [{ name: 'trigger_event' }], repeatedActivation: true },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        const survey = page.locator('.PostHogSurvey-repeatable-survey').locator('.survey-form')

        await page.evaluate(() => {
            ;(window as any).posthog.capture('trigger_event')
        })
        await expect(survey).toBeVisible()

        // Consumed on shown, never persisted: a reload does not re-display it without a fresh trigger
        await page.reload()
        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall
        await page.waitForTimeout(2000)
        await expect(survey).not.toBeVisible()

        // A fresh trigger shows it again
        await page.evaluate(() => {
            ;(window as any).posthog.capture('trigger_event')
        })
        await expect(survey).toBeVisible({ timeout: 10000 })
    })
})
