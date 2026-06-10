import { expect, test } from './utils/posthog-playwright-test-base'
import { start, waitForRemoteConfig } from './utils/setup'
import { assertThatRecordingStarted, pollUntilEventCaptured } from './utils/event-capture-utils'
import { Page } from '@playwright/test'
import { ENABLED_FEATURE_FLAGS, PERSISTENCE_FEATURE_FLAG_DETAILS, SESSION_ID, SURVEYS } from '@/constants'

// `setup.ts` always inits with the token 'test token', so the persistence name
// (and therefore the split-entry keys) are fixed for these tests.
const MAIN_KEY = 'ph_test token_posthog'
const MY_FLAG = 'my-flag'
const PAGE = './playground/cypress/index.html'

const flagOn = (key: string) => ({
    [key]: { key, enabled: true, variant: undefined, reason: undefined, metadata: undefined },
})

// Reads the PostHog localStorage entries: the main blob plus the per-group
// `__flags` / `__surveys` entries that `split_storage` partitions data into.
async function readPersistence(page: Page): Promise<{ main?: any; flags?: any; surveys?: any }> {
    return page.evaluate(() => {
        const snap: { main?: any; flags?: any; surveys?: any } = {}
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i) as string
            if (key.indexOf('ph_') !== 0) {
                continue
            }
            let value: any = window.localStorage.getItem(key)
            try {
                value = JSON.parse(value as string)
            } catch {
                // leave as the raw string
            }
            if (key.endsWith('__flags')) {
                snap.flags = value
            } else if (key.endsWith('__surveys')) {
                snap.surveys = value
            } else if (key.endsWith('_posthog')) {
                snap.main = value
            }
        }
        return snap
    })
}

const getFlag = (page: Page, flag: string): Promise<any> =>
    page.evaluate((f) => (window as any).posthog?.getFeatureFlag(f), flag)

test.describe('split storage (split_storage)', () => {
    test('gate off (default): flags stay in the single blob, no group entries', async ({ page, context }) => {
        await start(
            {
                options: {},
                flagsResponseOverrides: { featureFlags: { [MY_FLAG]: true }, flags: flagOn(MY_FLAG) },
                url: PAGE,
            },
            page,
            context
        )

        await expect.poll(() => getFlag(page, MY_FLAG)).toBe(true)

        const snap = await readPersistence(page)
        expect(snap.flags).toBeUndefined()
        expect(snap.surveys).toBeUndefined()
        // with the gate off the flag cluster rides in the main blob, as before
        expect(snap.main?.[ENABLED_FEATURE_FLAGS]?.[MY_FLAG]).toBe(true)
    })

    test('gate on: the flag cluster is written to the __flags entry and stripped from main', async ({
        page,
        context,
    }) => {
        await start(
            {
                options: { split_storage: true },
                flagsResponseOverrides: { featureFlags: { [MY_FLAG]: true }, flags: flagOn(MY_FLAG) },
                url: PAGE,
            },
            page,
            context
        )

        await expect.poll(() => getFlag(page, MY_FLAG)).toBe(true)

        const snap = await readPersistence(page)
        // the cluster now lives in its own entry...
        expect(snap.flags?.[ENABLED_FEATURE_FLAGS]?.[MY_FLAG]).toBe(true)
        // ...and has been migrated out of the main blob, which keeps everything else
        expect(snap.main?.[ENABLED_FEATURE_FLAGS]).toBeUndefined()
        expect(snap.main?.distinct_id).toBeTruthy()
    })

    test('gate on: flags survive a reload via the __flags entry', async ({ page, context }) => {
        const options = { split_storage: true }
        const flagsResponseOverrides = { featureFlags: { [MY_FLAG]: true }, flags: flagOn(MY_FLAG) }

        await start({ options, flagsResponseOverrides, url: PAGE }, page, context)
        await expect.poll(() => getFlag(page, MY_FLAG)).toBe(true)

        await start({ options, flagsResponseOverrides, url: PAGE, type: 'reload' }, page, context)

        await expect.poll(() => getFlag(page, MY_FLAG)).toBe(true)
        const snap = await readPersistence(page)
        expect(snap.flags?.[ENABLED_FEATURE_FLAGS]?.[MY_FLAG]).toBe(true)
        expect(snap.main?.[ENABLED_FEATURE_FLAGS]).toBeUndefined()
    })

    test('gate on: a pre-existing single blob is migrated — flags move out, the rest stays', async ({
        page,
        context,
    }) => {
        await start(
            {
                options: { split_storage: true },
                flagsResponseOverrides: { featureFlags: { [MY_FLAG]: true }, flags: flagOn(MY_FLAG) },
                url: PAGE,
                // seed an old-layout single blob (flags inline) before PostHog initialises
                runBeforePostHogInit: async (p) => {
                    await p.evaluate(({ key, blob }) => window.localStorage.setItem(key, JSON.stringify(blob)), {
                        key: MAIN_KEY,
                        blob: {
                            distinct_id: 'migrated-user',
                            [ENABLED_FEATURE_FLAGS]: { 'cached-flag': true },
                            [PERSISTENCE_FEATURE_FLAG_DETAILS]: { flags: {} },
                        },
                    })
                },
            },
            page,
            context
        )

        await expect.poll(() => getFlag(page, MY_FLAG)).toBe(true)

        const snap = await readPersistence(page)
        // the seeded identity survives the migration...
        expect(snap.main?.distinct_id).toBe('migrated-user')
        // ...but the flag cluster has been lifted out of the main blob into __flags
        expect(snap.main?.[ENABLED_FEATURE_FLAGS]).toBeUndefined()
        expect(snap.flags?.[ENABLED_FEATURE_FLAGS]).toBeTruthy()
    })

    test('gate on (surveys): $surveys is split out, the survey shows, and dismissal survives reload', async ({
        page,
        context,
    }) => {
        const surveyId = '123'
        // Register the survey mock before the page loads (await the route setup,
        // not after start) so the initial /surveys request is intercepted — the
        // route stays installed across the later reload too.
        await page.route('**/surveys/**', (route) =>
            route.fulfill({
                json: {
                    surveys: [
                        {
                            id: surveyId,
                            name: 'Split storage survey',
                            description: 'description',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                { type: 'open', question: 'What feedback do you have for us?', id: 'open_text_1' },
                            ],
                        },
                    ],
                },
            })
        )

        const options = { split_storage: true }
        const flagsResponseOverrides = { surveys: true }

        await start({ options, flagsResponseOverrides, url: PAGE }, page, context)

        await expect(page.locator(`.PostHogSurvey-${surveyId}`).locator('.survey-form')).toBeVisible()

        // $surveys must not ride in the main blob when the gate is on
        const snap = await readPersistence(page)
        expect(snap.main?.[SURVEYS]).toBeUndefined()

        await page.locator(`.PostHogSurvey-${surveyId}`).locator('.form-cancel').click()
        await expect(page.locator(`.PostHogSurvey-${surveyId}`).locator('.survey-form')).not.toBeInViewport()

        await page.reload()
        await start({ options, flagsResponseOverrides, url: PAGE, type: 'reload' }, page, context)

        // a dismissed survey stays dismissed across the reload with the gate on
        await expect(page.locator(`.PostHogSurvey-${surveyId}`).locator('.survey-form')).not.toBeInViewport()
    })

    test('gate on (replay): linked-flag recording still starts, and SESSION_ID stays in the main blob', async ({
        page,
        context,
    }) => {
        const linkedFlag = 'my-linked-flag'
        const recorderPromise = page.waitForResponse('**/*recorder.js*')

        await start(
            {
                options: {
                    split_storage: true,
                    opt_out_capturing_by_default: false,
                    session_recording: { compress_events: false },
                },
                flagsResponseOverrides: {
                    sessionRecording: { endpoint: '/ses/', linkedFlag },
                    featureFlags: { [linkedFlag]: true },
                    flags: flagOn(linkedFlag),
                    capturePerformance: true,
                    autocapture_opt_out: true,
                },
                url: PAGE,
            },
            page,
            context
        )

        await waitForRemoteConfig(page)
        await recorderPromise

        // drop the startup $pageview so the recording assertion sees only $snapshot
        await page.resetCapturedEvents()

        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)

        // the session id is not a split key — it must remain in the main blob
        const snap = await readPersistence(page)
        expect(snap.flags?.[SESSION_ID]).toBeUndefined()
        expect(snap.surveys?.[SESSION_ID]).toBeUndefined()
        expect(snap.main?.[SESSION_ID]).toBeTruthy()
    })
})
