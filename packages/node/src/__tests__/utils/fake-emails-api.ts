import type { PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'
import { emailContentHash } from '@/email-content-hash'

const SEND_PATH = '/api/projects/@current/messaging/send/email/'
const UPLOAD_PATH = /^\/api\/projects\/@current\/messaging_templates\/by_key\/([^/]+)\/$/
const DOCS_URL = 'https://posthog.com/docs/workflows/transactional-email-api'

export interface ReceivedRequest {
  method: string
  origin: string
  path: string
  headers: Record<string, string>
  body: Record<string, any>
}

export interface DeliveredEmail {
  messageId: string
  to: string
  /** The template id, the local template's key, or the rendered content's `template_key`. */
  template: string
  subject?: string
  html?: string
  text?: string
  variables?: Record<string, unknown>
  distinctId?: string
}

interface LocalTemplate {
  subject: string
  html: string
  text?: string
  contentHash: string
  editedInPostHog: boolean
}

export type Fault =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { networkError: Error }
  | { bodyBreaksOff: Error }

interface ScheduledFault {
  matches: (request: ReceivedRequest) => boolean
  fault: Fault
  remaining: number
}

/**
 * An in-memory PostHog app host that speaks the send and upload routes of the transactional email API: a template by
 * id, rendered content by `template_key`, and a local template by key and content hash, which answers
 * `template_outdated` until an upload publishes that content. An idempotency key PostHog already accepted for the
 * same request answers the first `202` again.
 */
export class FakeEmailsApi {
  readonly received: ReceivedRequest[] = []
  readonly delivered: DeliveredEmail[] = []
  private readonly templateIds = new Set<string>()
  private readonly localTemplates = new Map<string, LocalTemplate>()
  private readonly accepted = new Map<string, { fingerprint: string; messageId: string }>()
  private readonly faults: ScheduledFault[] = []
  private nextId = 1

  constructor(private readonly options: { secretKey: string; appHost: string }) {}

  readonly fetch = async (url: string, init: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
    const request = await describe(new Request(url, init as RequestInit))
    this.received.push(request)
    const fault = this.takeFault(request)
    if (fault && 'networkError' in fault) {
      throw fault.networkError
    }
    if (fault && 'bodyBreaksOff' in fault) {
      return breakOff(await this.handle(request), fault.bodyBreaksOff)
    }
    if (fault) {
      return respond(fault.status, fault.body, fault.headers)
    }
    return this.handle(request)
  }

  addTemplate(id: string): void {
    this.templateIds.add(id)
  }

  editInPostHog(key: string, content: { subject: string; html: string }): void {
    this.localTemplates.set(key, { ...content, contentHash: 'v1:edited', editedInPostHog: true })
  }

  localTemplate(key: string): LocalTemplate | undefined {
    return this.localTemplates.get(key)
  }

  failWhen(matches: (request: ReceivedRequest) => boolean, fault: Fault, times = Infinity): void {
    this.faults.push({ matches, fault, remaining: times })
  }

  failNext(fault: Fault, times = 1): void {
    this.failWhen(() => true, fault, times)
  }

  private takeFault(request: ReceivedRequest): Fault | undefined {
    const scheduled = this.faults.find((candidate) => candidate.remaining > 0 && candidate.matches(request))
    if (scheduled) {
      scheduled.remaining--
    }
    return scheduled?.fault
  }

  private async handle(request: ReceivedRequest): Promise<PostHogFetchResponse> {
    if (request.origin !== this.options.appHost) {
      return respond(404, '<html>Not the app host</html>')
    }
    if (request.headers.authorization !== `Bearer ${this.options.secretKey}`) {
      return refusal(401, 'authentication_failed', null)
    }
    const uploadKey = UPLOAD_PATH.exec(request.path)?.[1]
    if (request.method === 'PUT' && uploadKey) {
      return this.handleUpload(decodeURIComponent(uploadKey), request.body)
    }
    if (request.method === 'POST' && request.path === SEND_PATH) {
      return this.handleSend(request)
    }
    return refusal(404, 'not_found', null)
  }

  private async handleUpload(key: string, body: Record<string, any>): Promise<PostHogFetchResponse> {
    const existing = this.localTemplates.get(key)
    if (existing?.editedInPostHog && body.if_code_managed === true) {
      return refusal(409, 'template_edited_in_posthog', null)
    }
    const { subject, html, text } = body
    const contentHash = await emailContentHash({ subject, html, text })
    this.localTemplates.set(key, { subject, html, text, contentHash, editedInPostHog: false })
    return respond(existing ? 200 : 201, { key, result: existing ? 'updated' : 'created', content_hash: contentHash })
  }

  private handleSend({ headers, body }: ReceivedRequest): PostHogFetchResponse {
    const refused = this.refusalOf(body)
    if (refused) {
      return refused
    }
    const key = headers['idempotency-key']
    const fingerprint = JSON.stringify(body)
    const earlier = key === undefined ? undefined : this.accepted.get(key)
    if (earlier) {
      return earlier.fingerprint === fingerprint
        ? respond(202, { message_id: earlier.messageId, replayed: true, warnings: [] })
        : refusal(422, 'idempotency_key_reused', null)
    }
    const messageId = `message-${this.nextId++}`
    if (key !== undefined) {
      this.accepted.set(key, { fingerprint, messageId })
    }
    this.delivered.push({ messageId, to: body.to, distinctId: body.identifiers?.distinct_id, ...this.contentOf(body) })
    return respond(202, { message_id: messageId, replayed: false, warnings: [] })
  }

  private refusalOf(body: Record<string, any>): PostHogFetchResponse | undefined {
    const { id, key, hash } = body.template ?? {}
    if (id !== undefined && !this.templateIds.has(id)) {
      return refusal(404, 'template_not_found', 'template__id')
    }
    const local = key === undefined ? undefined : this.localTemplates.get(key)
    if (key !== undefined && (!local || (hash !== undefined && hash !== local.contentHash))) {
      return refusal(409, 'template_outdated', local ? 'template__hash' : 'template__key')
    }
    return undefined
  }

  private contentOf(body: Record<string, any>): Omit<DeliveredEmail, 'messageId' | 'to' | 'distinctId'> {
    const { id, key } = body.template ?? {}
    if (id !== undefined) {
      return { template: id, variables: body.message_data ?? {} }
    }
    if (key !== undefined) {
      const { subject, html, text } = this.localTemplates.get(key)!
      return { template: key, subject, html, text, variables: body.message_data ?? {} }
    }
    return { template: body.template_key, subject: body.subject, html: body.html, text: body.text }
  }
}

async function describe(request: Request): Promise<ReceivedRequest> {
  const text = await request.text()
  const url = new URL(request.url)
  return {
    method: request.method,
    origin: url.origin,
    path: url.pathname,
    headers: Object.fromEntries(request.headers.entries()),
    body: text ? JSON.parse(text) : {},
  }
}

export function refusal(status: number, code: string, attr: string | null): PostHogFetchResponse {
  return respond(status, refusalBody(code, attr))
}

export function refusalBody(code: string, attr: string | null): Record<string, unknown> {
  return {
    type: 'invalid_request',
    code,
    detail: `Refused with ${code}.`,
    attr,
    why: `Because the fake refuses ${code}.`,
    fix: `Fix ${code}.`,
    docs_url: `${DOCS_URL}#${code}`,
  }
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): PostHogFetchResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '')
  return new Response(text, { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

/** The answer PostHog sent, with a body that fails while the SDK reads it. */
function breakOff(answer: PostHogFetchResponse, error: Error): PostHogFetchResponse {
  const body = new ReadableStream({ start: (controller) => controller.error(error) })
  return new Response(body, { status: answer.status })
}
