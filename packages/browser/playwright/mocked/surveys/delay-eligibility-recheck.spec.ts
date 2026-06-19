import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { FlagsResponse } from '@/types'

// Regression test for a "show once per user" survey re-appearing to users who had already
// dismissed it. The survey's internal targeting flag passes while the visitor is still
// anonymous, so it is queued with its display delay; identify() then reloads flags and the
// flag flips to false for the identified profile. The delayed display must re-check
// eligibility and NOT show the survey.

const INTERNAL_TARGETING_FLAG = 'survey-targeting-recheck-test'

const openTextQuestion = {
    type: 'open',
    question: 'What feedback do you have for us?',
    description: 'plain text description',
    id: 'open_text_1',
}

const makeSurvey = (id: string) => ({
    id,
    name: 'Delayed targeted survey',
    description: 'description',
    type: 'popover',
    start_date: '2021-01-01T00:00:00Z',
    questions: [openTextQuestion],
    internal_targeting_flag_key: INTERNAL_TARGETING_FLAG,
    appearance: { surveyPopupDelaySeconds: 2 },
})

// A complete `/flags` response with the internal targeting flag set to `enabled`.
const flagsResponseWith = (enabled: boolean): Partial<FlagsResponse> =>
    ({
        editorParams: {},
        flags: {
            [INTERNAL_TARGETING_FLAG]: {
                key: INTERNAL_TARGETING_FLAG,
                enabled,
                variant: undefined,
                reason: {
                    code: enabled ? 'condition_match' : 'no_condition_match',
                    condition_index: 0,
                    description: 'test',
                },
                metadata: { id: 1, version: 1, description: undefined, payload: undefined },
            },
        },
        featureFlags: { [INTERNAL_TARGETING_FLAG]: enabled },
        featureFlagPayloads: {},
        errorsWhileComputingFlags: false,
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
        supportedCompression: [],
        autocaptureExceptions: false,
        surveys: true,
        sessionRecording: false,
    }) as unknown as Partial<FlagsResponse>

const startOptions = {
    options: {},
    // Anonymous load: the targeting flag is enabled, so the survey is eligible and queued.
    flagsResponseOverrides: flagsResponseWith(true),
    url: './playground/cypress/index.html',
}

test.describe('surveys - re-validate eligibility when the display delay elapses', () => {
    test('does not show a delayed survey once identify() flips its targeting flag to false', async ({
        page,
        context,
    }) => {
        const survey = makeSurvey('delay-recheck-suppressed')
        await page.route('**/surveys/**', (route) => route.fulfill({ json: { surveys: [survey] } }))

        await start(startOptions, page, context)

        // identify() reloads flags; replace the flags mock so the identified profile is no
        // longer targeted (unroute first so this handler, not the anonymous one, serves the reload).
        await context.unroute('**/flags/*')
        await context.route('**/flags/*', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(flagsResponseWith(false)),
            })
        )
        await page.evaluate(() => (window as WindowWithPostHog).posthog?.identify('identified-user-123'))

        // Wait past the 2s display delay; the survey must never render.
        await page.waitForTimeout(3500)
        await expect(page.locator('.PostHogSurvey-delay-recheck-suppressed').locator('.survey-form')).not.toBeVisible()
    })

    test('still shows a delayed survey that stays targeted (no identify)', async ({ page, context }) => {
        const survey = makeSurvey('delay-recheck-control')
        await page.route('**/surveys/**', (route) => route.fulfill({ json: { surveys: [survey] } }))

        await start(startOptions, page, context)

        // Flag stays enabled throughout: the survey appears once the delay elapses.
        await expect(page.locator('.PostHogSurvey-delay-recheck-control').locator('.survey-form')).toBeVisible({
            timeout: 8000,
        })
    })
})
