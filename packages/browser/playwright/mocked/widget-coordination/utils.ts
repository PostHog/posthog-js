import { Page, BrowserContext } from '@playwright/test'
import { Survey } from '@/posthog-surveys-types'
import { start, StartOptions } from '../utils/setup'
import { expect } from '../utils/posthog-playwright-test-base'

export function surveyForm(page: Page, surveyId: string) {
    return page.locator(`.PostHogSurvey-${surveyId}`).locator('.survey-form')
}

export function createPopoverSurvey(id: string, overrides: Partial<Survey> = {}): Survey {
    return {
        id,
        name: `Test survey ${id}`,
        type: 'popover',
        start_date: '2021-01-01T00:00:00Z',
        end_date: null,
        questions: [{ type: 'open', question: 'Feedback?', id: `q_${id}` }],
        ...overrides,
    } as Survey
}

export function createEventTriggeredSurvey(id: string, eventName: string, overrides: Partial<Survey> = {}): Survey {
    return createPopoverSurvey(id, {
        conditions: {
            events: {
                values: [{ name: eventName }],
            },
            actions: { values: [] },
            cancelEvents: { values: [] },
        },
        ...overrides,
    })
}

export async function captureEvent(page: Page, eventName: string) {
    await page.evaluate((name) => {
        ;(window as any).posthog.capture(name)
    }, eventName)
}

export function mockSurveysApi(page: Page, surveys: Survey[]) {
    return page.route('**/surveys/**', async (route) => {
        await route.fulfill({
            json: { surveys },
        })
    })
}

export const conversationsConfig = {
    enabled: true,
    widgetEnabled: true,
    token: 'test-token',
}

function conversationsWidgetButton(page: Page) {
    return page.locator('#ph-conversations-widget-container button').first()
}

async function enableConversations(page: Page) {
    await page.evaluate(() => {
        const posthog = (window as any).posthog
        if (posthog && posthog.conversations) {
            posthog.conversations.onRemoteConfig({
                conversations: {
                    enabled: true,
                    token: 'test-conversations-token',
                    widgetEnabled: true,
                },
            })
        }
    })
}

async function openConversationsWidget(page: Page) {
    await conversationsWidgetButton(page).click()
}

export async function enableAndOpenConversations(page: Page) {
    await enableConversations(page)
    await expect(conversationsWidgetButton(page)).toBeVisible({ timeout: 10000 })
    await openConversationsWidget(page)
}

/**
 * Opens conversations widget, then reloads the page so conversations auto-opens from persisted state.
 * Use this to test that surveys/tours are blocked when conversations is already open on page load.
 */
export async function openConversationsThenReload(
    page: Page,
    context: BrowserContext,
    reloadFlags: Record<string, unknown> = {}
) {
    // First load: just open conversations to persist the open state
    await start(
        {
            options: {},
            flagsResponseOverrides: {},
            url: './playground/cypress/index.html',
        },
        page,
        context
    )
    await enableAndOpenConversations(page)

    // Reload the page - conversations should auto-open from persisted state
    await start(
        {
            options: {},
            flagsResponseOverrides: {
                conversations: conversationsConfig,
                ...reloadFlags,
            },
            url: './playground/cypress/index.html',
            type: 'reload',
        },
        page,
        context
    )
}

export async function dispatchConversationsOpenedEvent(page: Page) {
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('PHConversationsWidgetOpened'))
    })
}

export async function displaySurveyWhenLoaded(page: Page, surveyId: string, respectWidgetCoordination = false) {
    await page.evaluate(
        ({ id, respect }) => {
            ;(window as any).posthog.onSurveysLoaded(() => {
                ;(window as any).posthog.displaySurvey(id, {
                    displayType: 'popover',
                    ignoreConditions: true,
                    respectWidgetCoordination: respect,
                })
            })
        },
        { id: surveyId, respect: respectWidgetCoordination }
    )
}

export const startOptionsWithSurveys: StartOptions = {
    options: {
        disable_surveys_automatic_display: true,
    },
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

export async function startWithSurveys(
    page: Page,
    context: BrowserContext,
    surveys: Survey[],
    options: { startOptions?: StartOptions } = {}
): Promise<void> {
    const { startOptions = startOptionsWithSurveys } = options

    const surveysApiRoute = page.route('**/surveys/**', async (route) => {
        await route.fulfill({
            json: { surveys },
        })
    })

    await start(startOptions, page, context)
    await surveysApiRoute
}
