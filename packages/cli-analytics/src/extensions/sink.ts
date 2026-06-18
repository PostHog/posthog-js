import type { PostHog } from 'posthog-node'
import { uuidv7 } from '@posthog/core'

import type { BeforeSendFn, CliEvent } from '../types'
import { newPrefixedId } from './ids'
import { log } from './logger'
import { type PostHogCaptureEvent, buildPostHogCaptureEvents } from './posthog-events'
import { sanitizeEvent } from './sanitization'
import { truncateEvent } from './truncation'

export interface CliCaptureOptions {
    enableExceptionAutocapture: boolean
    /** Inspect/modify/drop hook applied to each payload before capture. */
    beforeSend?: BeforeSendFn
}

/**
 * Runs a CLI event through the full transform: sanitize → truncate → fan out into
 * the `$cli_*` / `$exception` payloads → `beforeSend`. Returns `null` (and logs)
 * if a transform stage throws, so the event is dropped rather than partially
 * sent. This is the single source of truth for the pipeline — both the sink and
 * the tests call it, so tests assert on exactly the payloads that reach capture.
 */
export async function processCliEvent(
    event: CliEvent,
    options: CliCaptureOptions
): Promise<PostHogCaptureEvent[] | null> {
    let processed = event
    try {
        processed = sanitizeEvent(processed)
    } catch (err) {
        log(`Failed to sanitize event: ${err}`)
        return null
    }
    try {
        processed = truncateEvent(processed)
    } catch (err) {
        log(`Failed to truncate event: ${err}`)
        return null
    }
    processed.id = processed.id || newPrefixedId('evt')

    const built = buildPostHogCaptureEvents(processed, {
        enableExceptionAutocapture: options.enableExceptionAutocapture,
    })
    return applyBeforeSend(built, options.beforeSend)
}

async function applyBeforeSend(
    captures: PostHogCaptureEvent[],
    beforeSend: BeforeSendFn | undefined
): Promise<PostHogCaptureEvent[]> {
    if (!beforeSend) {
        return captures
    }
    const kept: PostHogCaptureEvent[] = []
    for (const capture of captures) {
        try {
            const result = await beforeSend(capture)
            if (result) {
                kept.push(result)
            }
        } catch (err) {
            log(`beforeSend threw for event ${capture.event}; dropping it: ${err}`)
        }
    }
    return kept
}

export interface CliEventSinkOptions {
    /** When false, events are dropped at the chokepoint (consent opt-out). */
    enabled: boolean
    /** When true, payloads are printed to stderr and nothing is sent. */
    debug: boolean
}

/**
 * Wraps a `posthog-node` client and is the single place every event passes
 * through. Enforces consent and debug mode here (not per call-site) so an
 * opt-out can never be bypassed by a particular capture method. The SDK does not
 * own the client lifecycle — the host constructs the client and the SDK calls
 * `shutdown()` on it.
 */
export class CliEventSink {
    constructor(
        private readonly posthog: PostHog,
        private readonly config: CliEventSinkOptions
    ) {}

    async capture(event: CliEvent, options: CliCaptureOptions): Promise<void> {
        if (!this.config.enabled && !this.config.debug) {
            return
        }

        const captures = await processCliEvent(event, options)
        if (!captures || captures.length === 0) {
            return
        }

        if (this.config.debug) {
            for (const capture of captures) {
                // Transparency mode: show exactly what would be sent, send nothing.
                process.stderr.write(`[posthog-cli-analytics] would capture ${JSON.stringify(capture)}\n`)
            }
            return
        }

        try {
            for (const capture of captures) {
                this.posthog.capture({
                    distinctId: capture.distinct_id,
                    event: capture.event,
                    properties: capture.properties,
                    timestamp: new Date(capture.timestamp),
                    uuid: uuidv7(),
                })
            }
        } catch (err) {
            log(`Failed to capture PostHog event: ${err}`)
        }
    }
}
