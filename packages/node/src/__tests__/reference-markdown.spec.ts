import fs from 'node:fs'
import path from 'node:path'

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..')
const REFERENCE_PATH = path.join(PACKAGE_ROOT, 'references', 'posthog-node-reference.md')
const MAJOR_6_PATH = path.join(PACKAGE_ROOT, 'references', 'posthog-node-6.md')
const GETTING_STARTED_PATH = path.join(PACKAGE_ROOT, 'docs', 'getting-started.md')

function stripFrontMatterTitle(markdown: string): string {
  return markdown.replace(/^title: .*\n/m, '')
}

function sectionBetween(markdown: string, heading: string, nextHeadingPrefix = '\n### '): string {
  const start = markdown.indexOf(heading)
  if (start === -1) {
    throw new Error(`Missing heading: ${heading}`)
  }
  const rest = markdown.slice(start + heading.length)
  const endCandidates = [rest.indexOf(nextHeadingPrefix), rest.indexOf('\n## ')].filter((i) => i !== -1)
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : rest.length
  return rest.slice(0, end)
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('posthog-node generated markdown reference', () => {
  const reference = fs.readFileSync(REFERENCE_PATH, 'utf8')
  const major6 = fs.readFileSync(MAJOR_6_PATH, 'utf8')
  const gettingStarted = fs.readFileSync(GETTING_STARTED_PATH, 'utf8')

  it('keeps posthog-node-reference.md and posthog-node-6.md in sync and pinned to ~6.0', () => {
    expect(stripFrontMatterTitle(reference)).toBe(stripFrontMatterTitle(major6))
    expect(gettingStarted).toContain('npm install posthog-node@~6.0')
  })

  it('includes subpath exports without duplicating symbols or exposing internal helpers', () => {
    expect(reference).toContain('### `PostHogInterceptor`')
    expect(reference).toContain("import { PostHogInterceptor } from 'posthog-node/nestjs'")
    expect(reference).toContain('### `PostHogContextSpanProcessor`')
    expect(reference).toContain("import { PostHogContextSpanProcessor } from 'posthog-node/otel'")
    expect(reference).toContain('### `PostHogInterceptorOptions`')
    expect(reference).toContain('### `ExceptionCaptureOptions`')

    expect(countOccurrences(reference, '### `enrichCurrentSpan`')).toBe(1)
    expect(countOccurrences(reference, '### `BeforeSendFn`')).toBe(1)
    expect(reference).not.toContain('CaptureEvent')
    expect(reference).not.toContain('PostHog.flushWithPendingPromises')
  })

  it('documents cross-cutting setup sections in getting started', () => {
    const started = sectionBetween(reference, '## Getting started', '\n## ')
    expect(started).toContain('### Share context across calls')
    expect(started).toContain('setupExpressRequestContext')
    expect(started).toContain('posthog-node/nestjs')
    expect(started).toContain('posthogHonoMiddleware')
    expect(started).toContain('instrumentRequest')
    expect(started).toContain('### Flush in short-lived runtimes')
    expect(started).toContain('posthog-node/edge')
    expect(started).toContain('### Handle background errors')
    expect(started).toContain("client.on('error'")
  })

  it('uses modern v6 examples and constructor guidance', () => {
    expect(reference).not.toContain('new PostHogBackendClient')
    expect(reference).not.toMatch(/https:\/\/app\.posthog\.com(?!\/project\/settings)/)

    const ctor = sectionBetween(reference, '### `new PostHog(...)`')
    expect(ctor).toContain('| Call | Methods | Reach for it when |')
    expect(ctor).toContain('phx_')

    for (const heading of [
      '### `PostHog.captureImmediate`',
      '### `PostHog.isLocalEvaluationReady`',
      '### `PostHog.waitForLocalEvaluationReady`',
      '### `PostHog.reloadFeatureFlags`',
    ]) {
      const section = sectionBetween(reference, heading)
      expect(section).not.toContain('sendFeatureFlags:')
      expect(section).not.toContain('client.getFeatureFlag(')
    }

    const waitReady = sectionBetween(reference, '### `PostHog.waitForLocalEvaluationReady`')
    expect(waitReady).toContain('30000')
    expect(waitReady).not.toContain('THIRTY_SECONDS')
  })

  it('documents state, lifecycle, emails, options, types, and IPostHog cleanly', () => {
    const emails = sectionBetween(reference, '### `PostHog.emails`')
    expect(emails).toContain('- **Credentials and scopes.**')
    expect(emails).toContain('- **Routing and retries.**')
    expect(emails).toContain('- **Result handling.**')
    expect(emails).toContain('- **Lifecycle.**')

    for (const heading of [
      '### `PostHog.isDebug`',
      '### `PostHog.isDisabled`',
      '### `PostHog.optedOut`',
      '### `PostHog.optIn`',
      '### `PostHog.optOut`',
      '### `PostHog.shutdown`',
    ]) {
      const section = sectionBetween(reference, heading)
      expect(section.trim().length).toBeGreaterThan(0)
      const betweenSignatureAndReturns = section.split('#### Returns')[0].split('##### Returns')[0]
      expect(betweenSignatureAndReturns).toMatch(/[a-z]{3,}/)
    }

    const posthogOptions = sectionBetween(reference, '### `PostHogOptions`')
    for (const optionName of ['enableLocalEvaluation', 'enableExceptionAutocapture', 'fetch', 'persistence']) {
      const rowMatch = posthogOptions.match(
        new RegExp(`\\| (?:<a id="[^"]+"><\\/a> )?\`${optionName}(?:\\(\\))?\\??\` \\|[^|]+\\| ([^|]+) \\|`)
      )
      expect(rowMatch?.[1]?.trim()).not.toBe('-')
      expect(rowMatch?.[1]?.trim()?.length).toBeGreaterThan(10)
    }
    expect(posthogOptions).toContain('disableGeoip: false')
    expect(posthogOptions).toContain('$ip')

    for (const typeHeading of [
      '### `EventMessage`',
      '### `IdentifyMessage`',
      '### `GroupIdentifyMessage`',
      '### `SetPersonPropertiesMessage`',
      '### `UnsetPersonPropertiesMessage`',
      '### `BaseFlagEvaluationOptions`',
      '### `FlagEvaluationOptions`',
      '### `ContextData`',
    ]) {
      const section = sectionBetween(reference, typeHeading)
      expect(section).not.toContain('| - |')
    }

    const unresolved = sectionBetween(reference, '### `UnresolvedFlagReason`')
    expect(unresolved).toContain('| Reason | Cause |')
    const reasonOrder = [
      'experience_continuity',
      'unsupported_definition',
      'unresolved_dependency',
      'missing_context',
    ].map((reason) => unresolved.indexOf(`| \`${reason}\` |`))
    expect(reasonOrder.every((idx) => idx !== -1)).toBe(true)
    expect(reasonOrder).toEqual([...reasonOrder].sort((a, b) => a - b))

    const iposthog = sectionBetween(reference, '### `IPostHog`')
    expect(iposthog).not.toContain('| `distinctId` | `EventMessage` |')
    expect(iposthog).not.toContain('| `groupType` | `GroupIdentifyMessage` |')
    expect(iposthog).not.toContain('requires:')
  })
})
