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

export const initPosthog = ClientFunction((configParams = {}) => {
    if (!('api_host' in configParams)) {
        configParams['api_host'] = 'http://localhost:8000'
    }
    window.posthog.init('e2e_token_1239', configParams)
})

export async function retryUntilResults(operation, target_results, limit = 100) {
    const attempt = (count, resolve, reject) => {
        setTimeout(() => {
            operation()
                .then((results) => {
                    if (results.length >= target_results) {
                        return resolve(results)
                    } else {
                        if (count === limit) {
                            return reject(
                                new Error(
                                    `Failed to fetch results in ${limit} attempts. 
                                       Expected ${target_results} results but received ${results?.length}
                                       
                                       Last results were: ${JSON.stringify(results)}`
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

export async function queryAPI() {
    const response = await fetch('http://localhost:8000/api/event', {
        headers: HEADERS,
    })

    const { results } = JSON.parse(await response.text())
    return results
}

export async function clearEvents() {
    await fetch('http://localhost:8000/delete_events/', { headers: HEADERS })
}
