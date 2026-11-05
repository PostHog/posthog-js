/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { convexTest, type TestConvex } from 'convex-test'
import { actionGeneric, anyApi, componentsGeneric, defineSchema, mutationGeneric, queryGeneric } from 'convex/server'
import { ConvexError, v, type Value } from 'convex/values'
import { Workpool, type WorkId, type WorkpoolComponent } from '@convex-dev/workpool'
import posthogTest from '../test.js'
import type { ComponentApi } from '../component/_generated/component.js'
import { PostHog, type SendEmailArgs } from './index.js'

const SEND_URL = 'https://us.posthog.com/api/projects/@current/messaging/send/email/'
const MESSAGE_ID = '01a18356-c56c-0001-e494-7666bc915188'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type ComponentRegistration = { default: { register(t: TestConvex<any>): unknown } }
const importShippedAsSource = (specifier: string): Promise<ComponentRegistration> => import(specifier)
const workpoolTest = (await importShippedAsSource('@convex-dev/workpool/test')).default

const components = componentsGeneric() as unknown as { posthog: ComponentApi; workpool: WorkpoolComponent }
const pool = new Workpool(components.workpool, { maxParallelism: 1, logLevel: 'ERROR' })

const app = {
  send: actionGeneric({
    args: { email: v.any(), defaultTemplateKey: v.optional(v.string()) },
    handler: (ctx, { email, defaultTemplateKey }) =>
      new PostHog(components.posthog, { emails: { defaultTemplateKey } }).sendEmail(ctx, email),
  }),
  enqueue: mutationGeneric({
    args: { email: v.any() },
    handler: (ctx, { email }) => new PostHog(components.posthog).enqueueEmail(ctx, pool, email),
  }),
  status: queryGeneric({
    args: { id: v.string() },
    handler: (ctx, { id }) => pool.status(ctx, id as WorkId),
  }),
}

function initConvexTest() {
  const t = convexTest(defineSchema({}), { './_generated/api.ts': async () => ({}), './emails.ts': async () => app })
  posthogTest.register(t)
  workpoolTest.register(t)
  return t
}

type Reply = Error | { status: number; body?: unknown; headers?: Record<string, string> }
type SentRequest = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

const ORDER_SHIPPED = {
  from: 'Shop <shop@example.com>',
  to: 'ana@example.com',
  subject: 'Your order shipped',
  html: '<p>On its way.</p>',
  text: 'On its way.',
} satisfies SendEmailArgs

const ORDER_SHIPPED_ON_THE_WIRE = { ...ORDER_SHIPPED, capture_engagement: true }

const accepted = (replayed = false): Reply => ({ status: 202, body: { message_id: MESSAGE_ID, replayed } })

describe('sending email through the component', () => {
  let replies: Reply[]
  let requests: SentRequest[]

  beforeEach(() => {
    vi.stubEnv('POSTHOG_PROJECT_TOKEN', 'phc_test')
    vi.stubEnv('POSTHOG_SECRET_KEY', 'phs_test_secret')
    replies = []
    requests = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({
          url,
          headers: init.headers as Record<string, string>,
          body: JSON.parse(init.body as string),
        })
        const reply = replies.shift()
        if (!reply) throw new Error('No reply queued')
        if (reply instanceof Error) throw reply
        return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'Content-Type': 'application/json', ...reply.headers },
        })
      })
    )
  })

  afterEach(() => {
    vi.useFakeTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const send = (email: unknown, defaultTemplateKey?: string) =>
    initConvexTest().action(anyApi.emails.send, { email, defaultTemplateKey })

  const failureOf = async (pending: Promise<unknown>) => {
    const error = await pending.then(
      () => undefined,
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(ConvexError)
    return (error as ConvexError<Value>).data as Record<string, unknown>
  }

  describe('the conformance cases', () => {
    test.each([
      ['01-rendered-minimal', {}, undefined, { template_key: 'convex' }, {}],
      [
        '03-cc-bcc-reply-to',
        { cc: 'bo@example.com', bcc: ['audit@example.com'], replyTo: ['a@example.com', 'b@example.com'] },
        undefined,
        {
          template_key: 'convex',
          cc: ['bo@example.com'],
          bcc: ['audit@example.com'],
          reply_to: ['a@example.com', 'b@example.com'],
        },
        {},
      ],
      [
        '04-attachments-and-inline',
        {
          html: '<img src="cid:logo">',
          attachments: [
            { filename: 'invoice.pdf', contentType: 'application/pdf', content: 'JVBERi0xLjQK' },
            { filename: 'logo.png', contentType: 'image/png', content: 'iVBORw0KGgo=', contentId: 'logo' },
          ],
        },
        undefined,
        {
          template_key: 'convex',
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
        {
          distinctId: 'user_42',
          templateKey: 'order-shipped',
          idempotencyKey: 'order-981-shipped',
          captureEngagement: false,
        },
        undefined,
        { template_key: 'order-shipped', distinct_id: 'user_42', capture_engagement: false },
        { 'Idempotency-Key': 'order-981-shipped' },
      ],
      ['07-template-key-config-default', {}, 'transactional', { template_key: 'transactional' }, {}],
    ])('%s', async (_case, email, defaultTemplateKey, body, headers) => {
      replies.push(accepted())

      await expect(send({ ...ORDER_SHIPPED, ...email }, defaultTemplateKey)).resolves.toEqual({
        message_id: MESSAGE_ID,
        replayed: false,
      })

      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(SEND_URL)
      expect(requests[0].body).toEqual({ ...ORDER_SHIPPED_ON_THE_WIRE, ...body })
      expect(requests[0].headers).toMatchObject({
        'X-PostHog-Integration': expect.stringMatching(/^convex\/[0-9A-Za-z.+-]{1,40}$/),
        ...headers,
      })
    })

    test.each([
      ['08-refuse-invalid-template-key', { ...ORDER_SHIPPED, templateKey: 'order shipped!' }, 'invalid_template_key'],
      [
        '16-refuse-template-unsupported',
        { to: 'ana@example.com', templateId: '0190f0c2-7d1e-7a3b-9c2e-5f1a2b3c4d5e' },
        'template_unsupported',
      ],
    ])('%s', async (_case, email, refusal) => {
      const posthog = new PostHog(components.posthog)
      const ctx = { runAction: vi.fn(), scheduler: { runAfter: vi.fn() } }
      const queue = { enqueueAction: vi.fn() }

      const refused = { code: refusal, retryable: false }
      expect(await failureOf(posthog.sendEmail(ctx, email as SendEmailArgs))).toMatchObject(refused)
      expect(await failureOf(posthog.enqueueEmail(ctx, queue, email as SendEmailArgs))).toMatchObject(refused)

      expect(ctx.runAction).not.toHaveBeenCalled()
      expect(queue.enqueueAction).not.toHaveBeenCalled()
    })
  })

  describe('the error map', () => {
    const LONG_WAIT = { 'Retry-After': '60' }

    test.each([
      ['400', { status: 400, body: { code: 'invalid_input', detail: 'Bad to.', attr: 'to' } }, false, undefined],
      ['401', { status: 401, body: { code: 'authentication_failed', detail: 'Bad key.' } }, false, undefined],
      ['403', { status: 403, body: { code: 'permission_denied', detail: 'No scope.' } }, false, undefined],
      ['404', { status: 404, body: { code: 'not_found', detail: 'No template.' } }, false, undefined],
      [
        '409 in flight',
        { status: 409, body: { code: 'idempotency_key_in_flight', detail: 'Still sending.' }, headers: LONG_WAIT },
        true,
        60,
      ],
      ['422', { status: 422, body: { code: 'recipient_suppressed', detail: 'Suppressed.' } }, false, undefined],
      ['429 quota', { status: 429, body: { code: 'quota_limited', detail: 'Over quota.' } }, false, undefined],
      [
        '429 throttled',
        { status: 429, body: { code: 'throttled', detail: 'Slow down.' }, headers: LONG_WAIT },
        true,
        60,
      ],
      [
        '503',
        { status: 503, body: { code: 'service_unavailable', detail: 'Try later.' }, headers: LONG_WAIT },
        true,
        60,
      ],
      ['500', { status: 500, body: { code: 'error', detail: 'Broke.' } }, false, undefined],
    ])('%s throws a ConvexError with the contract record', async (_row, reply, retryable, retryAfter) => {
      replies.push(reply as Reply)

      const data = await failureOf(send(ORDER_SHIPPED))

      expect(data).toMatchObject({
        status: (reply as { status: number }).status,
        code: (reply as { body: { code: string } }).body.code,
        detail: (reply as { body: { detail: string } }).body.detail,
        retryable,
      })
      expect(data.attr).toBe((reply as { body: { attr?: string } }).body.attr)
      expect(data.retry_after).toBe(retryAfter)
      expect(requests).toHaveLength(1)
    })

    test('a network error is retryable after the SDK retries it with the same key', async () => {
      vi.useRealTimers()
      replies.push(new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed'))

      const data = await failureOf(send(ORDER_SHIPPED))

      expect(data).toMatchObject({ code: 'network_error', retryable: true })
      expect(data).not.toHaveProperty('status')
      expect(requests).toHaveLength(3)
      expect(new Set(requests.map((r) => r.headers['Idempotency-Key'])).size).toBe(1)
    }, 15_000)

    test('a missing secret key is a permanent failure that sends nothing', async () => {
      vi.stubEnv('POSTHOG_SECRET_KEY', '')

      const data = await failureOf(send(ORDER_SHIPPED))

      expect(data).toMatchObject({ code: 'missing_secret_key', retryable: false })
      expect(requests).toHaveLength(0)
    })
  })

  describe('a queued send', () => {
    const runQueue = async (t: ReturnType<typeof initConvexTest>, workId: string) => {
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      return await t.query(anyApi.emails.status, { id: workId })
    }

    test('makes its key at enqueue and retries a retryable failure with it', async () => {
      replies.push(
        { status: 503, body: { code: 'service_unavailable', detail: 'Try later.' }, headers: { 'Retry-After': '60' } },
        accepted(true)
      )
      const t = initConvexTest()

      const workId = await t.mutation(anyApi.emails.enqueue, { email: ORDER_SHIPPED })

      expect(requests).toHaveLength(0)
      await expect(runQueue(t, workId)).resolves.toEqual({ state: 'finished' })
      expect(requests).toHaveLength(2)
      const [first, second] = requests.map((r) => r.headers['Idempotency-Key'])
      expect(first).toMatch(UUID)
      expect(second).toBe(first)
    })

    test('keeps the key the app passed', async () => {
      replies.push(accepted())
      const t = initConvexTest()

      const workId = await t.mutation(anyApi.emails.enqueue, {
        email: { ...ORDER_SHIPPED, idempotencyKey: 'order-981-shipped' },
      })

      await expect(runQueue(t, workId)).resolves.toEqual({ state: 'finished' })
      expect(requests.map((r) => r.headers['Idempotency-Key'])).toEqual(['order-981-shipped'])
    })

    test('stops at a permanent failure', async () => {
      replies.push(
        { status: 422, body: { code: 'recipient_suppressed', detail: 'Suppressed.' } },
        accepted(),
        accepted()
      )
      const t = initConvexTest()

      const workId = await t.mutation(anyApi.emails.enqueue, { email: ORDER_SHIPPED })

      await expect(runQueue(t, workId)).resolves.toEqual({ state: 'finished' })
      expect(requests).toHaveLength(1)
    })
  })
})
