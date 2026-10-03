import type { PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'

type PreferenceStatus = 'OPTED_IN' | 'OPTED_OUT'
type CategoryType = 'marketing' | 'transactional'
type PreferenceAction = 'add_opt_out' | 'remove_opt_out'

const ALL_MARKETING = '$all'
const PREFERENCES_PATH = /^\/api\/projects\/@current\/messaging_preferences\/(add_opt_out|remove_opt_out)\/$/

export interface ReceivedRequest {
  method: string
  path: string
  action?: PreferenceAction
  token: string | null
  authorization: string | null
  contentType: string | null
  identifier?: string
  categoryKey?: string
}

export interface RecipientPreferences {
  allMarketing?: boolean
  categories: Record<string, boolean>
}

export type Fault =
  | { status: number; body?: string }
  | { networkError: Error }
  | { hang: 'response' }
  | { hang: 'body'; status: number }

interface ScheduledFault {
  matches: (request: ReceivedRequest) => boolean
  fault: Fault
  remaining: number
}

export interface FakeMessagingPreferencesApiOptions {
  projectToken: string
  secretKey: string
  categories: Record<string, CategoryType>
  lastViewedProjectToken: string
}

export class FakeMessagingPreferencesApi {
  readonly received: ReceivedRequest[] = []
  private readonly recordsByProject = new Map<string, Map<string, Map<string, PreferenceStatus>>>()
  private readonly faults: ScheduledFault[] = []
  private pausedUntil: Promise<void> | undefined
  private inFlight = 0
  private peakInFlight = 0

  constructor(private readonly options: FakeMessagingPreferencesApiOptions) {}

  readonly fetch = async (url: string, init: PostHogFetchOptions): Promise<PostHogFetchResponse> => {
    const request = new Request(url, init as RequestInit)
    const received = await this.describe(request)
    this.received.push(received)
    this.inFlight++
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight)
    try {
      await this.pausedUntil
      return this.faultResponse(received) ?? this.handle(received)
    } finally {
      this.inFlight--
    }
  }

  preferencesOf(identifier: string, projectToken = this.options.projectToken): RecipientPreferences | undefined {
    const record = this.recordsOf(projectToken).get(identifier)
    if (!record) {
      return undefined
    }
    const categories: Record<string, boolean> = {}
    for (const [key, status] of record) {
      if (key !== ALL_MARKETING) {
        categories[key] = status === 'OPTED_IN'
      }
    }
    const allMarketing = record.get(ALL_MARKETING)
    return allMarketing === undefined ? { categories } : { allMarketing: allMarketing === 'OPTED_IN', categories }
  }

  wouldReceive(identifier: string, categoryKey: string): boolean {
    if (this.categoryType(categoryKey) === 'transactional') {
      return true
    }
    const record = this.recordsOf(this.options.projectToken).get(identifier)
    return record?.get(categoryKey) !== 'OPTED_OUT' && record?.get(ALL_MARKETING) !== 'OPTED_OUT'
  }

  failWhen(matches: (request: ReceivedRequest) => boolean, fault: Fault, times = Infinity): void {
    this.faults.push({ matches, fault, remaining: times })
  }

  pause(): () => void {
    let resume = (): void => {}
    this.pausedUntil = new Promise((resolve) => (resume = resolve))
    return () => {
      this.pausedUntil = undefined
      resume()
    }
  }

  get maxConcurrentRequests(): number {
    return this.peakInFlight
  }

  private async describe(request: Request): Promise<ReceivedRequest> {
    const url = new URL(request.url)
    const contentType = request.headers.get('Content-Type')
    const body = await readBody(request, contentType)
    return {
      method: request.method,
      path: url.pathname,
      action: PREFERENCES_PATH.exec(url.pathname)?.[1] as PreferenceAction | undefined,
      token: tokenAsDjangoReadsIt(request.method, url, body),
      authorization: request.headers.get('Authorization'),
      contentType,
      identifier: body.get('identifier')?.trim(),
      categoryKey: body.get('category_key') ?? undefined,
    }
  }

  private faultResponse(request: ReceivedRequest): Promise<PostHogFetchResponse> | undefined {
    const scheduled = this.faults.find((candidate) => candidate.remaining > 0 && candidate.matches(request))
    if (!scheduled) {
      return undefined
    }
    scheduled.remaining--
    const { fault } = scheduled
    if ('networkError' in fault) {
      return Promise.reject(fault.networkError)
    }
    if ('hang' in fault) {
      return fault.hang === 'response' ? new Promise(() => {}) : Promise.resolve(neverEndingBody(fault.status))
    }
    return Promise.resolve(new Response(fault.body ?? '', { status: fault.status }))
  }

  private handle(request: ReceivedRequest): PostHogFetchResponse {
    if (request.method !== 'POST' || !request.action) {
      return json(404, { detail: 'Not found.' })
    }
    if (request.authorization !== `Bearer ${this.options.secretKey}`) {
      return json(401, { detail: 'Personal API key is invalid.' })
    }
    const projectToken = request.token ?? this.options.lastViewedProjectToken
    if (projectToken !== this.options.projectToken && projectToken !== this.options.lastViewedProjectToken) {
      return json(401, { detail: 'Project API key invalid.' })
    }
    if (!request.identifier) {
      return json(400, { identifier: ['This field may not be blank.'] })
    }
    if (request.categoryKey !== undefined && !this.categoryType(request.categoryKey)) {
      return json(404, { error: 'Category not found' })
    }

    const records = this.recordsOf(projectToken)
    const created = !records.has(request.identifier)
    const record = records.get(request.identifier) ?? new Map<string, PreferenceStatus>()
    records.set(request.identifier, record)
    if (request.action === 'add_opt_out') {
      record.set(request.categoryKey ?? ALL_MARKETING, 'OPTED_OUT')
    } else {
      this.optIn(record, request.categoryKey)
    }
    return json(created ? 201 : 200, { identifier: request.identifier, preferences: Object.fromEntries(record) })
  }

  private optIn(record: Map<string, PreferenceStatus>, categoryKey: string | undefined): void {
    if (categoryKey === undefined) {
      record.set(ALL_MARKETING, 'OPTED_IN')
      return
    }
    if (this.categoryType(categoryKey) === 'marketing' && record.get(ALL_MARKETING) === 'OPTED_OUT') {
      this.optOutOfMarketingExcept(record, categoryKey)
      record.set(ALL_MARKETING, 'OPTED_IN')
    }
    record.set(categoryKey, 'OPTED_IN')
  }

  private optOutOfMarketingExcept(record: Map<string, PreferenceStatus>, keptCategoryKey: string): void {
    for (const [key, type] of Object.entries(this.options.categories)) {
      if (type === 'marketing' && key !== keptCategoryKey) {
        record.set(key, 'OPTED_OUT')
      }
    }
  }

  private recordsOf(projectToken: string): Map<string, Map<string, PreferenceStatus>> {
    const records = this.recordsByProject.get(projectToken) ?? new Map<string, Map<string, PreferenceStatus>>()
    this.recordsByProject.set(projectToken, records)
    return records
  }

  private categoryType(categoryKey: string): CategoryType | undefined {
    return Object.prototype.hasOwnProperty.call(this.options.categories, categoryKey)
      ? this.options.categories[categoryKey]
      : undefined
  }
}

async function readBody(request: Request, contentType: string | null): Promise<Map<string, string>> {
  const text = await request.text()
  if (contentType === 'application/x-www-form-urlencoded') {
    return new Map(new URLSearchParams(text))
  }
  const parsed: unknown = text ? JSON.parse(text) : {}
  const entries = Object.entries(parsed && typeof parsed === 'object' ? parsed : {})
  return new Map(entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function tokenAsDjangoReadsIt(method: string, url: URL, body: Map<string, string>): string | null {
  return method === 'GET' ? url.searchParams.get('token') : (body.get('token') ?? null)
}

function json(status: number, body: unknown): PostHogFetchResponse {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function neverEndingBody(status: number): PostHogFetchResponse {
  return {
    status,
    text: () => new Promise(() => {}),
    json: () => new Promise(() => {}),
  }
}
