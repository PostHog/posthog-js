import { CaptureResult } from '@/types'
import { PosthogPage, testPostHog } from './posthog'

const INGESTION_TIMEOUT = 30 * 60 * 1000 // 30 min
const currentEnv = process.env
const {
    POSTHOG_PERSONAL_API_KEY = 'private_key',
    POSTHOG_API_HOST = 'http://localhost:2345',
    POSTHOG_PROJECT_ID = '1',
} = currentEnv

export const testIngestion = testPostHog.extend<{}, { ingestion: IngestionPage }>({
    ingestion: [
        async ({}, use) => {
            const ingestion = new IngestionPage()
            ingestion.checkEnv()
            await use(ingestion)
            // eslint-disable-next-line no-console
            console.log(`
            Waiting for events from tests to appear in PostHog.
            You can manually confirm whether the events have shown up at ${POSTHOG_API_HOST}/project/${POSTHOG_PROJECT_ID}/activity/explore
            If they seem to be failing unexpectedly, check grafana for ingestion lag at https://grafana.prod-us.posthog.dev/d/homepage/homepage
            `)
            await ingestion.processSessionChecks()
        },
        { scope: 'worker', timeout: INGESTION_TIMEOUT },
    ],
})

const dedupeEventsByUuid = (events: CaptureResult[]): CaptureResult[] => {
    const seen = new Set<string>()

    return events.filter((event) => {
        if (!event.uuid) {
            return true
        }

        if (seen.has(event.uuid)) {
            return false
        }

        seen.add(event.uuid)
        return true
    })
}

export class IngestionPage {
    sessionChecks: {
        testSessionId: string
        testTitle: string
        eventsCount: number
        check: (events: CaptureResult[]) => Promise<void>
    }[] = []

    constructor() {}

    addSessionCheck(
        posthog: PosthogPage,
        eventsCount: number,
        check: (events: CaptureResult[]) => Promise<void>
    ): void {
        this.sessionChecks.push({
            testSessionId: posthog.getTestSessionId(),
            testTitle: posthog.getTestTitle(),
            eventsCount,
            check,
        })
    }

    checkEnv() {
        if (!POSTHOG_API_HOST || !POSTHOG_PROJECT_ID || !POSTHOG_PERSONAL_API_KEY) {
            throw new Error(
                'POSTHOG_API_HOST, POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY env variables must be set'
            )
        }
    }

    async processSessionChecks(): Promise<void> {
        for (const { testSessionId, testTitle, eventsCount, check } of this.sessionChecks) {
            await this.retrieveSessionEvents(testSessionId, testTitle, eventsCount, check)
        }
    }

    private async retrieveSessionEvents(
        sessionId: string,
        testTitle: string,
        count: number,
        check: (events: CaptureResult[]) => Promise<void>
    ): Promise<CaptureResult[]> {
        return await retryUntilResults(() => queryAPI(sessionId), count, sessionId, testTitle, { validate: check })
    }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// NOTE: This is limited by the real production ingestion lag, which you can see in grafana is usually
// in the low minutes https://grafana.prod-us.posthog.dev/d/homepage/homepage
// We keep polling until the semantic assertion passes, so this timeout should match the CI job timeout.
export async function retryUntilResults(
    operation: () => Promise<CaptureResult[]>,
    target_results: number,
    testSessionId: string,
    testTitle: string,
    {
        timeout = INGESTION_TIMEOUT,
        pollingIntervalSeconds = 30,
        maxAllowedApiErrors = 5,
        validate,
    }: {
        timeout?: number
        pollingIntervalSeconds?: number
        maxAllowedApiErrors?: number
        validate?: (results: CaptureResult[]) => Promise<void>
    } = {}
) {
    const start = Date.now()
    const deadline = start + timeout
    let api_errors = 0
    let attempts = 0
    let last_api_error: unknown = null
    let last_validation_error: unknown = null
    let elapsedSeconds = 0

    do {
        attempts++
        let results
        try {
            results = await operation()
        } catch (err) {
            api_errors++
            last_api_error = err
            // eslint-disable-next-line no-console
            console.error('API Error:', err)
        }

        if (results) {
            const dedupedResults = dedupeEventsByUuid(results)
            elapsedSeconds = Math.floor((Date.now() - start) / 1000)

            if (dedupedResults.length !== results.length) {
                // eslint-disable-next-line no-console
                console.warn(
                    `De-duped ${results.length - dedupedResults.length} duplicate ingested events (attempt: ${attempts}, testSessionId: ${testSessionId}, testTitle: ${testTitle})`
                )
            }

            if (validate) {
                try {
                    await validate(dedupedResults)
                    // eslint-disable-next-line no-console
                    console.log(
                        `Validated results after ${elapsedSeconds} seconds (attempt: ${attempts}, testSessionId: ${testSessionId}, testTitle: ${testTitle}, resultCount: ${dedupedResults.length})`
                    )
                    return dedupedResults
                } catch (err) {
                    last_validation_error = err
                    const message = err instanceof Error ? err.message : String(err)
                    // eslint-disable-next-line no-console
                    console.log(
                        `Validation failed with ${dedupedResults.length} results (attempt: ${attempts}, testSessionId: ${testSessionId}, testTitle: ${testTitle}): ${message}`
                    )
                }
            } else if (dedupedResults.length >= target_results) {
                // eslint-disable-next-line no-console
                console.log(
                    `Got correct number of results (${target_results}) after ${elapsedSeconds} seconds (attempt: ${attempts}, testSessionId: ${testSessionId}, testTitle: ${testTitle})`
                )
                return dedupedResults
            } else {
                // eslint-disable-next-line no-console
                console.log(
                    `Expected ${target_results} results, got ${dedupedResults.length} (attempt: ${attempts}, testSessionId: ${testSessionId}, testTitle: ${testTitle})`
                )
            }
        }

        await delay(pollingIntervalSeconds * 1000)
    } while (api_errors < maxAllowedApiErrors && Date.now() <= deadline)

    if (api_errors >= maxAllowedApiErrors && last_api_error) {
        throw last_api_error
    }

    if (last_validation_error) {
        const message =
            last_validation_error instanceof Error ? last_validation_error.message : String(last_validation_error)
        throw new Error(
            `Timed out after ${elapsedSeconds} seconds waiting for validated results (attempt: ${attempts}, testSessionId: ${testSessionId}, testTitle: ${testTitle}). Last validation error: ${message}`,
            { cause: last_validation_error instanceof Error ? last_validation_error : undefined }
        )
    }

    throw new Error(
        `Timed out after ${elapsedSeconds} seconds (attempt: ${attempts}, testSessionId: ${testSessionId}, testTitle: ${testTitle})`
    )
}

export async function queryAPI(testSessionId: string) {
    const HEADERS = { Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}` }
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const url = `${POSTHOG_API_HOST}/api/projects/${POSTHOG_PROJECT_ID}/events?properties=[{"key":"testSessionId","value":["${testSessionId}"],"operator":"exact","type":"event"}]&after=${yesterday}`
    const response = await fetch(url, {
        headers: HEADERS,
    })

    if (!response.ok) {
        const data = await response.text()
        // eslint-disable-next-line no-console
        console.error('Bad Response', response.status, data)
        throw new Error('Bad Response')
    }

    const { results } = await response.json()
    return results
}
