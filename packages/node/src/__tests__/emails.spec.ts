import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createElement, type ReactElement, Suspense, use } from 'react'

import {
  EmailError,
  MessageCategory,
  PostHog,
  PostHogOptions,
  SendEmailOptions,
  TRANSACTIONAL_EMAIL_CATEGORY,
} from '@/entrypoints/index.node'

import { FakePostHog, type FakePostHogOptions, type ServerChange } from './utils/emails-fake'

vi.mock('../version', () => ({ version: '1.2.3' }))

const SECRET_KEY = 'phs_test_secret'
const TEMPLATE_ID = '0190f6d2-7c1e-7b3a-9f5e-1c2d3e4f5a6b'
const SEND_URL = 'https://us.posthog.com/api/messaging/send/email/'
const MESSAGE_ID = '01a18356-c56c-0001-e494-7666bc915188'
const STATUS_URL = `https://us.posthog.com/api/messaging/emails/${MESSAGE_ID}/`
const PREFERENCES_URL = 'https://us.posthog.com/api/messaging/preferences/'
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

    it('decodes Base64 without Buffer, as on the edge runtime', async () => {
      const fake = againstPostHog()
      const atob = vi.spyOn(globalThis, 'atob')
      // send() decodes the files before its first await. Restore Buffer before awaiting: vitest's forks worker
      // decodes its IPC messages with the global Buffer and fails the run if one arrives while it is unset.
      vi.stubGlobal('Buffer', undefined)
      let sending: ReturnType<typeof sendFiles>
      try {
        sending = sendFiles([
          { filename: 'logo.png', content: new Uint8Array(LOGO) },
          { filename: 'invite.ics', content: 'QkVHSU46VkNBTEVOREFS' },
        ])
      } finally {
        vi.unstubAllGlobals()
      }
      const result = await sending

      expect(atob).toHaveBeenCalledWith('QkVHSU46VkNBTEVOREFS')
      atob.mockRestore()
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

    expect(fetch.mock.calls[0][0]).toBe(`${expected}/api/messaging/send/email/`)
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
      url.includes('/i/v1/analytics/events')
        ? Promise.resolve({ status: 200, text: async () => '{}', json: async () => ({}), headers: new Headers() })
        : emailFetch(url, options)
    )
    const batchCalls = (): number => fetch.mock.calls.filter(([url]) => url.includes('/i/v1/analytics/events')).length

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
        "A template made in PostHog sets its own sender, subject, content and category, and follows the project's engagement setting.",
        'Remove from, or send content from your code with templateKey.',
      ],
      [
        'engagement capture on the template form',
        { templateId: TEMPLATE_ID, captureEngagement: true },
        "A template made in PostHog sets its own sender, subject, content and category, and follows the project's engagement setting.",
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

  describe('message categories', () => {
    const CODE_SEND = {
      to: 'reader@example.com',
      templateKey: 'monthly-news',
      subject: 'This month',
      html: '<a href="{{ unsubscribe_url }}">Unsubscribe</a>',
    }

    const NEWSLETTER: MessageCategory = {
      key: 'newsletter',
      type: 'marketing',
      name: 'Newsletter',
      description: 'Monthly product news',
    }

    const RECEIPTS: MessageCategory = {
      key: 'receipts',
      type: 'transactional',
      name: 'Receipts',
    }

    const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    const HELLO_BYTES = utf8('hello')
    const HELLO_CHECKSUM = 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ='
    const UPLOADS_URL = 'https://us.posthog.com/api/messaging/attachments/uploads/'
    const STORAGE_UPLOAD_URL = `https://storage.example.com/team/2/${HELLO_SHA256}?X-Amz-Expires=900&X-Amz-Signature=sig-1`

    const sameBytes = (actual: Uint8Array, expected: Uint8Array): boolean =>
      actual.byteLength === expected.byteLength && actual.every((byte, index) => byte === expected[index])

    const isJsonContentType = (value: string | undefined): boolean =>
      typeof value === 'string' && value.split(';')[0].trim().toLowerCase() === 'application/json'

    const parseJsonObject = (body: BodyInit | null | undefined): Record<string, unknown> | null => {
      if (typeof body !== 'string') {
        return null
      }
      try {
        const parsed: unknown = JSON.parse(body)
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null
      } catch {
        return null
      }
    }

    const stubAttachmentSendRoutes = (
      sendReplies: Array<{ status: number; body: unknown }>
    ): { routes: string[]; uploadedBytes: Uint8Array[]; sentBodies: Record<string, unknown>[] } => {
      const routes: string[] = []
      const uploadedBytes: Uint8Array[] = []
      const sentBodies: Record<string, unknown>[] = []
      let uploaded = false
      const remainingSendReplies = [...sendReplies]

      fetch.mockImplementation(
        async (url: string, options: { method: string; headers?: Record<string, string>; body?: BodyInit | null }) => {
          const headers = Object.fromEntries(
            Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
          )
          const parsedUrl = new URL(url)

          if (options.method === 'POST' && parsedUrl.pathname === '/api/messaging/attachments/uploads/') {
            if (url !== UPLOADS_URL || headers.authorization !== `Bearer ${SECRET_KEY}`) {
              return fakeReply(401, {
                type: 'authentication_error',
                code: 'authentication_failed',
                detail: 'Bad auth.',
              })
            }
            if (!isJsonContentType(headers['content-type'])) {
              return fakeReply(415, {
                type: 'invalid_request',
                code: 'unsupported_media_type',
                detail: 'Expected application/json Content-Type.',
              })
            }
            const payload = parseJsonObject(options.body)
            const files = payload?.files
            const grantItem = Array.isArray(files) && files.length === 1 ? files[0] : null
            const validGrant =
              payload !== null &&
              Object.keys(payload).length === 1 &&
              grantItem !== null &&
              typeof grantItem === 'object' &&
              !Array.isArray(grantItem) &&
              Object.keys(grantItem).sort().join(',') === 'sha256,size' &&
              grantItem.sha256 === HELLO_SHA256 &&
              grantItem.size === HELLO_BYTES.byteLength
            if (!validGrant) {
              return fakeReply(400, { type: 'validation_error', code: 'invalid_input', detail: 'Bad upload grant.' })
            }
            routes.push('uploads')
            return fakeReply(200, {
              files: [
                {
                  sha256: HELLO_SHA256,
                  status: 'upload',
                  url: STORAGE_UPLOAD_URL,
                  method: 'PUT',
                  headers: {
                    'Content-Length': String(HELLO_BYTES.byteLength),
                    'x-amz-checksum-sha256': HELLO_CHECKSUM,
                  },
                  url_expires_at: '2026-11-30T00:00:00Z',
                },
              ],
            })
          }

          if (options.method === 'PUT' && url === STORAGE_UPLOAD_URL) {
            if ('authorization' in headers) {
              return fakeReply(400, {
                code: 'InvalidArgument',
                message: 'Authorization header not allowed on storage PUT.',
              })
            }
            const putBytes =
              options.body !== undefined && options.body !== null
                ? new Uint8Array(await new Response(options.body).arrayBuffer())
                : null
            if (
              headers['content-length'] !== String(HELLO_BYTES.byteLength) ||
              headers['x-amz-checksum-sha256'] !== HELLO_CHECKSUM ||
              putBytes === null ||
              !sameBytes(putBytes, HELLO_BYTES)
            ) {
              return fakeReply(400, { code: 'BadDigest', message: 'Storage PUT bytes or headers mismatch.' })
            }
            routes.push('put')
            uploadedBytes.push(putBytes)
            uploaded = true
            return fakeReply(200, {})
          }

          if (options.method === 'POST' && parsedUrl.pathname === '/api/messaging/send/email/') {
            if (url !== SEND_URL || headers.authorization !== `Bearer ${SECRET_KEY}`) {
              return fakeReply(401, {
                type: 'authentication_error',
                code: 'authentication_failed',
                detail: 'Bad auth.',
              })
            }
            if (!isJsonContentType(headers['content-type'])) {
              return fakeReply(415, {
                type: 'invalid_request',
                code: 'unsupported_media_type',
                detail: 'Expected application/json Content-Type.',
              })
            }
            if (!headers['idempotency-key']?.trim()) {
              return fakeReply(400, {
                type: 'invalid_request',
                code: 'invalid_idempotency_key',
                detail: 'Idempotency-Key header is required.',
              })
            }
            const parsedBody = parseJsonObject(options.body)
            if (!uploaded || parsedBody === null) {
              return fakeReply(400, {
                type: 'invalid_request',
                code: 'attachment_not_uploaded',
                detail: 'Upload before send.',
              })
            }
            routes.push('send')
            sentBodies.push(parsedBody)
            const next = remainingSendReplies.shift()
            if (!next) {
              return fakeReply(404, { type: 'invalid_request', code: 'not_found', detail: 'No send reply left.' })
            }
            return fakeReply(next.status, next.body)
          }

          return fakeReply(404, {
            type: 'invalid_request',
            code: 'not_found',
            detail: `Unexpected route ${options.method} ${url}`,
          })
        }
      )

      return { routes, uploadedBytes, sentBodies }
    }

    const sendIn = (
      category?: typeof TRANSACTIONAL_EMAIL_CATEGORY | MessageCategory,
      overrides: Record<string, unknown> = {}
    ): ReturnType<PostHog['emails']['send']> =>
      posthog.emails.send({ ...CODE_SEND, ...overrides, category } as SendEmailOptions)

    const sendUnchecked = (send: Record<string, unknown>): ReturnType<PostHog['emails']['send']> =>
      posthog.emails.send(send as unknown as SendEmailOptions)

    const postedSend = (
      callIndex = 0
    ): { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> } => {
      const [url, options] = fetch.mock.calls[callIndex]
      const headers = Object.fromEntries(
        Object.entries((options.headers ?? {}) as Record<string, string>).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ])
      )
      return {
        url,
        method: options.method,
        headers,
        body: JSON.parse(options.body),
      }
    }

    it.each([
      ['omitted category', undefined, undefined],
      ['the built-in transactional category', TRANSACTIONAL_EMAIL_CATEGORY, 'transactional'],
      [
        'a marketing category with description',
        NEWSLETTER,
        { key: 'newsletter', type: 'marketing', name: 'Newsletter', description: 'Monthly product news' },
      ],
      [
        'a transactional category without description',
        { key: 'receipts', type: 'transactional' as const, name: 'Receipts' },
        { key: 'receipts', type: 'transactional', name: 'Receipts' },
      ],
      [
        'a marketing category with an empty description',
        { key: 'newsletter', type: 'marketing' as const, name: 'Newsletter', description: '' },
        { key: 'newsletter', type: 'marketing', name: 'Newsletter', description: '' },
      ],
    ])('serializes %s on the send route', async (_label, category, expectedCategory) => {
      replies = [accepted()]

      const { data, error } = await sendIn(category)

      expect(error).toBeNull()
      expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(fetch).toHaveBeenCalledTimes(1)
      const request = postedSend()
      expect(request.url).toBe(SEND_URL)
      expect(request.method).toBe('POST')
      expect(request.headers.authorization).toBe(`Bearer ${SECRET_KEY}`)
      expect(request.body).toEqual({
        to: CODE_SEND.to,
        template_key: CODE_SEND.templateKey,
        subject: CODE_SEND.subject,
        html: CODE_SEND.html,
        ...(expectedCategory !== undefined && { category: expectedCategory }),
      })
      expect('category' in request.body).toBe(expectedCategory !== undefined)
      if (typeof expectedCategory === 'object') {
        expect('description' in (request.body.category as object)).toBe('description' in expectedCategory)
      }
    })

    it('sends a categorized email with attachments and preserves exact outbound fields', async () => {
      const boundary = stubAttachmentSendRoutes([{ status: 202, body: { message_id: 'msg_1', replayed: false } }])

      const { data, error } = await sendIn(NEWSLETTER, {
        attachments: [{ filename: 'guide.txt', content: utf8('hello') }],
      })

      expect(error).toBeNull()
      expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(boundary.routes).toEqual(['uploads', 'put', 'send'])
      expect(boundary.uploadedBytes).toEqual([HELLO_BYTES])
      expect(boundary.sentBodies).toEqual([
        {
          to: CODE_SEND.to,
          template_key: CODE_SEND.templateKey,
          subject: CODE_SEND.subject,
          html: CODE_SEND.html,
          category: NEWSLETTER,
          attachments: [{ sha256: HELLO_SHA256, filename: 'guide.txt' }],
        },
      ])
    })

    it('copies category fields from getters and drops extra properties', async () => {
      replies = [accepted()]
      class NewsletterCategory implements MessageCategory {
        readonly type = 'marketing'
        readonly extra = 'ignored'
        get key(): string {
          return 'newsletter'
        }
        get name(): string {
          return 'Newsletter'
        }
      }

      const { data, error } = await sendIn(new NewsletterCategory())

      expect(error).toBeNull()
      expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(postedSend().body.category).toEqual({ key: 'newsletter', type: 'marketing', name: 'Newsletter' })
    })

    it('sends the category type it checked when a getter changes its answer', async () => {
      replies = [accepted()]
      let typeReads = 0
      const shiftingCategory: MessageCategory = {
        key: 'newsletter',
        name: 'Newsletter',
        get type(): MessageCategory['type'] {
          typeReads += 1
          return typeReads === 1 ? 'marketing' : 'transactional'
        },
      }

      const { error } = await sendIn(shiftingCategory)

      expect(error).toBeNull()
      expect(postedSend().body.category).toEqual({ key: 'newsletter', type: 'marketing', name: 'Newsletter' })
    })

    it('reads an enumerable category getter once on send options instead of dropping it on a second read', async () => {
      replies = [accepted()]
      const queued: Array<MessageCategory | undefined> = [NEWSLETTER]
      const options: SendEmailOptions = {
        ...CODE_SEND,
        get category(): MessageCategory | undefined {
          return queued.shift()
        },
      }

      const { error } = await posthog.emails.send(options)

      expect(error).toBeNull()
      expect(postedSend().body.category).toEqual(NEWSLETTER)
    })

    it('ignores an inherited subject on a category-free template send as before', async () => {
      replies = [accepted()]
      const proto = { subject: 'Inherited subject' }
      const options = Object.assign(Object.create(proto), {
        to: 'reader@example.com',
        templateId: TEMPLATE_ID,
      })

      const { data, error } = await sendUnchecked(options)

      expect(error).toBeNull()
      expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(fetch).toHaveBeenCalledTimes(1)
      const request = postedSend()
      expect(request.url).toBe(SEND_URL)
      expect(request.method).toBe('POST')
      expect(request.body).toEqual({
        to: 'reader@example.com',
        template_id: TEMPLATE_ID,
        message_data: {},
      })
    })

    it('ignores a non-enumerable templateData on a category-free code send as before', async () => {
      replies = [accepted()]
      const options: Record<string, unknown> = { ...CODE_SEND }
      Object.defineProperty(options, 'templateData', {
        value: { name: 'Ada' },
        enumerable: false,
      })

      const { data, error } = await sendUnchecked(options)

      expect(error).toBeNull()
      expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(fetch).toHaveBeenCalledTimes(1)
      const request = postedSend()
      expect(request.url).toBe(SEND_URL)
      expect(request.method).toBe('POST')
      expect(request.body).toEqual({
        to: CODE_SEND.to,
        template_key: CODE_SEND.templateKey,
        subject: CODE_SEND.subject,
        html: CODE_SEND.html,
      })
    })

    it('refuses a template send whose enumerable subject getter makes html enumerable', async () => {
      replies = [accepted()]
      const options: Record<string, unknown> = {
        to: 'reader@example.com',
        templateId: TEMPLATE_ID,
      }
      Object.defineProperty(options, 'subject', {
        enumerable: true,
        get() {
          Object.defineProperty(options, 'html', { enumerable: true })
          return undefined
        },
      })
      Object.defineProperty(options, 'html', {
        value: '<p>Sneaky</p>',
        enumerable: false,
        configurable: true,
      })

      const { data, error } = await sendUnchecked(options)

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_form', name: 'validation_error', field: 'html' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('does not read category on a valid template send wrapped in a Proxy when category is absent', async () => {
      replies = [accepted()]
      const options = new Proxy<Record<string, unknown>>(
        {
          to: 'reader@example.com',
          templateId: TEMPLATE_ID,
        },
        {
          get(target, prop, receiver) {
            if (prop === 'category') {
              throw new Error('category should not be read when absent')
            }
            return Reflect.get(target, prop, receiver)
          },
        }
      )

      const { data, error } = await sendUnchecked(options)

      expect(error).toBeNull()
      expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(fetch).toHaveBeenCalledTimes(1)
      const request = postedSend()
      expect(request.url).toBe(SEND_URL)
      expect(request.method).toBe('POST')
      expect(request.body).toEqual({
        to: 'reader@example.com',
        template_id: TEMPLATE_ID,
        message_data: {},
      })
    })

    it('refuses a code send whose enumerable from getter makes templateData enumerable', async () => {
      replies = [accepted()]
      const options: Record<string, unknown> = { ...CODE_SEND }
      Object.defineProperty(options, 'from', {
        enumerable: true,
        get() {
          Object.defineProperty(options, 'templateData', { enumerable: true })
          return 'Sender <sender@example.com>'
        },
      })
      Object.defineProperty(options, 'templateData', {
        value: { name: 'Ada' },
        enumerable: false,
        configurable: true,
      })

      const { data, error } = await sendUnchecked(options)

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_form', name: 'validation_error', field: 'templateData' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('does not invoke the Proxy has trap for category on a valid template send', async () => {
      replies = [accepted()]
      const options = new Proxy<Record<string, unknown>>(
        {
          to: 'reader@example.com',
          templateId: TEMPLATE_ID,
        },
        {
          has(target, prop) {
            if (prop === 'category') {
              throw new Error('category membership should not be probed on templateId sends')
            }
            return Reflect.has(target, prop)
          },
        }
      )

      const { data, error } = await sendUnchecked(options)

      expect(error).toBeNull()
      expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(fetch).toHaveBeenCalledTimes(1)
      const request = postedSend()
      expect(request.url).toBe(SEND_URL)
      expect(request.method).toBe('POST')
      expect(request.body).toEqual({
        to: 'reader@example.com',
        template_id: TEMPLATE_ID,
        message_data: {},
      })
    })

    it('snapshots own enumerable send options once in property order when category and from use getters', async () => {
      replies = [accepted()]
      let resolvedCategory: typeof TRANSACTIONAL_EMAIL_CATEGORY | MessageCategory = TRANSACTIONAL_EMAIL_CATEGORY
      const fromAnswers = ['Sender <sender@example.com>', 'Other <other@example.com>']
      const options: Record<string, unknown> = { ...CODE_SEND }
      Object.defineProperty(options, 'category', {
        enumerable: true,
        get() {
          return resolvedCategory
        },
      })
      Object.defineProperty(options, 'from', {
        enumerable: true,
        get() {
          resolvedCategory = NEWSLETTER
          return fromAnswers.shift()
        },
      })

      const first = await sendUnchecked(options)

      expect(first.error).toBeNull()
      expect(first.data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(postedSend(0).body).toMatchObject({
        from: 'Sender <sender@example.com>',
        category: TRANSACTIONAL_EMAIL_CATEGORY,
      })

      replies = [accepted()]
      let categoryAfterFrom: typeof TRANSACTIONAL_EMAIL_CATEGORY | MessageCategory = TRANSACTIONAL_EMAIL_CATEGORY
      let categoryRead = false
      const reversed: Record<string, unknown> = { ...CODE_SEND }
      Object.defineProperty(reversed, 'from', {
        enumerable: true,
        get() {
          categoryAfterFrom = NEWSLETTER
          return 'Sender <sender@example.com>'
        },
      })
      Object.defineProperty(reversed, 'category', {
        enumerable: true,
        get() {
          if (categoryRead) {
            return TRANSACTIONAL_EMAIL_CATEGORY
          }
          categoryRead = true
          return categoryAfterFrom
        },
      })

      const second = await sendUnchecked(reversed)

      expect(second.error).toBeNull()
      expect(second.data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(postedSend(1).body).toMatchObject({
        from: 'Sender <sender@example.com>',
        category: NEWSLETTER,
      })
    })

    it('preserves category from a class getter or non-enumerable property on a code send', async () => {
      replies = [accepted(), accepted()]

      let classCategoryRead = false
      class ClassCategorySend {
        readonly to = CODE_SEND.to
        readonly templateKey = CODE_SEND.templateKey
        readonly subject = CODE_SEND.subject
        readonly html = CODE_SEND.html

        get category(): typeof TRANSACTIONAL_EMAIL_CATEGORY | MessageCategory {
          if (classCategoryRead) {
            return TRANSACTIONAL_EMAIL_CATEGORY
          }
          classCategoryRead = true
          return NEWSLETTER
        }
      }

      const fromClass = await posthog.emails.send(new ClassCategorySend())

      expect(fromClass.error).toBeNull()
      expect(fromClass.data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(postedSend(0).body).toMatchObject({
        to: CODE_SEND.to,
        template_key: CODE_SEND.templateKey,
        category: NEWSLETTER,
      })

      const nonEnumerable: Record<string, unknown> = { ...CODE_SEND }
      Object.defineProperty(nonEnumerable, 'category', {
        value: NEWSLETTER,
        enumerable: false,
      })

      const fromNonEnumerable = await sendUnchecked(nonEnumerable)

      expect(fromNonEnumerable.error).toBeNull()
      expect(fromNonEnumerable.data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(postedSend(1).body).toMatchObject({
        to: CODE_SEND.to,
        template_key: CODE_SEND.templateKey,
        category: NEWSLETTER,
      })
    })

    it('preserves class-backed idempotencyKey and templateData across repeated template sends', async () => {
      replies = [accepted(), { status: 202, body: { message_id: 'msg_1', replayed: true } }]

      class ClassTemplateSend {
        readonly to = 'reader@example.com'
        readonly templateId = TEMPLATE_ID

        get idempotencyKey(): string {
          return 'idem-class-template-1'
        }

        get templateData(): Record<string, unknown> {
          return { name: 'Ada' }
        }
      }

      const first = await posthog.emails.send(new ClassTemplateSend())
      const second = await posthog.emails.send(new ClassTemplateSend())

      expect(first.error).toBeNull()
      expect(first.data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(second.error).toBeNull()
      expect(second.data).toEqual({ id: 'msg_1', replayed: true, warnings: [] })
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(postedSend(0).headers['idempotency-key']).toBe('idem-class-template-1')
      expect(postedSend(1).headers['idempotency-key']).toBe('idem-class-template-1')
      expect(postedSend(0).body).toEqual({
        to: 'reader@example.com',
        template_id: TEMPLATE_ID,
        message_data: { name: 'Ada' },
      })
      expect(postedSend(1).body).toEqual({
        to: 'reader@example.com',
        template_id: TEMPLATE_ID,
        message_data: { name: 'Ada' },
      })
    })

    it('copies category before normalizing cc so a mutating cc proxy cannot downgrade marketing to transactional', async () => {
      replies = [accepted()]
      const mutableCategory: { key: string; type: 'marketing' | 'transactional'; name: string } = {
        key: 'newsletter',
        type: 'marketing',
        name: 'Newsletter',
      }
      const mutatingCc = new Proxy<string[]>([], {
        get(target, prop, receiver) {
          if (prop === 'length') {
            mutableCategory.type = 'transactional'
          }
          return Reflect.get(target, prop, receiver)
        },
      })

      const { data, error } = await sendUnchecked({
        ...CODE_SEND,
        cc: mutatingCc,
        category: mutableCategory,
      })

      expect(error).toBeNull()
      expect(data).toEqual({ id: 'msg_1', replayed: false, warnings: [] })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(postedSend().body.category).toEqual({
        key: 'newsletter',
        type: 'marketing',
        name: 'Newsletter',
      })
    })

    it.each([
      ['a category key as a bare string', 'newsletter'],
      ['null', null],
      ['a category without a name', { key: 'newsletter', type: 'marketing' }],
      ['a category with a key that is not a string', { ...NEWSLETTER, key: 7 }],
      ['a category of a type PostHog does not have', { ...NEWSLETTER, type: 'promotional' }],
      ['a category with a description that is not a string', { ...NEWSLETTER, description: ['Monthly'] }],
    ])('refuses %s as the category and sends nothing', async (_name, category) => {
      const { data, error } = await sendUnchecked({ ...CODE_SEND, category })

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_category', name: 'validation_error', field: 'category' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('refuses a category on the template form and sends nothing', async () => {
      const { data, error } = await sendUnchecked({
        to: 'reader@example.com',
        templateId: TEMPLATE_ID,
        category: TRANSACTIONAL_EMAIL_CATEGORY,
      })

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_form', name: 'validation_error', field: 'category' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      ['category_mismatch', 400, 'category', NEWSLETTER, {}],
      ['marketing_template', 400, null, undefined, { templateKey: 'marketing-tpl' }],
      ['categories_not_enabled', 400, 'category', NEWSLETTER, {}],
      ['too_many_categories', 400, 'category', NEWSLETTER, {}],
      ['unsubscribe_link_required', 400, null, NEWSLETTER, { html: '<p>Hi</p>' }],
      ['copies_not_allowed', 400, null, NEWSLETTER, { cc: 'copy@example.com', bcc: ['hidden@example.com'] }],
      ['sandbox_fields_unsupported', 400, 'cc', RECEIPTS, { cc: ['copy@example.com'] }],
      ['recipient_opted_out', 422, null, NEWSLETTER, {}],
    ])(
      'surfaces server %s (%i) refusal as validation_error without retrying',
      async (code, status, attr, category, overrides) => {
        replies = [
          {
            status,
            body: { type: 'invalid_request', code, detail: 'Refused.', attr },
          },
          accepted(),
        ]

        const { data, error } = await settle(sendIn(category, { ...overrides, maxRetries: 2 }))

        expect(data).toBeNull()
        expect(error).toMatchObject({ code, name: 'validation_error', statusCode: status })
        expect(error?.field).toBe(attr ?? undefined)
        expect(fetch).toHaveBeenCalledTimes(1)
        const request = postedSend()
        expect(request.url).toBe(SEND_URL)
        expect(request.method).toBe('POST')
        expect(request.body).toMatchObject({
          to: CODE_SEND.to,
          template_key: 'templateKey' in overrides ? overrides.templateKey : CODE_SEND.templateKey,
          subject: CODE_SEND.subject,
          html: 'html' in overrides ? overrides.html : CODE_SEND.html,
        })
        expect('category' in request.body).toBe(category !== undefined)
        if (category !== undefined) {
          expect(request.body.category).toEqual(category)
        }
        if ('cc' in overrides) {
          expect(request.body.cc).toEqual(['copy@example.com'])
        }
        if ('bcc' in overrides) {
          expect(request.body.bcc).toEqual(['hidden@example.com'])
        }
      }
    )

    it('surfaces server workflow_can_wait (400) refusal on categorized send with attachments without retrying', async () => {
      const boundary = stubAttachmentSendRoutes([
        {
          status: 400,
          body: {
            type: 'invalid_request',
            code: 'workflow_can_wait',
            detail: 'Workflow can wait.',
            attr: 'attachments',
          },
        },
        { status: 202, body: { message_id: 'msg_unexpected_retry', replayed: false } },
      ])

      const { data, error } = await settle(
        sendIn(NEWSLETTER, {
          attachments: [{ filename: 'guide.txt', content: utf8('hello') }],
          maxRetries: 2,
        })
      )

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'workflow_can_wait',
        name: 'validation_error',
        statusCode: 400,
        field: 'attachments',
      })
      expect(boundary.routes).toEqual(['uploads', 'put', 'send'])
      expect(boundary.uploadedBytes).toEqual([HELLO_BYTES])
      expect(boundary.sentBodies).toEqual([
        {
          to: CODE_SEND.to,
          template_key: CODE_SEND.templateKey,
          subject: CODE_SEND.subject,
          html: CODE_SEND.html,
          category: NEWSLETTER,
          attachments: [{ sha256: HELLO_SHA256, filename: 'guide.txt' }],
        },
      ])
    })

    it.each([
      [
        'mixed-version old CDP',
        NEWSLETTER,
        {
          type: 'invalid_request',
          code: 'field_not_accepted',
          detail: "PostHog doesn't take this field yet, so it didn't send the email.",
          attr: 'category',
          fix: 'Wait until PostHog accepts `category`, then send the email again.',
        },
        'Wait until PostHog accepts `category`, then send the email again.',
      ],
      [
        'pre-category Django',
        TRANSACTIONAL_EMAIL_CATEGORY,
        {
          type: 'validation_error',
          code: 'invalid',
          detail: 'Unknown field category.',
          attr: 'category',
        },
        undefined,
      ],
    ])(
      'returns an older-server refusal from %s on category without retrying or stripping category',
      async (_server, category, body, expectedFix) => {
        replies = [{ status: 400, body }, accepted()]

        const { data, error } = await settle(sendIn(category, { maxRetries: 2 }))

        expect(data).toBeNull()
        expect(error).toMatchObject({
          code: body.code,
          name: 'validation_error',
          statusCode: 400,
          field: 'category',
        })
        expect(error?.fix).toBe(expectedFix)
        expect(fetch).toHaveBeenCalledTimes(1)
        const request = postedSend()
        expect(request.url).toBe(SEND_URL)
        expect(request.body.category).toEqual(category)
      }
    )
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
