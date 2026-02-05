import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import {
    createPopoverSurvey,
    createEventTriggeredSurvey,
    captureEvent,
    surveyForm,
    dispatchConversationsOpenedEvent,
    mockSurveysApi,
    startWithSurveys,
    displaySurveyWhenLoaded,
    enableAndOpenConversations,
    openConversationsThenReload,
    conversationsConfig,
} from './utils'
import {
    createTour,
    createEventTriggeredTour,
    createBannerStep,
    tourTooltip,
    tourContainer,
    startWithTours,
    startOptionsWithProductTours,
    mockProductToursApi,
} from 'mocked/product-tours/utils'

const startOptionsWithAutoSurveys = {
    options: {},
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const startOptionsWithBothAuto = {
    options: {
        disable_product_tours: false,
    },
    flagsResponseOverrides: {
        surveys: true,
        productTours: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('widget coordination', () => {
    test.describe('blocking by conversations widget', () => {
        test('event-triggered tour does not show when conversations widget is already open', async ({
            page,
            context,
        }) => {
            const tour = createEventTriggeredTour('tour-blocked', 'trigger_tour')
            const toursApiRoute = mockProductToursApi(page, [tour])

            await start(startOptionsWithProductTours, page, context)
            await toursApiRoute

            await enableAndOpenConversations(page)

            await captureEvent(page, 'trigger_tour')
            await page.waitForTimeout(1000)

            await expect(tourTooltip(page, 'tour-blocked')).not.toBeVisible()
        })

        test('event-triggered survey does not show when conversations widget is already open', async ({
            page,
            context,
        }) => {
            const survey = createEventTriggeredSurvey('survey-blocked', 'trigger_survey')
            const surveysApiRoute = mockSurveysApi(page, [survey])

            await start(startOptionsWithAutoSurveys, page, context)
            await surveysApiRoute

            await enableAndOpenConversations(page)

            await captureEvent(page, 'trigger_survey')
            await page.waitForTimeout(1000)

            await expect(surveyForm(page, 'survey-blocked')).not.toBeVisible()
        })
    })

    test.describe('mutual exclusion (tour/survey)', () => {
        test('event-triggered tour does not show when survey is already displaying', async ({ page, context }) => {
            const survey = createPopoverSurvey('survey-first')
            const tour = createEventTriggeredTour('tour-second', 'trigger_tour')

            const surveysApiRoute = mockSurveysApi(page, [survey])
            const toursApiRoute = mockProductToursApi(page, [tour])

            await start(startOptionsWithBothAuto, page, context)
            await surveysApiRoute
            await toursApiRoute

            await expect(surveyForm(page, 'survey-first')).toBeVisible({ timeout: 5000 })

            await captureEvent(page, 'trigger_tour')
            await page.waitForTimeout(1000)

            await expect(tourTooltip(page, 'tour-second')).not.toBeVisible()
        })

        test('event-triggered survey does not show when tour is already displaying', async ({ page, context }) => {
            const tour = createTour({ id: 'tour-first', auto_launch: true })
            const survey = createEventTriggeredSurvey('survey-second', 'trigger_survey')

            const surveysApiRoute = mockSurveysApi(page, [survey])
            const toursApiRoute = mockProductToursApi(page, [tour])

            await start(startOptionsWithBothAuto, page, context)
            await toursApiRoute
            await surveysApiRoute

            await expect(tourTooltip(page, 'tour-first')).toBeVisible({ timeout: 5000 })

            await captureEvent(page, 'trigger_survey')
            await page.waitForTimeout(1000)

            await expect(surveyForm(page, 'survey-second')).not.toBeVisible()
        })
    })

    test.describe('auto-dismiss on conversations open', () => {
        test('active tour is dismissed when conversations widget opens', async ({ page, context }) => {
            const tour = createTour({ id: 'tour-dismiss', auto_launch: true })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'tour-dismiss')).toBeVisible({ timeout: 5000 })

            await dispatchConversationsOpenedEvent(page)

            await expect(tourTooltip(page, 'tour-dismiss')).not.toBeVisible()

            const events = await page.capturedEvents()
            const dismissEvent = events.find(
                (e) =>
                    e.event === 'product tour dismissed' &&
                    e.properties?.$product_tour_dismiss_reason === 'widget_conflict'
            )
            expect(dismissEvent).toBeTruthy()
        })

        test('active survey is dismissed when conversations widget opens', async ({ page, context }) => {
            const survey = createPopoverSurvey('survey-dismiss')
            const surveysApiRoute = mockSurveysApi(page, [survey])

            await start(startOptionsWithAutoSurveys, page, context)
            await surveysApiRoute

            await expect(surveyForm(page, 'survey-dismiss')).toBeVisible({ timeout: 5000 })

            await dispatchConversationsOpenedEvent(page)

            await expect(surveyForm(page, 'survey-dismiss')).not.toBeVisible()
        })
    })

    test.describe('banner tour exemptions', () => {
        test('banner tour shows even when conversations widget is open', async ({ page, context }) => {
            const bannerTour = createTour({
                id: 'banner-tour',
                auto_launch: true,
                steps: [createBannerStep({ contentHtml: '<p>Banner content</p>' })],
            })

            const toursApiRoute = mockProductToursApi(page, [bannerTour])

            await start(startOptionsWithProductTours, page, context)
            await toursApiRoute

            await enableAndOpenConversations(page)

            await expect(tourContainer(page, 'banner-tour')).toBeVisible({ timeout: 5000 })
        })

        test('survey auto-shows while banner tour is active', async ({ page, context }) => {
            const bannerTour = createTour({
                id: 'banner-with-survey',
                auto_launch: true,
                steps: [createBannerStep({ contentHtml: '<p>Banner content</p>' })],
            })
            const survey = createPopoverSurvey('survey-with-banner')

            const toursApiRoute = mockProductToursApi(page, [bannerTour])
            const surveysApiRoute = mockSurveysApi(page, [survey])

            await start(startOptionsWithBothAuto, page, context)
            await toursApiRoute
            await surveysApiRoute

            await expect(tourContainer(page, 'banner-with-survey')).toBeVisible({ timeout: 5000 })
            await expect(surveyForm(page, 'survey-with-banner')).toBeVisible({ timeout: 5000 })
        })

        test('banner tour is NOT auto-dismissed when conversations opens', async ({ page, context }) => {
            const bannerTour = createTour({
                id: 'banner-persist',
                auto_launch: true,
                steps: [createBannerStep({ contentHtml: '<p>Banner content</p>' })],
            })
            await startWithTours(page, context, [bannerTour])

            await expect(tourContainer(page, 'banner-persist')).toBeVisible({ timeout: 5000 })

            await dispatchConversationsOpenedEvent(page)
            await page.waitForTimeout(500)

            await expect(tourContainer(page, 'banner-persist')).toBeVisible()
        })
    })

    test.describe('delayed survey coordination', () => {
        test('delayed survey is cancelled when conversations opens during delay', async ({ page, context }) => {
            const survey = createPopoverSurvey('delayed-survey', {
                appearance: { surveyPopupDelaySeconds: 2 },
            })

            const surveysApiRoute = mockSurveysApi(page, [survey])

            await start(startOptionsWithAutoSurveys, page, context)
            await surveysApiRoute

            await expect(surveyForm(page, 'delayed-survey')).not.toBeVisible()

            await page.waitForTimeout(500)
            await dispatchConversationsOpenedEvent(page)

            await page.waitForTimeout(2000)

            await expect(surveyForm(page, 'delayed-survey')).not.toBeVisible()
        })
    })

    test.describe('programmatic display', () => {
        test('programmatic survey display ignores coordination by default', async ({ page, context }) => {
            const survey = createPopoverSurvey('survey-programmatic')

            await startWithSurveys(page, context, [survey])

            await enableAndOpenConversations(page)

            await displaySurveyWhenLoaded(page, 'survey-programmatic', false)

            await expect(surveyForm(page, 'survey-programmatic')).toBeVisible()
        })

        test('programmatic survey display respects coordination when opted in', async ({ page, context }) => {
            const survey = createPopoverSurvey('survey-coordinated')

            await startWithSurveys(page, context, [survey])

            await enableAndOpenConversations(page)

            await displaySurveyWhenLoaded(page, 'survey-coordinated', true)

            await page.waitForTimeout(1000)
            await expect(surveyForm(page, 'survey-coordinated')).not.toBeVisible()
        })

        test('programmatic tour display is blocked when conversations panel is open', async ({ page, context }) => {
            const tour = createTour({ id: 'tour-programmatic', auto_launch: false })

            await startWithTours(page, context, [tour])

            await enableAndOpenConversations(page)

            await page.evaluate(() => (window as any).posthog.productTours.showProductTour('tour-programmatic'))

            await expect(tourTooltip(page, 'tour-programmatic')).not.toBeVisible({ timeout: 5000 })
        })
    })

    test.describe('startup coordination', () => {
        test('survey is blocked when conversations auto-opens from persisted state', async ({ page, context }) => {
            const survey = createPopoverSurvey('survey-startup-blocked')
            const surveysApiRoute = mockSurveysApi(page, [survey])

            await openConversationsThenReload(page, context, { surveys: true })

            await surveysApiRoute
            await page.waitForTimeout(2000)

            await expect(surveyForm(page, 'survey-startup-blocked')).not.toBeVisible()
        })

        test('survey shows normally when conversations is ready but not open', async ({ page, context }) => {
            const survey = createPopoverSurvey('survey-startup-allowed')
            const surveysApiRoute = mockSurveysApi(page, [survey])

            await start(
                {
                    options: {},
                    flagsResponseOverrides: {
                        surveys: true,
                        conversations: conversationsConfig,
                    },
                    url: './playground/cypress/index.html',
                },
                page,
                context
            )

            await surveysApiRoute

            await expect(surveyForm(page, 'survey-startup-allowed')).toBeVisible({ timeout: 5000 })
        })

        test('tour is blocked when conversations auto-opens from persisted state', async ({ page, context }) => {
            const tour = createTour({ id: 'tour-startup-blocked', auto_launch: true })
            const toursApiRoute = mockProductToursApi(page, [tour])

            await openConversationsThenReload(page, context, { productTours: true })

            await toursApiRoute
            await page.waitForTimeout(2000)

            await expect(tourTooltip(page, 'tour-startup-blocked')).not.toBeVisible()
        })

        test('survey shows when conversations is disabled via config', async ({ page, context }) => {
            const survey = createPopoverSurvey('survey-convos-disabled')
            const surveysApiRoute = mockSurveysApi(page, [survey])

            await start(
                {
                    options: {
                        disable_conversations: true,
                    },
                    flagsResponseOverrides: {
                        surveys: true,
                    },
                    url: './playground/cypress/index.html',
                },
                page,
                context
            )

            await surveysApiRoute

            await expect(surveyForm(page, 'survey-convos-disabled')).toBeVisible({ timeout: 5000 })
        })

        test('survey shows when conversations is not in remote config', async ({ page, context }) => {
            const survey = createPopoverSurvey('survey-no-convos-config')
            const surveysApiRoute = mockSurveysApi(page, [survey])

            await start(
                {
                    options: {},
                    flagsResponseOverrides: {
                        surveys: true,
                    },
                    url: './playground/cypress/index.html',
                },
                page,
                context
            )

            await surveysApiRoute

            await expect(surveyForm(page, 'survey-no-convos-config')).toBeVisible({ timeout: 5000 })
        })

        test('survey shows when conversations is explicitly disabled in remote config', async ({ page, context }) => {
            const survey = createPopoverSurvey('survey-convos-false')
            const surveysApiRoute = mockSurveysApi(page, [survey])

            await start(
                {
                    options: {},
                    flagsResponseOverrides: {
                        surveys: true,
                        conversations: false,
                    },
                    url: './playground/cypress/index.html',
                },
                page,
                context
            )

            await surveysApiRoute

            await expect(surveyForm(page, 'survey-convos-false')).toBeVisible({ timeout: 5000 })
        })
    })
})
