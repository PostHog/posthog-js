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
// a survey armed by an event trigger is session-scoped, and a display delay resumes across a
// reload (rather than restarting from zero) so a user who navigates mid-delay still sees it.
test.describe('surveys - event trigger reload persistence', () => {
    test('an armed delayed survey resumes its delay across a reload and still shows', async ({ page, context }) => {
        // The popup delay used to be an in-memory timer discarded on navigation, so a user who
        // reloaded mid-delay restarted the countdown from zero on every page and never saw the
        // survey. The armed activation is now persisted for the session and the delay resumes, so
        // it displays after the reload without the trigger firing again.
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

        // Arm it, then reload before the delay elapses
        await page.evaluate(() => {
            ;(window as any).posthog.capture('trigger_event')
        })
        await page.reload()
        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall

        // No fresh trigger fires after the reload: the survey shows only because the armed
        // activation survived and the remaining delay elapsed.
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
