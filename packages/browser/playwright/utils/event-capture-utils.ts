import { Page } from '@playwright/test'
import { EventName } from '../../src/types'
import { expect } from './posthog-playwright-test-base'

export async function pollUntilEventCaptured(
    page: Page,
    event: EventName,
    wait = 200,
    attempts = 0,
    maxAttempts = 50
): Promise<void> {
    const captures = await page.capturedEvents()
    if (captures.some((capture) => capture.event === event)) {
        return
    } else if (attempts < maxAttempts) {
        await page.waitForTimeout(wait)
        return pollUntilEventCaptured(page, event, wait, attempts + 1, maxAttempts)
    } else {
        throw new Error('Max attempts reached without finding the expected event')
    }
}

export async function assertThatRecordingStarted(page: Page) {
    const captures = await page.capturedEvents()

    expect(captures.map((c) => c.event)).toEqual(['$snapshot'])
    const capturedSnapshot = captures[0]

    expect(capturedSnapshot).toBeDefined()

    expect(capturedSnapshot!['properties']['$snapshot_data'].length).toBeGreaterThan(2)

    // a meta and then a full snapshot
    expect(capturedSnapshot!['properties']['$snapshot_data'][0].type).toEqual(4) // meta
    expect(capturedSnapshot!['properties']['$snapshot_data'][1].type).toEqual(2) // full_snapshot
}

export async function pollUntilCondition(
    page: Page,
    fn: () => boolean | Promise<boolean>,
    wait = 200,
    attempts = 0,
    maxAttempts = 50
): Promise<void> {
    const condition = await fn()
    if (condition) {
        return
    } else if (attempts < maxAttempts) {
        await page.waitForTimeout(wait)
        return pollUntilCondition(page, fn, wait, attempts + 1, maxAttempts)
    } else {
        throw new Error('Max attempts reached without condition being true')
    }
}
