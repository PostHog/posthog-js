import { PostHog, PostHogOptions } from '@/entrypoints/index.node'
import type { SendEmailOptions } from '@/emails'
import { type Fault, FakeEmailsApi, refusalBody } from './utils/fake-emails-api'

vi.mock('../version', () => ({ version: '1.2.3' }))

const JANE = 'jane@example.com'
const SECRET_KEY = 'phs_secret'
const APP_HOST = 'https://posthog.example.com'
const TEMPLATE_ID = '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b'
const TEMPLATE_SEND = `POST /api/projects/@current/messaging_templates/${TEMPLATE_ID}/send/`
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('emails', () => {
  let api: FakeEmailsApi
  const clients: PostHog[] = []

  const createClient = (options: PostHogOptions = {}): PostHog => {
    const client = new PostHog('phc_project_token', {
      host: 'https://ingest.example.com',
      appHost: APP_HOST,
      secretKey: SECRET_KEY,
      enableLocalEvaluation: false,
      fetch: api.fetch,
      ...options,
    })
    clients.push(client)
    return client
  }

  const sendWelcome = (posthog: PostHog = createClient(), options: { maxRetries?: number } = {}) =>
    posthog.emails.send({ to: JANE, distinctId: 'user_42', templateId: TEMPLATE_ID, ...options })

  const requestLog = (): string[] => api.received.map(({ method, path }) => `${method} ${path}`)
  const idempotencyKeys = (): string[] => api.received.map(({ headers }) => headers['idempotency-key'])

  beforeEach(() => {
    api = new FakeEmailsApi({ secretKey: SECRET_KEY, appHost: APP_HOST })
    api.addTemplate(TEMPLATE_ID)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await Promise.all(clients.splice(0).map((client) => client.shutdown()))
  })

  describe('the template form', () => {
    it('sends the template with its data to the recipient, as the distinct id, with the secret key', async () => {
      const result = await createClient().emails.send({
        to: JANE,
        distinctId: 'user_42',
        templateId: TEMPLATE_ID,
        templateData: { firstName: 'Jane' },
      })

      expect(result).toEqual({ data: { id: 'message-1', warnings: [] }, error: null })
      expect(api.delivered).toEqual([
        {
          messageId: 'message-1',
          to: JANE,
          templateId: TEMPLATE_ID,
          variables: { firstName: 'Jane' },
          distinctId: 'user_42',
        },
      ])
      expect(api.received).toEqual([
        expect.objectContaining({
          origin: APP_HOST,
          headers: expect.objectContaining({
            authorization: `Bearer ${SECRET_KEY}`,
            'content-type': 'application/json',
            'user-agent': 'posthog-node/1.2.3',
            'idempotency-key': expect.stringMatching(UUID_V4),
          }),
        }),
      ])
      expect(requestLog()).toEqual([TEMPLATE_SEND])
    })

    it.each([
      ['no template data or distinct id', { to: JANE, templateId: TEMPLATE_ID }, { to: JANE }],
      [
        'template data and a distinct id',
        { to: JANE, templateId: TEMPLATE_ID, templateData: { n: 1 }, distinctId: 'u' },
        { to: JANE, message_data: { n: 1 }, identifiers: { distinct_id: 'u' } },
      ],
    ])('maps %s to the request body', async (_, options, body) => {
      await createClient().emails.send(options)

      expect(api.received.map((request) => request.body)).toEqual([body])
    })

    it('sends the given idempotency key, and the migration marker of the client', async () => {
      await createClient({ migratedFrom: 'resend' }).emails.send({
        to: JANE,
        distinctId: 'user_42',
        templateId: TEMPLATE_ID,
        idempotencyKey: 'welcome:user_42',
      })

      expect(api.received[0].headers).toEqual(
        expect.objectContaining({ 'idempotency-key': 'welcome:user_42', 'x-posthog-migrated-from': 'resend' })
      )
    })

    it('answers a replayed idempotency key with the id of the first send, and sends one email', async () => {
      const posthog = createClient()
      const send = () =>
        posthog.emails.send({ to: JANE, distinctId: 'user_42', templateId: TEMPLATE_ID, idempotencyKey: 'k-1' })

      const first = await send()
      const replay = await send()

      expect(replay).toEqual(first)
      expect(api.delivered).toHaveLength(1)
    })

    it('returns the warnings of a send, and logs each one once', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const posthog = createClient()
      posthog.debug(true)
      api.failNext({
        status: 202,
        body: {
          message_id: 'message-9',
          warnings: [
            { code: 'sender_unverified_soon', detail: 'The sender expires soon.', fix: 'Verify it again.' },
            'unreadable',
          ],
        },
      })

      const result = await sendWelcome(posthog)

      expect(result).toEqual({
        data: {
          id: 'message-9',
          warnings: [{ code: 'sender_unverified_soon', message: 'The sender expires soon.', fix: 'Verify it again.' }],
        },
        error: null,
      })
      expect(warn.mock.calls.filter((call) => call.join(' ').includes('sender_unverified_soon'))).toHaveLength(1)
    })
  })

  describe('errors', () => {
    it.each([
      [400, 'invalid_recipient', 'validation_error'],
      [400, 'transactional_email_paused', 'validation_error'],
      [400, 'invalid_idempotency_key', 'validation_error'],
      [401, 'authentication_failed', 'missing_api_key'],
      [403, 'permission_denied', 'invalid_permission'],
      [404, 'not_found', 'not_found'],
      [409, 'idempotency_key_in_flight', 'concurrent_idempotent_requests'],
      [409, 'template_outdated', 'validation_error'],
      [409, 'template_edited_in_posthog', 'validation_error'],
      [422, 'idempotency_key_reused', 'invalid_idempotent_request'],
      [429, 'throttled', 'rate_limit_exceeded'],
      [429, 'quota_limited', 'monthly_quota_exceeded'],
      [503, 'delivery_unavailable', 'service_unavailable'],
      [500, 'server_error', 'application_error'],
    ])('names a %s %s answer %s, with the fields PostHog sent', async (status, code, name) => {
      api.failNext({ status, body: refusalBody(code, 'to') }, Infinity)

      const result = await sendWelcome(createClient(), { maxRetries: 0 })

      expect(result).toEqual({
        data: null,
        error: {
          name,
          code,
          message: `Refused with ${code}.`,
          why: `Because the fake refuses ${code}.`,
          fix: `Fix ${code}.`,
          statusCode: status,
          docsUrl: `https://posthog.com/docs/workflows/transactional-email-api#${code}`,
          field: 'to',
        },
      })
    })

    it.each([
      [
        'an answer without a code',
        { status: 500, body: '<html>oops</html>' },
        'api_error',
        'application_error',
        'PostHog answered HTTP 500.',
        500,
      ],
      [
        'a 202 without a message id',
        { status: 202, body: { ok: true } },
        'api_error',
        'application_error',
        'PostHog answered HTTP 202 with an unexpected body.',
        202,
      ],
      [
        'a network failure',
        { networkError: new Error('getaddrinfo ENOTFOUND posthog.example.com') },
        'network_error',
        'service_unavailable',
        'Request failed: getaddrinfo ENOTFOUND posthog.example.com',
        undefined,
      ],
      [
        'a refused connection to a host with two addresses',
        {
          networkError: new TypeError('fetch failed', {
            cause: new AggregateError([
              new Error('connect ECONNREFUSED ::1:8000'),
              new Error('connect ECONNREFUSED 127.0.0.1:8000'),
            ]),
          }),
        },
        'network_error',
        'service_unavailable',
        'Request failed: fetch failed: connect ECONNREFUSED ::1:8000, connect ECONNREFUSED 127.0.0.1:8000',
        undefined,
      ],
    ] satisfies [string, Fault, string, string, string, number | undefined][])(
      'returns %s as %s',
      async (_, fault, code, name, message, statusCode) => {
        api.failNext(fault, Infinity)

        const result = await sendWelcome(createClient(), { maxRetries: 0 })

        expect(result).toEqual({
          data: null,
          error: { name, code, message, ...(statusCode !== undefined && { statusCode }) },
        })
      }
    )

    it.each([
      ['missing_secret_key', 'missing_api_key', { secretKey: undefined }, {}],
      ['missing_app_host', 'application_error', { appHost: undefined }, {}],
      ['client_disabled', 'application_error', { disabled: true }, {}],
      ['invalid_template_id', 'validation_error', {}, { templateId: '../../feature_flags' }],
      ['invalid_idempotency_key', 'validation_error', {}, { idempotencyKey: 'has spaces' }],
      ['invalid_idempotency_key', 'validation_error', {}, { idempotencyKey: 42 as unknown as string }],
    ])('returns %s as %s without a request', async (code, name, clientOptions: PostHogOptions, sendOptions) => {
      const result = await createClient(clientOptions).emails.send({
        to: JANE,
        distinctId: 'user_42',
        templateId: TEMPLATE_ID,
        ...sendOptions,
      })

      expect(result).toEqual({ data: null, error: expect.objectContaining({ name, code }) })
      expect(api.received).toEqual([])
    })

    it.each([
      ['after shutdown', async (client: PostHog) => await client.shutdown()],
      ['while shutdown drains', (client: PostHog) => void client.shutdown()],
    ])('returns client_closed as application_error %s without a request', async (_, shutDown) => {
      const client = createClient()
      await shutDown(client)

      const result = await sendWelcome(client)

      expect(result).toEqual({
        data: null,
        error: expect.objectContaining({ name: 'application_error', code: 'client_closed' }),
      })
      expect(api.received).toEqual([])
    })

    it('returns invalid_form for an option it does not take, such as Resend scheduledAt, without a request', async () => {
      const result = await createClient().emails.send({
        to: JANE,
        templateId: TEMPLATE_ID,
        scheduledAt: 'in 1 hour',
      } as SendEmailOptions)

      expect(result.error).toEqual(
        expect.objectContaining({ name: 'validation_error', code: 'invalid_form', field: 'scheduledAt' })
      )
      expect(api.received).toEqual([])
    })

    it.each([undefined, null, JANE])('returns invalid_form for %s options without a request', async (options) => {
      const result = await createClient().emails.send(options as never)

      expect(result).toEqual({
        data: null,
        error: expect.objectContaining({ name: 'validation_error', code: 'invalid_form' }),
      })
      expect(api.received).toEqual([])
    })

    it('returns unexpected_error when the template data cannot be encoded', async () => {
      const result = await createClient().emails.send({
        to: JANE,
        templateId: TEMPLATE_ID,
        templateData: { count: BigInt(1) },
      })

      expect(result).toEqual({
        data: null,
        error: expect.objectContaining({ name: 'application_error', code: 'unexpected_error' }),
      })
    })
  })

  describe('retries', () => {
    const settle = async <T>(work: Promise<T>): Promise<T> => {
      await vi.runAllTimersAsync()
      return work
    }

    beforeEach(() => {
      vi.useFakeTimers()
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
    })

    it.each([
      ['a network failure', { networkError: new Error('ECONNRESET') }],
      ['an in-flight idempotency key', { status: 409, body: refusalBody('idempotency_key_in_flight', null) }],
      ['a throttled send', { status: 429, body: refusalBody('throttled', null) }],
      ['an unavailable pipeline', { status: 503, body: refusalBody('delivery_unavailable', null) }],
    ] satisfies [string, Fault][])('retry %s after 1 s and 2 s with the same key', async (_, fault) => {
      api.failNext(fault, 2)

      const result = sendWelcome()
      await vi.advanceTimersByTimeAsync(999)
      expect(api.received).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(api.received).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1999)
      expect(api.received).toHaveLength(2)

      expect(await settle(result)).toEqual({ data: { id: 'message-1', warnings: [] }, error: null })
      expect(api.received).toHaveLength(3)
      expect(new Set(idempotencyKeys()).size).toBe(1)
    })

    it('gives up after maxRetries and returns the last answer', async () => {
      api.failNext({ status: 503, body: refusalBody('delivery_unavailable', null) }, Infinity)

      const result = await settle(sendWelcome())

      expect(result.error).toEqual(expect.objectContaining({ code: 'delivery_unavailable' }))
      expect(api.received).toHaveLength(3)
    })

    it.each([
      ['the client', { maxRetries: 0 }, {}],
      ['the send', {}, { maxRetries: 0 }],
    ])('never retries when %s sets maxRetries to 0', async (_, clientOptions: PostHogOptions, sendOptions) => {
      api.failNext({ status: 503, body: refusalBody('delivery_unavailable', null) }, Infinity)

      await settle(sendWelcome(createClient(clientOptions), sendOptions))

      expect(api.received).toHaveLength(1)
    })

    it.each([
      ['the client sets NaN', { maxRetries: NaN }, {}, 3],
      ['the send sets Infinity', {}, { maxRetries: Infinity }, 3],
      ['the send sets -1', { maxRetries: 1 }, { maxRetries: -1 }, 2],
      ['the send sets 1.5', { maxRetries: 1 }, { maxRetries: 1.5 }, 2],
    ])('falls back to the default when %s', async (_, clientOptions: PostHogOptions, sendOptions, attempts) => {
      api.failNext({ status: 503, body: refusalBody('delivery_unavailable', null) }, Infinity)

      await settle(sendWelcome(createClient(clientOptions), sendOptions))

      expect(api.received).toHaveLength(attempts)
    })

    it('retries a 202 whose body breaks off, and returns the id of the queued email', async () => {
      api.failNext({ bodyBreaksOff: new Error('socket hang up') })

      const result = await settle(sendWelcome())

      expect(result).toEqual({ data: { id: 'message-1', warnings: [] }, error: null })
      expect(api.delivered).toHaveLength(1)
      expect(new Set(idempotencyKeys()).size).toBe(1)
    })

    it('lets a send retry more often than the client', async () => {
      api.failNext({ status: 503, body: refusalBody('delivery_unavailable', null) }, Infinity)

      await settle(sendWelcome(createClient({ maxRetries: 0 }), { maxRetries: 3 }))

      expect(api.received).toHaveLength(4)
    })

    it.each([
      ['a longer Retry-After', '5', 5_000],
      ['a Retry-After over 30 s, capped', '120', 30_000],
    ])('waits for %s', async (_, retryAfter, wait) => {
      api.failNext({ status: 429, body: refusalBody('throttled', null), headers: { 'Retry-After': retryAfter } })

      const result = sendWelcome()
      await vi.advanceTimersByTimeAsync(wait - 1)
      expect(api.received).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(api.received).toHaveLength(2)
      await settle(result)
    })

    it.each([
      [429, 'quota_limited'],
      [409, 'template_edited_in_posthog'],
      [400, 'invalid_recipient'],
      [500, 'server_error'],
    ])('never retries a %s %s answer', async (status, code) => {
      api.failNext({ status, body: refusalBody(code, null) }, Infinity)

      await settle(sendWelcome())

      expect(api.received).toHaveLength(1)
    })
  })

  describe('the app host', () => {
    it.each([
      ['https://us.i.posthog.com', 'https://us.posthog.com'],
      ['https://us.posthog.com', 'https://us.posthog.com'],
      ['https://app.posthog.com', 'https://us.posthog.com'],
      ['https://eu.i.posthog.com/', 'https://eu.posthog.com'],
      ['https://eu.posthog.com', 'https://eu.posthog.com'],
      [undefined, 'https://us.posthog.com'],
    ])('derives the app host of PostHog Cloud host %s', async (host, appHost) => {
      api = new FakeEmailsApi({ secretKey: SECRET_KEY, appHost })
      api.addTemplate(TEMPLATE_ID)

      const result = await sendWelcome(createClient({ host, appHost: undefined }))

      expect(result.error).toBeNull()
      expect(api.received.map(({ origin }) => origin)).toEqual([appHost])
    })

    it('never sends the secret key to a host that is not PostHog Cloud', async () => {
      const result = await sendWelcome(createClient({ host: 'https://proxy.example.com', appHost: undefined }))

      expect(result.error).toEqual(expect.objectContaining({ code: 'missing_app_host' }))
      expect(api.received).toEqual([])
    })

    it('sends to the app host, not to the ingestion host', async () => {
      await sendWelcome(createClient({ host: 'https://proxy.example.com', appHost: `${APP_HOST}/` }))

      expect(api.received.map(({ origin }) => origin)).toEqual([APP_HOST])
    })
  })
})
