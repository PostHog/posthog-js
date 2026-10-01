import type { PostHogFetchResponse } from '@posthog/core'

const PREFERENCES_PATH = '/api/projects/@current/messaging_preferences'

/**
 * The email preferences to change for one recipient. Anything left out stays as it is.
 *
 * Sending is opt-out by default: a recipient with no recorded preference still receives
 * every message, so `true` only matters to undo an earlier opt-out.
 */
export interface MessagingPreferences {
  /** `false` opts the recipient out of every marketing message. `true` lifts that opt-out. */
  allMarketing?: boolean
  /**
   * Message category keys, as listed under Workflows opt-outs, mapped to whether the recipient
   * wants that category. `true` for one category while the recipient is opted out of all marketing
   * resubscribes them to that category only.
   */
  categories?: Record<string, boolean>
}

/** The `posthog.messaging` API: manage the email preferences of your recipients from your server. */
export interface Messaging {
  /**
   * Set the email preferences of one recipient.
   *
   * Applies `allMarketing` first and then each category in order, one request at a time, so
   * `{ allMarketing: false, categories: { newsletter: true } }` leaves only the newsletter on.
   * Needs the `secretKey` client option set to a personal API key with the `hog_flow:write` scope.
   * Does nothing when the client is disabled.
   *
   * @example
   * ```ts
   * await posthog.messaging.setPreferences('jane@example.com', {
   *   categories: { newsletter: false, 'product-updates': true },
   * })
   * await posthog.messaging.setPreferences('jane@example.com', { allMarketing: false })
   * ```
   *
   * @param identifier - The recipient's email address, exactly as you send to it. It is not normalized.
   * @param preferences - The preferences to change. Anything left out stays as it is.
   * @throws {MessagingPreferencesError} when any change failed. The other changes still apply, and
   *   retrying the whole call is safe.
   */
  setPreferences(identifier: string, preferences: MessagingPreferences): Promise<void>
}

/** Why one preference change failed. `status` is missing when the request never got a response. */
export interface MessagingPreferenceFailure {
  status?: number
  message: string
}

/**
 * Thrown by `setPreferences` when one or more changes failed. Every other change was still applied.
 * The call is idempotent, so retrying it as a whole is safe.
 */
export class MessagingPreferencesError extends Error {
  readonly name = 'MessagingPreferencesError'

  constructor(
    readonly allMarketing: MessagingPreferenceFailure | undefined,
    readonly categories: Record<string, MessagingPreferenceFailure>
  ) {
    super(describeFailures(allMarketing, categories))
  }
}

export interface MessagingHost {
  isDisabled(): boolean
  hasSecretKey(): boolean
  warn(message: string): void
  post(path: string, body: Record<string, string>): Promise<PostHogFetchResponse>
}

interface PreferenceUpdate {
  categoryKey?: string
  subscribed: boolean
}

export class PostHogMessaging implements Messaging {
  constructor(private readonly host: MessagingHost) {}

  async setPreferences(identifier: string, preferences: MessagingPreferences): Promise<void> {
    if (this.host.isDisabled()) {
      this.host.warn('The client is disabled')
      return
    }
    if (!this.host.hasSecretKey()) {
      throw new Error('Setting messaging preferences requires the secretKey client option')
    }
    assertValidIdentifier(identifier)
    assertValidPreferences(preferences)

    const allMarketingFailure = await this.applyAllMarketing(identifier, preferences.allMarketing)
    const categoryFailures = await this.applyCategories(identifier, preferences.categories ?? {})

    if (allMarketingFailure || Object.keys(categoryFailures).length > 0) {
      throw new MessagingPreferencesError(allMarketingFailure, categoryFailures)
    }
  }

  private async applyAllMarketing(
    identifier: string,
    subscribed: boolean | undefined
  ): Promise<MessagingPreferenceFailure | undefined> {
    return subscribed === undefined ? undefined : this.apply(identifier, { subscribed })
  }

  private async applyCategories(
    identifier: string,
    categories: Record<string, boolean>
  ): Promise<Record<string, MessagingPreferenceFailure>> {
    const failures: Record<string, MessagingPreferenceFailure> = {}
    for (const [categoryKey, subscribed] of Object.entries(categories)) {
      const failure = await this.apply(identifier, { categoryKey, subscribed })
      if (failure) {
        failures[categoryKey] = failure
      }
    }
    return failures
  }

  private async apply(identifier: string, update: PreferenceUpdate): Promise<MessagingPreferenceFailure | undefined> {
    try {
      const response = await this.host.post(endpointFor(update), requestBody(identifier, update))
      return isSuccess(response) ? undefined : { status: response.status, message: await serverMessage(response) }
    } catch (error) {
      return { message: error instanceof Error ? error.message : String(error) }
    }
  }
}

function assertValidIdentifier(identifier: unknown): void {
  if (typeof identifier !== 'string' || identifier.trim() === '') {
    throw new TypeError('The identifier must be a non-empty string, such as an email address')
  }
}

function assertValidPreferences(preferences: unknown): asserts preferences is MessagingPreferences {
  if (!isRecord(preferences)) {
    throw new TypeError('The preferences must be an object')
  }
  const { allMarketing, categories = {} } = preferences
  if (allMarketing !== undefined && typeof allMarketing !== 'boolean') {
    throw new TypeError('allMarketing must be true or false')
  }
  if (!isRecord(categories)) {
    throw new TypeError('categories must map category keys to true or false')
  }
  for (const [key, subscribed] of Object.entries(categories)) {
    if (typeof subscribed !== 'boolean') {
      throw new TypeError(`Category "${key}" must be true or false`)
    }
  }
}

function isSuccess({ status }: PostHogFetchResponse): boolean {
  return status >= 200 && status < 300
}

async function serverMessage(response: PostHogFetchResponse): Promise<string> {
  const body = await response.json().catch(() => undefined)
  const message = isRecord(body) ? (body.error ?? body.detail) : undefined
  return typeof message === 'string' ? message : `HTTP ${response.status}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function describeFailures(
  allMarketing: MessagingPreferenceFailure | undefined,
  categories: Record<string, MessagingPreferenceFailure>
): string {
  const failures = Object.entries(categories).map(([key, failure]) => `category "${key}": ${failure.message}`)
  const all = allMarketing ? [`all marketing: ${allMarketing.message}`] : []
  return `Failed to set messaging preferences (${[...all, ...failures].join('; ')})`
}

function endpointFor({ subscribed }: PreferenceUpdate): string {
  return `${PREFERENCES_PATH}/${subscribed ? 'remove_opt_out' : 'add_opt_out'}/`
}

function requestBody(identifier: string, { categoryKey }: PreferenceUpdate): Record<string, string> {
  return categoryKey === undefined ? { identifier } : { identifier, category_key: categoryKey }
}
