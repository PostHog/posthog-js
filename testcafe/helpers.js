import fs from 'fs'
import path from 'path'
import { RequestLogger, RequestMock, ClientFunction } from 'testcafe'
import fetch from 'node-fetch'

const HEADERS = { Authorization: 'Bearer e2e_demo_api_key' }

export const captureLogger = RequestLogger(/ip=1/, {
    logRequestHeaders: true,
    logRequestBody: true,
    logResponseHeaders: true,
    logResponseBody: true,
    stringifyRequestBody: true,
    stringifyResponseBody: true,
})

export const staticFilesMock = RequestMock()
    .onRequestTo(/array.js/)
    .respond((req, res) => {
        const arrayjs = fs.readFileSync(path.resolve(__dirname, '../dist/array.js'))
        res.setBody(arrayjs)
    })
    .onRequestTo(/playground/)
    .respond((req, res) => {
        const html = fs.readFileSync(path.resolve(__dirname, '../playground/cypress/index.html'))
        res.setBody(html)
    })

export const initPosthog = (config = {}) => {
    if (!('api_host' in config)) {
        config['api_host'] = 'http://localhost:8000'
    }

    return ClientFunction((configParams = {}) => {
        const testSessionId = Math.round(Math.random() * 10000000000).toString()
        window.posthog.init('e2e_token_1239', configParams)
        window.posthog.register({
            testSessionId,
        })

        return testSessionId
    })({
        ...config,
        debug: true,
    })
}

export async function retryUntilResults(operation, predicate, limit = 100) {
    const attempt = (count, resolve, reject) => {
        setTimeout(() => {
            operation()
                .then((results) => {
                    if (predicate(results)) {
                        return resolve(results)
                    } else {
                        if (count === limit) {
                            return reject(
                                new Error(
                                    `Did not match predicate in ${limit} attempts. 
                                       
                                       Last results were: ${JSON.stringify(
                                           results.map((r) => r.event || 'no event on this event ¯\\_(ツ)_/¯')
                                       )}`
                                )
                            )
                        }
                        return attempt(count + 1, resolve, reject)
                    }
                })
                .catch(reject)
        }, 600)
    }

    return new Promise((...args) => attempt(0, ...args))
}

export async function queryAPI(testSessionId) {
    const url = `http://localhost:8000/api/event?properties=[{"key":"testSessionId","value":["${testSessionId}"],"operator":"exact","type":"event"}]`
    const response = await fetch(url, {
        headers: HEADERS,
    })

    if (!response.ok) {
        throw new Error(JSON.stringify(response))
    }

    const { results } = JSON.parse(await response.text())
    return results
}

export async function clearEvents() {
    await fetch('http://localhost:8000/delete_events/', { headers: HEADERS })
}
