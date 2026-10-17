import type { PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'
import { type EmailContent, emailContentHash } from '@/email-content-hash'

const UPLOAD_PATH = /^\/api\/projects\/@current\/messaging_templates\/by_key\/([^/]+)\/$/
const SEND_PATH = '/api/projects/@current/messaging/send/email/'
const KEY_PATTERN = /^[a-zA-Z0-9_-]{1,400}$/
const DOCS_URL = 'https://posthog.com/docs/workflows/transactional-email-api'
const PUBLISHED_PARTS = ['subject', 'preheader', 'html', 'text'] as const

export interface ReceivedRequest {
  method: string
  path: string
  authorization: string | null
  body: Record<string, any>
}

export interface PublishedTemplate extends EmailContent {
  id: string
  key: string
  name: string
  contentHash: string
  supersededHashes: string[]
  source: { repository?: string; path?: string; ref?: string }
}

export interface DeliveredEmail {
  messageId: string
  to: string
  key: string
  subject?: string
  preheader?: string
  html?: string
  variables: Record<string, unknown>
  distinctId?: string
}

export type Fault = { status: number; body?: unknown } | { networkError: Error }

interface ScheduledFault {
  matches: (request: ReceivedRequest) => boolean
  fault: Fault
  remaining: number
}

/**
 * An in-memory PostHog that speaks the upload and send routes of the transactional email API, including the
 * content hash rule: a current or absent hash sends, a superseded hash sends the current content with a warning,
 * and a hash PostHog never published answers `template_outdated`. An upload with `if_not_superseded` of replaced
 * content changes nothing and answers `superseded`.
 */
export class FakeEmailsApi {
  readonly received: ReceivedRequest[] = []
  readonly delivered: DeliveredEmail[] = []
  private readonly templates = new Map<string, PublishedTemplate>()
  private readonly faults: ScheduledFault[] = []
  private nextId = 1

  constructor(private readonly options: { secretKey: string }) {}

  readonly fetch = async (url: string, init: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
    const request = await describe(new Request(url, init as RequestInit))
    this.received.push(request)
    const fault = this.takeFault(request)
    if (fault && 'networkError' in fault) {
      throw fault.networkError
    }
    if (fault) {
      return respond(fault.status, fault.body)
    }
    return this.handle(request)
  }

  async publish(key: string, content: EmailContent & { name?: string }): Promise<PublishedTemplate> {
    await this.upload(key, { name: key, ...content })
    return this.template(key)!
  }

  template(key: string): PublishedTemplate | undefined {
    return this.templates.get(key)
  }

  failWhen(matches: (request: ReceivedRequest) => boolean, fault: Fault, times = Infinity): void {
    this.faults.push({ matches, fault, remaining: times })
  }

  get requestLog(): string[] {
    return this.received.map(({ method, path }) => `${method} ${path}`)
  }

  private takeFault(request: ReceivedRequest): Fault | undefined {
    const scheduled = this.faults.find((candidate) => candidate.remaining > 0 && candidate.matches(request))
    if (scheduled) {
      scheduled.remaining--
    }
    return scheduled?.fault
  }

  private async handle(request: ReceivedRequest): Promise<PostHogFetchResponse> {
    if (request.authorization !== `Bearer ${this.options.secretKey}`) {
      return respond(401, {
        type: 'authentication_error',
        code: 'authentication_failed',
        detail: 'Project secret API key is invalid.',
        attr: null,
      })
    }
    const uploadKey = UPLOAD_PATH.exec(request.path)?.[1]
    if (request.method === 'PUT' && uploadKey) {
      return this.handleUpload(decodeURIComponent(uploadKey), request.body)
    }
    if (request.method === 'POST' && request.path === SEND_PATH) {
      return this.handleSend(request.body)
    }
    return respond(404, { type: 'invalid_request', code: 'not_found', detail: 'Endpoint not found.', attr: null })
  }

  private async handleUpload(key: string, body: Record<string, any>): Promise<PostHogFetchResponse> {
    if (!KEY_PATTERN.test(key)) {
      return refusal(400, 'invalid_template_key', 'key')
    }
    for (const field of ['name', 'subject', 'html']) {
      if (typeof body[field] !== 'string' || body[field] === '') {
        return refusal(400, 'invalid_request', field)
      }
    }
    const { template, result } = await this.upload(key, body)
    return respond(result === 'created' ? 201 : 200, {
      id: template.id,
      key,
      result,
      content_hash: template.contentHash,
      managed_by: 'code',
      source: template.source,
      transactional_hog_flow_id: `flow-${template.id}`,
    })
  }

  private async upload(
    key: string,
    body: Record<string, any>
  ): Promise<{ template: PublishedTemplate; result: 'created' | 'updated' | 'unchanged' | 'superseded' }> {
    const content: EmailContent = { subject: body.subject, preheader: body.preheader, html: body.html, text: body.text }
    const contentHash = await emailContentHash(content)
    const existing = this.templates.get(key)
    if (body.if_not_superseded === true && existing?.supersededHashes.includes(contentHash)) {
      return { template: existing, result: 'superseded' }
    }
    const source = { ...existing?.source, ...body.source }
    if (!existing) {
      const template = { id: `template-${this.nextId++}`, key, name: body.name, ...content, contentHash, source }
      this.templates.set(key, { ...template, supersededHashes: [] })
      return { template: this.templates.get(key)!, result: 'created' }
    }
    if (
      existing.name === body.name &&
      PUBLISHED_PARTS.every((part) => (existing[part] ?? '') === (content[part] ?? ''))
    ) {
      existing.source = source
      return { template: existing, result: 'unchanged' }
    }
    const supersededHashes = [existing.contentHash, ...existing.supersededHashes].filter(
      (hash, index, hashes) => hash !== contentHash && hashes.indexOf(hash) === index
    )
    const template = { ...existing, name: body.name, ...content, contentHash, supersededHashes, source }
    this.templates.set(key, template)
    return { template, result: 'updated' }
  }

  private handleSend(body: Record<string, any>): PostHogFetchResponse {
    const { key, hash } = body.template ?? {}
    if (typeof key !== 'string') {
      return refusal(400, 'invalid_request', 'template')
    }
    if (!KEY_PATTERN.test(key)) {
      return refusal(400, 'invalid_template_key', 'template__key')
    }
    const template = this.templates.get(key)
    if (!template) {
      return refusal(404, 'template_not_found', 'template__key')
    }
    if (hash !== undefined && hash !== template.contentHash && !template.supersededHashes.includes(hash)) {
      return refusal(409, 'template_outdated', 'template__hash')
    }
    const messageId = `message-${this.nextId++}`
    this.delivered.push({
      messageId,
      to: body.to,
      key,
      subject: template.subject,
      preheader: template.preheader,
      html: template.html,
      variables: body.message_data ?? {},
      distinctId: body.identifiers?.distinct_id,
    })
    const superseded = hash !== undefined && hash !== template.contentHash
    return respond(202, {
      message_id: messageId,
      warnings: superseded
        ? [
            {
              code: 'template_superseded',
              detail: 'The email was sent with the template’s current content.',
              fix: 'Deploy the newer file, or upload your file to publish it again.',
            },
          ]
        : [],
    })
  }
}

async function describe(request: Request): Promise<ReceivedRequest> {
  const text = await request.text()
  return {
    method: request.method,
    path: new URL(request.url).pathname,
    authorization: request.headers.get('Authorization'),
    body: text ? JSON.parse(text) : {},
  }
}

function refusal(status: number, code: string, attr: string): PostHogFetchResponse {
  return respond(status, {
    type: 'invalid_request',
    code,
    detail: `Refused with ${code}.`,
    attr,
    why: 'Because the fake says so.',
    fix: 'Fix it.',
    docs_url: `${DOCS_URL}#${code}`,
  })
}

function respond(status: number, body: unknown): PostHogFetchResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '')
  return new Response(text, { status, headers: { 'Content-Type': 'application/json' } })
}
