import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createElement, type ReactElement, Suspense, use } from 'react'

import {
  type BatchEmailResponse,
  EmailError,
  PostHog,
  PostHogOptions,
  SendEmailOptions,
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

  describe('scheduled sends', () => {
    const NOW = new Date('2026-11-22T10:00:00Z')

    beforeEach(() => {
      vi.setSystemTime(NOW)
    })

    it('schedules an email for a later time, and returns the time PostHog confirmed', async () => {
      const postHog = againstPostHog()

      const { data, error } = await settle(
        posthog.emails.send({ ...RECEIPT, scheduledAt: new Date('2026-11-23T09:00:00Z') })
      )

      expect(error).toBeNull()
      expect(data).toEqual({
        id: postHog.emails[0].id,
        replayed: false,
        warnings: [],
        scheduledAt: '2026-11-23T09:00:00.000Z',
      })
      expect(postHog.emails).toMatchObject([{ to: RECEIPT.to, scheduledAt: '2026-11-23T09:00:00.000Z' }])
    })

    it('reads a time in any offset, and rounds a finer time up to the next millisecond', async () => {
      const postHog = againstPostHog()

      const { data } = await settle(send({ scheduledAt: '2026-11-23T11:00:00.123456+02:00' }))

      expect(postHog.emails).toMatchObject([{ templateId: TEMPLATE_ID, scheduledAt: '2026-11-23T09:00:00.124Z' }])
      expect(data?.scheduledAt).toBe('2026-11-23T09:00:00.124Z')
    })

    it('asks for the same time on every retry, so a lost answer replays the first send', async () => {
      const postHog = againstPostHog()
      postHog.failNext('send', 'lost reply')

      const { data } = await settle(send({ scheduledAt: '2026-11-23T09:00:00.000000001Z' }))

      expect(postHog.emails).toHaveLength(1)
      expect(data).toMatchObject({ replayed: true, scheduledAt: '2026-11-23T09:00:00.001Z' })
    })

    it('accepts a time that had passed, which PostHog sends now', async () => {
      const postHog = againstPostHog()

      const { data, error } = await settle(send({ scheduledAt: '2026-11-22T09:59:59Z' }))

      expect(error).toBeNull()
      expect(data?.scheduledAt).toBeNull()
      expect(postHog.emails).toHaveLength(1)
      expect(postHog.emails[0].scheduledAt).toBeUndefined()
    })

    it.each([
      [
        'is lost and replayed on a retry',
        (postHog: FakePostHog): void => {
          postHog.failNext('send', 'lost reply')
          makeClient({ fetch: postHog.fetch })
        },
      ],
      [
        'arrives two seconds late',
        (postHog: FakePostHog): void => {
          makeClient({
            fetch: async (url, options) => {
              const reply = await postHog.fetch(url, options)
              vi.setSystemTime(Date.now() + 2000)
              return reply
            },
          })
        },
      ],
    ])('reports an email PostHog queued now over a minute early, even when its answer %s', async (_name, connect) => {
      const postHog = new FakePostHog({ secretKey: SECRET_KEY, queuesScheduledSendsNow: true })
      connect(postHog)

      const { data, error } = await settle(send({ scheduledAt: '2026-11-22T10:01:00.001Z' }))

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'schedule_not_confirmed', messageId: postHog.emails[0].id })
      expect(postHog.emails).toHaveLength(1)
    })

    it('counts the minute from the first attempt when a refused first attempt is retried', async () => {
      const postHog = new FakePostHog({ secretKey: SECRET_KEY, queuesScheduledSendsNow: true })
      postHog.failNext('send', { status: 429, code: 'throttled' })
      const sentAt: number[] = []
      makeClient({
        fetch: async (url, options) => {
          sentAt.push(Date.now())
          const reply = await postHog.fetch(url, options)
          if (sentAt.length === 1) {
            vi.setSystemTime(Date.now() + 5000)
          }
          return reply
        },
      })
      const scheduledAt = new Date(NOW.getTime() + 62_000)

      const { data, error } = await settle(send({ scheduledAt }))

      expect(sentAt).toHaveLength(2)
      expect(sentAt[0]).toBe(NOW.getTime())
      expect(scheduledAt.getTime() - sentAt[1]).toBeLessThan(60_000)
      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'schedule_not_confirmed', messageId: postHog.emails[0].id })
      expect(postHog.emails).toHaveLength(1)
    })

    it('accepts PostHog sending now a time at most a minute ahead, since its clock may run ahead of ours', async () => {
      const postHog = againstPostHog({ queuesScheduledSendsNow: true })

      const { data, error } = await settle(send({ scheduledAt: '2026-11-22T10:01:00Z' }))

      expect(error).toBeNull()
      expect(data?.scheduledAt).toBeNull()
      expect(postHog.emails).toHaveLength(1)
    })

    it('leaves scheduledAt out of the result of a send without it', async () => {
      againstPostHog()

      const { data } = await settle(send())

      expect(data).not.toHaveProperty('scheduledAt')
    })

    it.each([
      ['a time without an offset', '2026-11-23T09:00:00'],
      ['a date without a time', '2026-11-23'],
      ['a day the month does not have', '2026-02-30T09:00:00Z'],
      ['hour 24', '2026-11-23T24:00:00Z'],
      ['an offset past 59 minutes', '2026-11-23T09:00:00+01:60'],
      ['words', 'tomorrow at 9'],
      ['an invalid Date', new Date(Number.NaN)],
      ['a number', 1795597200000],
    ])('refuses %s before any request', async (_name, scheduledAt) => {
      const postHog = againstPostHog()

      const { error } = await settle(send({ scheduledAt }))

      expect(error).toMatchObject({ code: 'invalid_scheduled_at', name: 'validation_error', field: 'scheduledAt' })
      expect(postHog.emails).toEqual([])
    })

    it.each([
      [
        'a custom host',
        { host: 'https://ph.example.com', appHost: 'https://ph.example.com' },
        'https://ph.example.com',
      ],
      ['a custom host without an app host', { host: 'https://ph.example.com' }, 'https://ph.example.com'],
    ])('schedules only on PostHog Cloud, so it sends nothing to %s and names it', async (_name, hosts, named) => {
      makeClient(hosts)

      const { error } = await settle(send({ scheduledAt: '2026-11-23T09:00:00Z' }))

      expect(error).toMatchObject({ code: 'scheduling_requires_cloud', field: 'scheduledAt' })
      expect(error?.message).toContain(named)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('schedules on PostHog Cloud EU', async () => {
      const postHog = new FakePostHog({ secretKey: SECRET_KEY, appHost: 'https://eu.posthog.com' })
      makeClient({ host: 'https://eu.i.posthog.com', fetch: postHog.fetch })

      const { data } = await settle(send({ scheduledAt: '2026-11-23T09:00:00Z' }))

      expect(data?.scheduledAt).toBe('2026-11-23T09:00:00.000Z')
    })

    it.each([
      ['leaves the time out of its answer', { answersSchedule: false }, '2026-11-23T09:00:00Z'],
      ['schedules it for another time', { scheduleShiftMs: 1 }, '2026-11-23T09:00:00Z'],
      ['queues it now, a day early', { queuesScheduledSendsNow: true }, '2026-11-23T09:00:00Z'],
      ['queues it now, just over a minute early', { queuesScheduledSendsNow: true }, '2026-11-22T10:01:00.001Z'],
    ])('reports an email PostHog accepted but %s, with its message ID', async (_name, server, scheduledAt) => {
      const postHog = againstPostHog(server)

      const { data, error } = await settle(send({ scheduledAt }))

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'schedule_not_confirmed', messageId: postHog.emails[0].id })
      expect(postHog.emails).toHaveLength(1)
    })

    it.each([
      [
        'with your idempotencyKey, to send it again with that key',
        { idempotencyKey: 'trial-end:user_1' },
        /again with the same idempotencyKey/,
      ],
      [
        'without an idempotencyKey, not to send it again',
        {},
        /Don't send it again: the client chose this send's idempotencyKey/,
      ],
    ])('tells a caller of an unconfirmed schedule %s', async (_name, key, fix) => {
      againstPostHog({ answersSchedule: false })

      const { error } = await settle(send({ scheduledAt: '2026-11-23T09:00:00Z', ...key }))

      expect(error?.fix).toMatch(fix)
    })

    it.each([
      [
        'a PostHog that refuses scheduledAt',
        { fieldsNotTaken: ['scheduled_at'] },
        '2026-11-23T09:00:00Z',
        'field_not_accepted',
      ],
      ['a time more than 7 days away', {}, '2026-11-29T10:00:00.001Z', 'scheduled_too_far'],
    ])('returns the refusal from %s, and never sends now instead', async (_name, server, scheduledAt, code) => {
      const postHog = againstPostHog(server)

      const { error } = await settle(send({ scheduledAt }))

      expect(error).toMatchObject({ code, statusCode: 400, field: 'scheduled_at' })
      expect(postHog.emails).toEqual([])
    })
  })

  describe('batch', () => {
    const WELCOME = { templateKey: 'welcome', subject: 'Welcome', html: '<p>Hi</p>' }
    const NO_TEMPLATE =
      "PostHog found no template with this ID, or batch sends aren't available for this project, so it sent no email of this request."
    const CHECK_TEMPLATE =
      'Check the templateId. If it is right, send each recipient on its own with emails.send() until batch sends are available for the project.'
    const NO_CODE_BATCHES =
      "Batch sends from code aren't available for this project, so PostHog sent no email of this request."
    const UNCONFIRMED = "PostHog didn't confirm this email, and it may still go out."
    const SEND_EACH =
      'Send each recipient on its own with emails.send() until batch sends are available for the project.'
    const recipientsTo = (count: number): { to: string }[] =>
      Array.from({ length: count }, (_, index) => ({ to: `user${index}@example.com` }))

    it('queues one email per recipient, and returns their results in order', async () => {
      const postHog = againstPostHog()

      const { data, error } = await settle(
        posthog.emails.batch(WELCOME, [
          { to: 'ada@example.com', distinctId: 'ada', idempotencyKey: 'welcome:ada' },
          { to: 'bob@example.com' },
        ])
      )

      expect(error).toBeNull()
      expect(postHog.emails).toMatchObject([
        { to: 'ada@example.com', distinctId: 'ada', subject: 'Welcome' },
        { to: 'bob@example.com', subject: 'Welcome' },
      ])
      expect(data).toEqual({
        results: [
          {
            index: 0,
            to: 'ada@example.com',
            idempotencyKey: 'welcome:ada',
            status: 'queued',
            id: postHog.emails[0].id,
            replayed: false,
          },
          {
            index: 1,
            to: 'bob@example.com',
            idempotencyKey: expect.stringMatching(UUID_V4),
            status: 'queued',
            id: postHog.emails[1].id,
            replayed: false,
          },
        ],
        warnings: [],
      })
    })

    it("merges each recipient's template data over the batch's", async () => {
      const postHog = againstPostHog()

      await settle(
        posthog.emails.batch({ templateId: TEMPLATE_ID, templateData: { plan: 'pro', name: 'there' } }, [
          { to: 'ada@example.com', templateData: { name: 'Ada' } },
        ])
      )

      expect(postHog.emails).toMatchObject([{ templateId: TEMPLATE_ID, messageData: { plan: 'pro', name: 'Ada' } }])
    })

    it('sends 100 recipients in one request, and returns their 100 results in order', async () => {
      const postHog = againstPostHog()

      const { data, error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(100)))

      expect(error).toBeNull()
      expect(postHog.requests.batch).toBe(1)
      expect(data?.results.map(({ index, to, status }) => ({ index, to, status }))).toEqual(
        recipientsTo(100).map(({ to }, index) => ({ index, to, status: 'queued' }))
      )
    })

    it('refuses an array with a missing recipient before any request', async () => {
      const postHog = againstPostHog()
      const recipients: { to: string }[] = new Array(3)
      recipients[0] = { to: 'ada@example.com' }
      recipients[2] = { to: 'bob@example.com' }

      const { data, error } = await settle(posthog.emails.batch(WELCOME, recipients))

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_recipient', field: 'recipients[1]' })
      expect(postHog.requests.batch).toBe(0)
    })

    it('reads the recipients by index up to the length it checked, whatever the array iterates', async () => {
      const postHog = againstPostHog()
      const recipients = [{ to: 'ada@example.com' }]
      Object.defineProperty(recipients, Symbol.iterator, {
        value: function* () {
          yield* recipientsTo(101)
        },
      })

      const { data, error } = await settle(posthog.emails.batch(WELCOME, recipients))

      expect(error).toBeNull()
      expect(data?.results.map(({ to }) => to)).toEqual(['ada@example.com'])
      expect(postHog.emails.map(({ to }) => to)).toEqual(['ada@example.com'])
    })

    it('refuses a missing recipient that the array skips when iterated', async () => {
      const postHog = againstPostHog()
      const recipients: { to: string }[] = new Array(2)
      recipients[0] = { to: 'ada@example.com' }
      Object.defineProperty(recipients, Symbol.iterator, {
        value: function* () {
          yield { to: 'ada@example.com' }
        },
      })

      const { error } = await settle(posthog.emails.batch(WELCOME, recipients))

      expect(error).toMatchObject({ code: 'invalid_recipient', field: 'recipients[1]' })
      expect(postHog.requests.batch).toBe(0)
    })

    it('reads the length of the recipients once, so a changing length cannot pass the cap', async () => {
      const postHog = againstPostHog()
      const lengths = [101, 1]
      const recipients = new Proxy(recipientsTo(101), {
        get: (target, name, receiver) =>
          name === 'length' ? (lengths.shift() ?? target.length) : Reflect.get(target, name, receiver),
      })

      const { error } = await settle(posthog.emails.batch(WELCOME, recipients))

      expect(error).toMatchObject({ code: 'invalid_recipients', field: 'recipients' })
      expect(postHog.requests.batch).toBe(0)
    })

    it('sends every recipient it counted, even when a later read of the length is shorter', async () => {
      const postHog = againstPostHog()
      const lengths = [2, 1]
      const recipients = new Proxy(recipientsTo(2), {
        get: (target, name, receiver) =>
          name === 'length' ? (lengths.shift() ?? 1) : Reflect.get(target, name, receiver),
      })

      const { data, error } = await settle(posthog.emails.batch(WELCOME, recipients))

      expect(error).toBeNull()
      expect(data?.results.map(({ to }) => to)).toEqual(['user0@example.com', 'user1@example.com'])
      expect(postHog.emails.map(({ to }) => to)).toEqual(['user0@example.com', 'user1@example.com'])
      expect(postHog.requests.batch).toBe(1)
    })

    it('refuses a missing recipient that the array inherits a value for', async () => {
      const postHog = againstPostHog()
      const recipients: { to: string }[] = new Array(2)
      recipients[0] = { to: 'ada@example.com' }
      Object.setPrototypeOf(recipients, Object.assign(Object.create(Array.prototype), { 1: { to: 'bob@example.com' } }))

      const { error } = await settle(posthog.emails.batch(WELCOME, recipients))

      expect(error).toMatchObject({ code: 'invalid_recipient', field: 'recipients[1]' })
      expect(postHog.requests.batch).toBe(0)
    })

    it('refuses more than 100 recipients before any request', async () => {
      const postHog = againstPostHog()

      const { data, error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(101)))

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'invalid_recipients',
        name: 'validation_error',
        field: 'recipients',
        fix: expect.stringMatching(/at most 100/),
      })
      expect(error?.results).toBeUndefined()
      expect(postHog.requests.batch).toBe(0)
    })

    it("returns shared content too large for a batch as the 400 error, with PostHog's advice to send it one at a time", async () => {
      const postHog = againstPostHog()

      const { data, error } = await settle(
        posthog.emails.batch(
          { templateId: TEMPLATE_ID, templateData: { note: 'x'.repeat(300 * 1024) } },
          recipientsTo(2)
        )
      )

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'content_too_large',
        statusCode: 400,
        message:
          'The content or `message_data` that a batch sends to every recipient can be at most 256 KiB. Send larger emails one at a time.',
      })
      expect(error?.fix).toBeUndefined()
      expect(error?.results?.map(({ status }) => status)).toEqual(['failed', 'failed'])
      expect(postHog.requests.batch).toBe(1)
      expect(postHog.emails).toEqual([])
    })

    it('returns a request too large for PostHog as the 413 error, with its fix to split the recipients', async () => {
      const postHog = againstPostHog()
      const large = { note: 'x'.repeat(3 * 1024 * 1024) }

      const { data, error } = await settle(
        posthog.emails.batch(
          { templateId: TEMPLATE_ID },
          recipientsTo(2).map((recipient) => ({ ...recipient, templateData: large }))
        )
      )

      expect(data).toBeNull()
      expect(error).toMatchObject({
        code: 'content_too_large',
        statusCode: 413,
        message: "The batch is larger than PostHog can send at once, so PostHog didn't send it.",
        fix: 'Split the recipients into smaller batches.',
      })
      expect(error?.results?.map(({ status }) => status)).toEqual(['failed', 'failed'])
      expect(postHog.requests.batch).toBe(1)
      expect(postHog.emails).toEqual([])
    })

    it("returns each recipient's refusal and the message ID PostHog gave it", async () => {
      const postHog = againstPostHog({ suppressed: ['gone@example.com'] })

      const { data } = await settle(
        posthog.emails.batch(WELCOME, [{ to: 'gone@example.com' }, { to: 'ada@example.com' }])
      )

      expect(data?.results.map(({ status }) => status)).toEqual(['failed', 'queued'])
      expect(data?.results[0]).toMatchObject({
        id: expect.stringMatching(UUID_V4),
        error: { code: 'recipient_suppressed', statusCode: 422 },
      })
      expect(data?.results[0]).toMatchObject({ error: expect.not.objectContaining({ messageId: expect.anything() }) })
      expect(data?.results[0]).not.toMatchObject({ error: { fix: expect.stringMatching(/same idempotencyKey/) } })
      expect(data?.results[1]).not.toHaveProperty('error')
      expect(postHog.emails.map(({ to }) => to)).toEqual(['ada@example.com'])
    })

    it('keeps a recipient PostHog could not confirm unconfirmed, and sends nothing again', async () => {
      const postHog = againstPostHog({ unavailableFor: { 'ada@example.com': 1 } })

      const { data, error } = await settle(
        posthog.emails.batch(WELCOME, [{ to: 'ada@example.com' }, { to: 'bob@example.com' }])
      )

      expect(error).toBeNull()
      expect(data?.results).toMatchObject([
        {
          status: 'unconfirmed',
          id: expect.stringMatching(UUID_V4),
          error: {
            code: 'delivery_unavailable',
            fix: expect.stringMatching(/unchanged and with the same idempotencyKey/),
          },
        },
        { status: 'queued', replayed: false },
      ])
      expect(postHog.requests.batch).toBe(1)
      expect(postHog.emails.map(({ to }) => to)).toEqual(['bob@example.com'])
    })

    it.each([
      [
        'delivery_unavailable without retryable',
        { status: 422, code: 'delivery_unavailable', retryable: false },
        'unconfirmed',
      ],
      ['retryable with another code', { status: 429, code: 'recipient_throttled', retryable: true }, 'unconfirmed'],
      [
        'idempotency_key_in_flight without retryable',
        { status: 409, code: 'idempotency_key_in_flight', retryable: false },
        'unconfirmed',
      ],
      ['a 409 without a code', { status: 409, retryable: false }, 'unconfirmed'],
      ['a 409 with another code', { status: 409, code: 'conflict', retryable: false }, 'unconfirmed'],
      [
        'a 409 idempotency_key_reused',
        { status: 409, code: 'idempotency_key_reused', retryable: false },
        'unconfirmed',
      ],
      [
        'a 409 batch_unavailable marked retryable',
        { status: 409, code: 'batch_unavailable', retryable: true },
        'failed',
      ],
      ['a 503 that is neither', { status: 503, code: 'recipient_rejected', retryable: false }, 'failed'],
    ] as const)(
      'decides a recipient by its code and retryable flag, not its status: %s',
      async (_case, refusal, status) => {
        const postHog = againstPostHog({ refusesRecipient: { 'ada@example.com': refusal } })

        const { data } = await settle(posthog.emails.batch(WELCOME, [{ to: 'ada@example.com' }]))

        expect(data?.results).toMatchObject([{ status, error: { code: refusal.code ?? 'api_error' } }])
        expect(data?.results[0]).toMatchObject(
          status === 'unconfirmed'
            ? {
                error: {
                  message: UNCONFIRMED,
                  fix: expect.stringMatching(/unchanged and with the same idempotencyKey/),
                },
              }
            : { error: expect.not.objectContaining({ fix: expect.stringMatching(/same idempotencyKey/) }) }
        )
        expect(postHog.requests.batch).toBe(1)
      }
    )

    it.each([
      ['conflict', { status: 409, code: 'conflict' }],
      ['api_error', { status: 409, code: 'api_error' }],
      ['no code', { status: 409 }],
    ] as const)(
      'leaves every recipient unconfirmed, with its key, when PostHog answers the whole batch 409 with %s',
      async (_case, fault) => {
        const postHog = againstPostHog()
        postHog.failNext('batch', fault)

        const { error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(2)))

        expect(error?.fix).toMatch(/same email and recipients, unchanged, giving each recipient the idempotencyKey/)
        expect(error?.results).toMatchObject(
          [0, 1].map(() => ({
            status: 'unconfirmed',
            idempotencyKey: expect.any(String),
            error: { message: UNCONFIRMED },
          }))
        )
      }
    )

    it.each([
      ['a 5xx', [{ status: 500 }]],
      ['a lost answer and no retry left', ['lost reply']],
      ['a shutdown after a 503', 'shutdown'],
    ] as const)(
      'never tells an unconfirmed recipient its email was not queued or sent, after %s',
      async (_case, faults) => {
        const postHog = againstPostHog()
        postHog.failNext('batch', ...(faults === 'shutdown' ? [{ status: 503 } as const] : faults))

        const pending = posthog.emails.batch({ ...WELCOME, maxRetries: faults === 'shutdown' ? 2 : 0 }, recipientsTo(2))
        if (faults === 'shutdown') {
          await vi.advanceTimersByTimeAsync(0)
          void posthog.shutdown()
        }
        const { error } = await settle(pending)

        expect(error?.results?.map(({ status }) => status)).toEqual(['unconfirmed', 'unconfirmed'])
        for (const result of error?.results ?? []) {
          expect(result.status === 'unconfirmed' && result.error.message).toBe(UNCONFIRMED)
          expect(result.status === 'unconfirmed' && result.error.message).not.toMatch(
            /not queued|not sent|no email|failed/i
          )
        }
      }
    )

    it.each([
      ['409 conflict', { status: 409, code: 'conflict', message: 'PostHog could not take this batch.' }],
      ['409 api_error', { status: 409, code: 'api_error', message: 'PostHog could not take this batch.' }],
      [
        '409 idempotency_key_in_flight',
        { status: 409, code: 'idempotency_key_in_flight', message: 'PostHog could not take this batch.' },
      ],
    ] as const)(
      "keeps PostHog's message on a first attempt answered %s, and claims no earlier attempt",
      async (_case, fault) => {
        const postHog = againstPostHog()
        postHog.failNext('batch', fault)

        const { error } = await settle(posthog.emails.batch({ ...WELCOME, maxRetries: 0 }, recipientsTo(2)))

        expect(error).toMatchObject({ code: fault.code, statusCode: 409, message: fault.message })
        expect(error?.message).not.toMatch(/retry|earlier attempt|unanswered/i)
        expect(error?.fix).toMatch(/^PostHog may have queued these emails\./)
        expect(error?.results?.map(({ status }) => status)).toEqual(['unconfirmed', 'unconfirmed'])
        expect(postHog.requests.batch).toBe(1)
      }
    )

    it.each([
      ['a 503', { status: 503 }],
      ['a 409 idempotency_key_in_flight', { status: 409, code: 'idempotency_key_in_flight' }],
    ] as const)(
      'says an earlier attempt was not confirmed, not that it went unanswered, when shutdown follows %s',
      async (_case, fault) => {
        const postHog = againstPostHog()
        postHog.failNext('batch', fault)

        const pending = posthog.emails.batch({ ...WELCOME, maxRetries: 2 }, recipientsTo(2))
        await vi.advanceTimersByTimeAsync(0)
        void posthog.shutdown()
        const { error } = await settle(pending)

        expect(error).toMatchObject({ code: 'client_closed' })
        expect(error?.message).toMatch(/An earlier attempt of this batch wasn't confirmed, so PostHog may have queued/)
        expect(error?.message).not.toMatch(/unanswered/i)
        expect(error?.results?.map(({ status }) => status)).toEqual(['unconfirmed', 'unconfirmed'])
        expect(postHog.requests.batch).toBe(1)
      }
    )

    it('keeps recipients unconfirmed when PostHog fails the whole request with a 5xx, and sends nothing again', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', { status: 500 })

      const { data, error } = await settle(
        posthog.emails.batch(WELCOME, [
          { to: 'ada@example.com', idempotencyKey: 'welcome:ada' },
          { to: 'bob@example.com', idempotencyKey: 'welcome:bob' },
        ])
      )

      expect(data).toBeNull()
      expect(error).toMatchObject({ statusCode: 500 })
      expect(error?.results).toMatchObject(
        ['welcome:ada', 'welcome:bob'].map((idempotencyKey) => ({
          status: 'unconfirmed',
          idempotencyKey,
          error: { fix: expect.stringMatching(/unchanged and with the same idempotencyKey/) },
        }))
      )
      expect(postHog.requests.batch).toBe(1)
    })

    it('returns a refused request as the error, with every recipient failed and no retry', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', { status: 429, code: 'quota_limited' })

      const { data, error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(2)))

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'quota_limited', name: 'monthly_quota_exceeded' })
      expect(error?.results?.map(({ status }) => status)).toEqual(['failed', 'failed'])
      expect(error?.results?.[0]).not.toMatchObject({ error: { fix: expect.stringMatching(/same idempotencyKey/) } })
      expect(postHog.requests.batch).toBe(1)
      expect(postHog.batches).toEqual([])
    })

    it('keeps recipients of an unanswered request unconfirmed with their keys, and says to send them again with the same key', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', 'lost reply')

      const { error } = await settle(
        posthog.emails.batch({ ...WELCOME, maxRetries: 0 }, [
          { to: 'ada@example.com', idempotencyKey: 'welcome:ada' },
          { to: 'bob@example.com', idempotencyKey: 'welcome:bob' },
        ])
      )

      expect(error).toMatchObject({ code: 'network_error' })
      expect(error?.results).toMatchObject(
        ['welcome:ada', 'welcome:bob'].map((idempotencyKey) => ({
          status: 'unconfirmed',
          id: null,
          idempotencyKey,
          error: { code: 'network_error', fix: expect.stringMatching(/unchanged and with the same idempotencyKey/) },
        }))
      )
      expect(postHog.requests).toEqual({ uploads: 0, storage: 0, send: 0, batch: 1 })
      expect(postHog.unrouted).toEqual([])
      expect(postHog.emails).toHaveLength(2)
    })

    it.each([
      ['15 seconds by default', {}, 15_000],
      ['the emailRequestTimeoutMs of the client', { emailRequestTimeoutMs: 20_000 }, 20_000],
    ] as const)(
      'gives a batch request %s before it counts as unanswered, as emails.send does',
      async (_case, client, timeoutMs) => {
        const postHog = new FakePostHog({ secretKey: SECRET_KEY })
        makeClient({ fetch: postHog.fetch, ...client })
        postHog.failNext('batch', 'hang')
        let settled = false

        const pending = posthog.emails.batch({ ...WELCOME, maxRetries: 0 }, recipientsTo(1))
        void pending.finally(() => (settled = true))
        await vi.advanceTimersByTimeAsync(timeoutMs - 1)
        const settledBefore = settled
        await vi.advanceTimersByTimeAsync(2)
        const settledAfter = settled
        const { error } = await settle(pending)

        expect([settledBefore, settledAfter]).toEqual([false, true])
        expect(error?.results).toMatchObject([{ status: 'unconfirmed', idempotencyKey: expect.any(String) }])
      }
    )

    it('ends a batch request still waiting when shutdown starts before the shutdown deadline', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', 'hang')
      let settled = false

      const pending = posthog.emails.batch({ ...WELCOME, maxRetries: 0 }, recipientsTo(2))
      void pending.finally(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      const shutdown = posthog.shutdown(30_000)
      await vi.advanceTimersByTimeAsync(29_999)
      const settledBeforeDeadline = settled
      const { error } = await settle(pending)
      await shutdown

      expect(settledBeforeDeadline).toBe(true)
      expect(error?.results?.map(({ status }) => status)).toEqual(['unconfirmed', 'unconfirmed'])
    })

    it('retries a batch attempt that timed out with the same keys, so PostHog queues each email once', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', 'slow reply')

      const { data, error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(2)))

      expect(error).toBeNull()
      expect(data?.results).toMatchObject([
        { status: 'queued', replayed: true },
        { status: 'queued', replayed: true },
      ])
      expect(postHog.requests.batch).toBe(2)
      expect(postHog.emails).toHaveLength(2)
    })

    it('keeps each recipient unconfirmed with its key when every attempt times out, and a resend queues nothing twice', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', 'slow reply', 'slow reply')

      const { error } = await settle(posthog.emails.batch({ ...WELCOME, maxRetries: 1 }, recipientsTo(2)))

      expect(error?.results).toMatchObject(
        [0, 1].map(() => ({
          status: 'unconfirmed',
          idempotencyKey: expect.any(String),
          error: { message: UNCONFIRMED },
        }))
      )
      expect(postHog.emails).toHaveLength(2)

      const again = await settle(
        posthog.emails.batch(
          WELCOME,
          recipientsTo(2).map((recipient, index) => ({
            ...recipient,
            idempotencyKey: error?.results?.[index].idempotencyKey,
          }))
        )
      )

      expect(again.data?.results).toMatchObject([
        { status: 'queued', replayed: true },
        { status: 'queued', replayed: true },
      ])
      expect(postHog.emails).toHaveLength(2)
    })

    it.each([
      [413, 'application_error'],
      [400, 'validation_error'],
    ] as const)('names a too-large batch answered %s as %s, as the other SDKs do', async (status, name) => {
      const postHog = againstPostHog()
      postHog.failNext('batch', { status, code: 'content_too_large' })

      const { error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(1)))

      expect(error).toMatchObject({ code: 'content_too_large', statusCode: status, name })
    })

    it('retries a batch PostHog answered 503 with the same keys, and queues each email once', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', { status: 503 })

      const { data, error } = await settle(
        posthog.emails.batch(WELCOME, [
          { to: 'ada@example.com', idempotencyKey: 'welcome:ada' },
          { to: 'bob@example.com', idempotencyKey: 'welcome:bob' },
        ])
      )

      expect(error).toBeNull()
      expect(data?.results).toMatchObject([
        { status: 'queued', idempotencyKey: 'welcome:ada' },
        { status: 'queued', idempotencyKey: 'welcome:bob' },
      ])
      expect(postHog.requests.batch).toBe(2)
      expect(postHog.emails.map(({ to }) => to)).toEqual(['ada@example.com', 'bob@example.com'])
    })

    it('retries a lost answer with the same keys, so PostHog replays the emails it queued', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', 'lost reply')

      const { data, error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(2)))

      expect(error).toBeNull()
      expect(data?.results).toMatchObject([
        { status: 'queued', replayed: true },
        { status: 'queued', replayed: true },
      ])
      expect(postHog.requests.batch).toBe(2)
      expect(postHog.emails).toHaveLength(2)
    })

    it('sends a batch once with maxRetries: 0', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', { status: 503 })

      const { error } = await settle(posthog.emails.batch({ ...WELCOME, maxRetries: 0 }, recipientsTo(2)))

      expect(error).toMatchObject({ statusCode: 503 })
      expect(postHog.requests.batch).toBe(1)
    })

    it('keeps recipients unconfirmed when PostHog refuses the retry of a lost answer', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', 'lost reply', { status: 429, code: 'quota_limited' })

      const { error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(2)))

      expect(error).toMatchObject({ code: 'quota_limited' })
      expect(error?.results).toMatchObject(
        recipientsTo(2).map(() => ({
          status: 'unconfirmed',
          error: { code: 'quota_limited', fix: expect.stringMatching(/unchanged and with the same idempotencyKey/) },
        }))
      )
      expect(postHog.requests.batch).toBe(2)
    })

    it.each([
      ['refused', { status: 422, code: 'recipient_suppressed', retryable: false }, 'unconfirmed'],
      ['keyed to another email', { status: 422, code: 'idempotency_key_reused', retryable: false }, 'failed'],
      [
        'keyed to another email, as retryable',
        { status: 422, code: 'idempotency_key_reused', retryable: true },
        'failed',
      ],
      [
        'refused with 409 batch_unavailable',
        { status: 409, code: 'batch_unavailable', retryable: false },
        'unconfirmed',
      ],
      [
        'refused with 409 idempotency_key_reused',
        { status: 409, code: 'idempotency_key_reused', retryable: false },
        'unconfirmed',
      ],
    ] as const)('after a lost answer, decides a recipient PostHog %s on the retry', async (_case, refusal, status) => {
      const postHog = againstPostHog({ refusesRecipient: { 'ada@example.com': refusal } })
      postHog.failNext('batch', 'lost reply')

      const { data } = await settle(
        posthog.emails.batch(WELCOME, [{ to: 'ada@example.com' }, { to: 'bob@example.com' }])
      )

      expect(data?.results).toMatchObject([
        { status, error: { code: refusal.code } },
        { status: 'queued', replayed: true },
      ])
      expect(data?.results[0]).toMatchObject(
        status === 'unconfirmed'
          ? { error: { fix: expect.stringMatching(/unchanged and with the same idempotencyKey/) } }
          : { error: expect.not.objectContaining({ fix: expect.stringMatching(/same idempotencyKey/) }) }
      )
      expect(postHog.requests.batch).toBe(2)
    })

    it('tells the caller to resend with the same keys when PostHog refuses the retry of a lost answer', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', 'lost reply', { status: 409, code: 'batch_unavailable' })

      const { error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(2)))

      expect(error).toMatchObject({ code: 'batch_unavailable', statusCode: 409 })
      expect(error?.fix).toMatch(/same email and recipients, unchanged, giving each recipient the idempotencyKey/)
      expect(error?.results?.map(({ status }) => status)).toEqual(['unconfirmed', 'unconfirmed'])
    })

    it.each([
      [
        '400 content_too_large',
        WELCOME,
        { status: 400, code: 'content_too_large', message: 'Send larger emails one at a time.' },
      ],
      ['404 not_found on a code batch', WELCOME, { status: 404, code: 'not_found' }],
      ['404 not_found on a template batch', { templateId: TEMPLATE_ID }, { status: 404, code: 'not_found' }],
      ['409 batch_unavailable', WELCOME, { status: 409, code: 'batch_unavailable' }],
      [
        '409 conflict saying nothing was sent',
        WELCOME,
        { status: 409, code: 'conflict', message: 'PostHog sent no email of this request. Split the batch.' },
      ],
      [
        '409 api_error saying nothing was sent',
        WELCOME,
        { status: 409, code: 'api_error', message: "PostHog didn't send this batch. Send each email on its own." },
      ],
      [
        '413 content_too_large',
        WELCOME,
        {
          status: 413,
          code: 'content_too_large',
          message: "The batch is larger than PostHog can send at once, so PostHog didn't send it.",
        },
      ],
    ] as const)(
      'says some emails may have gone out, and to resend with the same keys, when a lost answer is followed by %s',
      async (_name, email, fault) => {
        const postHog = againstPostHog()
        postHog.failNext('batch', 'lost reply', fault)

        const { error } = await settle(posthog.emails.batch(email, recipientsTo(2)))

        expect(error).toMatchObject({
          code: fault.code,
          statusCode: fault.status,
          message: `PostHog refused the retry of this batch with ${fault.code}, but an earlier attempt of this batch wasn't confirmed, so some of its emails may have gone out. Send the batch again with each recipient's idempotencyKey from error.results, then read each recipient's result.`,
        })
        expect(error?.fix).toMatch(
          /^PostHog may have queued these emails\. Call emails\.batch\(\) again with the same email and recipients, unchanged, giving each recipient the idempotencyKey of its entry in error\.results/
        )
        expect(error?.fix).toMatch(/Then read each recipient's result\.$/)
        for (const text of [error?.message, error?.fix, error?.why]) {
          expect(text ?? '').not.toMatch(/split|smaller|one at a time|on its own|no email|nothing|didn't send|sent no/i)
        }
        expect(error?.results).toMatchObject(
          [0, 1].map(() => ({
            status: 'unconfirmed',
            idempotencyKey: expect.any(String),
            error: {
              message: UNCONFIRMED,
              fix: expect.stringMatching(
                /^PostHog may have queued this email\. Send this recipient again, unchanged and with the same idempotencyKey/
              ),
            },
          }))
        )
        expect(postHog.emails).toHaveLength(2)

        const again = await settle(
          posthog.emails.batch(
            email,
            recipientsTo(2).map((recipient, index) => ({
              ...recipient,
              idempotencyKey: error?.results?.[index].idempotencyKey,
            }))
          )
        )

        expect(again.data?.results).toMatchObject([
          { status: 'queued', replayed: true },
          { status: 'queued', replayed: true },
        ])
        expect(postHog.emails).toHaveLength(2)
      }
    )

    it.each([
      ['the client option', { emailRequestMaxRetries: 0 }, {}, 1],
      ['a batch option', {}, { maxRetries: 1 }, 2],
      ['a batch option over the client option', { emailRequestMaxRetries: 0 }, { maxRetries: 3 }, 4],
    ] as const)(
      'sends a batch PostHog keeps answering 503 as often as %s allows',
      async (_case, client, email, requests) => {
        const postHog = new FakePostHog({ secretKey: SECRET_KEY })
        makeClient({ fetch: postHog.fetch, ...client })
        postHog.failNext('batch', { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 })

        const { error } = await settle(posthog.emails.batch({ ...WELCOME, ...email }, recipientsTo(1)))

        expect(error).toMatchObject({ statusCode: 503 })
        expect(postHog.requests.batch).toBe(requests)
      }
    )

    it('waits for the Retry-After of a throttled batch before it retries', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', { status: 429, code: 'throttled', retryAfter: '5' })

      const pending = posthog.emails.batch(WELCOME, recipientsTo(1))
      await vi.advanceTimersByTimeAsync(4_999)
      expect(postHog.requests.batch).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(postHog.requests.batch).toBe(2)

      expect((await pending).data?.results).toMatchObject([{ status: 'queued' }])
    })

    it('reads maxRetries once, so the value it checked is the one it uses', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', { status: 503 })
      let reads = 0
      const email = Object.defineProperty({ ...WELCOME }, 'maxRetries', {
        enumerable: true,
        get: () => (reads++ === 0 ? 0 : Number.NaN),
      })

      await settle(posthog.emails.batch(email, recipientsTo(1)))

      expect(postHog.requests.batch).toBe(1)
    })

    it.each([
      ['a 503, which PostHog may have queued', { status: 503 }, 'unconfirmed'],
      ['a 429, which PostHog did not queue', { status: 429, code: 'throttled' }, 'failed'],
    ] as const)('sends no retry once the client shuts down after %s', async (_case, fault, status) => {
      const postHog = againstPostHog()
      postHog.failNext('batch', fault)

      const pending = posthog.emails.batch(WELCOME, recipientsTo(2))
      await vi.advanceTimersByTimeAsync(0)
      const shutdown = posthog.shutdown()
      const { error } = await settle(pending)
      await shutdown

      expect(error).toMatchObject({ code: 'client_closed' })
      expect(error?.message).not.toMatch(/refused the retry/)
      expect(postHog.requests.batch).toBe(1)
      expect(error?.results?.map((result) => result.status)).toEqual([status, status])
    })

    const shutDownAfterRetryWait = async (
      microtasks: number
    ): Promise<{ postHog: FakePostHog; fetchedAfterShutdown: boolean[]; response: BatchEmailResponse }> => {
      const postHog = new FakePostHog({ secretKey: SECRET_KEY })
      let shutDown = false
      const fetchedAfterShutdown: boolean[] = []
      makeClient({
        fetch: (url: string, options: Parameters<typeof postHog.fetch>[1]) => {
          fetchedAfterShutdown.push(shutDown)
          return postHog.fetch(url, options)
        },
      })
      postHog.failNext('batch', { status: 503 })

      const pending = posthog.emails.batch(WELCOME, recipientsTo(2))
      await vi.advanceTimersByTimeAsync(0)
      vi.advanceTimersToNextTimer()
      for (let i = 0; i < microtasks; i++) {
        await Promise.resolve()
      }
      shutDown = true
      const shutdown = posthog.shutdown()
      const response = await settle(pending)
      await shutdown
      return { postHog, fetchedAfterShutdown, response }
    }

    it.each([0, 1])(
      'sends no retry when the client shuts down %i microtasks after the retry wait, before its fetch',
      async (microtasks) => {
        const { postHog, fetchedAfterShutdown, response } = await shutDownAfterRetryWait(microtasks)

        expect(response.error).toMatchObject({ code: 'client_closed' })
        expect(fetchedAfterShutdown).toEqual([false])
        expect(postHog.requests.batch).toBe(1)
      }
    )

    it('lets a retry whose fetch already started finish when the client shuts down', async () => {
      const { postHog, fetchedAfterShutdown, response } = await shutDownAfterRetryWait(8)

      expect(response.data?.results.map((result) => result.status)).toEqual(['queued', 'queued'])
      expect(fetchedAfterShutdown).toEqual([false, false])
      expect(postHog.requests.batch).toBe(2)
    })

    it('still sends a batch called just before the client shuts down', async () => {
      const postHog = againstPostHog()

      const pending = posthog.emails.batch(WELCOME, recipientsTo(2))
      const shutdown = posthog.shutdown()
      const { data, error } = await settle(pending)
      await shutdown

      expect(error).toBeNull()
      expect(data?.results.map((result) => result.status)).toEqual(['queued', 'queued'])
      expect(postHog.requests.batch).toBe(1)
    })

    it('ends a batch waiting to retry as soon as the client shuts down, within a short shutdown deadline', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', { status: 503 })
      let settled = false

      const pending = posthog.emails.batch(WELCOME, recipientsTo(2)).finally(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      const shutdown = posthog.shutdown(20)
      await vi.advanceTimersByTimeAsync(20)
      await shutdown

      expect(settled).toBe(true)
      const { error } = await pending
      expect(error).toMatchObject({ code: 'client_closed' })
      expect(error?.results?.map((result) => result.status)).toEqual(['unconfirmed', 'unconfirmed'])
      expect(postHog.requests.batch).toBe(1)
    })

    it('says when batch sends are not on for the project yet, without a retry', async () => {
      const postHog = againstPostHog({ batchUnavailable: true })

      const { error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(1)))

      expect(error).toMatchObject({ code: 'batch_unavailable', statusCode: 409 })
      expect(error?.message).toMatch(/not on for this project/)
      expect(error?.results?.map((result) => result.status)).toEqual(['failed'])
      expect(postHog.requests.batch).toBe(1)
      expect(postHog.emails).toEqual([])
    })

    it('says a templateId PostHog does not have may be wrong, and never to update PostHog', async () => {
      const postHog = againstPostHog({ templateIds: [] })

      const { error } = await settle(posthog.emails.batch({ templateId: TEMPLATE_ID }, recipientsTo(2)))

      expect(error).toMatchObject({ code: 'not_found', statusCode: 404, message: NO_TEMPLATE, fix: CHECK_TEMPLATE })
      expect(error?.results?.map((result) => result.status)).toEqual(['failed', 'failed'])
      expect(postHog.requests.batch).toBe(1)
      expect(postHog.emails).toEqual([])
    })

    it('answers a templateId PostHog does not have with the 404 even where batch sends are off, as PostHog does', async () => {
      againstPostHog({ templateIds: [], batchUnavailable: true })

      const { error } = await settle(posthog.emails.batch({ templateId: TEMPLATE_ID }, recipientsTo(1)))

      expect(error).toMatchObject({ code: 'not_found', statusCode: 404, message: NO_TEMPLATE, fix: CHECK_TEMPLATE })
    })

    it.each([
      ['a server without the batch route', { batchRoute: false }, undefined],
      ['a proxy page', {}, { status: 404, page: '<html>Not Found</html>' }],
    ])('says batch sends from code are not available after a 404 from %s', async (_name, server, fault) => {
      const postHog = againstPostHog(server)
      if (fault) {
        postHog.failNext('batch', fault)
      }

      const { error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(1)))

      expect(error).toMatchObject({ code: 'not_found', statusCode: 404, message: NO_CODE_BATCHES, fix: SEND_EACH })
      expect(error?.results?.map((result) => result.status)).toEqual(['failed'])
    })

    it('reads a 404 on a template batch from a server without the route the same way, since PostHog answers both alike', async () => {
      againstPostHog({ batchRoute: false })

      const { error } = await settle(posthog.emails.batch({ templateId: TEMPLATE_ID }, recipientsTo(1)))

      expect(error).toMatchObject({ code: 'not_found', statusCode: 404, message: NO_TEMPLATE, fix: CHECK_TEMPLATE })
    })

    it.each([
      ['api_error', { status: 404, code: 'api_error' }],
      ['no code', { status: 404 }],
      ['a blank code', { status: 404, code: '   ' }],
      ['not_found with other detail', { status: 404, code: 'not_found', message: 'Endpoint not found.' }],
    ])('reads a 404 that names no field with %s the same way', async (_name, fault) => {
      const postHog = againstPostHog()
      postHog.failNext('batch', fault)

      const { error } = await settle(posthog.emails.batch({ templateId: TEMPLATE_ID }, recipientsTo(1)))

      expect(error).toMatchObject({ code: 'not_found', statusCode: 404, message: NO_TEMPLATE, fix: CHECK_TEMPLATE })
      expect(error?.results?.map((result) => result.status)).toEqual(['failed'])
    })

    it('keeps recipients unconfirmed while PostHog says their keys are still in flight', async () => {
      const postHog = againstPostHog()
      postHog.failNext('batch', { status: 409, code: 'idempotency_key_in_flight' })

      const { error } = await settle(posthog.emails.batch({ ...WELCOME, maxRetries: 0 }, recipientsTo(2)))

      expect(error).toMatchObject({ code: 'idempotency_key_in_flight' })
      expect(error?.results).toMatchObject([
        { status: 'unconfirmed', error: { fix: expect.stringMatching(/unchanged and with the same idempotencyKey/) } },
        { status: 'unconfirmed' },
      ])
      expect(postHog.requests.batch).toBe(1)
    })

    it.each([
      ['without a body', { status: 409 }],
      ['with a proxy page', { status: 409, page: '<html>Conflict</html>' }],
    ])('keeps recipients unconfirmed after a 409 %s, since it may be a key in flight', async (_, fault) => {
      const postHog = againstPostHog()
      postHog.failNext('batch', fault)

      const { error } = await settle(posthog.emails.batch({ ...WELCOME, maxRetries: 0 }, recipientsTo(2)))

      expect(error).toMatchObject({ statusCode: 409 })
      expect(error?.fix).toMatch(/Call emails\.batch\(\) again with the same email and recipients/)
      expect(error?.results).toMatchObject([
        { status: 'unconfirmed', error: { fix: expect.stringMatching(/unchanged and with the same idempotencyKey/) } },
        { status: 'unconfirmed' },
      ])
    })

    it('reads an inherited field the batch takes once, and sends no copy a later read would add', async () => {
      const postHog = againstPostHog()
      let maxRetriesReads = 0
      let ccReads = 0
      const email = Object.assign(
        Object.create({
          get maxRetries() {
            maxRetriesReads += 1
            if (maxRetriesReads > 1) {
              throw new Error('read twice')
            }
            return 0
          },
          get cc() {
            ccReads += 1
            return ccReads > 1 ? 'finance@example.com' : undefined
          },
        }),
        WELCOME
      )

      const { data, error } = await settle(posthog.emails.batch(email, recipientsTo(1)))

      expect(error).toBeNull()
      expect(data?.results).toMatchObject([{ status: 'queued' }])
      expect(postHog.emails.map(({ cc }) => cc)).toEqual([[]])
    })

    it('sends no batch once the client has shut down', async () => {
      const postHog = againstPostHog()
      await posthog.shutdown()

      const { error } = await settle(posthog.emails.batch(WELCOME, recipientsTo(2)))

      expect(error).toMatchObject({ code: 'client_closed' })
      expect(error?.results).toBeUndefined()
      expect(postHog.requests.batch).toBe(0)
    })

    it('keeps a recipient PostHog answered without a result unconfirmed, and reads nothing back by its key', async () => {
      const urls: string[] = []
      makeClient({
        fetch: async (url: string) => {
          urls.push(url)
          return fakeReply(200, { results: [{}] })
        },
      })

      const { data } = await settle(posthog.emails.batch(WELCOME, recipientsTo(1)))

      expect(data?.results).toMatchObject([
        { status: 'unconfirmed', id: null, error: { fix: expect.stringMatching(/same idempotencyKey/) } },
      ])
      expect(urls).toEqual([expect.stringMatching(/\/api\/messaging\/send\/email_batch\/$/)])
    })

    const queuedWithWarning = (count: number): Reply => ({
      status: 200,
      body: {
        results: Array.from({ length: count }, (_, i) => ({ message_id: `m${i}`, status: 'queued', replayed: false })),
        warnings: [{ code: 'sandbox_sender', detail: 'From the test sender.' }],
      },
    })

    const clientWithLoggedWarnings = (): ReturnType<typeof vi.fn> => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      makeClient()
      posthog.debug(true)
      return warn
    }

    it('logs the warnings PostHog gave the batch', async () => {
      const warn = clientWithLoggedWarnings()
      replies = [queuedWithWarning(2)]

      const { data } = await settle(posthog.emails.batch(WELCOME, recipientsTo(2)))

      expect(data?.warnings).toEqual([{ code: 'sandbox_sender', message: 'From the test sender.', fix: undefined }])
      expect(warn.mock.calls).toEqual([['[PostHog]', 'PostHog email warning sandbox_sender: From the test sender.']])
      warn.mockRestore()
    })

    it('returns the warnings PostHog gave the batch', async () => {
      makeClient()
      replies = [
        {
          status: 200,
          body: {
            results: [{ message_id: 'm1', status: 'queued', replayed: false }],
            warnings: [{ code: 'sandbox_sender', detail: 'From the test sender.' }],
          },
        },
      ]

      const { data } = await settle(posthog.emails.batch(WELCOME, recipientsTo(1)))

      expect(data?.warnings).toEqual([{ code: 'sandbox_sender', message: 'From the test sender.', fix: undefined }])
    })

    it.each([
      ['no recipients', WELCOME, [], 'invalid_recipients'],
      ['a recipient without an address', WELCOME, [{ to: '' }], 'invalid_recipient'],
      [
        'two recipients with one key',
        WELCOME,
        [
          { to: 'a@example.com', idempotencyKey: 'k' },
          { to: 'b@example.com', idempotencyKey: 'k' },
        ],
        'invalid_idempotency_key',
      ],
      ['template data on a code send', WELCOME, [{ to: 'a@example.com', templateData: { name: 'A' } }], 'invalid_form'],
      ['copies', { ...WELCOME, cc: 'finance@example.com' }, [{ to: 'a@example.com' }], 'invalid_form'],
      [
        'attachments',
        { ...WELCOME, attachments: [{ filename: 'a.txt', content: 'YQ==' }] },
        [{ to: 'a@example.com' }],
        'invalid_form',
      ],
      [
        'attachments that are not enumerable',
        Object.defineProperty({ ...WELCOME }, 'attachments', { value: [{ filename: 'a.txt', content: 'YQ==' }] }),
        [{ to: 'a@example.com' }],
        'invalid_form',
      ],
      [
        'inherited attachments',
        Object.assign(Object.create({ attachments: [{ filename: 'a.txt', content: 'YQ==' }] }), WELCOME),
        [{ to: 'a@example.com' }],
        'invalid_form',
      ],
      [
        'inherited copies',
        Object.assign(Object.create({ cc: 'finance@example.com' }), WELCOME),
        [{ to: 'a@example.com' }],
        'invalid_form',
      ],
      [
        'a recipient with attachments that are not enumerable',
        WELCOME,
        [
          Object.defineProperty({ to: 'a@example.com' }, 'attachments', {
            value: [{ filename: 'a.txt', content: 'YQ==' }],
          }),
        ],
        'invalid_form',
      ],
      [
        'a recipient with inherited attachments',
        WELCOME,
        [
          Object.assign(Object.create({ attachments: [{ filename: 'a.txt', content: 'YQ==' }] }), {
            to: 'a@example.com',
          }),
        ],
        'invalid_form',
      ],
      ['scheduledAt', { ...WELCOME, scheduledAt: '2026-12-01T09:00:00Z' }, [{ to: 'a@example.com' }], 'invalid_form'],
      ['maxRetries', { ...WELCOME, maxRetries: -1 }, [{ to: 'a@example.com' }], 'invalid_max_retries'],
      ['a shared recipient', { ...WELCOME, to: 'a@example.com' }, [{ to: 'a@example.com' }], 'invalid_form'],
    ])('refuses %s before any request', async (_name, email, recipients, code) => {
      const postHog = againstPostHog()

      const { error } = await settle(posthog.emails.batch(email as never, recipients as never))

      expect(error).toMatchObject({ code, name: 'validation_error' })
      expect(error?.results).toBeUndefined()
      expect(postHog.batches).toEqual([])
    })
  })

  describe('options a getter answers', () => {
    // Every field is an inherited getter that throws on a second read, so a check and the request can't see two values.
    const readOnce = (fields: Record<string, unknown>): never => {
      const getters = Object.entries(fields).map(([name, value]) => {
        let read = false
        const get = (): unknown => {
          if (read) {
            throw new Error(`${name} was read twice`)
          }
          read = true
          return value
        }
        return [name, { get }]
      })
      return Object.create(Object.defineProperties({}, Object.fromEntries(getters))) as never
    }

    beforeEach(() => {
      vi.setSystemTime(new Date('2026-11-22T10:00:00Z'))
    })

    it('sends an email from code with each option read once', async () => {
      const postHog = againstPostHog()

      const { error } = await settle(
        posthog.emails.send(
          readOnce({
            to: 'ada@example.com',
            distinctId: 'ada',
            idempotencyKey: 'welcome:ada',
            maxRetries: 0,
            scheduledAt: '2026-11-23T09:00:00Z',
            templateId: undefined,
            templateData: undefined,
            templateKey: 'welcome',
            subject: 'Welcome',
            react: createElement('p', null, 'Welcome, Ada'),
            replyTo: 'help@example.com',
            cc: 'cc@example.com',
            bcc: undefined,
            captureEngagement: false,
            attachments: [{ filename: 'hello.txt', content: Buffer.from('hello') }],
          })
        )
      )

      expect(error).toBeNull()
      expect(postHog.emails).toMatchObject([
        {
          to: 'ada@example.com',
          html: expect.stringContaining('<p>Welcome, Ada</p>'),
          cc: ['cc@example.com'],
          scheduledAt: '2026-11-23T09:00:00.000Z',
          attachments: [{ filename: 'hello.txt' }],
        },
      ])
    })

    it('reads an own getter once too', async () => {
      const postHog = againstPostHog()
      let reads = 0
      const options = Object.defineProperty(
        { to: 'ada@example.com', templateKey: 'welcome', html: '<p>Hi</p>' },
        'subject',
        {
          enumerable: true,
          get: () => {
            reads += 1
            if (reads > 1) {
              throw new Error('subject was read twice')
            }
            return 'Welcome'
          },
        }
      )

      const { error } = await settle(posthog.emails.send(options as SendEmailOptions))

      expect(error).toBeNull()
      expect(postHog.emails).toMatchObject([{ to: 'ada@example.com', subject: 'Welcome' }])
    })

    it.each([
      [
        'send',
        () => posthog.emails.send(JSON.parse(`{"to":"ada@example.com","templateId":"${TEMPLATE_ID}","__proto__":{}}`)),
      ],
      [
        'batch',
        () =>
          posthog.emails.batch(JSON.parse(`{"templateId":"${TEMPLATE_ID}","__proto__":{}}`), [
            { to: 'ada@example.com' },
          ]),
      ],
      [
        'a batch recipient',
        () =>
          posthog.emails.batch({ templateId: TEMPLATE_ID }, [JSON.parse('{"to":"ada@example.com","__proto__":{}}')]),
      ],
    ])('refuses an own __proto__ field on %s by name', async (_name, call) => {
      const postHog = againstPostHog()

      const { error } = await settle(call())

      expect(error).toMatchObject({ code: 'invalid_form', field: expect.stringMatching(/__proto__$/) })
      expect(postHog.emails).toEqual([])
    })

    it('sends a template email with each option read once', async () => {
      const postHog = againstPostHog()

      const { error } = await settle(
        posthog.emails.send(
          readOnce({
            to: 'ada@example.com',
            templateId: TEMPLATE_ID,
            templateData: { name: 'Ada' },
            templateKey: undefined,
            react: undefined,
            html: undefined,
            attachments: undefined,
            scheduledAt: undefined,
            maxRetries: 0,
          })
        )
      )

      expect(error).toBeNull()
      expect(postHog.emails).toMatchObject([{ to: 'ada@example.com', templateId: TEMPLATE_ID }])
      expect(postHog.emails[0].scheduledAt).toBeUndefined()
    })

    it('sends a batch from code with each option and recipient field read once', async () => {
      const postHog = againstPostHog()

      const { data, error } = await settle(
        posthog.emails.batch(
          readOnce({
            templateKey: 'welcome',
            templateId: undefined,
            subject: 'Welcome',
            react: createElement('p', null, 'Welcome'),
            maxRetries: 0,
            cc: undefined,
            attachments: undefined,
            scheduledAt: undefined,
          }),
          [
            readOnce({
              to: 'ada@example.com',
              distinctId: 'ada',
              idempotencyKey: 'welcome:ada',
              attachments: undefined,
            }),
          ]
        )
      )

      expect(error).toBeNull()
      expect(data?.results).toMatchObject([{ status: 'queued', idempotencyKey: 'welcome:ada' }])
      expect(postHog.emails).toMatchObject([
        { to: 'ada@example.com', cc: [], html: expect.stringContaining('Welcome') },
      ])
    })

    it('sends a batch of a template with each option and recipient field read once', async () => {
      const postHog = againstPostHog()

      const { data, error } = await settle(
        posthog.emails.batch(
          readOnce({
            templateId: TEMPLATE_ID,
            templateKey: undefined,
            templateData: { team: 'Acme' },
            react: undefined,
          }),
          [readOnce({ to: 'ada@example.com', templateData: { name: 'Ada' } })]
        )
      )

      expect(error).toBeNull()
      expect(data?.results).toMatchObject([{ status: 'queued' }])
      expect(postHog.emails).toMatchObject([{ to: 'ada@example.com', templateId: TEMPLATE_ID }])
    })
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
      ["Resend's tags on a code send", { ...CODE_SEND, tags: [{ name: 'kind', value: 'welcome' }] }, 'tags'],
    ])('refuses %s before sending', async (_name, form, field) => {
      const { data, error } = await sendForm(form)

      expect(data).toBeNull()
      expect(error).toMatchObject({ code: 'invalid_form', name: 'validation_error', field })
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([
      [
        'inherited template data on a code send',
        Object.assign(Object.create({ templateData: { name: 'Jane' } }), { to: 'user@example.com', ...CODE_SEND }),
        'templateData',
      ],
      [
        'html on the template form that is not enumerable',
        Object.defineProperty({ to: 'user@example.com', templateId: TEMPLATE_ID }, 'html', { value: '<p>Hi</p>' }),
        'html',
      ],
    ])('refuses %s before sending, as it does an own field', async (_name, options, field) => {
      const { data, error } = await posthog.emails.send(options as SendEmailOptions)

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
      [
        'a field no form takes',
        { ...CODE_SEND, tags: [{ name: 'kind', value: 'welcome' }] },
        undefined,
        'Remove tags and send again.',
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
