import fs from 'node:fs/promises'
import { assertEnv, assertFlatStringMap, getManifestKvKey, toCanonicalJsonString } from './release-utils.ts'

async function fetchCloudflare(pathname: string, init?: RequestInit): Promise<Response> {
    const accountId = assertEnv('CLOUDFLARE_ACCOUNT_ID')
    const apiToken = assertEnv('CLOUDFLARE_API_TOKEN')
    const namespaceId = assertEnv('CLOUDFLARE_POSTHOG_JS_ASSET_MANIFEST_KV_NAMESPACE_ID')

    const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}${pathname}`,
        {
            ...init,
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
                ...(init?.headers ?? {}),
            },
        }
    )

    if (!response.ok) {
        throw new Error(`Cloudflare API ${init?.method ?? 'GET'} ${pathname} failed with ${response.status}: ${await response.text()}`)
    }

    return response
}

async function putManifest(key: string, payload: string): Promise<void> {
    await fetchCloudflare(`/values/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: payload,
    })
}

async function getManifest(key: string): Promise<string> {
    return await (await fetchCloudflare(`/values/${encodeURIComponent(key)}`)).text()
}

export async function writeCloudflareManifestKv(manifestPath: string): Promise<void> {
    const manifest = assertFlatStringMap(JSON.parse(await fs.readFile(manifestPath, 'utf8')), 'manifest file')
    const expectedJson = toCanonicalJsonString(manifest)
    const kvKey = getManifestKvKey()

    console.log(`==> Writing Cloudflare Workers KV key '${kvKey}'`)
    await putManifest(kvKey, expectedJson)

    console.log(`==> Verifying Cloudflare Workers KV key '${kvKey}'`)
    const actualJson = toCanonicalJsonString(assertFlatStringMap(JSON.parse(await getManifest(kvKey)), `Workers KV value for ${kvKey}`))

    if (actualJson !== expectedJson) {
        throw new Error(`Cloudflare Workers KV manifest mismatch for ${kvKey}\nExpected: ${expectedJson}\nActual:   ${actualJson}`)
    }

    console.log('✓ Cloudflare Workers KV manifest matches expected payload')
}
