import type { PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'

const TEMPLATE_SEND_PATH = /^\/api\/projects\/@current\/messaging_templates\/([^/]+)\/send\/$/
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
  templateId: string
  variables: Record<string, unknown>
  distinctId?: string
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
 * An in-memory PostHog app host that speaks the template send route of the transactional email API, with its
 * idempotency rule: a key PostHog already accepted for the same request answers the first `202` again.
 */
export class FakeEmailsApi {
  readonly received: ReceivedRequest[] = []
  readonly delivered: DeliveredEmail[] = []
  private readonly templateIds = new Set<string>()
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
      return breakOff(this.handle(request), fault.bodyBreaksOff)
    }
    if (fault) {
      return respond(fault.status, fault.body, fault.headers)
    }
    return this.handle(request)
  }

  addTemplate(id: string): void {
    this.templateIds.add(id)
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

  private handle(request: ReceivedRequest): PostHogFetchResponse {
    if (request.origin !== this.options.appHost) {
      return respond(404, '<html>Not the app host</html>')
    }
    if (request.headers.authorization !== `Bearer ${this.options.secretKey}`) {
      return refusal(401, 'authentication_failed', null)
    }
    const templateId = TEMPLATE_SEND_PATH.exec(request.path)?.[1]
    if (request.method === 'POST' && templateId) {
      return this.handleTemplateSend(decodeURIComponent(templateId), request)
    }
    return refusal(404, 'not_found', null)
  }

  private handleTemplateSend(templateId: string, { headers, body }: ReceivedRequest): PostHogFetchResponse {
    if (!this.templateIds.has(templateId)) {
      return refusal(404, 'not_found', null)
    }
    const key = headers['idempotency-key']
    const fingerprint = JSON.stringify([templateId, body])
    const earlier = key === undefined ? undefined : this.accepted.get(key)
    if (earlier) {
      return earlier.fingerprint === fingerprint
        ? respond(202, { message_id: earlier.messageId, replayed: true })
        : refusal(422, 'idempotency_key_reused', null)
    }
    const messageId = `message-${this.nextId++}`
    if (key !== undefined) {
      this.accepted.set(key, { fingerprint, messageId })
    }
    this.delivered.push({
      messageId,
      to: body.to,
      templateId,
      variables: body.message_data ?? {},
      distinctId: body.identifiers?.distinct_id,
    })
    return respond(202, { message_id: messageId, replayed: false })
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
