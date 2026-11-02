import { EmailError, PostHog, PostHogOptions, SendEmailOptions } from '@/entrypoints/index.node'

vi.mock('../version', () => ({ version: '1.2.3' }))

const SECRET_KEY = 'phs_test_secret'
const TEMPLATE_ID = '0190f6d2-7c1e-7b3a-9f5e-1c2d3e4f5a6b'
const SEND_URL = 'https://us.posthog.com/api/projects/@current/messaging/send/email/'
const MESSAGE_ID = '01a18356-c56c-0001-e494-7666bc915188'
const STATUS_URL = `https://us.posthog.com/api/projects/@current/messaging/emails/${MESSAGE_ID}/`
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Reply = Error | { status: number; body?: unknown; headers?: Record<string, string> }

const accepted = (fields: Record<string, unknown> = {}): Reply => ({
  status: 202,
  body: { message_id: 'msg_1', replayed: false, ...fields },
})

const rejected = (status: number, code?: string, headers: Record<string, string> = {}): Reply => ({
  status,
  body: code ? { type: 'invalid_request', code, detail: 'Nope.', attr: null } : undefined,
  headers,
})

describe('emails', () => {
  vi.useFakeTimers()

  let posthog: PostHog
  let replies: Reply[]
  const fetch = vi.fn()

  const makeClient = (options: PostHogOptions = {}): PostHog => {
    posthog = new PostHog('phc_test', {
      secretKey: SECRET_KEY,
      enableLocalEvaluation: false,
      fetch,
      ...options,
    })
    return posthog
  }

  const send = (overrides: Record<string, unknown> = {}): ReturnType<PostHog['emails']['send']> =>
    posthog.emails.send({ to: 'user@example.com', templateId: TEMPLATE_ID, ...overrides })

  const sendAndSettle = async (overrides: Record<string, unknown> = {}): ReturnType<PostHog['emails']['send']> => {
    const pending = send(overrides)
    await vi.runAllTimersAsync()
    return pending
  }

  const sentHeaders = (): string[] => fetch.mock.calls.map(([, options]) => options.headers['Idempotency-Key'])

  beforeEach(() => {
    replies = []
    fetch.mockReset()
    fetch.mockImplementation(async () => {
      const reply = replies.shift()
      if (!reply) {
        throw new Error('No reply queued')
      }
      if (reply instanceof Error) {
        throw reply
      }
      const headers = Object.fromEntries(Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
      return {
        status: reply.status,
        text: async () => (reply.body === undefined ? '' : JSON.stringify(reply.body)),
        json: async () => reply.body,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      }
    })
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    makeClient()
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  it.each([
    ['with a distinct ID', { distinctId: 'user_123' }, { identifiers: { distinct_id: 'user_123' } }],
    ['without a distinct ID', {}, {}],
  ])('posts the template to the app host %s', async (_name, overrides, extraBody) => {
    replies = [accepted()]

    const { data, error } = await send({
      templateId: TEMPLATE_ID.toUpperCase(),
      templateData: { name: 'Ada', expiresAt: new Date('2026-11-20T00:00:00Z') },
      idempotencyKey: 'welcome:user_123',
      ...overrides,
    })

    expect(error).toBeNull()
    expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(SEND_URL)
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'welcome:user_123',
      'User-Agent': 'posthog-node/1.2.3',
    })
    expect(JSON.parse(options.body)).toEqual({
      template: { id: TEMPLATE_ID },
      to: 'user@example.com',
      message_data: { name: 'Ada', expiresAt: '2026-11-20T00:00:00.000Z' },
      ...extraBody,
    })
  })

  it('never takes the recipient person from the request context', async () => {
    replies = [accepted()]

    await posthog.withContext({ distinctId: 'context_user' }, () => send())

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      template: { id: TEMPLATE_ID },
      to: 'user@example.com',
      message_data: {},
    })
  })

  it.each([
    [
      'html',
      { templateKey: 'password-reset', subject: 'Reset your password', html: '<p>Reset</p>' },
      {
        template_key: 'password-reset',
        subject: 'Reset your password',
        html: '<p>Reset</p>',
        capture_engagement: true,
      },
    ],
    [
      'text, a sender, one reply-to address and engagement capture turned off',
      {
        templateKey: 'password-reset',
        subject: 'Reset',
        text: 'Reset',
        from: 'Security <security@example.com>',
        replyTo: 'help@example.com',
        captureEngagement: false,
      },
      {
        template_key: 'password-reset',
        subject: 'Reset',
        text: 'Reset',
        from: 'Security <security@example.com>',
        reply_to: ['help@example.com'],
        capture_engagement: false,
      },
    ],
    [
      'html, text and reply-to addresses',
      {
        templateKey: 'password-reset',
        subject: 'Reset',
        html: '<p>Reset</p>',
        text: 'Reset',
        replyTo: ['a@example.com', 'b@example.com'],
      },
      {
        template_key: 'password-reset',
        subject: 'Reset',
        html: '<p>Reset</p>',
        text: 'Reset',
        reply_to: ['a@example.com', 'b@example.com'],
        capture_engagement: true,
      },
    ],
  ])('posts content from code with %s to the same send URL', async (_name, content, body) => {
    replies = [accepted()]

    const { data, error } = await posthog.emails.send({ to: 'user@example.com', distinctId: 'user_123', ...content })

    expect(error).toBeNull()
    expect(data?.id).toBe('msg_1')
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(SEND_URL)
    expect(JSON.parse(options.body)).toEqual({
      ...body,
      to: 'user@example.com',
      distinct_id: 'user_123',
    })
  })

  it('names the provider the client moved from on every request', async () => {
    makeClient({ migratedFrom: 'resend' })
    replies = [accepted(), { status: 200, body: { id: MESSAGE_ID, status: 'sent', created_at: 'a', status_at: 'b' } }]

    await send()
    await posthog.emails.get(MESSAGE_ID)

    expect(fetch.mock.calls.map(([, options]) => options.headers['X-PostHog-Migrated-From'])).toEqual([
      'resend',
      'resend',
    ])
  })

  it.each([
    [undefined, undefined, 'https://us.posthog.com'],
    ['https://us.i.posthog.com', undefined, 'https://us.posthog.com'],
    ['https://eu.i.posthog.com/', undefined, 'https://eu.posthog.com'],
    ['https://us.posthog.com', undefined, 'https://us.posthog.com'],
    ['https://eu.posthog.com', undefined, 'https://eu.posthog.com'],
    ['https://app.posthog.com', undefined, 'https://us.posthog.com'],
    ['https://ph.example.com', 'https://posthog.example.com/', 'https://posthog.example.com'],
  ])('sends a client with host %s and appHost %s to %s', async (host, appHost, expected) => {
    makeClient({ host, appHost })
    replies = [accepted()]

    await send()

    expect(fetch.mock.calls[0][0]).toBe(`${expected}/api/projects/@current/messaging/send/email/`)
  })

  it.each([
    ['a custom host without appHost', { host: 'https://ph.example.com' }, 'missing_app_host', 'application_error'],
    ['no secret key', { secretKey: undefined }, 'missing_secret_key', 'missing_api_key'],
  ])('refuses to send with %s', async (_name, options, code, name) => {
    makeClient(options)

    const { data, error } = await send()

    expect(data).toBeNull()
    expect(error).toBeInstanceOf(EmailError)
    expect({ code: error?.code, name: error?.name }).toEqual({ code, name })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['429 throttled', true, rejected(429, 'throttled')],
    ['429 quota_limited', false, rejected(429, 'quota_limited')],
    ['503 delivery_unavailable', true, rejected(503, 'delivery_unavailable')],
    ['409 idempotency_key_in_flight', true, rejected(409, 'idempotency_key_in_flight')],
    ['409 template_outdated', false, rejected(409, 'template_outdated')],
    ['400 invalid_recipient', false, rejected(400, 'invalid_recipient')],
    ['500 without a body', false, rejected(500)],
    ['a network error', true, new TypeError('fetch failed')],
  ])('%s is retried: %s', async (_name, retried, firstReply) => {
    replies = [firstReply, accepted()]

    const { data, error } = await sendAndSettle()

    if (retried) {
      expect(error).toBeNull()
      expect(data?.id).toBe('msg_1')
      const [first, second] = sentHeaders()
      expect(first).toMatch(UUID_V4)
      expect(second).toBe(first)
    } else {
      expect(data).toBeNull()
      expect(error).toBeInstanceOf(EmailError)
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })

  it.each([
    [400, 'invalid_recipient', 'validation_error'],
    [400, 'recipient_suppressed', 'validation_error'],
    [401, 'authentication_failed', 'missing_api_key'],
    [403, 'permission_denied', 'invalid_permission'],
    [404, 'not_found', 'not_found'],
    [409, 'idempotency_key_in_flight', 'concurrent_idempotent_requests'],
    [422, 'idempotency_key_reused', 'invalid_idempotent_request'],
    [422, 'recipient_suppressed', 'validation_error'],
    [429, 'throttled', 'rate_limit_exceeded'],
    [429, 'quota_limited', 'monthly_quota_exceeded'],
    [503, 'delivery_unavailable', 'service_unavailable'],
    [500, undefined, 'application_error'],
  ])('keeps the HTTP %s code %s with the name %s', async (status, code, name) => {
    replies = [rejected(status, code)]

    const { error } = await send({ maxRetries: 0 })

    expect(error).toMatchObject({ statusCode: status, code: code ?? 'api_error', name })
    expect(error?.message).not.toContain(SECRET_KEY)
  })

  it('passes the field PostHog names in attr', async () => {
    replies = [{ status: 400, body: { type: 'validation_error', code: 'invalid_input', detail: 'Bad.', attr: 'to' } }]

    const { error } = await send()

    expect(error).toMatchObject({ code: 'invalid_input', message: 'Bad.', field: 'to', statusCode: 400 })
  })

  it('waits for a Retry-After longer than its backoff', async () => {
    replies = [rejected(429, 'throttled', { 'Retry-After': '5' }), accepted()]

    const pending = send()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)

    expect((await pending).data?.id).toBe('msg_1')
  })

  it('gives up at once on a Retry-After over 30 seconds', async () => {
    replies = [rejected(429, 'throttled', { 'Retry-After': '3600' })]

    const { error } = await send()

    expect(error).toMatchObject({ code: 'throttled', retryAfterMs: 3_600_000 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('backs off about 1 and then 2 seconds before it reports a network error', async () => {
    replies = [new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]

    const pending = send()
    await vi.advanceTimersByTimeAsync(999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(3)

    const { error } = await pending
    expect(error).toMatchObject({ code: 'network_error', name: 'service_unavailable' })
    expect(error?.statusCode).toBeUndefined()
  })

  it.each([
    ['the client option', { emailRequestMaxRetries: 0 }, {}, 1],
    ['a send option', {}, { maxRetries: 0 }, 1],
    ['a send option over the client option', { emailRequestMaxRetries: 0 }, { maxRetries: 3 }, 4],
  ])('limits retries with %s', async (_name, clientOptions, sendOptions, attempts) => {
    makeClient(clientOptions)
    replies = Array.from({ length: 5 }, () => rejected(503, 'delivery_unavailable'))

    const { error } = await sendAndSettle(sendOptions)

    expect(error?.code).toBe('delivery_unavailable')
    expect(fetch).toHaveBeenCalledTimes(attempts)
  })

  it('times out a request that answers too late and releases the late response', async () => {
    makeClient({ emailRequestTimeoutMs: 1_000 })
    let answer!: (response: unknown) => void
    fetch.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const cancel = vi.fn()

    const pending = send({ maxRetries: 0 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await pending).error?.code).toBe('network_error')

    answer({ status: 202, headers: new Headers(), text: async () => '{}', body: { cancel } })
    await vi.advanceTimersByTimeAsync(0)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('times out a response body that stalls and cancels it', async () => {
    makeClient({ emailRequestTimeoutMs: 1_000 })
    const cancel = vi.fn()
    fetch.mockResolvedValue({
      status: 202,
      headers: new Headers(),
      text: () => new Promise(() => {}),
      body: { cancel },
    })

    const pending = send({ maxRetries: 0 })
    await vi.advanceTimersByTimeAsync(1_000)

    expect((await pending).error?.code).toBe('network_error')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('keeps the status and Retry-After when an error body cannot be read', async () => {
    fetch.mockResolvedValue({
      status: 429,
      headers: new Headers({ 'Retry-After': '120' }),
      text: () => Promise.reject(new TypeError('terminated')),
      body: { cancel: vi.fn() },
    })

    const { error } = await sendAndSettle()

    expect(error).toMatchObject({ code: 'api_error', statusCode: 429, retryAfterMs: 120_000 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry an acceptance without a message ID', async () => {
    replies = [{ status: 202, body: {} }, accepted()]

    const { error } = await sendAndSettle()

    expect(error).toMatchObject({ code: 'api_error', statusCode: 202 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns a replay and its warnings', async () => {
    replies = [
      accepted({ replayed: true, warnings: [{ code: 'template_superseded', detail: 'Newer.', fix: 'Upload.' }] }),
    ]

    const { data } = await send()

    expect(data).toEqual({
      id: 'msg_1',
      replayed: true,
      warnings: [{ code: 'template_superseded', message: 'Newer.', fix: 'Upload.' }],
    })
  })

  it('sends nothing from a disabled client and returns client_disabled', async () => {
    makeClient({ disabled: true })

    const { data, error } = await send()

    expect(data).toBeNull()
    expect({ code: error?.code, name: error?.name }).toEqual({ code: 'client_disabled', name: 'application_error' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('waits for a send in its retry backoff before shutdown resolves', async () => {
    replies = [rejected(503, 'delivery_unavailable'), accepted()]
    let shutDown = false

    const pending = send()
    await vi.advanceTimersByTimeAsync(0)
    const shutdown = posthog.shutdown().then(() => (shutDown = true))
    await vi.advanceTimersByTimeAsync(999)
    expect(shutDown).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect((await pending).data?.id).toBe('msg_1')
    await shutdown
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('flushes queued events while an email send is in its retry backoff', async () => {
    // Compression runs on real I/O, which fake timers can't advance.
    makeClient({ disableCompression: true })
    replies = [rejected(503, 'delivery_unavailable'), accepted()]
    const emailFetch = fetch.getMockImplementation()!
    fetch.mockImplementation((url: string, options: unknown) =>
      url.includes('/batch/')
        ? Promise.resolve({ status: 200, text: async () => '{}', json: async () => ({}), headers: new Headers() })
        : emailFetch(url, options)
    )
    const batchCalls = (): number => fetch.mock.calls.filter(([url]) => url.includes('/batch/')).length

    const pending = send()
    await vi.advanceTimersByTimeAsync(0)
    posthog.capture({ distinctId: 'user_123', event: 'signed_up' })
    const shutdown = posthog.shutdown()
    await vi.advanceTimersByTimeAsync(500)
    const batchCallsDuringBackoff = batchCalls()
    await vi.advanceTimersByTimeAsync(500)

    expect((await pending).data?.id).toBe('msg_1')
    await shutdown
    expect(batchCallsDuringBackoff).toBe(1)
  })

  it('sends nothing after shutdown and returns client_closed', async () => {
    await posthog.shutdown()

    const { data, error } = await sendAndSettle()

    expect(data).toBeNull()
    expect({ code: error?.code, name: error?.name }).toEqual({ code: 'client_closed', name: 'application_error' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['several recipients', { to: ['a@example.com', 'b@example.com'] }, 'invalid_recipient'],
    ['an empty recipient', { to: ' ' }, 'invalid_recipient'],
    ['a template name', { templateId: 'welcome' }, 'invalid_template_id'],
    ['a template data list', { templateData: [1, 2] }, 'invalid_template_data'],
    ['an empty distinct ID', { distinctId: '' }, 'invalid_distinct_id'],
    ['a key with a space', { idempotencyKey: 'welcome user' }, 'invalid_idempotency_key'],
    ['a key that is too long', { idempotencyKey: 'k'.repeat(256) }, 'invalid_idempotency_key'],
    ['negative retries', { maxRetries: -1 }, 'invalid_max_retries'],
    ['neither templateId nor templateKey', { templateId: undefined }, 'invalid_form'],
    ['both templateId and templateKey', { templateKey: 'welcome', subject: 'Hi', html: '<p>Hi</p>' }, 'invalid_form'],
    ['a template key with a space', { templateId: undefined, templateKey: 'pass reset' }, 'invalid_template_key'],
  ])('rejects %s before sending', async (_name, overrides, code) => {
    const { data, error } = await send(overrides)

    expect(data).toBeNull()
    expect(error).toMatchObject({ code, name: 'validation_error' })
    expect(fetch).not.toHaveBeenCalled()
  })

  describe('the send form', () => {
    const CODE_SEND = { templateKey: 'welcome', subject: 'Hi', html: '<p>Hi</p>' }

    const sendForm = (form: Record<string, unknown>): ReturnType<PostHog['emails']['send']> =>
      posthog.emails.send({ to: 'user@example.com', ...form } as unknown as SendEmailOptions)

    it.each([
      ['from on the template form', { templateId: TEMPLATE_ID, from: 'Acme <hi@example.com>' }, 'from'],
      ['replyTo on the template form', { templateId: TEMPLATE_ID, replyTo: 'help@example.com' }, 'replyTo'],
      ['subject on the template form', { templateId: TEMPLATE_ID, subject: 'Hi' }, 'subject'],
      ['html on the template form', { templateId: TEMPLATE_ID, html: '<p>Hi</p>' }, 'html'],
      ['text on the template form', { templateId: TEMPLATE_ID, text: 'Hi' }, 'text'],
      [
        'captureEngagement on the template form',
        { templateId: TEMPLATE_ID, captureEngagement: false },
        'captureEngagement',
      ],
      ['a code send without a subject', { templateKey: 'welcome', html: '<p>Hi</p>' }, 'subject'],
      ['a code send without html or text', { templateKey: 'welcome', subject: 'Hi' }, 'html'],
      ['a code send with html that is not a string', { ...CODE_SEND, html: 1 }, 'html'],
      ['template data on a code send', { ...CODE_SEND, templateData: { name: 'Jane' } }, 'templateData'],
      [
        "Resend's scheduledAt on the template form",
        { templateId: TEMPLATE_ID, scheduledAt: 'in 1 hour' },
        'scheduledAt',
      ],
      ["Resend's scheduledAt on a code send", { ...CODE_SEND, scheduledAt: 'in 1 hour' }, 'scheduledAt'],
    ])('refuses %s before sending', async (_name, form, field) => {
      const { data, error } = await sendForm(form)

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_form', name: 'validation_error', field })
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      [
        'a sender on the template form',
        { templateId: TEMPLATE_ID, from: 'Acme <hi@example.com>' },
        "A template made in PostHog sets its own sender, subject and content, and follows the project's engagement setting.",
        'Remove from, or send content from your code with templateKey.',
      ],
      [
        'engagement capture on the template form',
        { templateId: TEMPLATE_ID, captureEngagement: true },
        "A template made in PostHog sets its own sender, subject and content, and follows the project's engagement setting.",
        'Remove captureEngagement, or send content from your code with templateKey.',
      ],
      [
        'template data on a code send',
        { ...CODE_SEND, templateData: { name: 'Jane' } },
        'A send with templateKey takes its content from your code.',
        'Remove templateData, or send a template made in PostHog with templateId.',
      ],
      [
        'a field no form takes',
        { ...CODE_SEND, scheduledAt: 'in 1 hour' },
        undefined,
        'Remove scheduledAt and send again.',
      ],
    ])('explains why it refuses %s and how to send it', async (_name, form, why, fix) => {
      const { error } = await sendForm(form)

      expect({ why: error?.why, fix: error?.fix }).toEqual({ why, fix })
    })

    it.each([
      ["Resend's second options argument", { idempotencyKey: 'welcome:user_123' }, 0],
      ['an undefined second argument from a wrapper', undefined, 1],
    ])('sends with %s: %s requests', async (_name, secondArgument, requests) => {
      replies = [accepted()]
      const sendWithTwoArguments = posthog.emails.send.bind(posthog.emails) as (
        ...args: unknown[]
      ) => ReturnType<PostHog['emails']['send']>

      const { error } = await sendWithTwoArguments({ to: 'user@example.com', templateId: TEMPLATE_ID }, secondArgument)

      expect(fetch).toHaveBeenCalledTimes(requests)
      expect(error?.code ?? null).toBe(requests ? null : 'invalid_form')
    })
  })

  describe('get', () => {
    const statusReply = (fields: Record<string, unknown> = {}): Reply => ({
      status: 200,
      body: {
        id: MESSAGE_ID,
        status: 'bounced',
        created_at: '2026-10-28T16:27:44.364000Z',
        status_at: '2026-10-28T16:30:02.100000Z',
        reason: 'hard',
        ...fields,
      },
    })

    it('reads the status of a sent email from the app host', async () => {
      replies = [statusReply()]

      const { data, error } = await posthog.emails.get(MESSAGE_ID.toUpperCase())

      expect(error).toBeNull()
      expect(data).toEqual({
        id: MESSAGE_ID,
        status: 'bounced',
        createdAt: '2026-10-28T16:27:44.364000Z',
        statusAt: '2026-10-28T16:30:02.100000Z',
        reason: 'hard',
      })
      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe(STATUS_URL)
      expect(options.method).toBe('GET')
      expect(options.body).toBeUndefined()
      expect(options.headers).toEqual({
        Authorization: `Bearer ${SECRET_KEY}`,
        Accept: 'application/json',
        'User-Agent': 'posthog-node/1.2.3',
      })
    })

    it('reads a null reason', async () => {
      replies = [statusReply({ status: 'sent', reason: null })]

      const { data } = await posthog.emails.get(MESSAGE_ID)

      expect(data).toMatchObject({ status: 'sent', reason: null })
    })

    it.each([
      ['an unknown ID without a retry', [rejected(404, 'not_found')], MESSAGE_ID, 'not_found', 'not_found', 1],
      ['an ID that is not a UUID without a request', [], 'msg_1', 'invalid_message_id', 'validation_error', 0],
      [
        'a status reply without a status',
        [statusReply({ status: null })],
        MESSAGE_ID,
        'api_error',
        'application_error',
        1,
      ],
    ])('reports %s', async (_name, queued, id, code, name, requests) => {
      replies = queued

      const { data, error } = await posthog.emails.get(id)

      expect(data).toBeNull()
      expect(error).toMatchObject({ code, name })
      expect(fetch).toHaveBeenCalledTimes(requests)
    })

    it('retries an unavailable service', async () => {
      replies = [rejected(503), statusReply()]

      const pending = posthog.emails.get(MESSAGE_ID)
      await vi.runAllTimersAsync()
      const { data } = await pending

      expect(data?.status).toBe('bounced')
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })
})
