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

export const initPosthog = ClientFunction(() => {
    window.posthog.init('e2e_token_1239', { api_host: 'http://localhost:8000' })
})

export async function retryUntilResults(operation, limit = 50) {
    const attempt = (count, resolve, reject) => {
        if (count === limit) {
            return reject(new Error('Failed to fetch results in 10 attempts'))
        }

        setTimeout(() => {
            operation()
                .then((results) => (results.length > 0 ? resolve(results) : attempt(count + 1, resolve, reject)))
                .catch(reject)
        }, 300)
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
