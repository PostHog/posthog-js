import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { waitForSurveyDefinitions } from '../utils/survey-readiness'

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
        await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') })
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse
        await waitForSurveyDefinitions(page)
        await page.clock.pauseAt(new Date('2024-01-01T00:01:00Z'))

        const survey = page.locator('.PostHogSurvey-armed-survey').locator('.survey-form')

        // Arm it, then reload before the delay elapses
        await page.evaluate(() => {
            ;(window as any).posthog.capture('trigger_event')
        })
        await page.clock.runFor(2000)
        await expect(page.locator('.PostHogSurvey-armed-survey')).toBeAttached()
        await expect(survey).not.toBeVisible()
        await start({ ...startOptions, type: 'reload', waitForFlags: false }, page, context)
        // oxlint-disable-next-line posthog-js/no-direct-function-check -- Serialized browser code cannot import isFunction.
        await page.waitForFunction(() => typeof (window as any).posthog?.getFeatureFlag === 'function')
        await page.clock.runFor(100)
        await surveysAPICall
        await waitForSurveyDefinitions(page)
        await page.clock.runFor(1000)

        // No fresh trigger fires after the reload: the survey shows only because the armed
        // Activation survived and only the remaining delay elapsed.
        await expect(survey).toBeVisible()
    })

    test('an armed delayed survey does not survive a session rotation across a reload', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'rotated-session-survey',
                            name: 'Rotated session survey',
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

        const survey = page.locator('.PostHogSurvey-rotated-session-survey').locator('.survey-form')

        await page.evaluate(() => {
            ;(window as any).posthog.capture('trigger_event')
        })

        // Rotate after arming but before the next load. The persisted activation belongs to the
        // triggering session, so the receiver must clear it when the new session is announced.
        const [previousSessionId, nextSessionId] = await page.evaluate(() => {
            const posthog = (window as any).posthog
            const previousSessionId = posthog.get_session_id()
            posthog.sessionManager.resetSessionId()
            const nextSessionId = posthog.sessionManager.checkAndGetSessionAndWindowId(false).sessionId
            return [previousSessionId, nextSessionId]
        })
        expect(nextSessionId).not.toBe(previousSessionId)

        await page.reload()
        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall

        await page.waitForTimeout(5000)
        await expect(survey).not.toBeVisible()

        // The survey remains displayable when it receives a fresh trigger in the new session.
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
        await waitForSurveyDefinitions(page)
        await page.waitForTimeout(2200)
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
