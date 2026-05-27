import {
  PostHogCoreOptions,
  PostHogCoreStateless,
  PostHogEventProperties,
  PostHogFetchOptions,
  PostHogFetchResponse,
  PostHogPersistedProperty,
  uuidv7,
} from '@posthog/core'

import { version } from '../version'
import { PostHogMemoryStorage } from '../storage-memory'
import type { Event, UnredactedEvent } from '../types'
import { log } from './logger'
import { buildPostHogCaptureEvents } from './posthog-events'
import { newPrefixedId } from './ids'
import { redactEvent } from './redaction'
import { sanitizeEvent } from './sanitization'
import { truncateEvent } from './truncation'

const DEFAULT_HOST = 'https://us.i.posthog.com'

export interface PostHogMCPOptions extends Pick<
  PostHogCoreOptions,
  'host' | 'flushAt' | 'flushInterval' | 'requestTimeout' | 'fetchRetryCount' | 'fetchRetryDelay' | 'disabled'
> {
  /** Optional custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: (url: string, options: PostHogFetchOptions) => Promise<PostHogFetchResponse>
}

/** Per-event toggles consulted by `PostHogMCP.capture()` when fanning out an event. */
export interface PostHogMCPCaptureOptions {
  enableAITracing: boolean
  enableExceptionAutocapture: boolean
}

/**
 * Internal PostHog client used by `instrument()`. Not exported from the package.
 * Use `flush(server)` and `shutdown(server)` if you need to drive the queue manually.
 */
export class PostHogMCP extends PostHogCoreStateless {
  private _memoryStorage = new PostHogMemoryStorage()
  private _customFetch?: PostHogMCPOptions['fetch']

  constructor(apiKey: string, options: PostHogMCPOptions = {}) {
    const host = options.host?.trim() || DEFAULT_HOST
    super(apiKey, { ...options, host })
    this._customFetch = options.fetch
  }

  getLibraryId(): string {
    return 'posthog-mcp'
  }

  getLibraryVersion(): string {
    return version
  }

  getCustomUserAgent(): string {
    return `${this.getLibraryId()}/${this.getLibraryVersion()}`
  }

  fetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> {
    return this._customFetch ? this._customFetch(url, options) : fetch(url, options)
  }

  getPersistedProperty<T>(key: PostHogPersistedProperty): T | undefined {
    return this._memoryStorage.getProperty(key) as T | undefined
  }

  setPersistedProperty<T>(key: PostHogPersistedProperty, value: T | null): void {
    this._memoryStorage.setProperty(key, value)
  }

  /**
   * Push an MCP event through the pipeline (redact → sanitize → truncate → fan out → enqueue).
   * Errors at any stage are logged and the event is dropped, never re-thrown into tool code.
   */
  async capture(event: UnredactedEvent, options: PostHogMCPCaptureOptions): Promise<void> {
    const { enableAITracing, enableExceptionAutocapture } = options

    let processed: UnredactedEvent = event

    if (event.redactionFn) {
      try {
        processed = (await redactEvent(event, event.redactionFn)) as UnredactedEvent
        processed.redactionFn = undefined
      } catch (err) {
        log(`Failed to redact event: ${err}`)
        return
      }
    }

    try {
      processed = sanitizeEvent(processed)
    } catch (err) {
      log(`Failed to sanitize event: ${err}`)
      return
    }

    try {
      processed = truncateEvent(processed)
    } catch (err) {
      log(`Failed to truncate event: ${err}`)
      return
    }

    processed.id = processed.id || newPrefixedId('evt')
    const fullEvent = processed as Event

    try {
      for (const captureEvent of buildPostHogCaptureEvents(fullEvent, {
        enableAITracing,
        enableExceptionAutocapture,
      })) {
        this.captureStateless(
          captureEvent.distinct_id,
          captureEvent.event,
          captureEvent.properties as PostHogEventProperties,
          {
            timestamp: new Date(captureEvent.timestamp),
            uuid: uuidv7(),
          }
        )
      }
      log(
        `Captured PostHog event ${fullEvent.id} | ${fullEvent.eventType} | ${fullEvent.duration} ms | ${
          fullEvent.identifyActorGivenId || 'anonymous'
        }`
      )
    } catch (err) {
      log(`Failed to capture PostHog event ${fullEvent.id}: ${err}`)
    }
  }
}
