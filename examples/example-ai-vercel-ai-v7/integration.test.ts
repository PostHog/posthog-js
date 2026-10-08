import assert from 'node:assert/strict'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import test from 'node:test'

import { OpenTelemetry } from '@ai-sdk/otel'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { PostHogSpanProcessor } from '@posthog/ai/otel'
import { generateText, registerTelemetry } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'

import { getPostHogSpanAttributes } from './telemetry.js'

interface CapturedRequest {
    url: string | undefined
    headers: IncomingHttpHeaders
    body: Buffer
}

test('AI SDK v7 exports enriched spans through the public PostHog processor', async () => {
    const requests: CapturedRequest[] = []
    const server = createServer((request, response) => {
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.on('end', () => {
            requests.push({
                url: request.url,
                headers: request.headers,
                body: Buffer.concat(chunks),
            })
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end('{}')
        })
    })

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })

    const address = server.address()
    assert.ok(address && typeof address === 'object')

    const processor = new PostHogSpanProcessor({
        projectToken: 'phc_test',
        host: `http://127.0.0.1:${address.port}`,
    })
    const sdk = new NodeSDK({ spanProcessors: [processor] })

    sdk.start()
    registerTelemetry(
        new OpenTelemetry({
            enrichSpan: getPostHogSpanAttributes,
        })
    )

    try {
        await generateText({
            model: new MockLanguageModelV4({
                doGenerate: async () => ({
                    content: [{ type: 'text', text: 'Hedgehogs have excellent signal-to-noise ratios.' }],
                    finishReason: { unified: 'stop', raw: undefined },
                    usage: {
                        inputTokens: {
                            total: 8,
                            noCache: 8,
                            cacheRead: undefined,
                            cacheWrite: undefined,
                        },
                        outputTokens: {
                            total: 9,
                            text: 9,
                            reasoning: undefined,
                        },
                    },
                    warnings: [],
                }),
            }),
            prompt: 'Tell me about hedgehogs.',
            runtimeContext: {
                distinctId: 'test-user',
                sessionId: 'test-session',
                traceName: 'test-trace',
                groups: {
                    company: 'test-company',
                },
                properties: {
                    environment: 'test',
                    'posthog.distinct_id': 'spoofed-user',
                    $ai_session_id: 'spoofed-session',
                    $groups: 'spoofed-groups',
                },
            },
            telemetry: {
                functionId: 'v7-otel-test',
                includeRuntimeContext: {
                    distinctId: true,
                    sessionId: true,
                    traceName: true,
                    groups: true,
                    properties: true,
                },
                recordInputs: false,
                recordOutputs: false,
            },
        })

        await processor.forceFlush()

        assert.equal(requests.length, 1)
        assert.equal(requests[0].url, '/i/v0/ai/otel')
        assert.equal(requests[0].headers.authorization, 'Bearer phc_test')

        const payload = requests[0].body.toString('utf8')
        for (const expected of [
            'gen_ai.operation.name',
            'posthog.distinct_id',
            'test-user',
            '$ai_session_id',
            'test-session',
            '$groups',
            'test-company',
            '$ai_trace_name',
            'test-trace',
            'environment',
        ]) {
            assert.ok(payload.includes(expected), `Expected OTLP payload to contain ${expected}`)
        }
        assert.equal(payload.includes('spoofed-'), false)
        assert.equal(payload.includes('Tell me about hedgehogs.'), false)
        assert.equal(payload.includes('Hedgehogs have excellent signal-to-noise ratios.'), false)
    } finally {
        await sdk.shutdown()
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
})
