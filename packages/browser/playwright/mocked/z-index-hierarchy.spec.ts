import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { Z_INDEX_SURVEYS, Z_INDEX_CONVERSATIONS } from '@/constants'

const startOptions = {
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const survey = {
    id: 'zindex-survey',
    name: 'Z-index test survey',
    type: 'popover' as const,
    start_date: '2021-01-01T00:00:00Z',
    questions: [{ type: 'open', question: 'Feedback?', id: 'q1' }],
}

test.describe('z-index hierarchy', () => {
    test('surveys have higher z-index than support', async ({ page, context }) => {
        // Mock surveys API
        const surveysRoute = page.route('**/surveys/**', async (route) => {
            await route.fulfill({ json: { surveys: [survey] } })
        })

        await start(startOptions, page, context)
        await surveysRoute

        await expect(page.locator('.PostHogSurvey-zindex-survey .survey-form')).toBeVisible()

        // Enable conversations widget
        await page.evaluate(() => {
            const posthog = (window as any).posthog
            if (posthog?.conversations) {
                posthog.conversations.onRemoteConfig({
                    ok: true,
                    config: {
                        conversations: {
                            enabled: true,
                            token: 'test-token',
                            widgetEnabled: true,
                        },
                    },
                })
            }
        })

        // Wait for conversations widget to render (container has no dimensions, check for the button inside)
        await expect(page.locator('#ph-conversations-widget-container button')).toBeVisible()

        // Read computed z-index values
        const surveyZIndex = await page
            .locator('.PostHogSurvey-zindex-survey .survey-form')
            .evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10))

        const conversationsZIndex = await page
            .locator('#ph-conversations-widget-container > div')
            .evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10))

        expect(surveyZIndex).toBeGreaterThan(conversationsZIndex)

        // Assert exact values match constants
        expect(surveyZIndex).toBe(Z_INDEX_SURVEYS)
        expect(conversationsZIndex).toBe(Z_INDEX_CONVERSATIONS)
    })
})
