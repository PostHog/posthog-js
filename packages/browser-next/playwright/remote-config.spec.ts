import { expect, test } from '@playwright/test'

test('native Fetch loads JSON configuration under capture denial', async ({ page }) => {
    const requests: string[] = []
    await page.route('**/array/ph_remote_config/config?token=ph_remote_config', async (route) => {
        requests.push(route.request().method())
        await route.fulfill({ json: { supportedCompression: ['gzip-js'], hasFeatureFlags: true } })
    })
    await page.goto('/')

    const result = await page.evaluate(() => window.consentHarness.remoteConfig())

    expect(result).toEqual({
        config: { supportedCompression: ['gzip-js'], hasFeatureFlags: true },
        canCapture: false,
    })
    expect(requests).toEqual(['GET'])
})
