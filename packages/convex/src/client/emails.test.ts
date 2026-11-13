/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import { convexTest, type TestConvex } from 'convex-test'
import {
  actionGeneric,
  anyApi,
  componentsGeneric,
  defineSchema,
  type FunctionArgs,
  mutationGeneric,
  queryGeneric,
} from 'convex/server'
import { ConvexError, v, type Value } from 'convex/values'
import { Workpool, type WorkId, type WorkpoolComponent } from '@convex-dev/workpool'
import posthogTest from '../test.js'
import type { ComponentApi } from '../component/_generated/component.js'
import { PostHog, type SendEmailArgs } from './index.js'

const SEND_URL = 'https://us.posthog.com/api/projects/@current/messaging/send/email/'
const UPLOADS_URL = 'https://us.posthog.com/api/projects/@current/messaging/attachments/uploads/'
const MESSAGE_ID = '01a18356-c56c-0001-e494-7666bc915188'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type ComponentRegistration = { default: { register(t: TestConvex<any>): unknown } }
const importShippedAsSource = (specifier: string): Promise<ComponentRegistration> => import(specifier)
const workpoolTest = (await importShippedAsSource('@convex-dev/workpool/test')).default

const components = componentsGeneric() as unknown as { posthog: ComponentApi; workpool: WorkpoolComponent }
const pool = new Workpool(components.workpool, { maxParallelism: 1, logLevel: 'ERROR' })

const finishedEmails: { workId: string; result: { kind: string; error?: string } }[] = []

const reportingPool: Pick<typeof pool, 'enqueueAction'> = {
  enqueueAction: (ctx, fn, args, options) =>
    pool.enqueueAction(ctx, fn, args, { ...options, onComplete: anyApi.emails.emailFinished, context: null }),
}

const WELCOME_ELEMENT = { $$typeof: Symbol.for('react.transitional.element'), type: 'p', props: {} }

const appArgs = {
  email: v.any(),
  defaultTemplateKey: v.optional(v.string()),
  withReactElement: v.optional(v.boolean()),
}

const madeInTheApp = ({ email, withReactElement }: { email: SendEmailArgs; withReactElement?: boolean }) =>
  (withReactElement ? { ...email, react: WELCOME_ELEMENT } : email) as SendEmailArgs

const app = {
  send: actionGeneric({
    args: appArgs,
    handler: (ctx, args) =>
      new PostHog(components.posthog, { emails: { defaultTemplateKey: args.defaultTemplateKey } }).sendEmail(
        ctx,
        madeInTheApp(args)
      ),
  }),
  enqueue: mutationGeneric({
    args: appArgs,
    handler: (ctx, args) =>
      new PostHog(components.posthog, { emails: { defaultTemplateKey: args.defaultTemplateKey } }).enqueueEmail(
        ctx,
        reportingPool,
        madeInTheApp(args)
      ),
  }),
  emailFinished: mutationGeneric({
    args: { workId: v.string(), context: v.any(), result: v.any() },
    handler: (_ctx, { workId, result }) => {
      finishedEmails.push({ workId, result })
    },
  }),
  sendQueuedDirectly: actionGeneric({
    args: { email: v.any() },
    handler: (ctx, { email }) => ctx.runAction(components.posthog.emails.sendQueued, email),
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
type SentRequest = { url: string; headers: Record<string, string>; body: Record<string, unknown>; answer: Reply }

const ORDER_SHIPPED = {
  from: 'Shop <shop@example.com>',
  to: 'ana@example.com',
  subject: 'Your order shipped',
  html: '<p>On its way.</p>',
  text: 'On its way.',
} satisfies SendEmailArgs

const accepted = (replayed = false): Reply => ({ status: 202, body: { message_id: MESSAGE_ID, replayed } })

const STORAGE_URL = 'https://storage.example.com/invoice.pdf'

const INVOICE_ATTACHED = {
  ...ORDER_SHIPPED,
  attachments: [{ filename: 'invoice.pdf', contentType: 'application/pdf', content: 'JVBERi0xLjQK' }],
} satisfies SendEmailArgs

const uploadsAnswering =
  ({ uploads, storage }: { uploads?: Reply; storage?: Reply }) =>
  ({ url, body }: { url: string; body: Record<string, unknown> }): Reply => {
    if (url === UPLOADS_URL) {
      const files = (body.files as { sha256: string }[]).map(({ sha256 }) => ({
        sha256,
        status: 'upload',
        url: STORAGE_URL,
        headers: { 'Content-Type': 'application/pdf' },
      }))
      return uploads ?? { status: 200, body: { files } }
    }
    return url === STORAGE_URL ? (storage ?? { status: 200 }) : accepted()
  }

const COOLING_DOWN: Reply = {
  status: 429,
  body: { code: 'throttled', detail: 'Slow down.' },
  headers: { 'Retry-After': '60' },
}

test('every field the app can pass reaches the component, so its validator never rejects a typed email', () => {
  type ComponentEmailArgs = FunctionArgs<ComponentApi['emails']['send']>
  expectTypeOf<Exclude<keyof SendEmailArgs, 'templateId' | 'react'>>().toMatchTypeOf<keyof ComponentEmailArgs>()
})

describe('sending email through the component', () => {
  let replies: Reply[]
  let answer: ((request: { url: string; body: Record<string, unknown> }) => Reply) | undefined
  let requests: SentRequest[]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('POSTHOG_PROJECT_TOKEN', 'phc_test')
    vi.stubEnv('POSTHOG_SECRET_KEY', 'phs_test_secret')
    replies = []
    finishedEmails.length = 0
    answer = undefined
    requests = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
        const reply = answer?.({ url, body }) ?? replies.shift()
        if (!reply) throw new Error('No reply queued')
        requests.push({ url, headers: init.headers as Record<string, string>, body, answer: reply })
        if (reply instanceof Error) throw reply
        return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'Content-Type': 'application/json', ...reply.headers },
        })
      })
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const send = (email: unknown, defaultTemplateKey?: string, withReactElement?: boolean) =>
    initConvexTest().action(anyApi.emails.send, { email, defaultTemplateKey, withReactElement })

  const failureOf = async (pending: Promise<unknown>) => {
    const error = await pending.then(
      () => undefined,
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(ConvexError)
    return (error as ConvexError<Value>).data as Record<string, unknown>
  }

  const QUEUE_STEP_MS = 100
  const QUEUE_GIVES_UP_AFTER_MS = 30 * 60_000

  const runQueue = async (t: ReturnType<typeof initConvexTest>, workId: string) => {
    for (let waited = 0; waited < QUEUE_GIVES_UP_AFTER_MS; waited += QUEUE_STEP_MS) {
      await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(QUEUE_STEP_MS))
      const status = await t.query(anyApi.emails.status, { id: workId })
      if (status.state === 'finished') return status
    }
    throw new Error('The queue never finished the email.')
  }

  const acceptedRequests = () => requests.filter(({ answer }) => !(answer instanceof Error) && answer.status === 202)

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
        '05-posthog-options',
        {
          distinctId: 'user_42',
          templateKey: 'order-shipped',
          idempotencyKey: 'order-981-shipped',
          tracking: { opens: true, clicks: false },
          sensitive: true,
        },
        undefined,
        {
          template_key: 'order-shipped',
          distinct_id: 'user_42',
          tracking: { opens: true, clicks: false },
          sensitive: true,
        },
        { 'Idempotency-Key': 'order-981-shipped' },
      ],
      ['07-template-key-config-default', {}, 'transactional', { template_key: 'transactional' }, {}],
      ['tracking off', { tracking: false }, undefined, { template_key: 'convex', tracking: false }, {}],
    ])('%s', async (_case, email, defaultTemplateKey, body, headers) => {
      replies.push(accepted())

      await expect(send({ ...ORDER_SHIPPED, ...email }, defaultTemplateKey)).resolves.toEqual({
        message_id: MESSAGE_ID,
        replayed: false,
      })

      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe(SEND_URL)
      expect(requests[0].body).toEqual({ ...ORDER_SHIPPED, ...body })
      expect(requests[0].headers).toMatchObject({
        'X-PostHog-Integration': expect.stringMatching(/^convex\/[0-9A-Za-z.+-]{1,40}$/),
        ...headers,
      })
    })

    test('04-attachments-and-inline', async () => {
      answer = ({ url, body }) =>
        url === UPLOADS_URL
          ? {
              status: 200,
              body: {
                files: (body.files as { sha256: string }[]).map(({ sha256 }) => ({ sha256, status: 'present' })),
              },
            }
          : accepted()
      const attachments = [
        { filename: 'invoice.pdf', contentType: 'application/pdf', content: 'JVBERi0xLjQK' },
        { filename: 'logo.png', contentType: 'image/png', content: 'iVBORw0KGgo=', contentId: 'logo' },
      ]

      await expect(send({ ...ORDER_SHIPPED, html: '<img src="cid:logo">', attachments })).resolves.toMatchObject({
        message_id: MESSAGE_ID,
      })

      const sent = requests.find(({ url }) => url === SEND_URL)
      expect(sent?.body).toMatchObject({ html: '<img src="cid:logo">', template_key: 'convex' })
      expect(sent?.body.attachments).toEqual([
        expect.objectContaining({ filename: 'invoice.pdf', content_type: 'application/pdf' }),
        expect.objectContaining({ filename: 'logo.png', content_type: 'image/png', content_id: 'logo' }),
      ])
    })

    test.each([
      [
        '08-refuse-invalid-template-key',
        { ...ORDER_SHIPPED, templateKey: 'order shipped!' },
        undefined,
        'invalid_template_key',
      ],
      ['an invalid default template key', ORDER_SHIPPED, 'order shipped!', 'invalid_template_key'],
      [
        '16-refuse-template-unsupported',
        { to: 'ana@example.com', templateId: '0190f0c2-7d1e-7a3b-9c2e-5f1a2b3c4d5e' },
        undefined,
        'template_unsupported',
      ],
      ['a React element', { to: 'ana@example.com', subject: 'Welcome' }, undefined, 'react_unsupported', true],
    ])(
      '%s is refused before anything is sent or queued',
      async (_case, email, defaultTemplateKey, refusal, withReactElement?: boolean) => {
        const refused = { code: refusal, retryable: false, name: 'validation_error', fix: expect.any(String) }
        expect(await failureOf(send(email, defaultTemplateKey, withReactElement))).toMatchObject(refused)

        const t = initConvexTest()
        const enqueued = t.mutation(anyApi.emails.enqueue, { email, defaultTemplateKey, withReactElement })
        expect(await failureOf(enqueued)).toMatchObject(refused)
        await t.finishAllScheduledFunctions(vi.runAllTimers)

        expect(requests).toHaveLength(0)
      }
    )
  })

  describe('a self-hosted or proxied PostHog', () => {
    test('sends to POSTHOG_APP_HOST', async () => {
      vi.stubEnv('POSTHOG_HOST', 'https://ingest.example.com')
      vi.stubEnv('POSTHOG_APP_HOST', 'https://posthog.example.com/')
      replies.push(accepted())

      await expect(send(ORDER_SHIPPED)).resolves.toMatchObject({ message_id: MESSAGE_ID })

      expect(requests.map(({ url }) => url)).toEqual([
        'https://posthog.example.com/api/projects/@current/messaging/send/email/',
      ])
    })

    test('without POSTHOG_APP_HOST, refuses to guess and sends nothing', async () => {
      vi.stubEnv('POSTHOG_HOST', 'https://ingest.example.com')

      expect(await failureOf(send(ORDER_SHIPPED))).toMatchObject({ code: 'missing_app_host', retryable: false })
      expect(requests).toHaveLength(0)
    })
  })

  describe('the error map', () => {
    test.each([
      [
        '400',
        { status: 400, body: { code: 'invalid_input', detail: 'Bad to.', attr: 'to' } },
        false,
        undefined,
        'validation_error',
      ],
      [
        '401',
        { status: 401, body: { code: 'authentication_failed', detail: 'Bad key.' } },
        false,
        undefined,
        'missing_api_key',
      ],
      [
        '403',
        { status: 403, body: { code: 'permission_denied', detail: 'No scope.' } },
        false,
        undefined,
        'invalid_permission',
      ],
      ['404', { status: 404, body: { code: 'not_found', detail: 'No template.' } }, false, undefined, 'not_found'],
      [
        '409 in flight',
        {
          status: 409,
          body: { code: 'idempotency_key_in_flight', detail: 'Still sending.' },
          headers: { 'Retry-After': '60' },
        },
        true,
        60,
        'concurrent_idempotent_requests',
      ],
      [
        '422',
        { status: 422, body: { code: 'recipient_suppressed', detail: 'Suppressed.' } },
        false,
        undefined,
        'validation_error',
      ],
      [
        '429 quota',
        { status: 429, body: { code: 'quota_limited', detail: 'Over quota.' } },
        false,
        undefined,
        'monthly_quota_exceeded',
      ],
      ['429 throttled', COOLING_DOWN, true, 60, 'rate_limit_exceeded'],
      [
        '503',
        { status: 503, body: { code: 'service_unavailable', detail: 'Try later.' }, headers: { 'Retry-After': '60' } },
        true,
        60,
        'service_unavailable',
      ],
      ['500', { status: 500, body: { code: 'error', detail: 'Broke.' } }, false, undefined, 'application_error'],
    ])('%s throws a ConvexError with the contract record', async (_row, reply, retryable, retryAfter, name) => {
      replies.push(reply as Reply)

      const data = await failureOf(send(ORDER_SHIPPED))

      expect(data).toMatchObject({
        status: (reply as { status: number }).status,
        code: (reply as { body: { code: string } }).body.code,
        detail: (reply as { body: { detail: string } }).body.detail,
        retryable,
        name,
      })
      expect(data.attr).toBe((reply as { body: { attr?: string } }).body.attr)
      expect(data.retry_after).toBe(retryAfter)
      expect(requests).toHaveLength(1)
    })

    test("PostHog's why, fix and docs link reach the app", async () => {
      replies.push({
        status: 422,
        body: {
          code: 'recipient_suppressed',
          detail: 'The recipient is suppressed.',
          why: 'They unsubscribed.',
          fix: 'Remove them from the send.',
          docs_url: 'https://posthog.com/docs/workflows/email',
        },
      })

      expect(await failureOf(send(ORDER_SHIPPED))).toMatchObject({
        code: 'recipient_suppressed',
        why: 'They unsubscribed.',
        fix: 'Remove them from the send.',
        docs_url: 'https://posthog.com/docs/workflows/email',
      })
    })

    test('a network error is retryable after the SDK retries it with the same key', async () => {
      vi.useRealTimers()
      replies.push(new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed'))

      const data = await failureOf(send(ORDER_SHIPPED))

      expect(data).toMatchObject({ code: 'network_error', retryable: true, name: 'service_unavailable' })
      expect(data).not.toHaveProperty('status')
      expect(requests).toHaveLength(3)
      expect(new Set(requests.map((r) => r.headers['Idempotency-Key'])).size).toBe(1)
    }, 15_000)

    test('a file storage outage is retryable after the SDK retries the upload', async () => {
      vi.useRealTimers()
      answer = uploadsAnswering({ storage: { status: 502 } })

      const data = await failureOf(send(INVOICE_ATTACHED))

      expect(data).toMatchObject({ status: 502, code: 'attachment_upload_failed', retryable: true })
      expect(requests.filter(({ url }) => url === SEND_URL)).toHaveLength(0)
    }, 15_000)

    test('an exhausted upload quota is a permanent failure', async () => {
      answer = uploadsAnswering({
        uploads: { status: 429, body: { code: 'upload_quota_exceeded', detail: 'Over the upload quota.' } },
      })

      const data = await failureOf(send(INVOICE_ATTACHED))

      expect(data).toMatchObject({ status: 429, code: 'upload_quota_exceeded', retryable: false })
      expect(requests).toHaveLength(1)
    })

    test('a missing secret key is a permanent failure that sends nothing', async () => {
      vi.stubEnv('POSTHOG_SECRET_KEY', '')

      const data = await failureOf(send(ORDER_SHIPPED))

      expect(data).toMatchObject({ code: 'missing_secret_key', retryable: false })
      expect(requests).toHaveLength(0)
    })
  })

  describe('a queued send', () => {
    test('makes its key at enqueue and retries a retryable failure with it', async () => {
      const networkDown = new TypeError('fetch failed')
      replies.push(networkDown, networkDown, networkDown, accepted(true))
      const t = initConvexTest()

      const workId = await t.mutation(anyApi.emails.enqueue, { email: ORDER_SHIPPED })

      expect(requests).toHaveLength(0)
      await expect(runQueue(t, workId)).resolves.toEqual({ state: 'finished' })
      expect(acceptedRequests()).toHaveLength(1)
      const keys = new Set(requests.map((r) => r.headers['Idempotency-Key']))
      expect(keys.size).toBe(1)
      expect([...keys][0]).toMatch(UUID)
    })

    test('waits out a cooldown longer than every Workpool backoff, and sends once it ends', async () => {
      let cooldownEndsAt: number | undefined
      answer = () => {
        cooldownEndsAt ??= Date.now() + 60_000
        return Date.now() < cooldownEndsAt ? COOLING_DOWN : accepted()
      }
      const t = initConvexTest()

      const workId = await t.mutation(anyApi.emails.enqueue, { email: ORDER_SHIPPED })

      await expect(runQueue(t, workId)).resolves.toEqual({ state: 'finished' })
      expect(acceptedRequests()).toHaveLength(1)
      expect(new Set(requests.map((r) => r.headers['Idempotency-Key'])).size).toBe(1)
    })

    test('ends at once, without sending early, when PostHog asks to wait longer than a queued send waits', async () => {
      replies.push(
        { status: 429, body: { code: 'throttled', detail: 'Slow down.' }, headers: { 'Retry-After': '1800' } },
        accepted(),
        accepted()
      )
      const t = initConvexTest()
      const enqueuedAt = Date.now()

      const workId = await t.mutation(anyApi.emails.enqueue, { email: ORDER_SHIPPED })

      await expect(runQueue(t, workId)).resolves.toEqual({ state: 'finished' })
      expect(Date.now() - enqueuedAt).toBeLessThan(60_000)
      expect(requests).toHaveLength(1)
      expect(finishedEmails).toEqual([{ workId, result: { kind: 'failed', error: expect.any(String) } }])
      const { error } = finishedEmails[0].result
      expect(error).toContain('PostHog asked to wait 1800s, which ends more than five minutes after this attempt began')
      expect(error).toContain(`idempotencyKey ${requests[0].headers['Idempotency-Key']}`)
    })

    test('the queued action refuses an email without an idempotency key, so no retry can send it twice', async () => {
      const t = initConvexTest()

      await expect(
        t.action(anyApi.emails.sendQueuedDirectly, { email: { ...ORDER_SHIPPED, templateKey: 'convex' } })
      ).rejects.toThrow(/idempotencyKey/)
      expect(requests).toHaveLength(0)
    })

    test('refuses an email too large for a queued job before it is queued, and points at sendEmail', async () => {
      const largeInvoice = { filename: 'invoice.pdf', content: 'A'.repeat(1_000_000), contentType: 'application/pdf' }
      const t = initConvexTest()

      const refused = failureOf(
        t.mutation(anyApi.emails.enqueue, { email: { ...ORDER_SHIPPED, attachments: [largeInvoice] } })
      )

      expect(await refused).toMatchObject({
        code: 'queued_email_too_large',
        name: 'validation_error',
        retryable: false,
        fix: expect.stringContaining('sendEmail'),
      })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(requests).toHaveLength(0)
      expect(finishedEmails).toHaveLength(0)
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
