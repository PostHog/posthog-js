import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const survey = {
    id: 'matching-subscription-survey',
    name: 'Matching subscription survey',
    type: 'api',
    start_date: '2021-01-01T00:00:00Z',
    end_date: null,
    questions: [{ type: 'open', question: 'Any feedback?', id: 'feedback' }],
    conditions: { events: { values: [{ name: 'subscription_trigger' }] } },
}

const startOptions = {
    options: { capture_pageview: 'history_change' as const, disable_session_recording: true },
    flagsResponseOverrides: { surveys: true },
    url: '/playground/cypress/index.html',
}

test.describe('surveys - compiled active matching subscription', () => {
    test('observes SPA pageviews and refreshed definitions without another activation', async ({ page, context }) => {
        const targeted = { ...survey, conditions: { ...survey.conditions, url: '/checkout' } }
        let definitions = [targeted]
        await page.route('**/surveys/**', (route) => route.fulfill({ json: { surveys: definitions } }))
        const initialResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await initialResponse

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog!
            const calls: string[][] = []
            ;(window as any).__matchingCalls = calls
            ;(window as any).__matchingUnsubscribe = ph.onActiveMatchingSurveysChanged((matching) => {
                calls.push(matching.map((item) => item.id))
            })
            ph.capture('subscription_trigger')
        })
        await expect.poll(() => page.evaluate(() => (window as any).__matchingCalls)).toEqual([[]])

        await page.evaluate(() => window.history.pushState({}, '', '/checkout'))
        await expect.poll(() => page.evaluate(() => (window as any).__matchingCalls)).toEqual([[], [survey.id]])

        definitions = []
        await page.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    ;(window as WindowWithPostHog).posthog!.getSurveys(() => resolve(), true)
                })
        )
        await expect.poll(() => page.evaluate(() => (window as any).__matchingCalls)).toEqual([[], [survey.id], []])

        await page.evaluate(() => {
            ;(window as any).__matchingUnsubscribe()
        })
        definitions = [targeted]
        await page.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    ;(window as WindowWithPostHog).posthog!.getSurveys(() => resolve(), true)
                })
        )
        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog!.capture('subscription_trigger')
        })
        expect(await page.evaluate(() => (window as any).__matchingCalls)).toEqual([[], [survey.id], []])
    })

    test('consumes an action-only survey through the public capture path', async ({ page, context }) => {
        const actionOnly = {
            ...survey,
            conditions: {
                actions: { values: [{ id: 1, name: 'upgrade', steps: [{ event: 'account_upgraded' }] }] },
            },
        }
        await page.route('**/surveys/**', (route) => route.fulfill({ json: { surveys: [actionOnly] } }))
        const initialResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await initialResponse

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog!
            const calls: string[][] = []
            ;(window as any).__matchingCalls = calls
            ph.onActiveMatchingSurveysChanged((matching) => calls.push(matching.map((item) => item.id)))
            ph.capture('account_upgraded')
        })
        await expect.poll(() => page.evaluate(() => (window as any).__matchingCalls)).toEqual([[], [survey.id]])
        await page.evaluate((id) => {
            const ph = (window as WindowWithPostHog).posthog!
            ph.capture('survey shown', { $survey_id: id })
            ph.capture('survey sent', { $survey_id: id })
        }, survey.id)
        await expect.poll(() => page.evaluate(() => (window as any).__matchingCalls)).toEqual([[], [survey.id], []])
    })

    test('does not deliver the pending initial response after unsubscribe', async ({ page, context }) => {
        let releaseResponse!: () => void
        let reportRequest!: () => void
        const responseGate = new Promise<void>((resolve) => {
            releaseResponse = resolve
        })
        const requestStarted = new Promise<void>((resolve) => {
            reportRequest = resolve
        })
        await page.route('**/surveys/**', async (route) => {
            reportRequest()
            await responseGate
            await route.fulfill({ json: { surveys: [survey] } })
        })
        const initialResponse = page.waitForResponse('**/surveys/**')
        try {
            await start(startOptions, page, context)
            await requestStarted
            await page.evaluate(() => {
                const calls: string[][] = []
                ;(window as any).__matchingCalls = calls
                const unsubscribe = (window as WindowWithPostHog).posthog!.onActiveMatchingSurveysChanged(
                    (matching) => {
                        calls.push(matching.map((item) => item.id))
                    }
                )
                unsubscribe()
                unsubscribe()
            })
        } finally {
            releaseResponse()
        }
        await initialResponse
        // Wait for the shared request callbacks to drain rather than using an arbitrary sleep.
        await page.evaluate(
            () =>
                new Promise<void>((resolve) => {
                    ;(window as WindowWithPostHog).posthog!.getSurveys(() => resolve())
                })
        )
        expect(await page.evaluate(() => (window as any).__matchingCalls)).toEqual([])
    })
})
