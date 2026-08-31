import { expect, test } from '@playwright/test'

const highEntropyValue = (): string => {
    let state = 0x12345678
    return Array.from({ length: 4_000 }, () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0
        return String.fromCharCode(32 + (state % 95))
    }).join('')
}

test('native gzip respects the measured threshold and round-trips Capture V1 envelopes', async ({ page }, testInfo) => {
    await page.goto('/')
    const samples = [
        { name: 'small', value: 'small payload' },
        { name: 'typical', value: 'plan=pro;source=browser;'.repeat(80) },
        { name: 'repetitive', value: 'compressible-payload-'.repeat(200) },
        { name: 'high-entropy', value: highEntropyValue() },
        { name: 'multibyte', value: 'héllo-😀-'.repeat(300) },
    ]
    const measurements: Array<{
        name: string
        uncompressedBytes: number
        compressedBytes: number
        elapsedMs: number
        encoding: string | null
    }> = []

    for (const sample of samples) {
        const result = await page.evaluate((value) => window.consentHarness.compressionDelivery(value), sample.value)
        const envelope = JSON.parse(result.body) as { batch: Array<{ event: string; properties: { value: string } }> }
        const uncompressedBytes = new TextEncoder().encode(result.body).length

        expect(result.compressedBytes).toBeLessThanOrEqual(uncompressedBytes)
        expect(envelope.batch).toEqual([
            expect.objectContaining({
                event: 'compression_test',
                properties: expect.objectContaining({ value: sample.value }),
            }),
        ])
        measurements.push({
            name: sample.name,
            uncompressedBytes,
            compressedBytes: result.compressedBytes,
            elapsedMs: result.elapsedMs,
            encoding: result.encoding,
        })
    }

    expect(measurements.find(({ name }) => name === 'small')?.encoding).toBeNull()
    expect(measurements.find(({ name }) => name === 'repetitive')?.encoding).toBe('gzip')
    expect(measurements.find(({ name }) => name === 'multibyte')?.encoding).toBe('gzip')

    await testInfo.attach('compression-measurements.json', {
        body: JSON.stringify({ browser: testInfo.project.name, measurements }),
        contentType: 'application/json',
    })
})
