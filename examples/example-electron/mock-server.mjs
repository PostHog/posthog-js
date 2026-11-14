import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'

export const mockToken = 'phc_electron_example_mock'
export const flagKey = 'electron-example'
export const flagPayload = { greeting: 'Hello from the local flag fixture' }

// Both the interactive app and the smoke test use the same credential-free receiver.
export async function startMockServer({ onEvent = () => {} } = {}) {
    const events = []
    const requests = []
    const errors = []
    const server = createServer(async (request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname
        try {
            const chunks = []
            for await (const chunk of request) chunks.push(chunk)
            const buffer = Buffer.concat(chunks)
            const text = (
                request.headers['content-encoding'] === 'gzip' || (buffer[0] === 0x1f && buffer[1] === 0x8b)
                    ? gunzipSync(buffer)
                    : buffer
            ).toString('utf8')
            const body = text ? JSON.parse(text) : undefined
            requests.push({ path, method: request.method, body })
            response.setHeader('Content-Type', 'application/json')
            if (/^\/(flags|decide)\/?$/.test(path)) {
                response.end(
                    JSON.stringify({
                        featureFlags: { [flagKey]: 'local-variant' },
                        featureFlagPayloads: { [flagKey]: JSON.stringify(flagPayload) },
                        errorsWhileComputingFlags: false,
                        sessionRecording: { endpoint: '/s/', sampleRate: 1 },
                    })
                )
            } else if (/^\/(batch|capture|e)\/?$/.test(path)) {
                const batch = body?.batch ?? (Array.isArray(body) ? body : [body])
                if (!batch.length || batch.some((event) => typeof event?.event !== 'string')) {
                    throw new Error(`Invalid capture body at ${path}`)
                }
                for (const event of batch) {
                    events.push(event)
                    onEvent(event)
                }
                response.end(JSON.stringify({ status: 1 }))
            } else {
                response.statusCode = 404
                response.end(JSON.stringify({ error: `Unexpected endpoint: ${path}` }))
            }
        } catch (error) {
            errors.push(error)
            response.statusCode = 400
            response.end(JSON.stringify({ error: error.message }))
        }
    })
    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
    return {
        host: `http://127.0.0.1:${server.address().port}`,
        events,
        requests,
        errors,
        close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    }
}
