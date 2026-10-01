import { MessagingPreferencesError, PostHog, PostHogOptions } from '@/entrypoints/index.node'

vi.mock('../version', () => ({ version: '1.2.3' }))

const PREFERENCES_URL = 'http://example.com/api/projects/@current/messaging_preferences'

const respondWith = (status: number, body: unknown = {}): Response =>
  ({ status, json: () => Promise.resolve(body) }) as Response

const createClient = (fetch: PostHogOptions['fetch'], options: PostHogOptions = {}): PostHog =>
  new PostHog('phc_project_token', {
    host: 'http://example.com',
    secretKey: 'phx_secret',
    enableLocalEvaluation: false,
    fetch,
    ...options,
  })

const sentRequests = (fetch: ReturnType<typeof vi.fn>): { url: string; body: unknown }[] =>
  fetch.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body) }))

describe('messaging.setPreferences', () => {
  let fetch: ReturnType<typeof vi.fn>
  let posthog: PostHog

  beforeEach(() => {
    fetch = vi.fn().mockResolvedValue(respondWith(200))
    posthog = createClient(fetch)
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  it('applies all marketing first, then each category, with the identifier passed verbatim', async () => {
    await posthog.messaging.setPreferences('Jane.Doe@Example.com', {
      categories: { newsletter: true, 'product-updates': false },
      allMarketing: false,
    })

    expect(sentRequests(fetch)).toEqual([
      {
        url: `${PREFERENCES_URL}/add_opt_out/?token=phc_project_token`,
        body: { identifier: 'Jane.Doe@Example.com' },
      },
      {
        url: `${PREFERENCES_URL}/remove_opt_out/?token=phc_project_token`,
        body: { identifier: 'Jane.Doe@Example.com', category_key: 'newsletter' },
      },
      {
        url: `${PREFERENCES_URL}/add_opt_out/?token=phc_project_token`,
        body: { identifier: 'Jane.Doe@Example.com', category_key: 'product-updates' },
      },
    ])
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer phx_secret',
        }),
      })
    )
  })

  it.each([
    [
      'an unknown category',
      respondWith(404, { error: 'Category not found' }),
      { status: 404, message: 'Category not found' },
    ],
    ['a missing permission', respondWith(403, { detail: 'No access' }), { status: 403, message: 'No access' }],
    ['an unreadable error body', respondWith(500, 'oops'), { status: 500, message: 'HTTP 500' }],
    ['a network error', new Error('socket hang up'), { message: 'socket hang up' }],
  ])('reports %s per category and still applies the rest', async (_, newsletterOutcome, expectedFailure) => {
    fetch.mockImplementation(async (_url: string, init: { body: string }) => {
      if (JSON.parse(init.body).category_key !== 'newsletter') {
        return respondWith(201)
      }
      if (newsletterOutcome instanceof Error) {
        throw newsletterOutcome
      }
      return newsletterOutcome
    })

    const error = await posthog.messaging
      .setPreferences('jane@example.com', { allMarketing: true, categories: { newsletter: false, offers: true } })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(MessagingPreferencesError)
    expect((error as MessagingPreferencesError).allMarketing).toBeUndefined()
    expect((error as MessagingPreferencesError).categories).toEqual({ newsletter: expectedFailure })
    expect((error as Error).message).not.toMatch(/jane@example\.com|phx_secret/)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['no secret key is configured', { secretKey: undefined }, 'jane@example.com', { allMarketing: false }, 'secretKey'],
    ['the identifier is empty', {}, '', { allMarketing: false }, 'identifier'],
    ['the identifier is blank', {}, '  ', { allMarketing: false }, 'identifier'],
    ['allMarketing is not a boolean', {}, 'jane@example.com', { allMarketing: 'false' }, 'allMarketing'],
    ['a category is not a boolean', {}, 'jane@example.com', { categories: { newsletter: 'no' } }, 'newsletter'],
    ['preferences are missing', {}, 'jane@example.com', undefined, 'preferences'],
  ])('rejects without sending anything when %s', async (_, options, identifier, preferences, mentioned) => {
    const client = createClient(fetch, options)

    await expect(client.messaging.setPreferences(identifier, preferences as any)).rejects.toThrow(mentioned)

    expect(fetch).not.toHaveBeenCalled()
    await client.shutdown()
  })

  it.each([
    ['the client is disabled', { disabled: true }, { allMarketing: false }],
    ['no preference is given', {}, {}],
    ['no category is given', {}, { categories: {} }],
  ])('resolves without sending anything when %s', async (_, options, preferences) => {
    const client = createClient(fetch, options)

    await expect(client.messaging.setPreferences('jane@example.com', preferences)).resolves.toBeUndefined()

    expect(fetch).not.toHaveBeenCalled()
    await client.shutdown()
  })

  it('gives up on a request that outlasts requestTimeout', async () => {
    fetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    )
    const client = createClient(fetch, { requestTimeout: 500 })

    const result = client.messaging.setPreferences('jane@example.com', { allMarketing: false }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(500)

    expect(await result).toMatchObject({ allMarketing: { message: 'aborted' } })
    await client.shutdown()
  })
})
