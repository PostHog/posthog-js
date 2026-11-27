import { PostHog, PostHogOptions, PushError } from '@/entrypoints/index.node'

vi.mock('../version', () => ({ version: '1.2.3' }))

const SECRET_KEY = 'phs_test_secret'
const TEMPLATE_ID = '0190f6d2-7c1e-7b3a-9f5e-1c2d3e4f5a6b'
const SEND_URL = 'https://us.posthog.com/api/messaging/send/push/'
const MESSAGE_ID = '019e1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b'
const STATUS_URL = `https://us.posthog.com/api/messaging/pushes/${MESSAGE_ID}/`
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Reply = Error | { status: number; body?: unknown; headers?: Record<string, string> }

const accepted = (fields: Record<string, unknown> = {}): Reply => ({
  status: 202,
  body: { message_id: 'msg_1', replayed: false, ...fields },
})

describe('push', () => {
  vi.useFakeTimers()

  let posthog: PostHog
  let replies: Reply[]
  const fetch = vi.fn()

  const makeClient = (options: PostHogOptions = {}): PostHog => {
    posthog = new PostHog('phc_test', { secretKey: SECRET_KEY, enableLocalEvaluation: false, fetch, ...options })
    return posthog
  }

  const send = (overrides: Record<string, unknown> = {}): ReturnType<PostHog['push']['send']> =>
    posthog.push.send({ templateId: TEMPLATE_ID, distinctId: 'user_123', ...overrides } as any)

  const sendAndSettle = async (overrides: Record<string, unknown> = {}): ReturnType<PostHog['push']['send']> => {
    const pending = send(overrides)
    await vi.runAllTimersAsync()
    return pending
  }

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

  it('posts the template, person and data to the app host', async () => {
    replies = [accepted({ replayed: true })]

    const { data, error } = await send({
      templateId: TEMPLATE_ID.toUpperCase(),
      templateData: { order_id: '1042', shippedAt: new Date('2026-11-20T00:00:00Z') },
      idempotencyKey: 'order-shipped:1042',
    })

    expect(error).toBeNull()
    expect(data).toEqual({ id: 'msg_1', replayed: true })
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(SEND_URL)
    expect(options.method).toBe('POST')
    expect(options.headers).toMatchObject({
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'order-shipped:1042',
      'User-Agent': 'posthog-node/1.2.3',
    })
    expect(JSON.parse(options.body)).toEqual({
      template_id: TEMPLATE_ID,
      distinct_id: 'user_123',
      message_data: { order_id: '1042', shippedAt: '2026-11-20T00:00:00.000Z' },
    })
  })

  it('retries an unavailable pipeline with the same generated idempotency key', async () => {
    replies = [
      { status: 503, body: { type: 'server_error', code: 'delivery_unavailable', detail: 'Try again.' } },
      accepted(),
    ]

    const { data, error } = await sendAndSettle()

    expect(error).toBeNull()
    expect(data?.id).toBe('msg_1')
    const keys = fetch.mock.calls.map(([, options]) => options.headers['Idempotency-Key'])
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(UUID_V4)
    expect(keys[1]).toBe(keys[0])
  })

  it('returns the server refusal as a push error', async () => {
    replies = [
      {
        status: 400,
        body: {
          type: 'validation_error',
          code: 'transactional_push_paused',
          detail: 'The workflow is turned off.',
          fix: 'Turn it on.',
          attr: 'template_id',
        },
      },
    ]

    const { data, error } = await sendAndSettle()

    expect(data).toBeNull()
    expect(error).toBeInstanceOf(PushError)
    expect(error).toMatchObject({
      name: 'validation_error',
      code: 'transactional_push_paused',
      message: 'The workflow is turned off.',
      statusCode: 400,
      fix: 'Turn it on.',
      field: 'template_id',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a template ID that is not a UUID', { templateId: 'order-shipped' }, 'invalid_template_id'],
    ['no distinct ID', { distinctId: undefined }, 'invalid_distinct_id'],
    ['an empty distinct ID', { distinctId: '' }, 'invalid_distinct_id'],
    ['a distinct ID over 400 characters', { distinctId: 'a'.repeat(401) }, 'invalid_distinct_id'],
    ['template data that is a list', { templateData: ['1042'] }, 'invalid_template_data'],
    ['an idempotency key with a space', { idempotencyKey: 'order 1042' }, 'invalid_idempotency_key'],
    ['an option send does not take', { to: 'user@example.com' }, 'invalid_form'],
  ])('refuses %s without a request', async (_name, overrides, code) => {
    const { data, error } = await send(overrides)

    expect(data).toBeNull()
    expect(error).toMatchObject({ name: 'validation_error', code })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses a second argument without a request', async () => {
    const { data, error } = await (posthog.push.send as any)(
      { templateId: TEMPLATE_ID, distinctId: 'user_123' },
      { idempotencyKey: 'order-shipped:1042' }
    )

    expect(data).toBeNull()
    expect(error).toMatchObject({ name: 'validation_error', code: 'invalid_form' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a custom host without appHost', { host: 'https://ph.example.com' }, 'missing_app_host'],
    ['no secret key', { secretKey: undefined }, 'missing_secret_key'],
  ])('refuses %s without a request', async (_name, options, code) => {
    makeClient(options)

    const { error } = await send()

    expect(error).toBeInstanceOf(PushError)
    expect(error?.code).toBe(code)
    expect(error?.message).toContain('push')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends to appHost when the client host is a proxy', async () => {
    makeClient({ host: 'https://ph.example.com', appHost: 'https://posthog.example.com/' })
    replies = [accepted()]

    await send()

    expect(fetch.mock.calls[0][0]).toBe('https://posthog.example.com/api/messaging/send/push/')
  })

  describe('get', () => {
    const statusReply = (fields: Record<string, unknown> = {}): Reply => ({
      status: 200,
      body: {
        id: MESSAGE_ID,
        status: 'not_sent',
        created_at: '2026-11-20T16:27:44.364000Z',
        reason: 'no_device',
        ...fields,
      },
    })

    it('reads the status of a sent push notification from the app host', async () => {
      replies = [{ status: 503 }, statusReply()]

      const pending = posthog.push.get(MESSAGE_ID.toUpperCase())
      await vi.runAllTimersAsync()

      expect(await pending).toEqual({
        data: {
          id: MESSAGE_ID,
          status: 'not_sent',
          createdAt: '2026-11-20T16:27:44.364000Z',
          reason: 'no_device',
        },
        error: null,
      })
      const [url, options] = fetch.mock.calls[1]
      expect(url).toBe(STATUS_URL)
      expect(options.method).toBe('GET')
      expect(options.body).toBeUndefined()
      expect(options.headers).toEqual({
        Authorization: `Bearer ${SECRET_KEY}`,
        Accept: 'application/json',
        'User-Agent': 'posthog-node/1.2.3',
      })
    })

    it.each([
      ['an unknown ID', [{ status: 404, body: { code: 'not_found' } }], MESSAGE_ID, 'not_found', 1],
      ['an ID that is not a UUID', [], 'msg_1', 'invalid_message_id', 0],
      ['a reply without a status', [statusReply({ status: null })], MESSAGE_ID, 'api_error', 1],
    ])('reports %s', async (_name, queued, id, code, requests) => {
      replies = queued

      const { data, error } = await posthog.push.get(id)

      expect(data).toBeNull()
      expect(error).toBeInstanceOf(PushError)
      expect(error?.code).toBe(code)
      expect(fetch).toHaveBeenCalledTimes(requests)
    })
  })

  it('makes shutdown wait for a send in its retry backoff', async () => {
    replies = [{ status: 503 }, accepted()]

    const pending = send()
    const shutdown = posthog.shutdown()
    await vi.runAllTimersAsync()
    await shutdown

    expect((await pending).data?.id).toBe('msg_1')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
