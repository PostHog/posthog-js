import { MessagingPreferencesError, PostHog, PostHogOptions } from '@/entrypoints/index.node'
import { FakeMessagingPreferencesApi } from './utils/fake-messaging-preferences-api'

vi.mock('../version', () => ({ version: '1.2.3' }))

const JANE = 'jane@example.com'

describe('messaging.setPreferences', () => {
  let api: FakeMessagingPreferencesApi
  const clients: PostHog[] = []

  const createClient = (options: PostHogOptions = {}): PostHog => {
    const client = new PostHog('phc_project_token', {
      host: 'http://example.com',
      secretKey: 'phx_secret',
      enableLocalEvaluation: false,
      fetch: api.fetch,
      fetchRetryCount: 0,
      ...options,
    })
    clients.push(client)
    return client
  }

  const failureOf = (promise: Promise<void>): Promise<MessagingPreferencesError> =>
    promise.then(
      () => {
        throw new Error('Expected setPreferences to reject')
      },
      (error: MessagingPreferencesError) => error
    )

  beforeEach(() => {
    api = new FakeMessagingPreferencesApi({
      projectToken: 'phc_project_token',
      secretKey: 'phx_secret',
      categories: {
        newsletter: 'marketing',
        'product-updates': 'marketing',
        offers: 'marketing',
        receipts: 'transactional',
      },
    })
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown()))
  })

  it('stores each category against the identifier exactly as given', async () => {
    await createClient().messaging.setPreferences('Jane.Doe@Example.com', {
      categories: { newsletter: false, 'product-updates': true },
    })

    expect(api.preferencesOf('Jane.Doe@Example.com')).toEqual({
      categories: { newsletter: false, 'product-updates': true },
    })
    expect(api.preferencesOf('jane.doe@example.com')).toBeUndefined()
  })

  it('stops all marketing mail and keeps transactional mail', async () => {
    await createClient().messaging.setPreferences(JANE, { allMarketing: false })

    expect(api.preferencesOf(JANE)).toEqual({ allMarketing: false, categories: {} })
    expect(api.wouldReceive(JANE, 'newsletter')).toBe(false)
    expect(api.wouldReceive(JANE, 'receipts')).toBe(true)
  })

  it('applies all marketing before the categories, so only the named category stays on', async () => {
    await createClient().messaging.setPreferences(JANE, { allMarketing: false, categories: { newsletter: true } })

    expect(api.wouldReceive(JANE, 'newsletter')).toBe(true)
    expect(api.wouldReceive(JANE, 'offers')).toBe(false)
    expect(api.wouldReceive(JANE, 'product-updates')).toBe(false)
  })

  it('keeps an earlier category opt-out when all marketing is turned back on', async () => {
    const posthog = createClient()

    await posthog.messaging.setPreferences(JANE, { allMarketing: false, categories: { newsletter: false } })
    await posthog.messaging.setPreferences(JANE, { allMarketing: true })

    expect(api.wouldReceive(JANE, 'newsletter')).toBe(false)
    expect(api.wouldReceive(JANE, 'offers')).toBe(true)
  })

  it('authenticates with the secret key and names the project with its token', async () => {
    await createClient().messaging.setPreferences(JANE, { allMarketing: false })

    expect(api.received).toEqual([
      expect.objectContaining({
        method: 'POST',
        token: 'phc_project_token',
        authorization: 'Bearer phx_secret',
        contentType: 'application/json',
      }),
    ])
  })

  it('changes nothing when the secret key is not accepted', async () => {
    const error = await failureOf(
      createClient({ secretKey: 'phx_revoked' }).messaging.setPreferences(JANE, { allMarketing: false })
    )

    expect(error.allMarketing).toEqual({ status: 401, message: 'Personal API key is invalid.' })
    expect(api.preferencesOf(JANE)).toBeUndefined()
  })

  it('reports an unknown category and still applies the rest', async () => {
    const error = await failureOf(
      createClient().messaging.setPreferences(JANE, { categories: { newsleter: false, offers: false } })
    )

    expect(error).toBeInstanceOf(MessagingPreferencesError)
    expect(error.categories).toEqual({ newsleter: { status: 404, message: 'Category not found' } })
    expect(api.wouldReceive(JANE, 'offers')).toBe(false)
  })

  it('reports a failed category even when its key is __proto__', async () => {
    const error = await failureOf(
      createClient().messaging.setPreferences(JANE, { categories: JSON.parse('{"__proto__": false}') })
    )

    expect(Object.entries(error.categories)).toEqual([['__proto__', { status: 404, message: 'Category not found' }]])
  })

  it.each([
    ['a server error with an unreadable body', { status: 500, body: 'oops' }, { status: 500, message: 'HTTP 500' }],
    [
      'a network error that mentions the recipient and key',
      { networkError: new Error(`socket hang up for ${JANE}, Bearer phx_secret`) },
      { message: 'Request failed' },
    ],
  ])('reports %s without leaking it and still applies the rest', async (_, fault, expectedFailure) => {
    api.failWhen((request) => request.categoryKey === 'newsletter', fault)

    const error = await failureOf(
      createClient().messaging.setPreferences(JANE, { categories: { newsletter: false, offers: false } })
    )

    expect(error.categories).toEqual({ newsletter: expectedFailure })
    expect(error.message).not.toMatch(/jane@example\.com|phx_secret/)
    expect(api.preferencesOf(JANE)).toEqual({ categories: { offers: false } })
  })

  it('hands the original network error to the client error event for diagnostics', async () => {
    const networkError = new Error('getaddrinfo ENOTFOUND example.com')
    api.failWhen(() => true, { networkError })
    const posthog = createClient()
    const errors: unknown[] = []
    posthog.on('error', (error) => errors.push(error))

    const failure = await failureOf(posthog.messaging.setPreferences(JANE, { allMarketing: false }))

    expect(failure.allMarketing).toEqual({ message: 'Request failed' })
    expect(errors).toEqual([expect.objectContaining({ error: networkError })])
  })

  it('retries a transient server error until the preference is stored', async () => {
    api.failWhen(() => true, { status: 503 }, 1)

    const done = createClient({ fetchRetryCount: 1, fetchRetryDelay: 100 }).messaging.setPreferences(JANE, {
      allMarketing: false,
    })
    await vi.advanceTimersByTimeAsync(100)
    await done

    expect(api.received).toHaveLength(2)
    expect(api.preferencesOf(JANE)).toEqual({ allMarketing: false, categories: {} })
  })

  it('does not retry a category the server rejects', async () => {
    await failureOf(
      createClient({ fetchRetryCount: 3 }).messaging.setPreferences(JANE, { categories: { unknown: false } })
    )

    expect(api.received).toHaveLength(1)
  })

  it('runs calls for the same recipient one after another', async () => {
    const posthog = createClient()
    const resume = api.pause()

    const first = posthog.messaging.setPreferences(JANE, { categories: { newsletter: false } })
    const second = posthog.messaging.setPreferences(JANE, { categories: { offers: false } })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.received).toHaveLength(1)

    resume()
    await Promise.all([first, second])

    expect(api.maxConcurrentRequests).toBe(1)
    expect(api.preferencesOf(JANE)).toEqual({ categories: { newsletter: false, offers: false } })
  })

  it.each([
    ['no response arrives', { hang: 'response' as const }, { message: 'Request timed out after 500ms' }],
    [
      'a success body never finishes',
      { hang: 'body' as const, status: 200 },
      { message: 'Request timed out after 500ms' },
    ],
    ['an error body never finishes', { hang: 'body' as const, status: 500 }, { status: 500, message: 'HTTP 500' }],
  ])('gives up after requestTimeout when %s', async (_, fault, expectedFailure) => {
    api.failWhen(() => true, fault)

    const result = failureOf(
      createClient({ requestTimeout: 500 }).messaging.setPreferences(JANE, { allMarketing: false })
    )
    await vi.advanceTimersByTimeAsync(500)

    expect((await result).allMarketing).toEqual(expectedFailure)
  })

  it.each([
    ['no secret key is configured', { secretKey: undefined }, JANE, { allMarketing: false }, 'secretKey'],
    ['the identifier is empty', {}, '', { allMarketing: false }, 'identifier'],
    ['the identifier is blank', {}, '  ', { allMarketing: false }, 'identifier'],
    ['the identifier has surrounding whitespace', {}, ` ${JANE}`, { allMarketing: false }, 'identifier'],
    ['allMarketing is not a boolean', {}, JANE, { allMarketing: 'false' }, 'allMarketing'],
    ['a category is not a boolean', {}, JANE, { categories: { newsletter: 'no' } }, 'newsletter'],
    ['categories is an array', {}, JANE, { categories: [false] }, 'categories'],
    ['preferences are missing', {}, JANE, undefined, 'preferences'],
  ])('rejects without contacting PostHog when %s', async (_, options, identifier, preferences, mentioned) => {
    await expect(createClient(options).messaging.setPreferences(identifier, preferences as any)).rejects.toThrow(
      mentioned
    )

    expect(api.received).toEqual([])
  })

  it.each([
    ['the client is disabled', { disabled: true }, { allMarketing: false }],
    ['no preference is given', {}, {}],
    ['no category is given', {}, { categories: {} }],
  ])('resolves without contacting PostHog when %s', async (_, options, preferences) => {
    await expect(createClient(options).messaging.setPreferences(JANE, preferences)).resolves.toBeUndefined()

    expect(api.received).toEqual([])
  })
})
