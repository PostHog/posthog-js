import * as fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import { Page } from '@playwright/test'
import { PostHogConfig } from '../../src/types'

// NOTE: These tests are run against a dedicated test project in PostHog cloud
// but can be overridden to call a local API when running locally
// User admin for the test project: https://us.posthog.com/admin/posthog/organization/0182397e-3df4-0000-52e3-d890b5a16955/change/
const currentEnv = process.env
export const {
    POSTHOG_PROJECT_KEY,
    POSTHOG_API_KEY,
    POSTHOG_API_HOST = 'https://us.i.posthog.com',
    POSTHOG_API_PROJECT = '11213',
    BRANCH_NAME,
    RUN_ID,
    BROWSER,
} = currentEnv

const HEADERS = { Authorization: `Bearer ${POSTHOG_API_KEY}` }

// NOTE: This is limited by the real production ingestion lag, which you can see in grafana is usually
// in the low minutes https://grafana.prod-us.posthog.dev/d/homepage/homepage
// This means that this test can fail if the ingestion lag is higher than the timeout, so we're pretty
// generous with the timeout here.
export async function retryUntilResults(
    operation: () => Promise<any>,
    target_results: number,
    {
        maxDurationSeconds = 10 * 60,
        pollingIntervalSeconds = 30,
        maxAllowedApiErrors = 5,
    }: { maxDurationSeconds?: number; pollingIntervalSeconds?: number; maxAllowedApiErrors?: number }
) {
    const start = Date.now()
    const deadline = start + maxDurationSeconds * 1000
    let api_errors = 0
    let attempts = 0
    let last_api_error = null
    let elapsedSeconds = 0

    do {
        attempts++
        let results
        try {
            results = await operation()
        } catch (err) {
            api_errors++
            last_api_error = err
            error('API Error:', err)
        }
        if (results) {
            elapsedSeconds = Math.floor((Date.now() - start) / 1000)
            if (results.length >= target_results) {
                log(
                    `Got correct number of results (${target_results}) after ${elapsedSeconds} seconds (attempt ${attempts})`
                )
                return results
            } else {
                log(`Expected ${target_results} results, got ${results.length} (attempt ${attempts})`)
            }
        }
        await delay(pollingIntervalSeconds * 1000)
    } while (api_errors < maxAllowedApiErrors && Date.now() <= deadline)

    if (api_errors >= maxAllowedApiErrors && last_api_error) {
        throw last_api_error
    }
    throw new Error(`Timed out after ${elapsedSeconds} seconds (attempt ${attempts})`)
}

export async function queryAPI(testSessionId: string) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const url = `${POSTHOG_API_HOST}/api/projects/${POSTHOG_API_PROJECT}/events?properties=[{"key":"testSessionId","value":["${testSessionId}"],"operator":"exact","type":"event"}]&after=${yesterday}`
    const response = await fetch(url, {
        headers: HEADERS,
    })

    const data = await response.text()

    if (!response.ok) {
        error('Bad Response', response.status, data)
        throw new Error('Bad Response')
    }

    const { results } = JSON.parse(data)
    return results
}

export function log(...args) {
    // eslint-disable-next-line no-console
    console.log(new Date().toISOString(), ...args)
}

export function error(...args) {
    // eslint-disable-next-line no-console
    console.error(new Date().toISOString(), ...args)
}

export function santizeTestName(testName) {
    return `${testName.replaceAll(/[/ ]/g, '_')}`
}

export function writeResultsJsonFile(testName, testSessionId, assertFunction) {
    fs.writeFileSync(
        path.join(__dirname, `${santizeTestName(testName)}.results.json`),
        JSON.stringify({ testSessionId, assert: assertFunction.name })
    )
}
export function getResultsJsonFiles() {
    return fs
        .readdirSync(__dirname)
        .filter((file) => file.endsWith('.results.json'))
        .map((file) => {
            const data = fs.readFileSync(path.join(__dirname, file))
            return JSON.parse(data.toString())
        })
}

export async function initPostHog(
    page: Page,
    testName: string,
    responses: Response[],
    options: Partial<PostHogConfig> = {}
): Promise<string> {
    if (!process.env.POSTHOG_PROJECT_KEY) {
        throw new Error('You must provide a POSTHOG_PROJECT_KEY environment variable')
    }
    page.on('response', (res: Response) => {
        responses.push(res)
    })
    const testSessionId = Math.round(Math.random() * 10000000000).toString()
    // mock posthog.js array
    await page.goto('/playground/cypress-full/index.html', { waitUntil: 'networkidle' })
    await page.posthog.init(process.env.POSTHOG_PROJECT_KEY, {
        api_host: process.env.POSTHOG_API_HOST,
        request_batching: false,
        bootstrap: {
            distinctID: 'automated-tester', // We set this to get around the ingestion delay for new distinctIDs
            isIdentifiedID: true,
        },
        opt_out_useragent_filter: true,
        ...options,
    })
    const register = {
        testSessionId,
        testName,
        testBranchName: BRANCH_NAME,
        testRunId: RUN_ID,
        testBrowser: BROWSER,
    }
    await page.posthog.register(register)
    await page.posthog.waitToLoad()
    return testSessionId
}
