import { expect, test } from '@playwright/test'

interface ReceivedRequest {
    headers: Record<string, string | string[] | undefined>
    body: string
}

test('pagehide hands queued Capture V1 events to native keepalive Fetch', async ({ page, request }, testInfo) => {
    const projectToken = `ph_browser_next_teardown_${testInfo.project.name}_${testInfo.retry}`
    await page.goto('/')
    await page.evaluate(
        ({ projectToken }) => window.consentHarness.prepareTeardown(['first', 'second'], projectToken),
        { projectToken }
    )

    await page.goto('/after')

    const matchingRequests = async (): Promise<ReceivedRequest[]> =>
        ((await (await request.get('/requests')).json()) as ReceivedRequest[]).filter(
            ({ headers }) => headers.authorization === `Bearer ${projectToken}`
        )
    await expect.poll(async () => (await matchingRequests()).length).toBe(1)
    const requests = await matchingRequests()
    expect(requests[0]?.headers.authorization).toBe(`Bearer ${projectToken}`)
    expect(requests[0]?.headers['posthog-sdk-info']).toMatch(/^posthog-js\//)
    expect(requests[0]?.headers['posthog-attempt']).toBe('1')
    expect(requests[0]?.headers['posthog-request-id']).toBeTruthy()
    expect(requests[0]?.headers['posthog-request-timestamp']).toBeTruthy()
    expect(requests[0]?.headers['content-encoding']).toBeUndefined()
    const envelope = JSON.parse(requests[0]?.body ?? '{}') as { batch: Array<{ event: string }> }
    expect(envelope.batch.map(({ event }) => event)).toEqual(['first', 'second'])
})
