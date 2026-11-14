import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createElement, type ReactElement, Suspense, use } from 'react'

import { EmailError, PostHog, PostHogOptions, SendEmailOptions } from '@/entrypoints/index.node'

import { FakePostHog, type FakePostHogOptions, type ServerChange } from './utils/emails-fake'

vi.mock('../version', () => ({ version: '1.2.3' }))

const SECRET_KEY = 'phs_test_secret'
const TEMPLATE_ID = '0190f6d2-7c1e-7b3a-9f5e-1c2d3e4f5a6b'
const SEND_URL = 'https://us.posthog.com/api/projects/@current/messaging/send/email/'
const MESSAGE_ID = '01a18356-c56c-0001-e494-7666bc915188'
const STATUS_URL = `https://us.posthog.com/api/projects/@current/messaging/emails/${MESSAGE_ID}/`
const PREFERENCES_URL = 'https://us.posthog.com/api/projects/@current/messaging/preferences/'
const CANCEL_URL = `${STATUS_URL}cancel/`
const LIST_URL = 'https://us.posthog.com/api/projects/@current/messaging/emails/'
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

const RECEIPT = { to: 'user@example.com', templateKey: 'receipt', subject: 'Your receipt', html: '<p>Thanks</p>' }
const COPIES = { cc: 'finance@example.com', bcc: ['audit@example.com', 'archive@example.com'] }
const LARGEST_FILE_WITH_EMPTY_BODIES = 29_182_821
const EMPTY_EMAIL_ESTIMATE = 64 * 1024

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

const SEND_FIELDS = new Set([
  'template_id',
  'message_data',
  'template_key',
  'subject',
  'html',
  'text',
  'from',
  'reply_to',
  'capture_engagement',
  'distinct_id',
  'scheduled_at',
  'to',
])

const fakeReply = (status: number, body: unknown) => ({
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
  headers: { get: () => null },
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

  const againstPostHog = (options: Omit<FakePostHogOptions, 'secretKey'> = {}): FakePostHog => {
    const fake = new FakePostHog({ secretKey: SECRET_KEY, ...options })
    makeClient({ fetch: fake.fetch })
    return fake
  }

  const settle = async <T>(pending: Promise<T>): Promise<T> => {
    let done = false
    void pending.finally(() => (done = true))
    while (!done) {
      await vi.advanceTimersByTimeAsync(1000)
    }
    return pending
  }

  const deliverToInbox = (): Record<string, unknown>[] => {
    const inbox: Record<string, unknown>[] = []
    fetch.mockImplementation(async (url: string, options: { method: string; body?: string }) => {
      if (url !== SEND_URL || options.method !== 'POST') {
        return fakeReply(404, { type: 'invalid_request', code: 'not_found', detail: 'Not found.', attr: null })
      }
      const email: Record<string, unknown> = JSON.parse(options.body ?? '{}')
      const unknownField = Object.keys(email).find((field) => !SEND_FIELDS.has(field))
      if (unknownField !== undefined) {
        return fakeReply(400, {
          type: 'validation_error',
          code: 'invalid_input',
          detail: 'Unknown field.',
          attr: unknownField,
        })
      }
      inbox.push(email)
      return fakeReply(202, { message_id: 'msg_1', replayed: false })
    })
    return inbox
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
    expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [], status: 'queued', scheduledAt: null })
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
    const fake = againstPostHog()
    const templateData = { name: 'Ada' }
    const cc = ['finance@example.com']

    const templateSend = send({ templateData })
    const codeSend = posthog.emails.send({ ...RECEIPT, cc })
    templateData.name = 'Changed'
    cc.push('changed@example.com')
    await Promise.all([templateSend, codeSend])

    expect(fake.emails).toEqual([
      expect.objectContaining({ templateId: TEMPLATE_ID, messageData: { name: 'Ada' } }),
      expect.objectContaining({ subject: 'Your receipt', cc: ['finance@example.com'] }),
    ])
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

  it('sends the template data each send was called with', async () => {
    const inbox = deliverToInbox()
    const templateData = { name: 'Ada' }

    const toAda = send({ templateData })
    templateData.name = 'Bob'
    await Promise.all([toAda, send({ to: 'bob@example.com', templateData })])

    expect(inbox.map((email) => email.message_data)).toEqual([{ name: 'Ada' }, { name: 'Bob' }])
  })

  it.each([
    [
      'html',
      { templateKey: 'password-reset', subject: 'Reset your password', html: '<p>Reset</p>' },
      {
        template_key: 'password-reset',
        subject: 'Reset your password',
        html: '<p>Reset</p>',
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
      },
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

  it('queues a code send with its copies', async () => {
    const fake = againstPostHog()

    const { data, error } = await posthog.emails.send({ ...RECEIPT, ...COPIES })

    expect(error).toBeNull()
    expect(fake.emails).toEqual([
      expect.objectContaining({
        id: data?.id,
        to: 'user@example.com',
        cc: ['finance@example.com'],
        bcc: ['audit@example.com', 'archive@example.com'],
        attachments: [],
      }),
    ])
  })

  it('leaves out empty copies and attachments, so a PostHog that takes none of them still sends', async () => {
    const fake = againstPostHog({ fieldsNotTaken: ['cc', 'bcc', 'attachments'] })

    const { data, error } = await posthog.emails.send({ ...RECEIPT, cc: [], bcc: [], attachments: [] })

    expect(error).toBeNull()
    expect(fake.emails).toEqual([expect.objectContaining({ id: data?.id, cc: [], bcc: [], attachments: [] })])
  })

  it.each(['cc', 'bcc'])(
    "reports a PostHog that doesn't take %s yet as its own refusal, without retrying",
    async (field) => {
      const fake = againstPostHog({ fieldsNotTaken: [field] })
      fake.recoverAfter('send', 1, { fieldsNotTaken: [] })

      const { data, error } = await settle(posthog.emails.send({ ...RECEIPT, ...COPIES }))

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'field_not_accepted',
        name: 'validation_error',
        statusCode: 400,
        field,
        message: "PostHog doesn't take this field yet, so it didn't send the email.",
        why: "This PostHog version doesn't take the field yet, so it refused the email instead of sending it without it.",
        fix: 'Send the email without this field, or send it again once PostHog takes the field.',
      })
      expect(fake.emails).toEqual([])
    }
  )

  describe('attachments', () => {
    const LOGO = [0, 255, 1]

    const sendFiles = (
      attachments: unknown,
      content: Record<string, unknown> = {}
    ): ReturnType<PostHog['emails']['send']> =>
      settle(posthog.emails.send({ ...RECEIPT, ...content, attachments } as SendEmailOptions))

    const expectNothingSent = (fake: FakePostHog): void => {
      expect(fake.emails).toEqual([])
      expect(fake.writes).toEqual([])
    }

    it('sends every file, and stores only the files PostHog does not have yet', async () => {
      const fake = againstPostHog()
      fake.holdAlready(utf8('hello'))

      const { data, error } = await sendFiles([
        { filename: 'receipt.txt', content: Buffer.from('hello') },
        { filename: 'logo.png', content: new Uint8Array(LOGO), contentType: 'image/png', contentId: 'logo' },
        { filename: 'invite.ics', content: 'QkVHSU46VkNBTEVOREFS', contentType: 'text/calendar' },
      ])

      expect(error).toBeNull()
      expect(fake.emails).toEqual([
        {
          id: data?.id,
          to: 'user@example.com',
          cc: [],
          bcc: [],
          replyTo: [],
          subject: 'Your receipt',
          html: '<p>Thanks</p>',
          captureEngagement: true,
          attachments: [
            { filename: 'receipt.txt', bytes: utf8('hello') },
            { filename: 'logo.png', contentType: 'image/png', contentId: 'logo', bytes: new Uint8Array(LOGO) },
            { filename: 'invite.ics', contentType: 'text/calendar', bytes: utf8('BEGIN:VCALENDAR') },
          ],
        },
      ])
      expect(fake.writes).toEqual([new Uint8Array(LOGO), utf8('BEGIN:VCALENDAR')])
    })

    it('asks where to upload with the secret key, and stores the bytes without it', async () => {
      const fake = againstPostHog()

      const { error } = await sendFiles([{ filename: 'logo.png', content: new Uint8Array(LOGO) }])

      expect(error).toBeNull()
      expect(fake.writes).toEqual([new Uint8Array(LOGO)])
    })

    it('sends a calendar invite with its file and without open tracking', async () => {
      const fake = againstPostHog()

      const { data, error } = await sendFiles(
        [{ filename: 'invite.ics', content: 'QkVHSU46VkNBTEVOREFS', contentType: 'text/calendar' }],
        { tracking: { opens: false }, sensitive: false }
      )

      expect(error).toBeNull()
      expect(fake.emails).toEqual([
        expect.objectContaining({
          id: data?.id,
          tracking: { opens: false },
          sensitive: false,
          attachments: [{ filename: 'invite.ics', contentType: 'text/calendar', bytes: utf8('BEGIN:VCALENDAR') }],
        }),
      ])
    })

    it('stores a file attached twice once, and sends it twice', async () => {
      const fake = againstPostHog()

      await sendFiles([
        { filename: 'hello.txt', content: Buffer.from('hello') },
        { filename: 'copy.txt', content: Buffer.from('hello') },
      ])

      expect(fake.writes.map(textOf)).toEqual(['hello'])
      expect(fake.emails.map(({ attachments }) => attachments)).toEqual([
        [
          { filename: 'hello.txt', bytes: utf8('hello') },
          { filename: 'copy.txt', bytes: utf8('hello') },
        ],
      ])
    })

    it("sends nothing when the file storage refuses an expired upload, and returns the storage's answer", async () => {
      const fake = againstPostHog({ uploadUrlTtlMs: 0 })
      fake.holdAlready(utf8('hello'))

      const { data, error } = await sendFiles([
        { filename: 'hello.txt', content: Buffer.from('hello') },
        { filename: 'logo.png', content: new Uint8Array(LOGO) },
      ])

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'attachment_upload_failed',
        name: 'application_error',
        statusCode: 403,
        field: 'attachments__1',
        message:
          "PostHog's file storage refused the upload of attachments__1, so no email was sent. It answered HTTP 403 AccessDenied: Request has expired.",
      })
      expectNothingSent(fake)
    })

    it('sends nothing when the file storage refuses an upload once, without retrying', async () => {
      const fake = againstPostHog()
      fake.failNext('storage', { status: 403, code: 'AccessDenied', message: 'Access Denied' })

      const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toMatchObject({ code: 'attachment_upload_failed', name: 'application_error', statusCode: 403 })
      expectNothingSent(fake)
    })

    it.each([
      [
        'fails on its side',
        [
          { status: 500, code: 'InternalError', message: 'We encountered an internal error. Please try again.' },
          { status: 502 },
        ],
      ],
      ['throttles the upload', [{ status: 429, code: 'SlowDown', message: 'Please reduce your request rate.' }]],
      ['answers too late twice', ['hang', 'hang']],
      ['drops the connection twice', ['network error', 'network error']],
    ])('retries a file storage that %s, then sends', async (_name, faults) => {
      const fake = againstPostHog()
      fake.failNext('storage', ...faults)

      const { data, error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toBeNull()
      expect(fake.emails).toEqual([
        expect.objectContaining({ id: data?.id, attachments: [{ filename: 'hello.txt', bytes: utf8('hello') }] }),
      ])
      expect(fake.writes.map(textOf)).toEqual(['hello'])
    })

    it('sends nothing when the file storage keeps failing on its side', async () => {
      const fake = againstPostHog()
      fake.failNext('storage', ...Array(3).fill({ status: 500, code: 'InternalError', message: 'Oops.' }))

      const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toMatchObject({ code: 'attachment_upload_failed', name: 'service_unavailable', statusCode: 500 })
      expectNothingSent(fake)
    })

    it('says an upload timed out, and which setting gives it longer', async () => {
      const fake = againstPostHog()
      fake.failNext('storage', 'hang', 'hang', 'hang')

      const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toMatchObject({
        code: 'network_error',
        field: 'attachments__0',
        message: 'The upload of attachments__0 timed out after 15000ms, so no email was sent.',
        fix: 'Raise emailRequestTimeoutMs on the client, or send smaller files.',
      })
      expectNothingSent(fake)
    })

    it('sends nothing when an upload never reaches the file storage', async () => {
      const fake = againstPostHog()
      fake.failNext('storage', 'network error', 'network error', 'network error')

      const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toMatchObject({ code: 'network_error', name: 'service_unavailable', field: 'attachments__0' })
      expectNothingSent(fake)
    })

    it('names the attachment the upload route refuses, as the caller passed it', async () => {
      const fake = againstPostHog({ messageLimitBytes: EMPTY_EMAIL_ESTIMATE + 10 })

      const { error } = await sendFiles([
        { filename: 'hello.txt', content: Buffer.from('hello') },
        { filename: 'copy.txt', content: Buffer.from('hello') },
        { filename: 'invoice.txt', content: Buffer.from('invoice') },
      ])

      expect(error).toMatchObject({
        code: 'message_too_large',
        name: 'validation_error',
        statusCode: 400,
        field: 'attachments__2',
      })
      expectNothingSent(fake)
    })

    it("reports a project that can't send files yet as a refusal of attachments, and sends nothing", async () => {
      const fake = againstPostHog({ filesAllowed: false })
      fake.recoverAfter('uploads', 1, { filesAllowed: true })

      const { data, error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'field_not_accepted',
        name: 'validation_error',
        statusCode: 400,
        field: 'attachments',
        message: "This project can't send files yet, so PostHog didn't prepare the uploads.",
        why: "Sending files isn't available to this project yet.",
        fix: 'Send the email without files, or try again once files are available to this project.',
      })
      expectNothingSent(fake)
    })

    it('sends the bytes of the call, through a busy file storage and a send whose answer was lost', async () => {
      const fake = againstPostHog()
      fake.failNext('storage', { status: 503, code: 'SlowDown', message: 'Please reduce your request rate.' })
      fake.failNext('send', 'lost reply')
      const file = Buffer.from('invoice')

      const pending = posthog.emails.send({ ...RECEIPT, attachments: [{ filename: 'invoice.txt', content: file }] })
      file.fill(0)
      const { data, error } = await settle(pending)

      expect(error).toBeNull()
      expect(data?.replayed).toBe(true)
      expect(fake.emails).toEqual([
        expect.objectContaining({ id: data?.id, attachments: [{ filename: 'invoice.txt', bytes: utf8('invoice') }] }),
      ])
      expect(fake.writes.map(textOf)).toEqual(['invoice'])
    })

    it.each([
      [
        'a message too large, without retrying',
        { messageLimitBytes: EMPTY_EMAIL_ESTIMATE },
        1,
        { messageLimitBytes: Number.MAX_SAFE_INTEGER },
        { code: 'message_too_large', name: 'validation_error', field: 'attachments__0' },
      ],
      [
        'a daily upload quota, without retrying',
        { uploadQuotaBytes: 4 },
        1,
        { uploadQuotaBytes: Number.MAX_SAFE_INTEGER },
        { code: 'upload_quota_exceeded', name: 'rate_limit_exceeded', field: undefined },
      ],
      [
        'an unavailable file storage, after retrying',
        { storageAvailable: false },
        3,
        { storageAvailable: true },
        { code: 'delivery_unavailable', name: 'service_unavailable', field: undefined },
      ],
    ])(
      'sends nothing when PostHog refuses the uploads for %s',
      async (_name, options, refusals, change: ServerChange, refusal) => {
        const fake = againstPostHog(options)
        fake.recoverAfter('uploads', refusals, change)

        const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

        expect(error).toMatchObject(refusal)
        expectNothingSent(fake)
      }
    )

    it('sends once the file storage is back within the retries', async () => {
      const fake = againstPostHog({ storageAvailable: false })
      fake.recoverAfter('uploads', 2, { storageAvailable: true })

      const { data, error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toBeNull()
      expect(fake.emails).toEqual([
        expect.objectContaining({ id: data?.id, attachments: [{ filename: 'hello.txt', bytes: utf8('hello') }] }),
      ])
    })

    it.each([
      ["Django's answer", (fake: FakePostHog) => fake, 'Endpoint not found.'],
      [
        'a page that is not JSON',
        (fake: FakePostHog) => fake.failNext('uploads', { status: 404, page: '<html>Not Found</html>' }),
        'PostHog answered HTTP 404.',
      ],
    ])(
      'reports not_found on attachments when the upload route answers 404 with %s, and sends nothing',
      async (_name, arrange, message) => {
        const fake = againstPostHog({ uploadRoute: false })
        arrange(fake)

        const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

        expect(error).toMatchObject({
          code: 'not_found',
          name: 'not_found',
          statusCode: 404,
          field: 'attachments',
          message,
        })
        expectNothingSent(fake)
      }
    )

    it('hashes bytes and decodes Base64 without Buffer, as on the edge runtime', async () => {
      const fake = againstPostHog()
      vi.stubGlobal('Buffer', undefined)
      let result: Awaited<ReturnType<PostHog['emails']['send']>>
      try {
        result = await sendFiles([
          { filename: 'logo.png', content: new Uint8Array(LOGO) },
          { filename: 'invite.ics', content: 'QkVHSU46VkNBTEVOREFS' },
        ])
      } finally {
        vi.unstubAllGlobals()
      }

      expect(result.error).toBeNull()
      expect(fake.emails.map(({ attachments }) => attachments)).toEqual([
        [
          { filename: 'logo.png', bytes: new Uint8Array(LOGO) },
          { filename: 'invite.ics', bytes: utf8('BEGIN:VCALENDAR') },
        ],
      ])
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
        [{ filename: 'scan.pdf', content: `${'A'.repeat(38_910_428)}AA==` }],
        { html: '' },
        { code: 'message_too_large', field: 'attachments' },
      ],
      [
        'an empty file',
        [{ filename: 'empty.txt', content: new Uint8Array(0) }],
        {},
        { code: 'invalid_attachment', field: 'attachments__0__content' },
      ],
    ])('refuses %s before anything is stored or sent', async (_name, attachments, content, refusal) => {
      const fake = againstPostHog()

      const { error } = await sendFiles(attachments, content)

      expect(error).toMatchObject({ ...refusal, name: 'validation_error', statusCode: undefined })
      expectNothingSent(fake)
    })

    it.each([
      ['57 ASCII bytes, counted as 78', 29_182_707, true, 'a'.repeat(57)],
      ['57 ASCII bytes, counted as 78', 29_182_708, false, 'a'.repeat(57)],
      ['57 two-byte characters, counted as 156', 29_182_593, true, 'é'.repeat(57)],
      ['57 two-byte characters, counted as 156', 29_182_594, false, 'é'.repeat(57)],
    ])(
      'counts an html body of %s like a file, and again for the text PostHog derives from it, beside a file of %i bytes (fits: %s)',
      async (_name, size, fits, html) => {
        const fake = againstPostHog()

        const { error } = await posthog.emails.send({
          ...RECEIPT,
          html,
          attachments: [{ filename: 'scan.pdf', content: new Uint8Array(size) }],
        })

        if (fits) {
          expect(error).toBeNull()
          expect(fake.emails.map(({ attachments }) => attachments[0].bytes.byteLength)).toEqual([size])
        } else {
          expect(error).toMatchObject({ code: 'message_too_large', field: 'attachments' })
          expectNothingSent(fake)
        }
      }
    )

    it.each([
      ['refuses it locally without a text body, since PostHog derives one from the html', {}, false],
      ['sends it beside a text body', { text: 'Thanks' }, true],
    ])('counts an html body that fits once but not twice: %s', async (_name, content, sent) => {
      const fake = againstPostHog()

      const { error } = await posthog.emails.send({
        ...RECEIPT,
        html: 'a'.repeat(5_700),
        ...content,
        attachments: [{ filename: 'scan.pdf', content: new Uint8Array(29_177_115) }],
      })

      if (sent) {
        expect(error).toBeNull()
        expect(fake.emails.map(({ attachments }) => attachments[0].bytes.byteLength)).toEqual([29_177_115])
      } else {
        expect(error).toMatchObject({ code: 'message_too_large', field: 'attachments', statusCode: undefined })
        expectNothingSent(fake)
      }
    })

    it("refuses an upload URL that isn't https before any upload, and keeps the URL out of the error", async () => {
      const fake = againstPostHog({ storageOrigin: 'http://email-files.s3.example.com' })
      fake.holdAlready(utf8('hello'))

      const { data, error } = await sendFiles([
        { filename: 'hello.txt', content: Buffer.from('hello') },
        { filename: 'logo.png', content: new Uint8Array(LOGO) },
      ])

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'api_error',
        field: 'attachments__1',
        message:
          "PostHog named an upload URL for attachments__1 that isn't https, so the file would travel unencrypted. No email was sent.",
        fix: "Make your PostHog's file storage URL use https. For local development over plain HTTP, set appHost to your http app host.",
      })
      expectNothingSent(fake)
    })

    it("refuses an upload that file storage redirects, so the file goes nowhere PostHog didn't sign", async () => {
      const fake = againstPostHog({ storageRedirectOrigin: 'http://email-files.example.com' })

      const { data, error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'attachment_upload_failed',
        field: 'attachments__0',
        statusCode: 307,
        message:
          "PostHog's file storage redirected the upload of attachments__0 elsewhere. The SDK uploads only to the URL PostHog signed, so no email was sent.",
        fix: "Make your PostHog's file storage URL point straight at the storage, over https.",
      })
      expect(fake.writes).toEqual([])
      expectNothingSent(fake)
    })

    it('uploads over plain HTTP when the client sends to a plain-HTTP app host for local development', async () => {
      const fake = new FakePostHog({
        secretKey: SECRET_KEY,
        appHost: 'http://localhost:8010',
        storageOrigin: 'http://localhost:19000',
      })
      makeClient({ appHost: 'http://localhost:8010', fetch: fake.fetch })

      const { data, error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }])

      expect(error).toBeNull()
      expect(fake.emails).toEqual([
        expect.objectContaining({ id: data?.id, attachments: [{ filename: 'hello.txt', bytes: utf8('hello') }] }),
      ])
    })

    it.each([
      ['42 ASCII bytes, counted as 75', 'x'.repeat(42), 29_182_821],
      ['43 ASCII bytes, counted as 150', 'x'.repeat(43), 29_182_767],
      ['21 two-byte characters, counted as 75', 'é'.repeat(21), 29_182_821],
      ['22 two-byte characters, counted as 150', 'é'.repeat(22), 29_182_767],
      ['420 ASCII bytes, counted as 750', 'x'.repeat(420), 29_182_329],
    ])(
      'counts a subject of %s, so the largest file that fits beside it is sent and one byte more is refused',
      async (_name, subject, largest) => {
        const fake = againstPostHog()
        const withFile = (size: number): SendEmailOptions => ({
          ...RECEIPT,
          subject,
          html: '',
          attachments: [{ filename: 'scan.pdf', content: new Uint8Array(size) }],
        })

        const over = await posthog.emails.send(withFile(largest + 1))
        const fits = await posthog.emails.send(withFile(largest))

        expect(over.error).toMatchObject({ code: 'message_too_large', field: 'attachments', statusCode: undefined })
        expect(fits.error).toBeNull()
        expect(fake.emails.map(({ attachments }) => attachments[0].bytes.byteLength)).toEqual([largest])
      }
    )

    it('counts an empty subject as nothing, so only PostHog refuses it', async () => {
      const fake = againstPostHog()
      const withFile = (size: number): SendEmailOptions => ({
        ...RECEIPT,
        subject: '',
        html: '',
        attachments: [{ filename: 'scan.pdf', content: new Uint8Array(size) }],
      })

      const over = await posthog.emails.send(withFile(29_182_876))
      const fits = await posthog.emails.send(withFile(29_182_875))

      expect(over.error).toMatchObject({ code: 'message_too_large', field: 'attachments', statusCode: undefined })
      expect(fits.error).toMatchObject({ field: 'subject', statusCode: 400 })
      expect(fake.emails).toEqual([])
    })

    it.each([
      ['bytes', new Uint8Array(LARGEST_FILE_WITH_EMPTY_BODIES)],
      ['Base64', 'A'.repeat(38_910_428)],
    ])('sends the largest file that fits an email with empty bodies, as %s', async (_name, content) => {
      const fake = againstPostHog()

      const { error } = await posthog.emails.send({
        ...RECEIPT,
        html: '',
        attachments: [{ filename: 'scan.pdf', content }],
      })

      expect(error).toBeNull()
      expect(fake.emails.map(({ attachments }) => attachments[0].bytes.byteLength)).toEqual([
        LARGEST_FILE_WITH_EMPTY_BODIES,
      ])
    })

    it('sends the files with the html a react element renders into', async () => {
      const fake = againstPostHog()

      const { error } = await sendFiles([{ filename: 'hello.txt', content: Buffer.from('hello') }], {
        html: undefined,
        react: createElement('p', null, 'Welcome, Ada'),
      })

      expect(error).toBeNull()
      expect(fake.emails).toEqual([
        expect.objectContaining({
          html: expect.stringContaining('<p>Welcome, Ada</p>'),
          text: 'Welcome, Ada',
          attachments: [{ filename: 'hello.txt', bytes: utf8('hello') }],
        }),
      ])
    })

    it('counts the html a react element renders into, and sends no request when the files no longer fit', async () => {
      const fake = new FakePostHog({ secretKey: SECRET_KEY })
      const requests: string[] = []
      makeClient({
        fetch: (url: string, options: Parameters<FakePostHog['fetch']>[1]) => {
          requests.push(url)
          return fake.fetch(url, options)
        },
      })

      const { data, error } = await sendFiles(
        [{ filename: 'scan.pdf', content: new Uint8Array(LARGEST_FILE_WITH_EMPTY_BODIES) }],
        {
          html: undefined,
          react: createElement('p', null, 'Welcome, Ada'),
        }
      )

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'message_too_large', name: 'validation_error', field: 'attachments' })
      expect(requests).toEqual([])
    })
  })

  describe('content from a React Email element', () => {
    const WelcomeMail = ({ firstName }: { firstName: string }): ReactElement =>
      createElement('html', null, createElement('body', null, createElement('p', null, `Welcome, ${firstName}`)))
    const welcome = createElement(WelcomeMail, { firstName: 'Ada' })

    const sendReact = (content: Record<string, unknown>): ReturnType<PostHog['emails']['send']> =>
      posthog.emails.send({
        to: 'user@example.com',
        templateKey: 'welcome',
        subject: 'Welcome',
        ...content,
      } as SendEmailOptions)

    let inbox: Record<string, unknown>[]

    beforeEach(() => {
      inbox = deliverToInbox()
    })

    afterEach(() => {
      vi.doUnmock('@react-email/render')
    })

    const withoutRenderer = (): void => {
      vi.doMock('@react-email/render', () => {
        throw new Error("Cannot find package '@react-email/render'")
      })
    }

    it('renders the element into html and text', async () => {
      const { error } = await sendReact({ react: welcome })

      expect(error).toBeNull()
      expect(inbox).toEqual([
        {
          template_key: 'welcome',
          subject: 'Welcome',
          html: expect.stringContaining('<p>Welcome, Ada</p>'),
          text: 'Welcome, Ada',
          to: 'user@example.com',
        },
      ])
    })

    it('renders content that waits inside nested Suspense boundaries', async () => {
      let startLoading = (): void => {}
      const firstName = new Promise<string>((resolve) => {
        startLoading = () => setTimeout(() => resolve('Ada'), 10)
      })
      const Greeting = (): ReactElement => {
        startLoading()
        return createElement('p', null, `Welcome, ${use(firstName)}`)
      }
      const fallback = createElement('p', null, 'Loading')
      const Mail = (): ReactElement =>
        createElement(
          'html',
          null,
          createElement(
            'body',
            null,
            createElement(Suspense, { fallback }, createElement(Suspense, { fallback }, createElement(Greeting)))
          )
        )

      let settled = false
      const pending = sendReact({ react: createElement(Mail) }).finally(() => {
        settled = true
      })
      while (!settled) {
        await vi.advanceTimersByTimeAsync(5)
      }
      await pending

      expect(inbox).toEqual([expect.objectContaining({ text: 'Welcome, Ada' })])
      expect(inbox[0].html).toEqual(expect.stringContaining('<p>Welcome, Ada</p>'))
      expect(inbox[0].html).not.toMatch(/Loading|<script|<template/)
    })

    it('keeps the text the caller wrote', async () => {
      await sendReact({ react: welcome, text: 'Hi Ada' })

      expect(inbox).toEqual([
        expect.objectContaining({ html: expect.stringContaining('<p>Welcome, Ada</p>'), text: 'Hi Ada' }),
      ])
    })

    it('sends the other fields as they were when send was called, while the element renders', async () => {
      const replyTo = ['support@example.com']

      const pending = sendReact({ react: welcome, replyTo })
      replyTo.push('someone-else@example.com')
      await pending

      expect(inbox).toEqual([expect.objectContaining({ reply_to: ['support@example.com'] })])
    })

    it.each([
      ['html beside react', { react: welcome, html: '<p>Hi</p>' }, 'html'],
      ['react that is not an element', { react: '<p>Hi</p>' }, 'react'],
      ['react shaped like an element', { react: { type: 'p', props: { children: 'Hi' } } }, 'react'],
      [
        'react on the template form',
        { templateKey: undefined, subject: undefined, templateId: TEMPLATE_ID, react: welcome },
        'react',
      ],
    ])('refuses %s before rendering or sending', async (_name, content, field) => {
      const { data, error } = await sendReact(content)

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_form', name: 'validation_error', field })
      expect(inbox).toEqual([])
    })

    it('explains how to send html or react, not both', async () => {
      const { error } = await sendReact({ react: welcome, html: '<p>Hi</p>' })

      expect({ message: error?.message, fix: error?.fix }).toEqual({
        message: 'A send with react renders its own html, so it takes no html. No email was sent.',
        fix: 'Remove html to send the rendered react element, or remove react to send your html.',
      })
    })

    it('asks to install @react-email/render when it does not load, and sends nothing', async () => {
      withoutRenderer()

      const { data, error } = await sendReact({ react: welcome })

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'missing_react_renderer',
        message:
          "react needs the @react-email/render package, which isn't installed or failed to load, so no email was sent.",
        fix: 'Install @react-email/render with react and react-dom next to posthog-node, or render the email yourself and send html.',
        cause: expect.any(Error),
      })
      expect(inbox).toEqual([])
    })

    it('sends html without loading @react-email/render', async () => {
      withoutRenderer()
      const { error } = await sendReact({ html: '<p>Hi</p>' })

      expect(error).toBeNull()
      expect(inbox).toEqual([expect.objectContaining({ html: '<p>Hi</p>' })])
    })

    it('reports a disabled client before it loads @react-email/render', async () => {
      withoutRenderer()
      makeClient({ disabled: true })

      const { error } = await sendReact({ react: welcome })

      expect(error?.code).toBe('client_disabled')
    })

    it('reports an element that fails to render, and sends nothing', async () => {
      const Broken = (): ReactElement => {
        throw new Error('firstName is missing')
      }

      const { data, error } = await sendReact({ react: createElement(Broken) })

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'react_render_failed',
        message: 'Rendering the react element failed, so no email was sent.',
        cause: expect.objectContaining({ message: 'firstName is missing' }),
      })
      expect(inbox).toEqual([])
    })

    it('gives up on an element that never finishes rendering, after the request timeout', async () => {
      makeClient({ emailRequestTimeoutMs: 1000 })
      const Waits = (): ReactElement => use(new Promise<ReactElement>(() => {}))

      let settled = false
      const pending = sendReact({ react: createElement(Waits) }).finally(() => {
        settled = true
      })
      while (!settled) {
        await vi.advanceTimersByTimeAsync(100)
      }
      const { data, error } = await pending

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'react_render_failed',
        cause: expect.objectContaining({ message: 'Rendering the react element took longer than 1000ms.' }),
      })
      expect(inbox).toEqual([])
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
      status: 'queued',
      scheduledAt: null,
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
      ["Resend's tags on the template form", { templateId: TEMPLATE_ID, tags: [{ name: 'a', value: 'b' }] }, 'tags'],
      ["Resend's tags on a code send", { ...CODE_SEND, tags: [{ name: 'a', value: 'b' }] }, 'tags'],
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
    ])('refuses %s before anything is stored or sent', async (_name, attachments, field) => {
      const fake = againstPostHog()

      const { error } = await sendForm({ ...CODE_SEND, attachments })

      expect(error).toMatchObject({ code: 'invalid_attachment', name: 'validation_error', field })
      expect(fake.emails).toEqual([])
      expect(fake.writes).toEqual([])
    })

    it.each([
      ['cc on the template form', { cc: 'finance@example.com' }, 'cc'],
      ['bcc on the template form', { bcc: ['audit@example.com'] }, 'bcc'],
      ['attachments on the template form', { attachments: [{ filename: 'a.txt', content: 'YQ==' }] }, 'attachments'],
    ])('refuses %s before anything is stored or sent', async (_name, fields, field) => {
      const fake = againstPostHog()

      const { error } = await sendForm({ templateId: TEMPLATE_ID, ...fields })

      expect(error).toMatchObject({ code: 'invalid_form', name: 'validation_error', field })
      expect(fake.emails).toEqual([])
      expect(fake.writes).toEqual([])
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
      ['a field no form takes', { ...CODE_SEND, tags: [] }, undefined, 'Remove tags and send again.'],
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

  describe('scheduled sends', () => {
    const scheduled = (fields: Record<string, unknown> = {}): Reply =>
      accepted({ status: 'scheduled', scheduled_at: '2026-12-01T09:00:00Z', ...fields })

    it.each([
      ['a Date as UTC', new Date('2026-12-01T10:00:00+01:00'), '2026-12-01T09:00:00.000Z'],
      ['a string with Z as given', '2026-12-01T09:00:00Z', '2026-12-01T09:00:00Z'],
      ['a string with an offset as given', '2026-12-01T10:00:00.250+01:00', '2026-12-01T10:00:00.250+01:00'],
    ])('schedules a template send with %s', async (_name, scheduledAt, sent) => {
      replies = [scheduled()]

      const { data, error } = await send({ scheduledAt })

      expect(error).toBeNull()
      expect(data).toEqual({
        id: 'msg_1',
        replayed: false,
        warnings: [],
        status: 'scheduled',
        scheduledAt: '2026-12-01T09:00:00Z',
      })
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
        template_id: TEMPLATE_ID,
        message_data: {},
        to: 'user@example.com',
        scheduled_at: sent,
      })
    })

    it('schedules a send of content from code', async () => {
      const inbox = deliverToInbox()

      const { error } = await posthog.emails.send({
        to: 'user@example.com',
        templateKey: 'trial-ending',
        subject: 'Your trial ends soon',
        text: 'Your trial ends in 3 days.',
        scheduledAt: '2026-12-01T09:00:00Z',
      })

      expect(error).toBeNull()
      expect(inbox).toEqual([
        expect.objectContaining({ template_key: 'trial-ending', scheduled_at: '2026-12-01T09:00:00Z' }),
      ])
    })

    it('reads a time at or before now as sent now', async () => {
      replies = [accepted({ status: 'queued', scheduled_at: null })]

      const { data } = await send({ scheduledAt: '2020-01-01T00:00:00Z' })

      expect(data).toMatchObject({ status: 'queued', scheduledAt: null, warnings: [] })
    })

    it('warns when a PostHog from before scheduled sends sent the email now', async () => {
      replies = [accepted()]

      const { data, error } = await send({ scheduledAt: '2026-12-01T09:00:00Z' })

      expect(error).toBeNull()
      expect(data).toMatchObject({
        status: 'queued',
        scheduledAt: null,
        warnings: [expect.objectContaining({ code: 'scheduling_unsupported' })],
      })
    })

    it("keeps each send's scheduling warning its own when a caller changes one", async () => {
      replies = [accepted(), accepted()]

      const first = await send({ scheduledAt: '2026-12-01T09:00:00Z' })
      Object.assign(first.data!.warnings[0], { code: 'changed', message: 'changed', fix: 'changed' })
      const second = await send({ scheduledAt: '2026-12-01T09:00:00Z' })

      expect(second.data?.warnings).toEqual([
        {
          code: 'scheduling_unsupported',
          message: 'This PostHog predates scheduled sends, so it ignored scheduledAt and sent the email now.',
          fix: 'Update PostHog before you schedule emails with it.',
        },
      ])
    })

    it('does not warn about scheduling a send that had no time', async () => {
      replies = [accepted()]

      const { data } = await send()

      expect(data?.warnings).toEqual([])
    })

    it.each([
      ['a time without an offset', '2026-12-01T09:00:00'],
      ['a date without a time', '2026-12-01'],
      ["a time in words, as Resend's API takes", 'in 1 hour'],
      ['a month that does not exist', '2026-13-01T09:00:00Z'],
      ['a day that does not exist', '2026-02-30T09:00:00Z'],
      ['an hour that does not exist', '2026-12-01T99:00:00Z'],
      ['a minute that does not exist', '2026-12-01T09:60:00Z'],
      ['a second that does not exist', '2026-12-01T09:00:61Z'],
      ['an offset that does not exist', '2026-12-01T09:00:00+99:99'],
      ['an invalid Date', new Date('nope')],
      ['a timestamp in milliseconds', 1_796_115_600_000],
      ['null', null],
    ])('refuses %s before sending', async (_name, scheduledAt) => {
      const { data, error } = await send({ scheduledAt })

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_scheduled_at', name: 'validation_error', field: 'scheduledAt' })
      expect(error?.message).toContain('Nothing was sent.')
      expect(fetch).not.toHaveBeenCalled()
    })

    it('keeps the code PostHog answers for a time more than 30 days ahead', async () => {
      replies = [
        {
          status: 400,
          body: {
            type: 'validation_error',
            code: 'invalid_scheduled_at',
            detail: 'scheduled_at is too far ahead.',
            attr: 'scheduled_at',
            why: 'scheduled_at is more than 30 days after the email was created.',
          },
        },
      ]

      const { error } = await send({ scheduledAt: '2027-06-01T09:00:00Z' })

      expect(error).toMatchObject({ code: 'invalid_scheduled_at', name: 'validation_error', statusCode: 400 })
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('update', () => {
    const moved = (fields: Record<string, unknown> = {}): Reply => ({
      status: 200,
      body: { id: MESSAGE_ID, status: 'scheduled', scheduled_at: '2026-12-02T09:00:00Z', ...fields },
    })

    const update = (options: Record<string, unknown>): ReturnType<PostHog['emails']['update']> =>
      posthog.emails.update(options as unknown as Parameters<PostHog['emails']['update']>[0])

    it('moves a scheduled email to a new time', async () => {
      replies = [moved()]

      const { data, error } = await posthog.emails.update({
        id: MESSAGE_ID.toUpperCase(),
        scheduledAt: new Date('2026-12-02T09:00:00Z'),
      })

      expect(error).toBeNull()
      expect(data).toEqual({ id: MESSAGE_ID, status: 'scheduled', scheduledAt: '2026-12-02T09:00:00Z' })
      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe(STATUS_URL)
      expect(options.method).toBe('PATCH')
      expect(options.headers).toEqual({
        Authorization: `Bearer ${SECRET_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'posthog-node/1.2.3',
      })
      expect(JSON.parse(options.body)).toEqual({ scheduled_at: '2026-12-02T09:00:00.000Z' })
    })

    it.each([
      ['a network error', new TypeError('fetch failed')],
      ['503', rejected(503)],
      ['429 throttled', rejected(429, 'throttled')],
    ])('retries %s, because the same move twice ends the same', async (_name, firstReply) => {
      replies = [firstReply, moved()]

      const pending = update({ id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00Z' })
      await vi.runAllTimersAsync()
      const { data } = await pending

      expect(data?.status).toBe('scheduled')
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('reports already_sending when the retry of a move to now finds the email going out', async () => {
      replies = [new TypeError('fetch failed'), rejected(409, 'already_sending')]

      const pending = update({ id: MESSAGE_ID, scheduledAt: new Date() })
      await vi.runAllTimersAsync()
      const { data, error } = await pending

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'already_sending', statusCode: 409 })
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('runs a second move of the same email after the first move and its retries', async () => {
      replies = [
        rejected(429, 'throttled'),
        moved({ scheduled_at: '2026-12-02T09:00:00Z' }),
        moved({ scheduled_at: '2026-12-03T09:00:00Z' }),
      ]

      const first = update({ id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00Z' })
      const second = update({ id: MESSAGE_ID.toUpperCase(), scheduledAt: '2026-12-03T09:00:00Z' })
      await vi.runAllTimersAsync()
      const [firstResult, secondResult] = await Promise.all([first, second])

      expect(fetch.mock.calls.map(([, options]) => JSON.parse(options.body).scheduled_at)).toEqual([
        '2026-12-02T09:00:00Z',
        '2026-12-02T09:00:00Z',
        '2026-12-03T09:00:00Z',
      ])
      expect(firstResult.data?.scheduledAt).toBe('2026-12-02T09:00:00Z')
      expect(secondResult.data?.scheduledAt).toBe('2026-12-03T09:00:00Z')
    })

    describe("after a move that wasn't confirmed", () => {
      const FIRST_TIME = '2026-12-02T09:00:00Z'
      const OTHER_TIME = '2026-12-03T09:00:00Z'
      let timeAtPostHog: string
      let reachPostHogLate: () => void

      beforeEach(() => {
        makeClient({ emailRequestTimeoutMs: 1_000, emailRequestMaxRetries: 0 })
        timeAtPostHog = '2026-12-01T09:00:00Z'
        fetch.mockImplementation(async (_url: string, options: { body: string }) => {
          const time = JSON.parse(options.body).scheduled_at
          if (fetch.mock.calls.length === 1) {
            // PostHog applies the first move only after the client gave up on it.
            reachPostHogLate = () => (timeAtPostHog = time)
            return new Promise(() => {})
          }
          timeAtPostHog = time
          return fakeReply(200, { id: MESSAGE_ID, status: 'scheduled', scheduled_at: time })
        })
      })

      const moveWithoutAnswer = async (): Promise<void> => {
        const pending = update({ id: MESSAGE_ID, scheduledAt: FIRST_TIME })
        await vi.advanceTimersByTimeAsync(1_000)
        expect((await pending).error?.code).toBe('network_error')
      }

      it('refuses a move to another time, which the late move could undo', async () => {
        await moveWithoutAnswer()

        const { data, error } = await update({ id: MESSAGE_ID.toUpperCase(), scheduledAt: OTHER_TIME })
        reachPostHogLate()

        expect(data).toBeNull()
        expect(error).toMatchObject({ code: 'move_unconfirmed' })
        expect(error?.message).toBe(
          "An earlier move of this email to another time wasn't confirmed, so PostHog may still apply it after this one. Nothing was changed."
        )
        expect(error?.fix).toContain('cancel')
        expect(timeAtPostHog).toBe(FIRST_TIME)
        expect(fetch).toHaveBeenCalledTimes(1)
      })

      it.each([
        ['the same text', FIRST_TIME],
        ['a Date', new Date(FIRST_TIME)],
        ['another offset', '2026-12-02T10:00:00.000+01:00'],
      ])('sends a move to the same time as %s, which the late move cannot undo', async (_name, sameTime) => {
        await moveWithoutAnswer()

        const { data, error } = await update({ id: MESSAGE_ID, scheduledAt: sameTime })
        reachPostHogLate()

        expect(error).toBeNull()
        expect(Date.parse(data!.scheduledAt)).toBe(Date.parse(FIRST_TIME))
        expect(Date.parse(timeAtPostHog)).toBe(Date.parse(FIRST_TIME))
      })

      it('refuses a move to a time a microsecond away', async () => {
        await moveWithoutAnswer()

        const { error } = await update({ id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00.000001Z' })

        expect(error?.code).toBe('move_unconfirmed')
      })

      it.each([500, 502, 503, 504])(
        'refuses a move to another time after a %s, which a gateway can answer while PostHog still applies the move',
        async (status) => {
          fetch.mockImplementationOnce(async () => fakeReply(status, null))
          const first = await update({ id: MESSAGE_ID, scheduledAt: FIRST_TIME })
          expect(first.error?.statusCode).toBe(status)

          const { error } = await update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })

          expect(error?.code).toBe('move_unconfirmed')
          expect(fetch).toHaveBeenCalledTimes(1)
        }
      )

      it('sends a move to another time after PostHog refused the earlier move', async () => {
        fetch.mockImplementationOnce(async () => fakeReply(400, { code: 'invalid_scheduled_at', detail: 'Nope.' }))
        expect((await update({ id: MESSAGE_ID, scheduledAt: FIRST_TIME })).error?.statusCode).toBe(400)

        const { data } = await update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })

        expect(data?.scheduledAt).toBe(OTHER_TIME)
      })

      it("refuses a move to another time queued behind the move that wasn't confirmed", async () => {
        const first = update({ id: MESSAGE_ID, scheduledAt: FIRST_TIME })
        const second = update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })
        await vi.advanceTimersByTimeAsync(1_000)

        expect((await first).error?.code).toBe('network_error')
        expect((await second).error?.code).toBe('move_unconfirmed')
        expect(fetch).toHaveBeenCalledTimes(1)
      })

      it.each([
        ['a timeout', undefined],
        ['a 503', 503],
      ])('refuses a move to another time even when a retry after %s got an answer', async (_name, status) => {
        makeClient({ emailRequestTimeoutMs: 1_000, emailRequestMaxRetries: 1 })
        if (status !== undefined) {
          fetch.mockImplementationOnce(async () => fakeReply(status, null))
        }
        const pending = update({ id: MESSAGE_ID, scheduledAt: FIRST_TIME })
        await vi.runAllTimersAsync()
        expect((await pending).data?.scheduledAt).toBe(FIRST_TIME)

        const { error } = await update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })

        expect(error?.code).toBe('move_unconfirmed')
        expect(fetch).toHaveBeenCalledTimes(2)
      })

      it('moves other emails as before', async () => {
        await moveWithoutAnswer()
        const otherId = MESSAGE_ID.replace(/.$/, MESSAGE_ID.endsWith('0') ? '1' : '0')

        const { data } = await update({ id: otherId, scheduledAt: OTHER_TIME })

        expect(data?.scheduledAt).toBe(OTHER_TIME)
      })

      it("lets PostHog answer a move once the email is canceled, which a late move can't undo", async () => {
        await moveWithoutAnswer()
        fetch.mockImplementationOnce(async () => fakeReply(200, { id: MESSAGE_ID, status: 'canceled' }))
        expect((await posthog.emails.cancel(MESSAGE_ID)).data?.status).toBe('canceled')
        fetch.mockImplementationOnce(async () => fakeReply(409, rejected(409, 'canceled').body))

        const { error } = await update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })

        expect(error).toMatchObject({ code: 'canceled', statusCode: 409 })
        expect(fetch).toHaveBeenCalledTimes(3)
      })

      describe('when PostHog confirms a cancel while moves of the email are out or queued', () => {
        const THIRD_TIME = '2026-12-04T09:00:00Z'
        const answerMoves = (answerFor: (time: string) => Reply | undefined): void => {
          fetch.mockImplementation(async (_url: string, options: { method: string; body?: string }) => {
            if (options.method === 'POST') {
              return fakeReply(200, { id: MESSAGE_ID, status: 'canceled' })
            }
            const reply = answerFor(JSON.parse(options.body!).scheduled_at)
            return reply === undefined ? new Promise(() => {}) : fakeReply(reply.status, reply.body)
          })
        }
        const canceledAtPostHog = (): Reply => rejected(409, 'canceled')

        it("answers the cancel without waiting for the move that's out, and records nothing from that move", async () => {
          answerMoves((time) => (time === FIRST_TIME ? undefined : canceledAtPostHog()))
          const out = update({ id: MESSAGE_ID, scheduledAt: FIRST_TIME })
          await vi.advanceTimersByTimeAsync(0)

          expect((await posthog.emails.cancel(MESSAGE_ID)).data?.status).toBe('canceled')
          await vi.advanceTimersByTimeAsync(1_000)
          expect((await out).error?.code).toBe('network_error')
          const { error } = await update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })

          expect(error).toMatchObject({ code: 'canceled', statusCode: 409 })
          expect(fetch).toHaveBeenCalledTimes(3)
        })

        it('records nothing from a queued move, whatever PostHog answers it', async () => {
          answerMoves((time) =>
            time === FIRST_TIME ? undefined : time === OTHER_TIME ? rejected(503) : canceledAtPostHog()
          )
          const out = update({ id: MESSAGE_ID, scheduledAt: FIRST_TIME })
          const queued = update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })
          await vi.advanceTimersByTimeAsync(0)

          expect((await posthog.emails.cancel(MESSAGE_ID)).data?.status).toBe('canceled')
          await vi.advanceTimersByTimeAsync(1_000)
          expect((await out).error?.code).toBe('network_error')
          expect((await queued).error?.statusCode).toBe(503)
          const { error } = await update({ id: MESSAGE_ID, scheduledAt: THIRD_TIME })

          expect(error).toMatchObject({ code: 'canceled', statusCode: 409 })
          expect(fetch).toHaveBeenCalledTimes(4)
        })

        it('guards a later move again once the moves that were out at the cancel have ended', async () => {
          answerMoves((time) => (time === FIRST_TIME ? undefined : rejected(503)))
          const out = update({ id: MESSAGE_ID, scheduledAt: FIRST_TIME })
          await vi.advanceTimersByTimeAsync(0)
          expect((await posthog.emails.cancel(MESSAGE_ID)).data?.status).toBe('canceled')
          await vi.advanceTimersByTimeAsync(1_000)
          expect((await out).error?.code).toBe('network_error')

          expect((await update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })).error?.statusCode).toBe(503)
          const { error } = await update({ id: MESSAGE_ID, scheduledAt: THIRD_TIME })

          expect(error?.code).toBe('move_unconfirmed')
          expect(fetch).toHaveBeenCalledTimes(3)
        })
      })

      it('refuses a move to another time after PostHog refused the cancel', async () => {
        await moveWithoutAnswer()
        fetch.mockImplementationOnce(async () => fakeReply(409, rejected(409, 'already_sending').body))
        expect((await posthog.emails.cancel(MESSAGE_ID)).error?.code).toBe('already_sending')

        const { error } = await update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })

        expect(error?.code).toBe('move_unconfirmed')
        expect(fetch).toHaveBeenCalledTimes(2)
      })

      it('keeps refusing moves of a later unconfirmed email after an earlier guard lapses', async () => {
        const start = Date.now()
        onTestFinished(() => vi.setSystemTime(start))
        const [laterId, latestId] = ['1', '2'].map((digit) => MESSAGE_ID.replace(/.$/, digit))
        const moveAnswered503 = async (id: string): Promise<void> => {
          fetch.mockImplementationOnce(async () => fakeReply(503, null))
          expect((await update({ id, scheduledAt: FIRST_TIME })).error?.statusCode).toBe(503)
        }
        await moveWithoutAnswer()
        vi.setSystemTime(Date.now() + 10 * 24 * 60 * 60 * 1_000)
        await moveAnswered503(laterId)
        vi.setSystemTime(Date.now() + 22 * 24 * 60 * 60 * 1_000)
        await moveAnswered503(latestId)

        const later = await update({ id: laterId, scheduledAt: OTHER_TIME })
        const earliest = await update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })

        expect(later.error?.code).toBe('move_unconfirmed')
        expect(earliest.data?.scheduledAt).toBe(OTHER_TIME)
        expect(fetch).toHaveBeenCalledTimes(4)
      })

      it.each([
        ['refuses', 30, 'move_unconfirmed', 1],
        ['sends', 31, undefined, 2],
      ])(
        '%s a move to another time %i days after the move PostHog may still apply',
        async (_verb, days, code, requests) => {
          const start = Date.now()
          onTestFinished(() => vi.setSystemTime(start))
          await moveWithoutAnswer()
          vi.setSystemTime(Date.now() + days * 24 * 60 * 60 * 1_000)

          const { error } = await update({ id: MESSAGE_ID, scheduledAt: OTHER_TIME })

          expect(error?.code).toBe(code)
          expect(fetch).toHaveBeenCalledTimes(requests)
        }
      )
    })

    it('moves different emails without waiting for each other', async () => {
      const otherId = MESSAGE_ID.replace(/.$/, MESSAGE_ID.endsWith('0') ? '1' : '0')
      replies = [new TypeError('fetch failed'), moved({ id: otherId }), moved()]

      const first = update({ id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00Z' })
      const second = update({ id: otherId, scheduledAt: '2026-12-02T09:00:00Z' })
      await vi.advanceTimersByTimeAsync(0)

      expect(fetch).toHaveBeenCalledTimes(2)
      await vi.runAllTimersAsync()
      await Promise.all([first, second])
    })

    it('refuses a time without an offset without saying an email was sent', async () => {
      const { error } = await update({ id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00' })

      expect(error?.message).toContain('Nothing was changed.')
      expect(error?.message).not.toContain('sent')
    })

    it.each([
      ['an email PostHog has started sending', 409, 'already_sending', 'validation_error'],
      ['a canceled email', 409, 'canceled', 'validation_error'],
      ['a time more than 30 days after the send', 400, 'invalid_scheduled_at', 'validation_error'],
      ['an unknown email', 404, 'not_found', 'not_found'],
    ])('reports %s without a retry', async (_name, status, code, name) => {
      replies = [rejected(status, code), moved()]

      const { data, error } = await update({ id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00Z' })

      expect(data).toBeNull()
      expect(error).toMatchObject({ statusCode: status, code, name })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['an ID that is not a UUID', { id: 'msg_1', scheduledAt: '2026-12-02T09:00:00Z' }, 'invalid_message_id', 'id'],
      ['no time', { id: MESSAGE_ID }, 'invalid_scheduled_at', 'scheduledAt'],
      [
        'a time without an offset',
        { id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00' },
        'invalid_scheduled_at',
        'scheduledAt',
      ],
      [
        'a change other than the time',
        { id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00Z', subject: 'Hi' },
        'invalid_form',
        'subject',
      ],
      ['no options', undefined, 'invalid_message_id', 'id'],
    ])('refuses %s before any request', async (_name, options, code, field) => {
      const { data, error } = await update(options as Record<string, unknown>)

      expect(data).toBeNull()
      expect(error).toMatchObject({ code, field, name: 'validation_error' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('reports a reply without the new time as api_error', async () => {
      replies = [moved({ scheduled_at: null })]

      const { error } = await update({ id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00Z' })

      expect(error).toMatchObject({ code: 'api_error', statusCode: 200 })
    })
  })

  describe('cancel', () => {
    const canceled: Reply = { status: 200, body: { id: MESSAGE_ID, status: 'canceled' } }

    it('cancels a scheduled email', async () => {
      replies = [canceled]

      const { data, error } = await posthog.emails.cancel(MESSAGE_ID.toUpperCase())

      expect(error).toBeNull()
      expect(data).toEqual({ id: MESSAGE_ID, status: 'canceled' })
      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe(CANCEL_URL)
      expect(options.method).toBe('POST')
      expect(options.body).toBeUndefined()
      expect(options.headers).toEqual({
        Authorization: `Bearer ${SECRET_KEY}`,
        Accept: 'application/json',
        'User-Agent': 'posthog-node/1.2.3',
      })
    })

    it.each([
      ['a network error', new TypeError('fetch failed')],
      ['503', rejected(503)],
    ])('retries %s, because a second cancel answers the same', async (_name, firstReply) => {
      replies = [firstReply, canceled]

      const pending = posthog.emails.cancel(MESSAGE_ID)
      await vi.runAllTimersAsync()
      const { data } = await pending

      expect(data?.status).toBe('canceled')
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it.each([
      ['an email PostHog has started sending', 409, 'already_sending', 'validation_error'],
      ['an unknown email', 404, 'not_found', 'not_found'],
    ])('reports %s without a retry', async (_name, status, code, name) => {
      replies = [rejected(status, code), canceled]

      const { data, error } = await posthog.emails.cancel(MESSAGE_ID)

      expect(data).toBeNull()
      expect(error).toMatchObject({ statusCode: status, code, name })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('refuses an ID that is not a UUID before any request', async () => {
      const { error } = await posthog.emails.cancel('msg_1')

      expect(error).toMatchObject({ code: 'invalid_message_id', field: 'id', name: 'validation_error' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('reports a reply that is not canceled as api_error', async () => {
      replies = [{ status: 200, body: { id: MESSAGE_ID, status: 'scheduled' } }]

      const { error } = await posthog.emails.cancel(MESSAGE_ID)

      expect(error).toMatchObject({ code: 'api_error', statusCode: 200 })
    })
  })

  describe('list', () => {
    const page = (fields: Record<string, unknown> = {}): Reply => ({
      status: 200,
      body: {
        results: [
          {
            id: MESSAGE_ID,
            scheduled_at: '2026-12-01T09:00:00Z',
            created_at: '2026-11-12T10:00:00Z',
          },
        ],
        next: 'cursor_2',
        ...fields,
      },
    })

    const list = (options: Record<string, unknown>): ReturnType<PostHog['emails']['list']> =>
      posthog.emails.list(options as unknown as Parameters<PostHog['emails']['list']>[0])

    it('lists the scheduled emails of one page', async () => {
      replies = [page()]

      const { data, error } = await posthog.emails.list({ status: 'scheduled', cursor: 'cursor_1', limit: 10 })

      expect(error).toBeNull()
      expect(data).toEqual({
        results: [
          {
            id: MESSAGE_ID,
            scheduledAt: '2026-12-01T09:00:00Z',
            createdAt: '2026-11-12T10:00:00Z',
          },
        ],
        next: 'cursor_2',
      })
      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe(`${LIST_URL}?status=scheduled&cursor=cursor_1&limit=10`)
      expect(options.method).toBe('GET')
      expect(options.body).toBeUndefined()
    })

    it('returns only the ID and the two times of each email, even when PostHog sends more', async () => {
      replies = [
        page({
          results: [
            {
              id: MESSAGE_ID,
              to: 'user@example.com',
              scheduled_at: '2026-12-01T09:00:00Z',
              created_at: '2026-11-12T10:00:00Z',
            },
          ],
        }),
      ]

      const { data } = await posthog.emails.list({ status: 'scheduled' })

      expect(Object.keys(data!.results[0]).sort()).toEqual(['createdAt', 'id', 'scheduledAt'])
    })

    it.each([
      ['a malformed cursor', 'not-a-cursor', 'invalid_input'],
      ['a cursor over 128 characters', 'c'.repeat(129), 'max_length'],
    ])('reports PostHog refusing %s as a validation error on cursor, without a retry', async (_name, cursor, code) => {
      replies = [
        { status: 400, body: { type: 'validation_error', code, detail: 'Bad cursor.', attr: 'cursor' } },
        page(),
      ]

      const { data, error } = await list({ status: 'scheduled', cursor })

      expect(data).toBeNull()
      expect(error).toMatchObject({ statusCode: 400, code, field: 'cursor', name: 'validation_error' })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('asks for the first page without a cursor and reads the last page', async () => {
      replies = [page({ results: [], next: null })]

      const { data } = await posthog.emails.list({ status: 'scheduled' })

      expect(data).toEqual({ results: [], next: null })
      expect(fetch.mock.calls[0][0]).toBe(`${LIST_URL}?status=scheduled`)
    })

    it('encodes a cursor PostHog returned', async () => {
      replies = [page()]

      await posthog.emails.list({ status: 'scheduled', cursor: 'a+b/c=&d' })

      expect(new URL(fetch.mock.calls[0][0]).searchParams.get('cursor')).toBe('a+b/c=&d')
    })

    it.each([
      ['a network error', new TypeError('fetch failed')],
      ['503', rejected(503)],
    ])('never retries %s', async (_name, firstReply) => {
      replies = [firstReply, page()]

      const pending = list({ status: 'scheduled' })
      await vi.runAllTimersAsync()
      const { data, error } = await pending

      expect(data).toBeNull()
      expect(error).toBeInstanceOf(EmailError)
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['another status', { status: 'sent' }, 'status'],
      ['no status', {}, 'status'],
      ['no options', undefined, 'status'],
      ['a limit of 0', { status: 'scheduled', limit: 0 }, 'limit'],
      ['a limit over 100', { status: 'scheduled', limit: 101 }, 'limit'],
      ['a limit that is not a whole number', { status: 'scheduled', limit: 1.5 }, 'limit'],
      ['an empty cursor', { status: 'scheduled', cursor: '' }, 'cursor'],
    ])('refuses %s before any request', async (_name, options, field) => {
      const { data, error } = await list(options as Record<string, unknown>)

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_list_options', field, name: 'validation_error' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      ['no results', { results: null }],
      ['a row without a time', { results: [{ id: MESSAGE_ID, created_at: '2026-11-12T10:00:00Z' }] }],
      ['a cursor that is not a string', { next: 2 }],
    ])('reports a reply with %s as api_error', async (_name, fields) => {
      replies = [page(fields)]

      const { error } = await list({ status: 'scheduled' })

      expect(error).toMatchObject({ code: 'api_error', statusCode: 200 })
    })
  })

  describe.each([
    ['update', (posthog: PostHog) => posthog.emails.update({ id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00Z' })],
    ['cancel', (posthog: PostHog) => posthog.emails.cancel(MESSAGE_ID)],
    ['list', (posthog: PostHog) => posthog.emails.list({ status: 'scheduled' })],
  ])('%s', (_name, call) => {
    it.each([
      ['a disabled client', { disabled: true }, 'client_disabled'],
      ['no secret key', { secretKey: undefined }, 'missing_secret_key'],
      ['a custom host without appHost', { host: 'https://ph.example.com' }, 'missing_app_host'],
    ])('makes no request from %s', async (_label, options, code) => {
      makeClient(options)

      const { data, error } = await call(posthog)

      expect(data).toBeNull()
      expect(error?.code).toBe(code)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('makes no request after shutdown', async () => {
      await posthog.shutdown()

      const { error } = await call(posthog)

      expect(error?.code).toBe('client_closed')
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it('waits for a cancel in its retry backoff before shutdown resolves', async () => {
    replies = [rejected(503), { status: 200, body: { id: MESSAGE_ID, status: 'canceled' } }]
    const pending = posthog.emails.cancel(MESSAGE_ID)
    await vi.advanceTimersByTimeAsync(0)

    let shutDown = false
    const shutdown = posthog.shutdown().then(() => (shutDown = true))
    await vi.advanceTimersByTimeAsync(500)
    expect(shutDown).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    await shutdown

    expect((await pending).data?.status).toBe('canceled')
  })

  it('sends every move accepted before shutdown, including one queued behind another move', async () => {
    const moved = (scheduledAt: string): Reply => ({
      status: 200,
      body: { id: MESSAGE_ID, status: 'scheduled', scheduled_at: scheduledAt },
    })
    replies = [rejected(429, 'throttled'), moved('2026-12-02T09:00:00Z'), moved('2026-12-03T09:00:00Z')]

    const first = posthog.emails.update({ id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00Z' })
    const second = posthog.emails.update({ id: MESSAGE_ID, scheduledAt: '2026-12-03T09:00:00Z' })
    const shutdown = posthog.shutdown()
    await vi.runAllTimersAsync()
    await shutdown

    expect((await first).data?.scheduledAt).toBe('2026-12-02T09:00:00Z')
    expect((await second).data?.scheduledAt).toBe('2026-12-03T09:00:00Z')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('moves the email to the time it had when update was called, even if the caller changes the options after', async () => {
    replies = [
      new TypeError('fetch failed'),
      { status: 200, body: { id: MESSAGE_ID, status: 'scheduled', scheduled_at: '2026-12-02T09:00:00Z' } },
    ]
    const options = { id: MESSAGE_ID, scheduledAt: '2026-12-02T09:00:00Z' }

    const pending = posthog.emails.update(options)
    options.scheduledAt = '2026-12-09T09:00:00Z'
    options.id = '01a18356-c56c-0001-e494-7666bc915199'
    await vi.runAllTimersAsync()
    await pending

    expect(fetch.mock.calls.map(([url, init]) => [url, JSON.parse(init.body).scheduled_at])).toEqual([
      [STATUS_URL, '2026-12-02T09:00:00Z'],
      [STATUS_URL, '2026-12-02T09:00:00Z'],
    ])
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

    it.each(['scheduled', 'canceled'])('reads an email that is %s', async (status) => {
      replies = [statusReply({ status, reason: null })]

      const { data } = await posthog.emails.get(MESSAGE_ID)

      expect(data).toMatchObject({ status, reason: null })
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

  describe('setPreferences', () => {
    const applied = (fields: Record<string, unknown> = {}): Reply => ({
      status: 200,
      body: { identifier: 'user@example.com', all_marketing: null, topics: { newsletter: false }, ...fields },
    })

    const setPreferences = (
      options: Record<string, unknown> = { to: 'user@example.com', topics: { newsletter: false } }
    ): ReturnType<PostHog['emails']['setPreferences']> =>
      posthog.emails.setPreferences(options as unknown as Parameters<PostHog['emails']['setPreferences']>[0])

    it('posts every change in one request to the app host', async () => {
      replies = [applied({ all_marketing: true, topics: { newsletter: true, 'product-updates': false } })]

      const { data, error } = await setPreferences({
        to: 'user@example.com',
        allMarketing: false,
        topics: { newsletter: true },
      })

      expect(error).toBeNull()
      expect(data).toEqual({
        to: 'user@example.com',
        allMarketing: true,
        topics: { newsletter: true, 'product-updates': false },
      })
      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, options] = fetch.mock.calls[0]
      expect(url).toBe(PREFERENCES_URL)
      expect(options.method).toBe('POST')
      expect(options.headers).toEqual({
        Authorization: `Bearer ${SECRET_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'posthog-node/1.2.3',
      })
      expect(JSON.parse(options.body)).toEqual({
        identifier: 'user@example.com',
        all_marketing: false,
        topics: { newsletter: true },
      })
    })

    it('leaves out the changes the call does not make', async () => {
      replies = [applied()]

      await setPreferences({ to: 'user@example.com', allMarketing: false })

      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ identifier: 'user@example.com', all_marketing: false })
    })

    it('reports an unknown topic as unknown_topic without a retry', async () => {
      replies = [
        {
          status: 404,
          body: { type: 'invalid_request', code: 'unknown_topic', detail: 'No topic newsletter.', attr: null },
        },
      ]

      const { data, error } = await setPreferences()

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'unknown_topic', name: 'not_found', message: 'No topic newsletter.' })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['a topic value that is not a boolean', { topics: { newsletter: 'false' } }],
      ['no topics', { topics: null }],
      ['an all_marketing value that is not a boolean', { all_marketing: 'false' }],
    ])('reports a reply with %s as api_error', async (_label, fields) => {
      replies = [applied(fields)]

      const { data, error } = await setPreferences()

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'api_error', statusCode: 200 })
    })

    it('retries an unavailable service, because the same change twice ends the same', async () => {
      replies = [rejected(503), applied()]

      const pending = setPreferences()
      await vi.runAllTimersAsync()
      const { data } = await pending

      expect(data?.topics).toEqual({ newsletter: false })
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('needs a secret key', async () => {
      makeClient({ secretKey: undefined })

      const { error } = await setPreferences()

      expect(error).toMatchObject({ code: 'missing_secret_key', name: 'missing_api_key' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      ['an empty recipient', { to: ' ', allMarketing: false }, 'invalid_recipient'],
      ['no change', { to: 'user@example.com', topics: {} }, 'invalid_preferences'],
      ['a non-boolean all marketing', { to: 'user@example.com', allMarketing: 'no' }, 'invalid_preferences'],
      ['a topic list', { to: 'user@example.com', topics: ['newsletter'] }, 'invalid_preferences'],
      ['a non-boolean topic', { to: 'user@example.com', topics: { newsletter: 'off' } }, 'invalid_preferences'],
    ])('rejects %s before sending', async (_name, options, code) => {
      const { data, error } = await setPreferences(options)

      expect(data).toBeNull()
      expect(error).toMatchObject({ code, name: 'validation_error' })
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})

describe('emails over HTTP', () => {
  const CODE_SEND = { to: 'user@example.com', templateKey: 'welcome', subject: 'Welcome', html: '<p>Hi</p>' }
  const CODE_SEND_BODY = { to: 'user@example.com', template_key: 'welcome', subject: 'Welcome', html: '<p>Hi</p>' }

  let server: Server
  let posthog: PostHog
  let received: unknown[]

  beforeAll(async () => {
    vi.useRealTimers()
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => (body += chunk))
      request.on('end', () => {
        received.push(JSON.parse(body))
        response.writeHead(202, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ message_id: 'msg_1', replayed: false }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    posthog = new PostHog('phc_test', {
      secretKey: SECRET_KEY,
      appHost: `http://127.0.0.1:${port}`,
      enableLocalEvaluation: false,
    })
  })

  afterAll(async () => {
    await posthog.shutdown()
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(() => {
    received = []
  })

  it.each([
    ['no tracking or sensitive choice, which leaves them and capture_engagement out', {}, {}],
    ['the email marked sensitive', { sensitive: true }, { sensitive: true }],
    ['the email marked not sensitive', { sensitive: false }, { sensitive: false }],
    ['all tracking turned off', { tracking: false }, { tracking: false }],
    ['all tracking turned on', { tracking: true }, { tracking: true }],
    [
      'each kind of tracking chosen',
      { tracking: { opens: true, clicks: true, engagement: false } },
      { tracking: { opens: true, clicks: true, engagement: false } },
    ],
    ['the deprecated captureEngagement', { captureEngagement: false }, { capture_engagement: false }],
  ])('delivers a code send with %s', async (_name, options, body) => {
    const { data, error } = await posthog.emails.send({ ...CODE_SEND, ...options })

    expect(error).toBeNull()
    expect(data?.id).toBe('msg_1')
    expect(received).toEqual([{ ...CODE_SEND_BODY, ...body }])
  })

  it.each([
    ['tracking', { tracking: false }],
    ['sensitive', { sensitive: false }],
  ])('refuses %s on the template form without sending', async (field, option) => {
    const send = { to: 'user@example.com', templateId: TEMPLATE_ID, ...option } as unknown as SendEmailOptions

    const { data, error } = await posthog.emails.send(send)

    expect(data).toBeNull()
    expect(error).toMatchObject({ code: 'invalid_form', name: 'validation_error', field })
    expect(received).toEqual([])
  })
})
