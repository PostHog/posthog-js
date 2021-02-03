import { RequestLogger, ClientFunction } from 'testcafe'
import fetch from 'node-fetch'

const HEADERS = { Authorization: 'Bearer e2e_demo_api_key' }

export const captureLogger = RequestLogger(/ip=1/, {
    logRequestHeaders: true,
    logRequestBody: true,
    logResponseHeaders: true,
    stringifyRequestBody: true,
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
