import { canonicalizeUuid } from '@/capture-v1/uuid'
import type { PostHogOptions } from '@/entrypoints/index.node'

import { AI_CAPTURE_PATH, ANALYTICS_CAPTURE_PATH, captureEvents } from '../utils'
import { V1WiringHarness } from '../utils/v1-wiring'

vi.mock('../../version', () => ({ version: '1.2.3' }))

const CANONICAL = '0198c0de-1234-7abc-8def-0123456789ab'
const WARNING = '[PostHog] Replaced an invalid event uuid with a generated one; uuids must be RFC 4122 strings'
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const ACCEPTED: [string, string][] = [
  ['hyphenated', CANONICAL],
  ['uppercase', CANONICAL.toUpperCase()],
  ['braced', `{${CANONICAL}}`],
  ['braced uppercase', `{${CANONICAL.toUpperCase()}}`],
  ['urn', `urn:uuid:${CANONICAL}`],
  ['uppercase urn', `URN:UUID:${CANONICAL.toUpperCase()}`],
  ['32 hex digits', CANONICAL.replace(/-/g, '')],
]

const REJECTED: [string, string][] = [
  ['bracketed', `[${CANONICAL}]`],
  ['parenthesized', `(${CANONICAL})`],
  ['misplaced hyphens', '0198c0de1-234-7abc-8def-0123456789ab'],
  ['hyphens in the 32-hex form', '0198c0de-12347abc8def0123456789ab'],
  ['a braced 32-hex form', `{${CANONICAL.replace(/-/g, '')}}`],
  ['a urn 32-hex form', `urn:uuid:${CANONICAL.replace(/-/g, '')}`],
  ['an unclosed brace', `{${CANONICAL}`],
  ['surrounding whitespace', ` ${CANONICAL}`],
  ['a non-hex digit', CANONICAL.replace('a', 'g')],
  ['31 hex digits', CANONICAL.replace(/-/g, '').slice(1)],
  ['free text', 'my-event-id'],
]

describe('canonicalizeUuid', () => {
  it.each(ACCEPTED)('accepts the %s form as lowercase hyphenated', (_label, value) => {
    expect(canonicalizeUuid(value)).toBe(CANONICAL)
  })

  it.each(REJECTED)('rejects %s', (_label, value) => {
    expect(canonicalizeUuid(value)).toBeUndefined()
  })
})

describe('event uuids on the client', () => {
  const harness = new V1WiringHarness()
  let warn: vi.SpyInstance

  beforeEach(() => {
    vi.useFakeTimers()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    harness.useDefaultRouting()
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.clearAllMocks()
  })

  const uuidWarnings = (): unknown[][] => warn.mock.calls.filter(([message]) => String(message).includes('uuid'))

  async function wireUuid(uuid: string | undefined, options: PostHogOptions = {}): Promise<string> {
    const posthog = harness.makeClient(options)
    posthog.capture({ distinctId: 'u', event: 'e', properties: {}, uuid })
    await posthog.flush()
    const events = captureEvents(harness.fetch, ANALYTICS_CAPTURE_PATH)
    expect(events).toHaveLength(1)
    return events[0].uuid
  }

  it.each(ACCEPTED)('sends a %s uuid in canonical form without a warning', async (_label, value) => {
    expect(await wireUuid(value)).toBe(CANONICAL)
    expect(uuidWarnings()).toEqual([])
  })

  it.each(REJECTED)('replaces a uuid with %s, with one warning that does not repeat it', async (_label, value) => {
    const sent = await wireUuid(value)

    expect(sent).toMatch(UUID_V7)
    expect(uuidWarnings()).toEqual([[WARNING]])
    expect(WARNING).not.toContain(value)
  })

  it.each<[string, string | undefined]>([
    ['empty', ''],
    ['missing', undefined],
  ])('generates a uuid for a %s one without a warning', async (_label, value) => {
    expect(await wireUuid(value)).toMatch(UUID_V7)
    expect(uuidWarnings()).toEqual([])
  })

  it('shows before_send the canonical uuid', async () => {
    const seen: (string | undefined)[] = []
    await wireUuid(`{${CANONICAL.toUpperCase()}}`, {
      before_send: (event) => {
        seen.push(event?.uuid)
        return event
      },
    })

    expect(seen).toEqual([CANONICAL])
  })

  it.each<[string, string, string | RegExp, unknown[][]]>([
    ['canonicalizes', `urn:uuid:${CANONICAL.toUpperCase()}`, CANONICAL, []],
    ['replaces, with one warning,', 'not-a-uuid', UUID_V7, [[WARNING]]],
  ])('%s a uuid that before_send sets', async (_label, hookUuid, expected, warnings) => {
    const sent = await wireUuid(undefined, { before_send: (event) => event && { ...event, uuid: hookUuid } })

    expect(sent).toMatch(expected)
    expect(uuidWarnings()).toEqual(warnings)
  })

  it('warns once when the caller and before_send both keep an invalid uuid', async () => {
    const sent = await wireUuid('bad-uuid', { before_send: (event) => event })

    expect(sent).toMatch(UUID_V7)
    expect(uuidWarnings()).toEqual([[WARNING]])
  })

  it.each<[string, string, string | RegExp, unknown[][]]>([
    ['a canonical form of', `{${CANONICAL.toUpperCase()}}`, CANONICAL, []],
    ['a generated replacement for', `[${CANONICAL}]`, UUID_V7, [[WARNING]]],
  ])('captureAi returns and sends %s the caller uuid', async (_label, value, expected, warnings) => {
    const posthog = harness.makeClient()

    const returned = posthog.captureAi({ distinctId: 'u', event: '$ai_generation', properties: {}, uuid: value })
    await posthog.flush()

    expect(returned).toMatch(expected)
    expect(captureEvents(harness.fetch, AI_CAPTURE_PATH).map((event) => event.uuid)).toEqual([returned])
    expect(uuidWarnings()).toEqual(warnings)
  })

  it('warns once per bad call', async () => {
    const posthog = harness.makeClient()

    posthog.capture({ distinctId: 'u', event: 'a', properties: {}, uuid: 'bad-1' })
    posthog.capture({ distinctId: 'u', event: 'b', properties: {}, uuid: 'bad-2' })
    await posthog.flush()

    expect(uuidWarnings()).toEqual([[WARNING], [WARNING]])
  })
})
