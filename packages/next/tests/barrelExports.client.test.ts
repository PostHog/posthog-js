/**
 * @vitest-environment jsdom
 *
 * Smoke tests for the per-runtime barrels resolved by the `browser`
 * exports condition. Asserts that client-only barrels expose the
 * documented client-safe surface and DO NOT re-export anything that
 * pulls in `server-only` or `posthog-node`. If a server-only symbol
 * leaks in here, Next.js's enforcement plugin will reject the client
 * bundle in consumer apps.
 */

vi.mock('next/router.js', () => ({ useRouter: vi.fn() }))
vi.mock('next/navigation.js', () => ({
    usePathname: vi.fn(),
    useSearchParams: vi.fn(),
}))
vi.mock('@posthog/react', () => ({
    PostHogContext: { Provider: ({ children }: { children: unknown }) => children },
    usePostHog: vi.fn(),
    useFeatureFlagResult: vi.fn(),
    useActiveFeatureFlags: vi.fn(),
    PostHogFeature: vi.fn(() => null),
}))
vi.mock('posthog-js', () => ({ __esModule: true, default: { __loaded: false, init: vi.fn() } }))

import * as pagesClient from '../src/pages.client'
import * as indexClient from '../src/index.client'

const asRecord = (mod: unknown) => mod as Record<string, unknown>

describe('client barrels (browser exports condition)', () => {
    describe("@posthog/next/pages → 'browser' → pages.client", () => {
        it.each([
            ['PostHogProvider', 'function'],
            ['PostHogPageView', 'function'],
            ['DEFAULT_INGEST_PATH', 'string'],
        ])('exposes %s as %s', (name, expectedType) => {
            expect(typeof asRecord(pagesClient)[name]).toBe(expectedType)
        })

        it.each(['getServerSidePostHog', 'getPostHog', 'createPostHog', 'postHogMiddleware'])('omits %s', (name) => {
            expect(asRecord(pagesClient)[name]).toBeUndefined()
        })
    })

    describe("@posthog/next → 'browser' → index.client", () => {
        it.each([
            ['PostHogPageView', 'function'],
            ['usePostHog', 'function'],
            ['useFeatureFlag', 'function'],
            ['useActiveFeatureFlags', 'function'],
            ['PostHogFeature', 'function'],
            ['DEFAULT_INGEST_PATH', 'string'],
        ])('exposes %s as %s', (name, expectedType) => {
            expect(typeof asRecord(indexClient)[name]).toBe(expectedType)
        })

        it.each([
            'PostHogProvider',
            'getPostHog',
            'createPostHog',
            'postHogMiddleware',
            'captureRequestError',
            'onRequestError',
            'createOnRequestError',
        ])('omits %s', (name) => {
            expect(asRecord(indexClient)[name]).toBeUndefined()
        })
    })
})
