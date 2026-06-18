import type { PostHog } from 'posthog-node'

export interface RecordedCapture {
    distinctId?: string
    event: string
    properties?: Record<string, unknown>
    timestamp?: Date
    uuid?: string
}

/**
 * Minimal stand-in for a `posthog-node` client that records `capture()` calls
 * instead of sending them, so tests can assert on exactly what the SDK emits.
 * Cast to `PostHog` at the call site — only the methods the SDK uses are real.
 */
export class FakePostHog {
    readonly captures: RecordedCapture[] = []
    flushed = 0
    shutdownCalls = 0

    capture(payload: RecordedCapture): void {
        this.captures.push(payload)
    }

    async flush(): Promise<void> {
        this.flushed++
    }

    async shutdown(): Promise<void> {
        this.shutdownCalls++
    }

    get events(): string[] {
        return this.captures.map((c) => c.event)
    }

    lastCapture(): RecordedCapture | undefined {
        return this.captures.at(-1)
    }

    asPostHog(): PostHog {
        return this as unknown as PostHog
    }
}
