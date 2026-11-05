import nodemailer from 'nodemailer'

import { PostHog } from '@/entrypoints/index.node'
import { createPostHogTransport, type PostHogTransportOptions } from '@/entrypoints/nodemailer'

vi.mock('../version', () => ({ version: '1.2.3' }))

const SEND_URL = 'https://us.posthog.com/api/projects/@current/messaging/send/email/'
const MESSAGE_ID = '01a18356-c56c-0001-e494-7666bc915188'

type Reply = Error | { status: number; body?: unknown; headers?: Record<string, string> }

const SHOP = { name: 'Shop', address: 'shop@example.com' }
const ANA = { name: 'Ana', address: 'ana@example.com' }
const ORDER_SHIPPED = {
  from: SHOP,
  to: ANA,
  subject: 'Your order shipped',
  html: '<p>On its way.</p>',
  text: 'On its way.',
}
const ORDER_SHIPPED_ON_THE_WIRE = {
  to: 'ana@example.com',
  from: 'Shop <shop@example.com>',
  subject: 'Your order shipped',
  html: '<p>On its way.</p>',
  text: 'On its way.',
  capture_engagement: true,
}

describe('posthog-node/nodemailer', () => {
  let posthog: PostHog
  let replies: Reply[]
  const fetch = vi.fn()

  const transporter = (options: Omit<PostHogTransportOptions, 'client'> = {}): nodemailer.Transporter =>
    nodemailer.createTransport(createPostHogTransport({ client: posthog, ...options }))

  const sentRequests = (): { url: string; headers: Record<string, string>; body: unknown }[] =>
    fetch.mock.calls.map(([url, options]) => ({ url, headers: options.headers, body: JSON.parse(options.body) }))

  const refusalOf = (error: unknown): unknown => {
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ code: 'EPOSTHOGUNSUPPORTED' })
    return (error as { refusal: unknown }).refusal
  }

  beforeEach(() => {
    vi.useRealTimers()
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
    posthog = new PostHog('phc_test', {
      secretKey: 'phs_test_secret',
      enableLocalEvaluation: false,
      emailRequestMaxRetries: 0,
      fetch,
    })
  })

  afterEach(async () => {
    await posthog.shutdown()
    vi.useFakeTimers()
  })

  describe('the conformance cases', () => {
    it.each([
      ['01-rendered-minimal', {}, ORDER_SHIPPED, {}, {}],
      [
        '02-display-names',
        {},
        { ...ORDER_SHIPPED, cc: { name: 'Bo', address: 'bo@example.com' }, replyTo: '"Help" <help@example.com>' },
        { cc: ['bo@example.com'], reply_to: ['help@example.com'] },
        {},
      ],
      [
        '03-cc-bcc-reply-to',
        {},
        {
          ...ORDER_SHIPPED,
          cc: 'bo@example.com',
          bcc: ['audit@example.com'],
          replyTo: ['a@example.com', 'b@example.com'],
        },
        { cc: ['bo@example.com'], bcc: ['audit@example.com'], reply_to: ['a@example.com', 'b@example.com'] },
        {},
      ],
      [
        '04-attachments-and-inline',
        {},
        {
          ...ORDER_SHIPPED,
          html: '<img src="cid:logo">',
          attachments: [
            { filename: 'invoice.pdf', contentType: 'application/pdf', content: Buffer.from('JVBERi0xLjQK', 'base64') },
            {
              filename: 'logo.png',
              contentType: 'image/png',
              content: 'iVBORw0KGgo=',
              encoding: 'base64',
              cid: 'logo',
            },
          ],
        },
        {
          html: '<img src="cid:logo">',
          attachments: [
            { filename: 'invoice.pdf', content_type: 'application/pdf', content: 'JVBERi0xLjQK' },
            { filename: 'logo.png', content_type: 'image/png', content: 'iVBORw0KGgo=', content_id: 'logo' },
          ],
        },
        {},
      ],
      [
        '05-posthog-options',
        {},
        {
          ...ORDER_SHIPPED,
          posthog: {
            distinct_id: 'user_42',
            template_key: 'order-shipped',
            idempotency_key: 'order-981-shipped',
            capture_engagement: false,
          },
        },
        { template_key: 'order-shipped', distinct_id: 'user_42', capture_engagement: false },
        { 'Idempotency-Key': 'order-981-shipped' },
      ],
      [
        '07-template-key-config-default',
        { defaultTemplateKey: 'transactional' },
        ORDER_SHIPPED,
        { template_key: 'transactional' },
        {},
      ],
      [
        '11-headers-ignored-and-refused, with only the ignored header',
        {},
        { ...ORDER_SHIPPED, headers: { 'Message-ID': '<x@example.com>' } },
        {},
        {},
      ],
      [
        '11-headers-ignored-and-refused, with the ignored header as a list',
        {},
        { ...ORDER_SHIPPED, headers: [{ key: 'Message-ID', value: '<x@example.com>' }] },
        {},
        {},
      ],
    ])('%s sends one request', async (_name, options, mail, extraBody, extraHeaders) => {
      replies = [{ status: 202, body: { message_id: MESSAGE_ID, replayed: false } }]

      const info = await transporter(options).sendMail(mail)

      expect(info.messageId).toBe(MESSAGE_ID)
      const requests = sentRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(SEND_URL)
      expect(requests[0].body).toEqual({ ...ORDER_SHIPPED_ON_THE_WIRE, template_key: 'nodemailer', ...extraBody })
      expect(requests[0].headers).toMatchObject({
        'X-PostHog-Integration': 'nodemailer/1.2.3',
        'User-Agent': 'posthog-node/1.2.3',
        ...extraHeaders,
      })
    })

    it.each([
      [
        '08-refuse-invalid-template-key',
        { ...ORDER_SHIPPED, posthog: { template_key: 'order shipped!' } },
        'invalid_template_key',
      ],
      ['09-refuse-multiple-to', { ...ORDER_SHIPPED, to: ['ana@example.com', 'bo@example.com'] }, 'multiple_to'],
      ['09-refuse-multiple-to, with no to', { ...ORDER_SHIPPED, to: undefined, bcc: 'ana@example.com' }, 'multiple_to'],
      [
        '09-refuse-multiple-to, with a group',
        { ...ORDER_SHIPPED, to: 'Team: ana@example.com, bo@example.com;' },
        'multiple_to',
      ],
      [
        '10-refuse-inline-without-cid',
        {
          ...ORDER_SHIPPED,
          attachments: [
            {
              filename: 'logo.png',
              contentType: 'image/png',
              content: 'iVBORw0KGgo=',
              encoding: 'base64',
              contentDisposition: 'inline' as const,
            },
          ],
        },
        'inline_without_cid',
      ],
      [
        '11-headers-ignored-and-refused',
        { ...ORDER_SHIPPED, headers: { 'Message-ID': '<x@example.com>', 'X-Campaign': 'spring' } },
        'unsupported_header',
      ],
      [
        '11-headers-ignored-and-refused, with the headers as a list',
        {
          ...ORDER_SHIPPED,
          headers: [
            { key: 'Message-ID', value: '<x@example.com>' },
            { key: 'X-Campaign', value: 'spring' },
          ],
        },
        'unsupported_header',
      ],
      [
        '13-refuse-envelope-mismatch',
        { ...ORDER_SHIPPED, envelope: { from: 'bounce@example.com', to: ['ana@example.com'] } },
        'envelope_mismatch',
      ],
    ])('%s refuses before any request', async (_name, mail, refusal) => {
      const error = await transporter()
        .sendMail(mail)
        .then(
          () => undefined,
          (rejection: unknown) => rejection
        )

      expect(refusalOf(error)).toBe(refusal)
      expect(error).toMatchObject({ message: `PostHog cannot send this email: ${refusal}` })
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  it.each([
    ['an AMP part', { amp: '<!doctype html><html amp4email></html>' }, 'unsupported_part'],
    ['a calendar event', { icalEvent: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' }, 'unsupported_part'],
    ['an Apple Watch part', { watchHtml: '<p>On its way.</p>' }, 'unsupported_part'],
    [
      'an alternative part',
      { alternatives: [{ contentType: 'text/x-web-markdown', content: '**On its way.**' }] },
      'unsupported_part',
    ],
    ['a raw message', { raw: 'Subject: hi\r\n\r\nhi' }, 'unsupported_part'],
    [
      'an attachment with a raw source',
      { attachments: [{ filename: 'notes.txt', content: 'hello', raw: 'Content-Type: text/plain\r\n\r\nother' }] },
      'unsupported_part',
    ],
    [
      'an attachment with its own headers',
      {
        html: '<img src="cid:logo">',
        attachments: [
          { filename: 'logo.png', content: 'iVBORw0KGgo=', encoding: 'base64', headers: { 'Content-ID': '<logo>' } },
        ],
      },
      'unsupported_header',
    ],
    ['a high priority', { priority: 'high' as const }, 'unsupported_priority'],
    ['a reply thread', { inReplyTo: '<earlier@example.com>' }, 'unsupported_header'],
    ['a list header', { list: { unsubscribe: 'https://example.com/unsubscribe' } }, 'unsupported_header'],
    ['a sender other than from', { sender: 'bounce@example.com' }, 'unsupported_header'],
  ])('refuses %s, which PostHog cannot carry', async (_name, extra, refusal) => {
    const error = await transporter()
      .sendMail({ ...ORDER_SHIPPED, ...extra })
      .then(
        () => undefined,
        (rejection: unknown) => rejection
      )

    expect(refusalOf(error)).toBe(refusal)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends a plain address, a quoted sender name and a text attachment', async () => {
    replies = [{ status: 202, body: { message_id: MESSAGE_ID, replayed: false } }]

    await transporter().sendMail({
      from: { name: 'Doe, Jane', address: 'jane@example.com' },
      to: 'ana@example.com',
      subject: 'Notes',
      text: 'See attached.',
      priority: 'normal',
      attachments: [{ filename: 'notes.txt', content: 'hello' }],
    })

    expect(sentRequests()[0].body).toEqual({
      to: 'ana@example.com',
      from: '"Doe, Jane" <jane@example.com>',
      subject: 'Notes',
      text: 'See attached.',
      template_key: 'nodemailer',
      capture_engagement: true,
      attachments: [{ filename: 'notes.txt', content_type: 'text/plain', content: 'aGVsbG8=' }],
    })
  })

  describe('the error map', () => {
    const failureOf = async (reply: Reply): Promise<unknown> => {
      replies = [reply]
      return transporter()
        .sendMail(ORDER_SHIPPED)
        .then(
          () => undefined,
          (rejection: unknown) => rejection
        )
    }

    const apiError = (status: number, code: string, headers: Record<string, string> = {}): Reply => ({
      status,
      body: { type: 'invalid_request', code, detail: 'Nope.', attr: 'to' },
      headers,
    })

    it.each([
      ['400', apiError(400, 'invalid_input'), { status: 400, code: 'invalid_input', attr: 'to', retryable: false }],
      ['401', apiError(401, 'authentication_failed'), { status: 401, code: 'authentication_failed', retryable: false }],
      ['403', apiError(403, 'permission_denied'), { status: 403, code: 'permission_denied', retryable: false }],
      ['404', apiError(404, 'not_found'), { status: 404, code: 'not_found', retryable: false }],
      [
        '409 in flight',
        apiError(409, 'idempotency_key_in_flight'),
        { status: 409, code: 'idempotency_key_in_flight', retryable: true },
      ],
      ['422', apiError(422, 'recipient_suppressed'), { status: 422, code: 'recipient_suppressed', retryable: false }],
      ['429 quota', apiError(429, 'quota_limited'), { status: 429, code: 'quota_limited', retryable: false }],
      [
        '429 throttled',
        apiError(429, 'throttled', { 'Retry-After': '7' }),
        { status: 429, code: 'throttled', retryable: true, retry_after: 7 },
      ],
      ['503', apiError(503, 'delivery_unavailable'), { status: 503, code: 'delivery_unavailable', retryable: true }],
      ['500', { status: 500 }, { status: 500, code: 'api_error', retryable: false }],
      ['a network error', new TypeError('fetch failed'), { code: 'network_error', retryable: true }],
    ])('turns %s into an error that says whether to retry', async (_name, reply, expected) => {
      const error = await failureOf(reply)

      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ detail: expect.any(String), ...expected })
      if (!('retry_after' in expected)) {
        expect(error).not.toHaveProperty('retry_after')
      }
      if (!('status' in expected)) {
        expect(error).not.toHaveProperty('status')
      }
    })
  })

  it('reports a send the client could not make', async () => {
    posthog = new PostHog('phc_test', { enableLocalEvaluation: false, fetch })

    const error = await transporter()
      .sendMail(ORDER_SHIPPED)
      .then(
        () => undefined,
        (rejection: unknown) => rejection
      )

    expect(error).toMatchObject({ code: 'missing_secret_key', retryable: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names itself to Nodemailer', () => {
    expect(createPostHogTransport({ client: posthog })).toMatchObject({ name: 'PostHog', version: '1.2.3' })
  })
})
