import * as fs from 'fs'
import path from 'path'
import { ClientFunction, RequestLogger, RequestMock } from 'testcafe'
import fetch from 'node-fetch'

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

export const captureLogger = RequestLogger(/ip=0/, {
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
        const ENV_BROWSER = process.env.BROWSER
        const fileToRead = ENV_BROWSER === 'browserstack:ie' ? '../dist/array.full.es5.js' : '../dist/array.full.js'
        const arrayjs = fs.readFileSync(path.resolve(__dirname, fileToRead))
        res.setBody(arrayjs)
    })
    .onRequestTo(/playground/)
    .respond((req, res) => {
        const html = fs.readFileSync(path.resolve(__dirname, '../playground/cypress-full/index.html'))
        res.setBody(html)
    })

export const initPosthog = (testName, config) => {
    let testSessionId = Math.round(Math.random() * 10000000000).toString()
    log(`Initializing posthog with testSessionId "${testSessionId}"`)

    const posthogConfig = {
        ...config,
        debug: true,
        api_host: POSTHOG_API_HOST,
        api_key: POSTHOG_PROJECT_KEY,
        bootstrap: {
            distinctID: 'automated-tester', // We set this to get around the ingestion delay for new distinctIDs
            isIdentifiedID: true,
        },
        opt_out_useragent_filter: true,
        request_batching: false,
    }

    const register = {
        testSessionId,
        testName,
        testBranchName: BRANCH_NAME,
        testRunId: RUN_ID,
        testBrowser: BROWSER,
    }

    return ClientFunction(
        (clientPosthogConfig = {}) => {
            clientPosthogConfig.loaded = () => {
                window.loaded = true
                window.fullCaptures = []
            }
            clientPosthogConfig.before_send = (event) => {
                window.fullCaptures.push(event)
                return event
            }
            window.posthog.init(clientPosthogConfig.api_key, clientPosthogConfig)
            window.posthog.register(register)

            return testSessionId
        },
        {
            dependencies: {
                register,
                testSessionId,
            },
        }
    )(posthogConfig)
}

export const isLoaded = ClientFunction(() => !!window.loaded)
export const numCaptures = ClientFunction(() => window.captures.length)

export const capturesMap = ClientFunction(() => {
    const map = {}
    window.fullCaptures.forEach((capture) => {
        const eventName = capture.event
        if (!map[eventName]) {
            map[eventName] = 0
        }
        map[eventName]++
    })
    return map
})

// test code, doesn't need to be IE11 compatible
// eslint-disable-next-line compat/compat
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// NOTE: This is limited by the real production ingestion lag, which you can see in grafana is usually
// in the low minutes https://grafana.prod-us.posthog.dev/d/homepage/homepage
// This means that this test can fail if the ingestion lag is higher than the timeout, so we're pretty
// generous with the timeout here.
export async function retryUntilResults(
    operation,
    target_results,
    { deadline = undefined, polling_interval_seconds = 30, max_allowed_api_errors = 5 } = {}
) {
    const start = Date.now()
    deadline = deadline ?? start + 10 * 60 * 1000 // default to 10 minutes
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
        await delay(polling_interval_seconds * 1000)
    } while (api_errors < max_allowed_api_errors && Date.now() <= deadline)

    if (api_errors >= max_allowed_api_errors && last_api_error) {
        throw last_api_error
    }
    throw new Error(`Timed out after ${elapsedSeconds} seconds (attempt ${attempts})`)
}

export async function queryAPI(testSessionId) {
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
    return `${testName.replaceAll(/[/ ]/g, '_')}.results.json`
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
