import { EmailError, PostHog, PostHogOptions, SendEmailOptions } from '@/entrypoints/index.node'

vi.mock('../version', () => ({ version: '1.2.3' }))

const SECRET_KEY = 'phs_test_secret'
const TEMPLATE_ID = '0190f6d2-7c1e-7b3a-9f5e-1c2d3e4f5a6b'
const SEND_URL = 'https://us.posthog.com/api/projects/@current/messaging/send/email/'
const MESSAGE_ID = '01a18356-c56c-0001-e494-7666bc915188'
const STATUS_URL = `https://us.posthog.com/api/projects/@current/messaging/emails/${MESSAGE_ID}/`
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Reply = Error | { status: number; body?: unknown; text?: string; headers?: Record<string, string> }

const accepted = (fields: Record<string, unknown> = {}): Reply => ({
  status: 202,
  body: { message_id: 'msg_1', replayed: false, ...fields },
})

const rejected = (status: number, code?: string, headers: Record<string, string> = {}): Reply => ({
  status,
  body: code ? { type: 'invalid_request', code, detail: 'Nope.', attr: null } : undefined,
  headers,
})

const COPIES = { cc: 'finance@example.com', bcc: ['audit@example.com', 'archive@example.com'] }
const COPIES_ON_THE_WIRE = { cc: ['finance@example.com'], bcc: ['audit@example.com', 'archive@example.com'] }

const UPLOADS_URL = 'https://us.posthog.com/api/projects/@current/messaging/attachments/uploads/'
const STORAGE_URL = 'https://email-files.s3.example.com/team/2/'
const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
const LOGO_SHA256 = '47ffa3ea45a70b8a41c2c0825df323c00a8b7a01c1ea06083cc41dddcc001123'
const INVITE_SHA256 = '9daa8e24f9b759073687839a0aa7de2a2f09abc2a771e77a34e1a05dd4198387'
const INVOICE_SHA256 = '52d6e3de4fa0dcc29946695f93940c3e7f26f30e1e39f4b1a49ad98839112786'
const LARGEST_FILE_WITH_EMPTY_BODIES = 29_182_875

const filesAnswer = (...files: Record<string, unknown>[]): Reply => ({ status: 200, body: { files } })
const present = (sha256: string): Record<string, unknown> => ({
  sha256,
  status: 'present',
  expires_at: '2026-12-16T00:00:00Z',
})
const uploadSlot = (sha256: string, size: number): Record<string, unknown> => ({
  sha256,
  status: 'upload',
  url: `${STORAGE_URL}${sha256}?X-Amz-Signature=signed`,
  method: 'PUT',
  headers: { 'Content-Length': String(size), 'x-amz-checksum-sha256': `checksum-of-${sha256.slice(0, 8)}` },
  url_expires_at: '2026-11-09T12:15:00Z',
})
const stored: Reply = { status: 200 }
const storageRefused = (status: number, code: string, message: string): Reply => ({
  status,
  text: `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message></Error>`,
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
  const requests = (): string[] => fetch.mock.calls.map(([url, options]) => `${options.method} ${url}`)
  const bodyOf = (request: number): any => JSON.parse(fetch.mock.calls[request][1].body)

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
        text: async () => reply.text ?? (reply.body === undefined ? '' : JSON.stringify(reply.body)),
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
    ['with a distinct ID', { distinctId: 'user_123' }, { distinct_id: 'user_123' }],
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
      template_id: TEMPLATE_ID,
      to: 'user@example.com',
      message_data: { name: 'Ada', expiresAt: '2026-11-20T00:00:00.000Z' },
      ...extraBody,
    })
  })

  it('sends the options as they were at the call, whatever the caller changes later', async () => {
    replies = [accepted(), accepted()]
    const templateData = { name: 'Ada' }
    const cc = ['finance@example.com']

    const templateSend = send({ templateData })
    const codeSend = posthog.emails.send({
      to: 'user@example.com',
      templateKey: 'receipt',
      subject: 'Your receipt',
      html: '<p>Thanks</p>',
      cc,
    })
    templateData.name = 'Changed'
    cc.push('changed@example.com')
    await Promise.all([templateSend, codeSend])

    expect(bodyOf(0).message_data).toEqual({ name: 'Ada' })
    expect(bodyOf(1).cc).toEqual(['finance@example.com'])
  })

  it('never takes the recipient person from the request context', async () => {
    replies = [accepted()]

    await posthog.withContext({ distinctId: 'context_user' }, () => send())

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      template_id: TEMPLATE_ID,
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
    [
      'copies',
      { templateKey: 'receipt', subject: 'Your receipt', html: '<p>Thanks</p>', ...COPIES },
      {
        template_key: 'receipt',
        subject: 'Your receipt',
        html: '<p>Thanks</p>',
        ...COPIES_ON_THE_WIRE,
        capture_engagement: true,
      },
    ],
    [
      'empty copies and attachments, which it leaves out without uploading',
      { templateKey: 'receipt', subject: 'Your receipt', html: '<p>Thanks</p>', cc: [], bcc: [], attachments: [] },
      { template_key: 'receipt', subject: 'Your receipt', html: '<p>Thanks</p>', capture_engagement: true },
    ],
    [
      'an empty reply-to list, which it leaves out',
      {
        templateKey: 'password-reset',
        subject: 'Reset',
        html: '<p>Reset</p>',
        replyTo: [],
      },
      {
        template_key: 'password-reset',
        subject: 'Reset',
        html: '<p>Reset</p>',
        capture_engagement: true,
      },
    ],
  ])('posts content from code with %s to the same send URL', async (_name, content, body) => {
    replies = [accepted()]

    const { data, error } = await posthog.emails.send({ to: 'user@example.com', distinctId: 'user_123', ...content })

    expect(error).toBeNull()
    expect(data?.id).toBe('msg_1')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe(SEND_URL)
    expect(JSON.parse(options.body)).toEqual({
      ...body,
      to: 'user@example.com',
      distinct_id: 'user_123',
    })
  })

  it.each(['cc', 'bcc'])(
    "reports a PostHog that doesn't take %s yet as its own refusal, without retrying",
    async (field) => {
      const why =
        "This PostHog version doesn't take the field yet, so it refused the email instead of sending it without it."
      const fix = 'Send the email without this field, or send it again once PostHog takes the field.'
      replies = [
        {
          status: 400,
          body: {
            type: 'validation_error',
            code: 'field_not_accepted',
            detail: "PostHog doesn't take this field yet, so it didn't send the email.",
            attr: field,
            why,
            fix,
          },
        },
      ]

      const { data, error } = await posthog.emails.send({
        to: 'user@example.com',
        templateKey: 'receipt',
        subject: 'Your receipt',
        html: '<p>Thanks</p>',
        ...COPIES,
      })

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'field_not_accepted',
        name: 'validation_error',
        statusCode: 400,
        field,
        message: "PostHog doesn't take this field yet, so it didn't send the email.",
        why,
        fix,
      })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch.mock.calls[0][0]).toBe(SEND_URL)
    }
  )

  describe('attachments', () => {
    const RECEIPT = { to: 'user@example.com', templateKey: 'receipt', subject: 'Your receipt', html: '<p>Thanks</p>' }

    const settle = async <T>(pending: Promise<T>): Promise<T> => {
      let done = false
      void pending.finally(() => (done = true))
      while (!done) {
        await vi.advanceTimersByTimeAsync(1000)
      }
      return pending
    }

    const sendFiles = (
      attachments: unknown,
      content: Record<string, unknown> = {}
    ): ReturnType<PostHog['emails']['send']> =>
      settle(posthog.emails.send({ ...RECEIPT, ...content, attachments } as SendEmailOptions))

    it('uploads the files PostHog does not have, then sends every file by its hash', async () => {
      replies = [
        filesAnswer(present(HELLO_SHA256), uploadSlot(LOGO_SHA256, 3), uploadSlot(INVITE_SHA256, 15)),
        stored,
        stored,
        accepted(),
      ]

      const { data, error } = await sendFiles([
        { filename: 'receipt.txt', content: Buffer.from('hello') },
        { filename: 'logo.png', content: new Uint8Array([0, 255, 1]), contentType: 'image/png', contentId: 'logo' },
        { filename: 'invite.ics', content: 'QkVHSU46VkNBTEVOREFS', contentType: 'text/calendar' },
      ])

      expect(error).toBeNull()
      expect(data?.id).toBe('msg_1')
      expect(requests()).toEqual([
        `POST ${UPLOADS_URL}`,
        `PUT ${STORAGE_URL}${LOGO_SHA256}?X-Amz-Signature=signed`,
        `PUT ${STORAGE_URL}${INVITE_SHA256}?X-Amz-Signature=signed`,
        `POST ${SEND_URL}`,
      ])
      expect(bodyOf(0)).toEqual({
        files: [
          { sha256: HELLO_SHA256, size: 5 },
          { sha256: LOGO_SHA256, size: 3 },
          { sha256: INVITE_SHA256, size: 15 },
        ],
      })
      expect(bodyOf(3)).toEqual({
        to: 'user@example.com',
        template_key: 'receipt',
        subject: 'Your receipt',
        html: '<p>Thanks</p>',
        capture_engagement: true,
        attachments: [
          { sha256: HELLO_SHA256, filename: 'receipt.txt' },
          { sha256: LOGO_SHA256, filename: 'logo.png', content_type: 'image/png', content_id: 'logo' },
          { sha256: INVITE_SHA256, filename: 'invite.ics', content_type: 'text/calendar' },
        ],
      })
    })

    it('asks where to upload with the secret key, and puts the bytes with only the headers PostHog gave', async () => {
      replies = [filesAnswer(uploadSlot(LOGO_SHA256, 3)), stored, accepted()]

      await sendFiles([{ filename: 'logo.png', content: new Uint8Array([0, 255, 1]) }])

      const [[, ask], [, put]] = fetch.mock.calls
      expect(ask.headers).toMatchObject({ Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json' })
      expect(put.headers).toEqual({ 'Content-Length': '3', 'x-amz-checksum-sha256': 'checksum-of-47ffa3ea' })
      expect(Array.from(put.body)).toEqual([0, 255, 1])
    })

    it('uploads a file attached twice once, and sends it twice', async () => {
      replies = [filesAnswer(uploadSlot(HELLO_SHA256, 5)), stored, accepted()]

      await sendFiles([
        { filename: 'hello.txt', content: Buffer.from('hello') },
        { filename: 'copy.txt', content: Buffer.from('hello') },
      ])

      expect(bodyOf(0)).toEqual({ files: [{ sha256: HELLO_SHA256, size: 5 }] })
      expect(requests().filter((request) => request.startsWith('PUT'))).toHaveLength(1)
      expect(bodyOf(2).attachments).toEqual([
        { sha256: HELLO_SHA256, filename: 'hello.txt' },
        { sha256: HELLO_SHA256, filename: 'copy.txt' },
      ])
    })

    it("sends nothing when the file storage refuses an upload, and returns the storage's answer", async () => {
      replies = [
        filesAnswer(present(HELLO_SHA256), uploadSlot(LOGO_SHA256, 3)),
        storageRefused(400, 'BadDigest', 'The SHA256 you specified did not match the calculated checksum.'),
      ]

      const { data, error } = await sendFiles([
        { filename: 'hello.txt', content: Buffer.from('hello') },
        { filename: 'logo.png', content: new Uint8Array([0, 255, 1]) },
      ])

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'attachment_upload_failed',
        name: 'application_error',
        statusCode: 400,
        field: 'attachments__1',
      })
      expect(error?.message).toBe(
        "PostHog's file storage refused the upload of attachments__1, so no email was sent. It answered HTTP 400 BadDigest: The SHA256 you specified did not match the calculated checksum."
      )
      expect(requests()).toHaveLength(2)
    })

    it('retries a file storage that fails on its side, then sends', async () => {
      replies = [
        filesAnswer(uploadSlot(HELLO_SHA256, 5)),
        storageRefused(500, 'InternalError', 'We encountered an internal error. Please try again.'),
        { status: 502 },
        stored,
        accepted(),
      ]

      const { data } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(data?.id).toBe('msg_1')
      expect(requests().filter((request) => request.startsWith('PUT'))).toHaveLength(3)
    })

    it('retries a file storage that throttles the upload, then sends', async () => {
      replies = [
        filesAnswer(uploadSlot(HELLO_SHA256, 5)),
        storageRefused(429, 'SlowDown', 'Please reduce your request rate.'),
        stored,
        accepted(),
      ]

      const { data } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(data?.id).toBe('msg_1')
      expect(requests().filter((request) => request.startsWith('PUT'))).toHaveLength(2)
    })

    it('sends nothing when the file storage keeps failing on its side', async () => {
      replies = [
        filesAnswer(uploadSlot(HELLO_SHA256, 5)),
        ...Array(3).fill(storageRefused(500, 'InternalError', 'Oops.')),
      ]

      const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toMatchObject({ code: 'attachment_upload_failed', name: 'service_unavailable', statusCode: 500 })
      expect(requests()).toHaveLength(4)
    })

    it('says an upload timed out, and which setting gives it longer', async () => {
      replies = [filesAnswer(uploadSlot(HELLO_SHA256, 5))]
      fetch.mockImplementationOnce(fetch.getMockImplementation()!).mockImplementation(() => new Promise(() => {}))

      const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toMatchObject({
        code: 'network_error',
        field: 'attachments__0',
        message: 'The upload of attachments__0 timed out after 15000ms, so no email was sent.',
        fix: 'Raise emailRequestTimeoutMs on the client, or send smaller files.',
      })
      expect(requests().filter((request) => request.startsWith('PUT'))).toHaveLength(3)
      expect(requests()).not.toContain(`POST ${SEND_URL}`)
    })

    it('names the attachment the upload route refuses, as the caller passed it', async () => {
      replies = [{ status: 400, body: { code: 'message_too_large', detail: 'Too large.', attr: 'files__1__size' } }]

      const { error } = await sendFiles([
        { filename: 'hello.txt', content: Buffer.from('hello') },
        { filename: 'copy.txt', content: Buffer.from('hello') },
        { filename: 'invoice.txt', content: Buffer.from('invoice') },
      ])

      expect(error).toMatchObject({ code: 'message_too_large', field: 'attachments__2' })
    })

    it("reports a project that can't send files yet as a refusal of attachments, and sends nothing", async () => {
      replies = [
        {
          status: 400,
          body: {
            type: 'invalid_request',
            code: 'field_not_accepted',
            detail: "This project can't send files yet, so PostHog didn't prepare the uploads.",
            attr: 'files',
            why: "Sending files isn't available to this project yet.",
            fix: 'Send the email without files, or try again once files are available to this project.',
          },
        },
      ]

      const { data, error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'field_not_accepted',
        name: 'validation_error',
        statusCode: 400,
        field: 'attachments',
        message: "This project can't send files yet, so PostHog didn't prepare the uploads.",
        fix: 'Send the email without files, or try again once files are available to this project.',
      })
      expect(requests()).toEqual([`POST ${UPLOADS_URL}`])
    })

    it('sends nothing when an upload never reaches the file storage', async () => {
      replies = [
        filesAnswer(uploadSlot(HELLO_SHA256, 5)),
        new Error('ECONNRESET'),
        new Error('ECONNRESET'),
        new Error('ECONNRESET'),
      ]

      const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toMatchObject({ code: 'network_error', field: 'attachments__0' })
      expect(requests()).toEqual([
        `POST ${UPLOADS_URL}`,
        ...Array(3).fill(`PUT ${STORAGE_URL}${HELLO_SHA256}?X-Amz-Signature=signed`),
      ])
    })

    it('uploads and sends the bytes of the call, through a busy file storage and a retried send with one key', async () => {
      replies = [
        filesAnswer(uploadSlot(INVOICE_SHA256, 7)),
        storageRefused(503, 'SlowDown', 'Please reduce your request rate.'),
        stored,
        rejected(503, 'delivery_unavailable'),
        accepted(),
      ]
      const file = Buffer.from('invoice')

      const pending = posthog.emails.send({ ...RECEIPT, attachments: [{ filename: 'invoice.txt', content: file }] })
      file.fill(0)

      expect((await settle(pending)).data?.id).toBe('msg_1')
      expect(bodyOf(0).files).toEqual([{ sha256: INVOICE_SHA256, size: 7 }])
      const puts = fetch.mock.calls.filter(([, options]) => options.method === 'PUT')
      expect(puts.map(([, options]) => Buffer.from(options.body).toString())).toEqual(['invoice', 'invoice'])
      const sends = fetch.mock.calls.filter(([url]) => url === SEND_URL)
      expect(sends).toHaveLength(2)
      expect(sends[1][1].body).toBe(sends[0][1].body)
      expect(new Set(sends.map(([, options]) => options.headers['Idempotency-Key'])).size).toBe(1)
    })

    it.each([
      [
        'a message too large',
        { status: 400, body: { code: 'message_too_large', attr: 'files__0__size' } },
        'message_too_large',
        1,
      ],
      [
        'a daily upload quota, without retrying',
        { status: 429, body: { code: 'upload_quota_exceeded' } },
        'upload_quota_exceeded',
        1,
      ],
      [
        'an unavailable file storage, after retrying',
        { status: 503, body: { code: 'delivery_unavailable' } },
        'delivery_unavailable',
        3,
      ],
    ])('uploads and sends nothing when PostHog refuses the uploads for %s', async (_name, refusal, code, asks) => {
      replies = Array(asks).fill(refusal)

      const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error?.code).toBe(code)
      expect(requests()).toEqual(Array(asks).fill(`POST ${UPLOADS_URL}`))
    })

    it.each([
      [
        "Django's answer",
        {
          status: 404,
          body: { type: 'invalid_request', code: 'not_found', detail: 'Endpoint not found.', attr: null },
        },
        'Endpoint not found.',
      ],
      ['a page that is not JSON', { status: 404, text: '<html>Not Found</html>' }, 'PostHog answered HTTP 404.'],
    ])(
      'reports not_found on attachments when the upload route answers 404 with %s, and sends nothing',
      async (_name, reply, message) => {
        replies = [reply]

        const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

        expect(error).toMatchObject({
          code: 'not_found',
          name: 'not_found',
          statusCode: 404,
          field: 'attachments',
          message,
        })
        expect(requests()).toEqual([`POST ${UPLOADS_URL}`])
      }
    )

    it('hashes bytes and decodes Base64 without Buffer, as on the edge runtime', async () => {
      replies = [filesAnswer(uploadSlot(LOGO_SHA256, 3), uploadSlot(INVITE_SHA256, 15)), stored, stored, accepted()]
      vi.stubGlobal('Buffer', undefined)
      try {
        await sendFiles([
          { filename: 'logo.png', content: new Uint8Array([0, 255, 1]) },
          { filename: 'invite.ics', content: 'QkVHSU46VkNBTEVOREFS' },
        ])
      } finally {
        vi.unstubAllGlobals()
      }

      expect(bodyOf(0).files).toEqual([
        { sha256: LOGO_SHA256, size: 3 },
        { sha256: INVITE_SHA256, size: 15 },
      ])
      expect(Buffer.from(fetch.mock.calls[2][1].body).toString()).toBe('BEGIN:VCALENDAR')
    })

    it.each([
      [
        'more than 10 files',
        Array.from({ length: 11 }, (_, index) => ({ filename: `${index}.txt`, content: Buffer.from('hello') })),
        {},
        { code: 'too_many_attachments', field: 'attachments' },
      ],
      [
        'files over 40 MB after Base64 encoding',
        [{ filename: 'scan.pdf', content: new Uint8Array(LARGEST_FILE_WITH_EMPTY_BODIES + 1) }],
        { html: '' },
        { code: 'message_too_large', field: 'attachments' },
      ],
      [
        'files that fit only without the html and text',
        [{ filename: 'scan.pdf', content: new Uint8Array(LARGEST_FILE_WITH_EMPTY_BODIES) }],
        { html: '<', text: '' },
        { code: 'message_too_large', field: 'attachments' },
      ],
      [
        'Base64 files over 40 MB after Base64 encoding',
        [{ filename: 'scan.pdf', content: `${'A'.repeat(38_910_500)}AA==` }],
        { html: '' },
        { code: 'message_too_large', field: 'attachments' },
      ],
      [
        'an empty file',
        [{ filename: 'empty.txt', content: new Uint8Array(0) }],
        {},
        { code: 'invalid_attachment', field: 'attachments__0__content' },
      ],
    ])('refuses %s before any request', async (_name, attachments, content, refusal) => {
      const { error } = await sendFiles(attachments, content)

      expect(error).toMatchObject({ ...refusal, name: 'validation_error' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      ['57 ASCII bytes, counted as 78', 'a'.repeat(57), 29_182_818, true],
      ['57 ASCII bytes, counted as 78', 'a'.repeat(57), 29_182_819, false],
      ['57 two-byte characters, counted as 156', 'é'.repeat(57), 29_182_761, true],
      ['57 two-byte characters, counted as 156', 'é'.repeat(57), 29_182_762, false],
    ])(
      'counts an html body of %s like a file, beside a file of %i bytes (fits: %s)',
      async (_name, html, size, fits) => {
        replies = [rejected(503, 'delivery_unavailable'), rejected(503), rejected(503)]

        const { error } = await sendFiles([{ filename: 'scan.pdf', content: new Uint8Array(size) }], { html })

        if (fits) {
          expect(bodyOf(0).files[0].size).toBe(size)
        } else {
          expect(error).toMatchObject({ code: 'message_too_large', field: 'attachments' })
          expect(fetch).not.toHaveBeenCalled()
        }
      }
    )

    it.each([
      ['bytes', new Uint8Array(LARGEST_FILE_WITH_EMPTY_BODIES)],
      ['Base64', 'A'.repeat(38_910_500)],
    ])('asks to upload the largest file that fits an email with empty bodies, as %s', async (_name, content) => {
      replies = [rejected(503, 'delivery_unavailable'), rejected(503), rejected(503)]

      await sendFiles([{ filename: 'scan.pdf', content }], { html: '' })

      expect(bodyOf(0).files[0].size).toBe(LARGEST_FILE_WITH_EMPTY_BODIES)
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
      ['cc on the template form', { templateId: TEMPLATE_ID, cc: 'finance@example.com' }, 'cc'],
      ['bcc on the template form', { templateId: TEMPLATE_ID, bcc: ['audit@example.com'] }, 'bcc'],
      [
        'attachments on the template form',
        { templateId: TEMPLATE_ID, attachments: [{ filename: 'a.txt', content: 'YQ==' }] },
        'attachments',
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
      ['attachments that are not a list', { filename: 'a.txt', content: 'YQ==' }, 'attachments'],
      ['a hole in a sparse list of attachments', new Array(1), 'attachments__0'],
      ['an attachment without content', [{ filename: 'a.txt' }], 'attachments__0__content'],
      ["a file's bytes in place of an attachment", [Buffer.from('%PDF')], 'attachments__0'],
      ['a Base64 string in place of an attachment', ['JVBERi0='], 'attachments__0'],
      ['an attachment whose content is a number', [{ filename: 'a.txt', content: 42 }], 'attachments__0__content'],
      [
        'an attachment whose content is text, not Base64',
        [{ filename: 'a.txt', content: 'hello world' }],
        'attachments__0__content',
      ],
      [
        'an attachment whose Base64 lacks its padding',
        [{ filename: 'a.txt', content: 'YQ' }],
        'attachments__0__content',
      ],
      ['an attachment without a filename', [{ content: 'YQ==' }], 'attachments__0__filename'],
      ['an attachment with an empty filename', [{ filename: '', content: 'YQ==' }], 'attachments__0__filename'],
      [
        'an attachment whose contentType is not a string',
        [{ filename: 'a.txt', content: 'YQ==', contentType: {} }],
        'attachments__0__contentType',
      ],
      [
        'an attachment whose contentId is not a string',
        [{ filename: 'logo.png', content: 'AA==', contentId: 7 }],
        'attachments__0__contentId',
      ],
      [
        'an attachment with a key it does not take',
        [{ filename: 'logo.png', content: 'AA==', content_id: 'logo' }],
        'attachments__0__content_id',
      ],
      [
        "a Resend attachment path, which PostHog can't fetch",
        [
          { filename: 'terms.txt', content: 'dGVybXM=' },
          { filename: 'a.pdf', path: 'https://example.com/a.pdf' },
        ],
        'attachments__1__path',
      ],
    ])('refuses %s before sending', async (_name, attachments, field) => {
      const { error } = await sendForm({ ...CODE_SEND, attachments })

      expect(error).toMatchObject({ code: 'invalid_attachment', name: 'validation_error', field })
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
