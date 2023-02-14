import fs from 'fs'
import path from 'path'
import { RequestLogger, RequestMock, ClientFunction } from 'testcafe'
import fetch from 'node-fetch'

// NOTE: These tests are run against a dedicated test project in PostHog cloud
// but can be overridden to call a local API when running locally
const { POSTHOG_API_KEY } = process.env
const POSTHOG_API_HOST = process.env.POSTHOG_API_HOST || 'https://app.posthog.com'
const POSTHOG_API_PROJECT = process.env.POSTHOG_API_PROJECT || '11213'

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
        const arrayjs = fs.readFileSync(path.resolve(__dirname, '../dist/array.full.js'))
        res.setBody(arrayjs)
    })
    .onRequestTo(/playground/)
    .respond((req, res) => {
        const html = fs.readFileSync(path.resolve(__dirname, '../playground/cypress-full/index.html'))
        res.setBody(html)
    })

export const initPosthog = (config) => {
    return ClientFunction((configParams = {}) => {
        var testSessionId = Math.round(Math.random() * 10000000000).toString()
        configParams.debug = true
        window.posthog.init(configParams.api_key, configParams)
        window.posthog.register({
            testSessionId,
        })

        return testSessionId
    })({
        ...config,
        api_host: process.env.POSTHOG_API_HOST || 'https://app.posthog.com',
        api_key: process.env.POSTHOG_PROJECT_KEY,
        bootstrap: {
            distinctID: 'automated-tester', // We set this to get around the ingestion delay for new distinctIDs
            isIdentifiedID: true,
        },
    })
}

// NOTE: Ingestion delays events by up to 60 seconds for new IDs hence we need to wait at least 60 seconds
// This is annoying but essentially we are allowing up to 3 minutes for the test to complete
export async function retryUntilResults(operation, target_results, limit = 6, delay = 30000) {
    const attempt = (count, resolve, reject) => {
        if (count === limit) {
            return reject(new Error(`Failed to fetch results in ${limit} attempts`))
        }

        setTimeout(() => {
            operation()
                .then((results) => {
                    if (results.length >= target_results) {
                        resolve(results)
                    } else {
                        console.log(`Expected ${target_results} results, got ${results.length} (attempt ${count})`)
                        attempt(count + 1, resolve, reject)
                    }
                })
                .catch(reject)
        }, delay)
    }

    return new Promise((...args) => attempt(0, ...args))
}

export async function queryAPI(testSessionId) {
    const url = `${POSTHOG_API_HOST}/api/projects/${POSTHOG_API_PROJECT}/events?properties=[{"key":"testSessionId","value":["${testSessionId}"],"operator":"exact","type":"event"}]`
    const response = await fetch(url, {
        headers: HEADERS,
    })

    const data = await response.text()

    if (!response.ok) {
        console.error('Bad Response', response.status, data)
        throw new Error('Bad Response')
    }

    const { results } = JSON.parse(data)
    return results
}
