import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { createTour, mockProductToursApi } from './product-tours/utils'
import { Z_INDEX_TOURS, Z_INDEX_SURVEYS, Z_INDEX_CONVERSATIONS } from '@/constants'

const startOptions = {
    options: {
        disable_product_tours: false,
    },
    flagsResponseOverrides: {
        surveys: true,
        productTours: true,
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
    test('tours have higher z-index than surveys, surveys higher than support', async ({ page, context }) => {
        // Mock surveys API
        const surveysRoute = page.route('**/surveys/**', async (route) => {
            await route.fulfill({ json: { surveys: [survey] } })
        })

        // Mock product tours API
        const tour = createTour({ id: 'zindex-tour' })
        const toursRoute = mockProductToursApi(page, [tour])

        await start(startOptions, page, context)
        await surveysRoute
        await toursRoute

        // Wait for both to render
        await expect(page.locator('.PostHogSurvey-zindex-survey .survey-form')).toBeVisible()
        await expect(page.locator('.ph-product-tour-container-zindex-tour .ph-tour-tooltip')).toBeVisible()

        // Enable conversations widget
        await page.evaluate(() => {
            const posthog = (window as any).posthog
            if (posthog?.conversations) {
                posthog.conversations.onRemoteConfig({
                    conversations: {
                        enabled: true,
                        token: 'test-token',
                        widgetEnabled: true,
                    },
                })
            }
        })

        // Wait for conversations widget to render (container has no dimensions, check for the button inside)
        await expect(page.locator('#ph-conversations-widget-container button')).toBeVisible()

        // Read computed z-index values
        const tourZIndex = await page
            .locator('.ph-product-tour-container-zindex-tour .ph-tour-tooltip')
            .evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10))

        const surveyZIndex = await page
            .locator('.PostHogSurvey-zindex-survey .survey-form')
            .evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10))

        const conversationsZIndex = await page
            .locator('#ph-conversations-widget-container > div')
            .evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10))

        // Assert hierarchy: tours > surveys > support
        expect(tourZIndex).toBeGreaterThan(surveyZIndex)
        expect(surveyZIndex).toBeGreaterThan(conversationsZIndex)

        // Assert exact values match constants
        expect(tourZIndex).toBe(Z_INDEX_TOURS + 1) // tooltip is calc(base + 1)
        expect(surveyZIndex).toBe(Z_INDEX_SURVEYS)
        expect(conversationsZIndex).toBe(Z_INDEX_CONVERSATIONS)
    })
})
