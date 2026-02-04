import { BrowserContext, Page } from '@playwright/test'
import { ProductTour, ProductTourStep } from '@/posthog-product-tours-types'
import { FeatureFlagDetail } from '@/types'
import { start, StartOptions } from '../utils/setup'
import {
    TOUR_SHOWN_KEY_PREFIX,
    TOUR_COMPLETED_KEY_PREFIX,
    TOUR_DISMISSED_KEY_PREFIX,
    ACTIVE_TOUR_SESSION_KEY,
} from '@/extensions/product-tours/constants'

export { ACTIVE_TOUR_SESSION_KEY }

export const tourShownKey = (tourId: string) => `${TOUR_SHOWN_KEY_PREFIX}${tourId}`
export const tourCompletedKey = (tourId: string) => `${TOUR_COMPLETED_KEY_PREFIX}${tourId}`
export const tourDismissedKey = (tourId: string) => `${TOUR_DISMISSED_KEY_PREFIX}${tourId}`

export const startOptionsWithProductTours: StartOptions = {
    options: {
        disable_product_tours: false,
    },
    flagsResponseOverrides: {
        productTours: true,
    },
    url: './playground/cypress/index.html',
}

const defaultStep: ProductTourStep = {
    id: 'step-1',
    type: 'modal',
    progressionTrigger: 'button',
    content: null,
    contentHtml: '<p>This is a test tour step</p>',
}

export function createStep(overrides: Partial<ProductTourStep> = {}): ProductTourStep {
    return { ...defaultStep, ...overrides }
}

export function createTour(overrides: Partial<ProductTour> = {}): ProductTour {
    const id = overrides.id || 'test-tour'
    return {
        id,
        name: `Test Tour ${id}`,
        type: 'product_tour',
        auto_launch: true,
        start_date: '2021-01-01T00:00:00Z',
        end_date: null,
        steps: [createStep()],
        display_frequency: 'until_interacted',
        ...overrides,
    }
}

export function createEventTriggeredTour(
    id: string,
    eventName: string,
    overrides: Partial<ProductTour> = {}
): ProductTour {
    return createTour({
        id,
        auto_launch: false,
        conditions: {
            events: {
                values: [{ name: eventName }],
            },
        },
        ...overrides,
    })
}

export function createElementStep(selector: string, overrides: Partial<ProductTourStep> = {}): ProductTourStep {
    return createStep({
        type: 'element',
        selector,
        useManualSelector: true,
        ...overrides,
    })
}

export function createBannerStep(overrides: Partial<ProductTourStep> = {}): ProductTourStep {
    return createStep({
        type: 'banner',
        contentHtml: '<p>Banner content</p>',
        bannerConfig: { behavior: 'static' },
        ...overrides,
    })
}

export function mockProductToursApi(page: Page, tours: ProductTour[]) {
    return page.route('**/api/product_tours/**', async (route) => {
        await route.fulfill({
            json: { product_tours: tours },
        })
    })
}

export function tourContainer(page: Page, tourId: string) {
    return page.locator(`.ph-product-tour-container-${tourId}`)
}

export function tourTooltip(page: Page, tourId: string) {
    return tourContainer(page, tourId).locator('.ph-tour-tooltip')
}

export function createFlagsOverride(
    flags: Record<string, { enabled: boolean; variant?: string }>
): Record<string, FeatureFlagDetail> {
    return Object.fromEntries(
        Object.entries(flags).map(([key, { enabled, variant }]) => [
            key,
            {
                key,
                enabled,
                variant,
                reason: { code: 'condition_match', condition_index: 0, description: 'Matched' },
                metadata: { id: 1, version: 1, description: undefined, payload: undefined },
            } as FeatureFlagDetail,
        ])
    )
}

export async function startWithTours(
    page: Page,
    context: BrowserContext,
    tours: ProductTour[],
    options: { waitForApiResponse?: boolean; startOptions?: StartOptions } = {}
): Promise<void> {
    const { waitForApiResponse = false, startOptions = startOptionsWithProductTours } = options

    const toursApiRoute = mockProductToursApi(page, tours)

    if (waitForApiResponse) {
        const toursResponse = page.waitForResponse('**/api/product_tours/**')
        await start(startOptions, page, context)
        await toursApiRoute
        await toursResponse
    } else {
        await start(startOptions, page, context)
        await toursApiRoute
    }
}

export function getSessionState(page: Page): Promise<{ tourId?: string; stepIndex?: number }> {
    return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || '{}'), ACTIVE_TOUR_SESSION_KEY)
}

export function captureEvent(page: Page, eventName: string, properties?: Record<string, unknown>): Promise<void> {
    return page.evaluate(
        ({ name, props }) => {
            ;(window as any).posthog.capture(name, props)
        },
        { name: eventName, props: properties }
    )
}
