import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeCloudflareManifestKv } from './write-cloudflare-manifest-kv.ts'

test('writeCloudflareManifestKv writes and verifies the global manifest key', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-release-'))
    const manifestPath = path.join(tempDir, 'manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify({ '1': '1.370.0', '1.370': '1.370.0' }), 'utf8')

    const originalEnv = {
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_POSTHOG_JS_ASSET_MANIFEST_KV_NAMESPACE_ID:
            process.env.CLOUDFLARE_POSTHOG_JS_ASSET_MANIFEST_KV_NAMESPACE_ID,
    }
    const originalFetch = global.fetch

    process.env.CLOUDFLARE_ACCOUNT_ID = 'account-id'
    process.env.CLOUDFLARE_API_TOKEN = 'api-token'
    process.env.CLOUDFLARE_POSTHOG_JS_ASSET_MANIFEST_KV_NAMESPACE_ID = 'namespace-id'

    const requests: Array<{ url: string; method: string; body?: string }> = []
    let storedPayload = ''

    global.fetch = async (input, init) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ? init.body : undefined
        requests.push({ url, method, body })

        if (method === 'PUT') {
            storedPayload = body ?? ''
            return new Response('', { status: 200 })
        }

        return new Response(storedPayload, { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    try {
        await writeCloudflareManifestKv(manifestPath)

        assert.deepEqual(
            requests.map(({ method, url }) => ({ method, url })),
            [
                {
                    method: 'PUT',
                    url: 'https://api.cloudflare.com/client/v4/accounts/account-id/storage/kv/namespaces/namespace-id/values/manifest',
                },
                {
                    method: 'GET',
                    url: 'https://api.cloudflare.com/client/v4/accounts/account-id/storage/kv/namespaces/namespace-id/values/manifest',
                },
            ]
        )
        assert.equal(storedPayload, '{"1":"1.370.0","1.370":"1.370.0"}')
    } finally {
        global.fetch = originalFetch

        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) {
                delete process.env[key]
            } else {
                process.env[key] = value
            }
        }

        await fs.rm(tempDir, { recursive: true, force: true })
    }
})
