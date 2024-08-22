import fs from 'fs'
import path from 'path'
import { RequestLogger, RequestMock, ClientFunction } from 'testcafe'
import fetch from 'node-fetch'
import { uuidv7 } from '../src/uuidv7'

// NOTE: These tests are run against a dedicated test project in PostHog cloud
// but can be overridden to call a local API when running locally
// eslint-disable-next-line no-undef
const currentEnv = process.env
const {
    POSTHOG_PROJECT_KEY,
    POSTHOG_API_KEY,
    POSTHOG_API_HOST = 'https://us.i.posthog.com',
    POSTHOG_API_PROJECT = '11213',
    BRANCH_NAME,
    RUN_ID,
    BROWSER,
} = currentEnv
// User admin for the test project: https://us.posthog.com/admin/posthog/organization/0182397e-3df4-0000-52e3-d890b5a16955/change/

const HEADERS = { Authorization: `Bearer ${POSTHOG_API_KEY}` }

export const captureLogger = RequestLogger(/ip=1/, {
    logRequestHeaders: true,
    logRequestBody: true,
    logResponseHeaders: true,
    logResponseBody: true,
    stringifyRequestBody: true,
    stringifyResponseBody: true,
})

export const staticFilesMock = RequestMock()
    .onRequestTo(/array.full.js/)
    .respond((req, res) => {
        // eslint-disable-next-line no-undef
        const arrayjs = fs.readFileSync(path.resolve(__dirname, '../dist/array.full.js'))
        res.setBody(arrayjs)
    })
    .onRequestTo(/playground/)
    .respond((req, res) => {
        // eslint-disable-next-line no-undef
        const html = fs.readFileSync(path.resolve(__dirname, '../playground/cypress-full/index.html'))
        res.setBody(html)
    })

export const initPosthog = (config) => {
    return ClientFunction((configParams = {}) => {
        let testSessionId = uuidv7()
        if (BRANCH_NAME && RUN_ID && BROWSER) {
            testSessionId = `${BRANCH_NAME} ${BROWSER} ${RUN_ID} ${testSessionId}`
        }
        configParams.debug = true
        window.posthog.init(configParams.api_key, configParams)
        window.posthog.register({
            testSessionId,
        })
        // eslint-disable-next-line no-console
        console.log('Initialized posthog with testSessionId', testSessionId)

        return testSessionId
    })({
        ...config,
        api_host: POSTHOG_API_HOST,
        api_key: POSTHOG_PROJECT_KEY,
        bootstrap: {
            distinctID: 'automated-tester', // We set this to get around the ingestion delay for new distinctIDs
            isIdentifiedID: true,
        },
        opt_out_useragent_filter: true,
    })
}

// NOTE: This is limited by the real production ingestion lag, which you can see in grafana is usually
// in the low minutes https://grafana.prod-us.posthog.dev/d/homepage/homepage
// This means that this test can fail if the ingestion lag is higher than the timeout, so we're pretty
// generous with the timeout here.
export async function retryUntilResults(
    operation,
    target_results,
    {
        timeout_seconds = 1200,
        polling_interval_seconds = 10,
        max_allowed_api_errors = 5,
        success_function = () => true,
    } = {}
) {
    const start = Date.now()
    const deadline = start + timeout_seconds * 1000
    let api_errors = 0

    const attempt = (count, resolve, reject) => {
        setTimeout(() => {
            operation()
                .then((results) => {
                    if (results.length >= target_results && success_function(results)) {
                        // eslint-disable-next-line no-console
                        console.log(
                            `Got correct number of results (${target_results}) after ${Math.floor(
                                (Date.now() - start) / 1000
                            )} seconds (attempt ${count})`
                        )
                        resolve(results)
                    } else {
                        // eslint-disable-next-line no-console
                        console.log(`Expected ${target_results} results, got ${results.length} (attempt ${count})`)
                        if (Date.now() > deadline) {
                            reject(new Error(`Timed out after ${timeout_seconds} seconds`))
                        } else {
                            attempt(count + 1, resolve, reject)
                        }
                    }
                })
                .catch((err) => {
                    api_errors++
                    if (api_errors > max_allowed_api_errors) {
                        reject(err)
                    } else {
                        // eslint-disable-next-line no-console
                        console.error('API Error:', err)
                        attempt(count + 1, resolve, reject)
                    }
                })
        }, polling_interval_seconds * 1000)
    }

    // new Promise isn't supported in IE11, but we don't care in these tests
    // eslint-disable-next-line compat/compat
    return new Promise((...args) => attempt(0, ...args))
}

export async function queryAPI(testSessionId) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const url = `${POSTHOG_API_HOST}/api/projects/${POSTHOG_API_PROJECT}/events?properties=[{"key":"testSessionId","value":["${testSessionId}"],"operator":"exact","type":"event"}]&after=${yesterday}`
    const response = await fetch(url, {
        headers: HEADERS,
    })

    const data = await response.text()

    if (!response.ok) {
        // eslint-disable-next-line no-console
        console.error('Bad Response', response.status, data)
        throw new Error('Bad Response')
    }

    const { results } = JSON.parse(data)
    return results
}
